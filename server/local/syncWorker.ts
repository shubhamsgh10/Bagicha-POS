// The shop PC's down-sync loop: snapshot once, then pull the cloud change log every 60 s, on demand
// (requestPull / pullNow) and after every forwarded write. One cycle at a time; requests that
// arrive during a cycle just schedule exactly one more.
import type { PGlite } from "@electric-sql/pglite";
import { SYNC_TABLES } from "../../shared/syncTables";
import { applyChanges, applySnapshot, getCursor, type PullResponse, type SnapshotResponse } from "./applyChanges";
import { getMeta, setMeta } from "./localSchema";
import { SNAPSHOT_ORDER_DAYS } from "../../shared/syncTables";

export interface SyncWorkerOptions {
  client: PGlite;
  /** No trailing slash. */
  cloudUrl: string;
  /** Vercel Deployment Protection bypass secret (never logged). */
  bypassSecret?: string;
  deviceToken: string;
  fetchImpl?: typeof fetch;
  pullIntervalMs?: number;
  /** Per-request abort for pulls. Default 10 s. */
  requestTimeoutMs?: number;
  /** Snapshots are big; default 60 s. */
  snapshotTimeoutMs?: number;
  /** Called after rows were applied, with the tables touched. Must not throw (errors are logged). */
  onApplied?: (tables: string[]) => void | Promise<void>;
  log?: (msg: string) => void;
}

export interface SyncStatus {
  cursor: string | null;
  hasSnapshot: boolean;
  lastPullAt: string | null;
  lastError: string | null;
  online: boolean;
}

export interface SyncWorker {
  start(): Promise<void>;
  stop(): void;
  /** Fire-and-forget: run a cycle soon (coalesced with one already queued). */
  requestPull(): void;
  /** Resolves when a cycle that STARTED after this call has finished, or after timeoutMs. Never rejects. */
  pullNow(timeoutMs: number): Promise<void>;
  status(): SyncStatus;
  /** Orders created before this are not in the local copy (null = unknown). */
  coverageStart(): Date | null;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function createSyncWorker(opts: SyncWorkerOptions): SyncWorker {
  const { client, cloudUrl, deviceToken } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const intervalMs = opts.pullIntervalMs ?? 60_000;
  const reqTimeout = opts.requestTimeoutMs ?? 10_000;
  const snapTimeout = opts.snapshotTimeoutMs ?? 60_000;
  const log = opts.log ?? ((m: string) => console.log(`[local-sync] ${m}`));

  let cursor: string | null = null;
  let snapshotAt: string | null = null;
  let lastPullAt: string | null = null;
  let lastError: string | null = null;
  let online = false;
  let failures = 0;

  let stopped = false;
  let running = false;
  let again = false;
  let started = 0;
  let finished = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const waiters: Array<{ target: number; done: () => void }> = [];

  async function cloudGet<T>(path: string, timeoutMs: number): Promise<T> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await doFetch(`${cloudUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${deviceToken}`, Accept: "application/json",
          ...(opts.bypassSecret ? { "x-vercel-protection-bypass": opts.bypassSecret } : {}),
        },
        signal: ac.signal,
      });
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        throw new HttpError(res.status, `cloud answered ${res.status}${msg ? `: ${msg}` : ""}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async function notifyApplied(tables: string[]) {
    if (!opts.onApplied) return;
    try { await opts.onApplied(tables); } catch (e: any) { log(`onApplied failed: ${e?.message ?? e}`); }
  }

  async function snapshot() {
    const snap = await cloudGet<SnapshotResponse>("/api/sync/snapshot", snapTimeout);
    await applySnapshot(client, snap);
    cursor = snap.cursor;
    snapshotAt = new Date().toISOString();
    await setMeta(client, "snapshot_at", snapshotAt);
    const counts = SYNC_TABLES.map((t) => `${t}=${snap.tables[t]?.length ?? 0}`).join(" ");
    log(`snapshot applied (${counts})`);
    await notifyApplied(Array.from(SYNC_TABLES));
  }

  async function cycle() {
    if (!cursor) cursor = await getCursor(client);
    if (!cursor) return snapshot();
    let pull: PullResponse | { reset: true };
    try {
      pull = await cloudGet(`/api/sync/pull?cursor=${encodeURIComponent(cursor)}`, reqTimeout);
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) { // cloud can't read our cursor: start over
        log("cursor rejected by the cloud; taking a fresh snapshot");
        return snapshot();
      }
      throw e;
    }
    if ("reset" in pull && pull.reset) {
      log("cloud asked for a reset; taking a fresh snapshot");
      return snapshot();
    }
    const p = pull as PullResponse;
    const touched = await applyChanges(client, p);
    cursor = p.cursor;
    if (p.changes.length) log(`applied ${p.changes.length} change(s) [${touched.join(", ")}]`);
    if (touched.length) await notifyApplied(touched);
  }

  function schedule() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const delay = failures > 0 ? Math.min(60_000, 1000 * 2 ** Math.min(failures - 1, 6)) : intervalMs;
    timer = setTimeout(kick, delay);
    (timer as any).unref?.();
  }

  async function loop() {
    running = true;
    try {
      while (again && !stopped) {
        again = false;
        const n = ++started;
        try {
          await cycle();
          online = true;
          lastError = null;
          failures = 0;
          lastPullAt = new Date().toISOString();
        } catch (e: any) {
          online = false;
          failures++;
          lastError = e?.name === "AbortError" ? "cloud request timed out" : (e?.message ?? String(e));
          log(`cycle failed (${failures}): ${lastError}`);
        }
        finished = n;
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].target <= finished) { waiters[i].done(); waiters.splice(i, 1); }
        }
      }
    } finally {
      running = false;
      schedule();
    }
  }

  function kick() {
    if (stopped) return;
    again = true;
    if (!running) void loop();
  }

  return {
    async start() {
      stopped = false;
      cursor = await getCursor(client);
      snapshotAt = await getMeta(client, "snapshot_at");
      kick();
      // Wait for the first cycle so a boot with an empty DB has data (or a recorded error) before serving.
      await this.pullNow(reqTimeout + snapTimeout);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const w of waiters.splice(0)) w.done();
    },
    requestPull: kick,
    pullNow(timeoutMs: number) {
      return new Promise<void>((resolve) => {
        const target = started + 1;
        let t: ReturnType<typeof setTimeout> | null = null;
        const done = () => { if (t) clearTimeout(t); resolve(); };
        waiters.push({ target, done });
        t = setTimeout(() => {
          const i = waiters.findIndex((w) => w.done === done);
          if (i >= 0) waiters.splice(i, 1);
          resolve();
        }, timeoutMs);
        kick();
      });
    },
    coverageStart() {
      if (!snapshotAt) return null;
      // 1 h of slack: the cloud measures "3 days" from its own now(), the snapshot lands a moment later.
      return new Date(new Date(snapshotAt).getTime() - SNAPSHOT_ORDER_DAYS * 86_400_000 + 3_600_000);
    },
    status() {
      return { cursor, hasSnapshot: cursor !== null, lastPullAt, lastError, online };
    },
  };
}
