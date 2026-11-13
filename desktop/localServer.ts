// Supervisor for the shop PC's local server child process. Electron-free on purpose (the caller passes
// the executable, entry and env) so scripts/verify-local-mode-config.ts can drive it with a fake child.
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import {
  decideAfterExit,
  readyTimedOut,
  LOCAL_READY_TIMEOUT_MS,
  LOCAL_CRASH_LIMIT,
  LOCAL_CRASH_WINDOW_MS,
} from "./localMode.js";

export interface LocalServerOptions {
  execPath: string;
  entry: string;
  env: NodeJS.ProcessEnv;
  port: number;
  readyTimeoutMs?: number;
  crashLimit?: number;
  crashWindowMs?: number;
  /** Multiplies restart backoff (tests use a tiny value). */
  backoffScale?: number;
  stdio?: "inherit" | "ignore" | "pipe";
  log?: (msg: string) => void;
}

export type StartOutcome = { ok: true } | { ok: false; reason: string };

/** GET /api/local/status must answer 200 with { localMode: true } — /api/auth/context would also answer on a stray server. */
export function probeLocalStatus(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/api/local/status", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (body.length < 4096) body += c; });
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(false);
        try { resolve(JSON.parse(body)?.localMode === true); } catch { resolve(false); }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

export class LocalServer {
  private proc: ChildProcess | null = null;
  private stopping = false;
  private crashTimes: number[] = [];
  private settled = false;
  private ready = false;
  private gaveUp = false;
  /** After a not-ready timeout the child keeps running (finishing its first snapshot) but is never restarted. */
  private warmup = false;
  private resolveStart!: (o: StartOutcome) => void;
  private startedAt = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called once if the server is lost for good AFTER it was ready (crash loop). */
  onGaveUp: (reason: string) => void = () => {};
  /** Called when a warm-up child finally becomes ready after start() already reported a timeout. */
  onReadyLater: () => void = () => {};

  constructor(private readonly o: LocalServerOptions) {}

  private log(msg: string) { (this.o.log ?? console.log)(`[local-server] ${msg}`); }

  isReady() { return this.ready && !this.gaveUp; }

  start(): Promise<StartOutcome> {
    return new Promise((resolve) => {
      this.resolveStart = resolve;
      this.startedAt = Date.now();
      this.spawnChild();
      this.poll();
    });
  }

  private settle(o: StartOutcome) {
    if (this.settled) return;
    this.settled = true;
    this.resolveStart(o);
  }

  private spawnChild() {
    const { execPath, entry, env, stdio } = this.o;
    const child = spawn(execPath, [entry], { stdio: stdio ?? "inherit", env, windowsHide: true });
    this.proc = child;
    const startedAt = Date.now();
    child.on("error", (err) => this.log(`spawn error: ${err.message}`));
    child.on("exit", (code, signal) => {
      if (this.proc === child) this.proc = null;
      if (this.stopping || this.gaveUp) return;
      this.log(`exited (${signal ?? code})`);
      if (this.warmup) return; // dropped for this run already; do not churn in the background
      const now = Date.now();
      // A child that ran a long time before dying starts a fresh budget (same idea as the embedded host).
      if (now - startedAt > (this.o.crashWindowMs ?? LOCAL_CRASH_WINDOW_MS)) this.crashTimes = [];
      this.crashTimes.push(now);
      const d = decideAfterExit(this.crashTimes, now, this.o.crashLimit ?? LOCAL_CRASH_LIMIT, this.o.crashWindowMs ?? LOCAL_CRASH_WINDOW_MS);
      if (d.action === "fallback") return this.giveUp(d.reason);
      this.ready = false;
      const delay = Math.max(1, Math.round(d.delayMs * (this.o.backoffScale ?? 1)));
      this.log(`restarting (#${d.crashes}) in ${delay} ms`);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (!this.stopping && !this.gaveUp && !this.proc) { this.spawnChild(); this.poll(); }
      }, delay);
    });
  }

  private giveUp(reason: string) {
    this.gaveUp = true;
    this.ready = false;
    this.kill();
    this.log(`giving up: ${reason}`);
    if (!this.settled) this.settle({ ok: false, reason });
    else this.onGaveUp(reason);
  }

  private poll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (this.stopping || this.gaveUp) return;
    void probeLocalStatus(this.o.port).then((ok) => {
      if (this.stopping || this.gaveUp) return;
      if (ok && this.proc) {
        const first = !this.ready;
        this.ready = true;
        if (!this.settled) { this.log("ready"); this.settle({ ok: true }); }
        else if (this.warmup && first) { this.log("ready (after the start-up timeout)"); this.onReadyLater(); return; }
        return; // healthy: no more polling
      }
      if (!this.settled && readyTimedOut(this.startedAt, Date.now(), this.o.readyTimeoutMs ?? LOCAL_READY_TIMEOUT_MS)) {
        this.warmup = true;
        this.settle({ ok: false, reason: `local server not ready within ${Math.round((this.o.readyTimeoutMs ?? LOCAL_READY_TIMEOUT_MS) / 1000)} s` });
      }
      this.pollTimer = setTimeout(() => this.poll(), 500);
    });
  }

  private kill() {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    const p = this.proc;
    this.proc = null;
    if (p && !p.killed) { try { p.kill(); } catch { /* already gone */ } }
  }

  stop() {
    this.stopping = true;
    this.kill();
    if (!this.settled) this.settle({ ok: false, reason: "stopped" });
  }
}
