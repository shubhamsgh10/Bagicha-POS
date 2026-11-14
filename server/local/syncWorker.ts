// The shop PC's down-sync loop: snapshot once, then pull the cloud change log every 60 s, on demand
// (requestPull / pullNow) and after every forwarded write. One cycle at a time; requests that
// arrive during a cycle just schedule exactly one more.
import type { PGlite } from "@electric-sql/pglite";
import { SYNC_TABLES_V2, SNAPSHOT_ORDER_DAYS } from "../../shared/syncTables";
import { applyChangesDetailed, applySnapshot, getCursor, upsertRows, type PullResponse, type SnapshotResponse } from "./applyChanges";
import { getMeta, setMeta } from "./localSchema";
import { counts, pendingSkipSets } from "./outbox";

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
  /**
   * Runs at the start of every cycle that already has a snapshot: replays the outbox to the cloud.
   * A rejection (cloud unreachable) fails the cycle, i.e. the PC counts as offline. Pulls then skip
   * the orders whose entries are still pending.
   */
  beforePull?: () => Promise<void>;
  /** Called after each successful cycle (lease refills etc.). Must not throw. */
  afterCycle?: () => void | Promise<void>;
  /** A schema change was refused because unsynced actions exist (shown in status). */
  schemaBlocked?: () => boolean;
  log?: (msg: string) => void;
}

export interface SyncStatus {
  cursor: string | null;
  hasSnapshot: boolean;
  lastPullAt: string | null;
  lastError: string | null;
  online: boolean;
  /** A cycle (replay + pull) is running right now. */
  syncing: boolean;
  outboxPending: number;
  problems: number;
  schemaBlocked: boolean;
}

export interface SyncWorker {
  start(): Promise<void>;
  stop(): void;
  /** Fire-and-forget: run a cycle soon (coalesced with one already queued). */
  requestPull(): void;
  /** Resolves when a cycle that STARTED after this call has finished, or after timeoutMs. Never rejects. */
  pullNow(timeoutMs: number): Promise<void>;
  status(): SyncStatus;
  /** status() plus the outbox counts (reads the local database). */
  fullStatus(): Promise<SyncStatus>;
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
  let syncing = false;
  let lastReplayError: string | null = null;
  let lastCounts = { pending: 0, problems: 0 };

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

  /** Protocol v2: take the cursor first, then page every table by id; the pull that follows heals anything that moved meanwhile. */
  async function snapshot() {
    const begin = await cloudGet<{ cursor: string; tables: string[]; pageSize?: number }>("/api/sync/snapshot?v=2&begin=1", reqTimeout);
    if (typeof begin?.cursor !== "string" || !Array.isArray(begin.tables)) throw new Error("malformed snapshot start");
    const tables: Record<string, unknown[]> = {};
    for (const t of SYNC_TABLES_V2) {
      const rows: unknown[] = [];
      let after: string | null = null;
      for (;;) {
        const q: string = `/api/sync/snapshot?v=2&table=${encodeURIComponent(t)}&limit=${begin.pageSize ?? 1000}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
        const page: { rows: unknown[]; next: string | null } = await cloudGet(q, snapTimeout);
        for (const r of page.rows) rows.push(r);
        if (!page.next) break;
        after = String(page.next);
      }
      tables[t] = rows;
    }
    const snap: SnapshotResponse = { cursor: begin.cursor, tables };
    await applySnapshot(client, snap);
    cursor = snap.cursor;
    snapshotAt = new Date().toISOString();
    await setMeta(client, "snapshot_at", snapshotAt);
    await setMeta(client, "tables_dirty", null);
    const c = SYNC_TABLES_V2.map((t) => `${t}=${snap.tables[t]?.length ?? 0}`).join(" ");
    log(`snapshot applied (${c})`);
    await notifyApplied(Array.from(SYNC_TABLES_V2));
  }

  /** Re-reads the `tables` table (a pull skipped some rows while their orders had pending edits). */
  async function resyncTables() {
    const rows: unknown[] = [];
    let after: string | null = null;
    for (;;) {
      const q: string = `/api/sync/snapshot?v=2&table=tables&limit=1000${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const page: { rows: unknown[]; next: string | null } = await cloudGet(q, reqTimeout);
      for (const r of page.rows) rows.push(r);
      if (!page.next) break;
      after = String(page.next);
    }
    await upsertRows(client, "tables", rows);
    await setMeta(client, "tables_dirty", null);
    log("tables re-synced after the outbox drained");
    await notifyApplied(["tables"]);
  }

  async function cycle() {
    if (!cursor) cursor = await getCursor(client);
    if (!cursor) return snapshot();
    // Replay first: the pull below must not overwrite orders the cloud has not heard about yet.
    if (opts.beforePull) {
      try { await opts.beforePull(); lastReplayError = null; } catch (e: any) {
        if (!e?.deferred) throw e; // network failure: the cloud is unreachable
        lastReplayError = e?.message ?? String(e);
        log(`replay deferred: ${lastReplayError}`);
      }
    }
    let pull: PullResponse | { reset: true };
    try {
      pull = await cloudGet(`/api/sync/pull?v=2&cursor=${encodeURIComponent(cursor)}`, reqTimeout);
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
    const skip = await pendingSkipSets(client);
    const r = await applyChangesDetailed(client, p, skip);
    cursor = p.cursor;
    if (p.changes.length) log(`applied ${p.changes.length - r.skipped} change(s) [${r.touched.join(", ")}]${r.skipped ? `, kept ${r.skipped} (unsynced local edits)` : ""}`);
    if (r.skippedTables) await setMeta(client, "tables_dirty", "1");
    if (r.touched.length) await notifyApplied(r.touched);
    if ((await getMeta(client, "tables_dirty")) === "1" && (await counts(client)).pending === 0) await resyncTables();
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
    syncing = true;
    try {
      while (again && !stopped) {
        again = false;
        const n = ++started;
        try {
          await cycle();
          if (opts.afterCycle) { try { await opts.afterCycle(); } catch (e: any) { log(`afterCycle failed: ${e?.message ?? e}`); } }
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
      syncing = false;
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
      return {
        cursor, hasSnapshot: cursor !== null, lastPullAt, lastError: lastError ?? lastReplayError, online, syncing,
        outboxPending: lastCounts.pending, problems: lastCounts.problems, schemaBlocked: opts.schemaBlocked?.() ?? false,
      };
    },
    async fullStatus() {
      lastCounts = await counts(client).catch(() => lastCounts);
      return this.status();
    },
  };
}
