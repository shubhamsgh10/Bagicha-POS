/**
 * attendanceAgent.ts — runs inside the Electron main process (the only POS component
 * on the restaurant LAN), the sibling of PrintQueue. It pulls fingerprint punches from
 * the K30 Pro and POSTs them to the cloud API's /api/attendance/device-punch.
 *
 * Resilience (mirrors PrintQueue):
 *  - Unsynced punches + the sync cursor are persisted to userData, surviving restarts
 *    and offline periods.
 *  - Live capture pushes immediately (near-real-time); a periodic full pull reconciles
 *    and recovers any missed live events.
 *  - Auth reuses the POS session cookie (like PrintQueue). Before a POS user logs in,
 *    the device itself retains punches and the agent buffers — nothing is lost.
 */

import fs from "fs";
import path from "path";
import { ZkAdapter, type RawPunch } from "./zkAdapter.js";
import type {
  AttendanceDeviceConfig,
  AttendanceStatus,
  AttendanceTestResult,
} from "../../shared/electron/ipc.js";

type GetConfig = () => Promise<AttendanceDeviceConfig | null>;
type GetCookieHeader = () => Promise<string>;
type GetApiBase = () => string;

interface BufferedPunch {
  biometricId: string;
  date: string;
  time: string;
  ts: number;
}

const FLUSH_BATCH = 200;
const FLUSH_RETRY_MS = 15_000;
const BOOTSTRAP_RETRY_MS = 30_000;
const BACKFILL_MS = 3 * 24 * 60 * 60 * 1000; // first run ever: only sync the last 3 days

export class AttendanceAgent {
  private bufferFile: string;
  private cursorFile: string;
  private tokenFile: string;
  private token: string | undefined; // device auth secret (provisioned via an admin session, then cached)
  private buffer: BufferedPunch[] = [];
  private cursor = 0; // max device-log epoch ms already pulled
  private adapter: ZkAdapter | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private connected = false;
  private lastSyncAt: number | null = null;
  private lastError: string | undefined;
  private deviceIp = "";

  constructor(
    userDataPath: string,
    private getConfig: GetConfig,
    private getCookieHeader: GetCookieHeader,
    private getApiBase: GetApiBase,
  ) {
    this.bufferFile = path.join(userDataPath, "attendance-buffer.json");
    this.cursorFile = path.join(userDataPath, "attendance-cursor.json");
    this.tokenFile = path.join(userDataPath, "attendance-token.json");
    this.loadState();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    if (this.running) return;
    const cfg = await this.getConfig().catch(() => null);
    if (!cfg || !cfg.enabled || !cfg.ip) {
      // Not configured / not logged in yet — retry shortly so it self-starts after login.
      this.scheduleBootstrap();
      return;
    }
    this.running = true;
    this.deviceIp = cfg.ip;
    if (cfg.token) this.setToken(cfg.token);
    await this.connect(cfg);
    const interval = Math.max(15, cfg.syncIntervalSec || 60) * 1000;
    this.reconcileTimer = setInterval(() => { void this.reconcile(); }, interval);
    this.flushTimer = setInterval(() => { void this.flush(); }, FLUSH_RETRY_MS);
    void this.reconcile();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    this.reconcileTimer = null;
    this.flushTimer = null;
    this.bootstrapTimer = null;
    await this.adapter?.disconnect().catch(() => {});
    this.adapter = null;
    this.connected = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private scheduleBootstrap(): void {
    if (this.bootstrapTimer) return;
    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = null;
      void this.start();
    }, BOOTSTRAP_RETRY_MS);
  }

  // ── device ─────────────────────────────────────────────────────────────────────
  private async connect(cfg: AttendanceDeviceConfig): Promise<void> {
    try {
      this.adapter = new ZkAdapter(cfg.ip, cfg.port || 4370);
      await this.adapter.connect();
      this.connected = true;
      this.lastError = undefined;
      this.adapter.onLivePunch((p) => {
        this.enqueue(p);
        void this.flush();
      });
      console.log(`[attendance] connected to ${cfg.ip}:${cfg.port || 4370}`);
    } catch (e: any) {
      this.connected = false;
      this.lastError = e?.message ?? String(e);
      console.warn("[attendance] connect failed:", this.lastError);
    }
  }

  private async reconcile(): Promise<void> {
    if (!this.running) return;
    if (!this.connected) {
      const cfg = await this.getConfig().catch(() => null);
      if (cfg?.token) this.setToken(cfg.token);
      if (cfg?.enabled && cfg.ip) await this.connect(cfg);
      if (!this.connected) return;
    }
    try {
      const punches = await this.adapter!.getAttendances();
      const minTs = this.cursor > 0 ? this.cursor : Date.now() - BACKFILL_MS;
      let maxTs = this.cursor;
      let added = 0;
      for (const p of punches) {
        if (p.ts <= minTs) continue;
        this.enqueue(p);
        added++;
        if (p.ts > maxTs) maxTs = p.ts;
      }
      if (maxTs > this.cursor) {
        this.cursor = maxTs;
        this.persistCursor();
      }
      if (added > 0) await this.flush();
    } catch (e: any) {
      this.lastError = e?.message ?? String(e);
      this.connected = false; // force a reconnect on the next cycle
      console.warn("[attendance] reconcile failed:", this.lastError);
    }
  }

  // ── buffer + flush ───────────────────────────────────────────────────────────
  private enqueue(p: RawPunch): void {
    if (this.buffer.some((b) => b.biometricId === p.biometricId && b.date === p.date && b.time === p.time)) {
      return; // dedupe identical punch (live vs reconcile overlap)
    }
    this.buffer.push({ biometricId: p.biometricId, date: p.date, time: p.time, ts: p.ts });
    this.persistBuffer();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.slice(0, FLUSH_BATCH);
    const cookie = await this.getCookieHeader().catch(() => "");
    try {
      const res = await fetch(`${this.getApiBase()}/api/attendance/device-punch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { "X-Device-Token": this.token } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({
          deviceId: this.deviceIp,
          punches: batch.map((b) => ({ biometricId: b.biometricId, date: b.date, time: b.time })),
        }),
      });
      if (res.status === 401) return; // no POS user logged in yet — keep buffered, retry later
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.buffer = this.buffer.slice(batch.length);
      this.persistBuffer();
      this.lastSyncAt = Date.now();
      this.lastError = undefined;
      if (this.buffer.length > 0) setImmediate(() => { void this.flush(); });
    } catch (e: any) {
      this.lastError = e?.message ?? String(e);
      // keep buffered — the flush timer retries
    }
  }

  // ── status / test ─────────────────────────────────────────────────────────────
  async testConnection(cfg: AttendanceDeviceConfig): Promise<AttendanceTestResult> {
    const adapter = new ZkAdapter(cfg.ip, cfg.port || 4370);
    try {
      await adapter.connect();
      const info = await adapter.getInfo();
      await adapter.disconnect();
      return { ok: true, info };
    } catch (e: any) {
      await adapter.disconnect().catch(() => {});
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  getStatus(): AttendanceStatus {
    return {
      enabled: this.running,
      connected: this.connected,
      lastSyncAt: this.lastSyncAt,
      buffered: this.buffer.length,
      lastError: this.lastError,
      deviceIp: this.deviceIp || undefined,
    };
  }

  // ── persistence ────────────────────────────────────────────────────────────────
  private loadState(): void {
    try {
      const saved = JSON.parse(fs.readFileSync(this.bufferFile, "utf8"));
      this.buffer = Array.isArray(saved) ? saved : [];
    } catch {
      this.buffer = [];
    }
    try {
      const c = JSON.parse(fs.readFileSync(this.cursorFile, "utf8"));
      this.cursor = typeof c?.cursor === "number" ? c.cursor : 0;
    } catch {
      this.cursor = 0;
    }
    try {
      const t = JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
      this.token = typeof t?.token === "string" && t.token ? t.token : undefined;
    } catch {
      this.token = undefined;
    }
  }

  /** Cache + persist the device token once an admin/manager session reveals it. */
  private setToken(t: string): void {
    if (!t || t === this.token) return;
    this.token = t;
    try {
      fs.writeFileSync(this.tokenFile, JSON.stringify({ token: t }), "utf8");
    } catch (e) {
      console.warn("[attendance] token persist failed:", e);
    }
  }

  private persistBuffer(): void {
    try {
      fs.writeFileSync(this.bufferFile, JSON.stringify(this.buffer), "utf8");
    } catch (e) {
      console.warn("[attendance] buffer persist failed:", e);
    }
  }

  private persistCursor(): void {
    try {
      fs.writeFileSync(this.cursorFile, JSON.stringify({ cursor: this.cursor }), "utf8");
    } catch (e) {
      console.warn("[attendance] cursor persist failed:", e);
    }
  }
}
