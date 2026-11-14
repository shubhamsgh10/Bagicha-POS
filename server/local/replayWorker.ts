// Re-sends the shop PC's outbox to the cloud, in order, as the original requests (see the phase-4
// plan, "Core design"). Called at the start of every sync cycle (syncWorker's beforePull), so a replay
// and a pull never run at the same time.
//
// Rules:
//  - strictly in `seq` order; a network error / 5xx / 408 / 429 stops the drain and is retried next
//    cycle (never reordered, never skipped);
//  - any other 4xx is a PROBLEM: that entry and every later pending entry of the same order are held
//    (status problem), the order is refreshed from the cloud, and entries of other orders keep flowing;
//  - a 401 WITHOUT a code is the device token itself being refused (revoked): nothing is marked, the
//    cycle just fails until an admin fixes the token;
//  - every attempt re-sends the entry's own Idempotency-Key, so a lost answer replays the cloud's
//    stored answer instead of a false conflict;
//  - after an acknowledgement the order's cloud rows replace the local ones (temporary item / ticket
//    ids vanish) once no later entry for it is pending; until then only its replay base is refreshed.
import type { PGlite } from "@electric-sql/pglite";
import {
  listPending, markSent, markProblem, noteAttempt, hasPendingFor, getOrderBase, type OutboxRow,
} from "./outbox";
import { replaceOrderRows, recordOrderBase, LOCAL_TEMP_ID_FLOOR, type OrderRefresh } from "./applyChanges";

export interface ReplayerOptions {
  client: PGlite;
  /** No trailing slash. */
  cloudUrl: string;
  deviceToken: string;
  bypassSecret?: string;
  fetchImpl?: typeof fetch;
  /** Per replayed request. Default 30 s (a replay prints nothing but still saves, prices and audits). */
  timeoutMs?: number;
  /** Called after local rows of an order were replaced from the cloud. Must not throw. */
  onOrderRefreshed?: (orderId: number) => void | Promise<void>;
  log?: (msg: string) => void;
}

export interface Replayer {
  /** Sends every pending entry it can. Rejects on a network failure / 5xx (the caller treats the cloud as offline). */
  drain(): Promise<void>;
  /** Replaces one order's local rows from the cloud. `allowDelete`: a cloud "deleted" answer removes the local rows too. */
  refreshOrder(orderId: number, allowDelete: boolean): Promise<void>;
  /** The order's CURRENT cloud updated_at (null = not on the cloud). Rejects when the cloud is unreachable. */
  currentCloudBase(orderId: number): Promise<string | null>;
}

/**
 * The cloud answered but cannot take this entry right now (5xx / 408 / 429 / the token refused). The
 * outbox is left as is and retried next cycle, but the cloud IS reachable, so the sync cycle carries
 * on and pulls (a pull skips the orders that still have pending entries).
 */
export class ReplayDeferred extends Error {
  readonly deferred = true;
}
export class ReplayStop extends ReplayDeferred {}

/** The body the cloud gets: the original request plus the numbers this PC printed on paper. */
export function replayBody(row: OutboxRow): unknown {
  const body = row.body && typeof row.body === "object" && !Array.isArray(row.body) ? { ...row.body } : row.body;
  const n = row.numbers;
  if (!n || !body || typeof body !== "object") return body;
  const b = body as Record<string, unknown>;
  if (row.method === "POST" && row.path === "/api/orders") {
    if (n.id !== undefined) b.clientId = n.id;
    if (n.billNo !== undefined) b.clientOrderNumber = `ORD${String(n.billNo).padStart(4, "0")}`;
  }
  if (n.kotNos.length > 0 && (row.path === "/api/orders" || /\/items$/.test(row.path))) b.clientKotNumber = String(n.kotNos[0]).padStart(3, "0");
  return b;
}

export function createReplayer(opts: ReplayerOptions): Replayer {
  const { client } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const log = opts.log ?? ((m: string) => console.log(`[local-replay] ${m}`));

  function baseHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${opts.deviceToken}`,
      ...(opts.bypassSecret ? { "x-vercel-protection-bypass": opts.bypassSecret } : {}),
    };
  }

  async function call(method: string, path: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: any }> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await doFetch(`${opts.cloudUrl}${path}`, {
        method,
        headers: { ...baseHeaders(), Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: ac.signal,
      });
      let json: any = null;
      try { json = await res.json(); } catch { /* not JSON */ }
      return { status: res.status, json };
    } catch (e: any) {
      throw new Error(e?.name === "AbortError" ? "cloud request timed out" : (e?.message ?? String(e)));
    } finally {
      clearTimeout(t);
    }
  }

  async function fetchOrder(orderId: number): Promise<OrderRefresh | null | undefined> {
    const r = await call("GET", `/api/sync/order/${orderId}`, {}, undefined);
    if (r.status !== 200 || !r.json) return undefined; // could not tell: leave local rows alone
    if (r.json.deleted) return null;
    return { order: r.json.order, items: r.json.items ?? [], kotTickets: r.json.kotTickets ?? [] };
  }

  async function refreshOrder(orderId: number, allowDelete: boolean): Promise<void> {
    const data = await fetchOrder(orderId);
    if (data === undefined) return;
    if (data === null && !allowDelete) return;
    await replaceOrderRows(client, orderId, data);
    try { await opts.onOrderRefreshed?.(orderId); } catch (e: any) { log(`onOrderRefreshed failed: ${e?.message ?? e}`); }
  }

  async function acknowledge(row: OutboxRow, resJson: any): Promise<void> {
    const orderId = row.orderId ?? (Number.isInteger(Number(resJson?.id)) ? Number(resJson.id) : null);
    if (orderId === null) return;
    try {
      if (await hasPendingFor(client, orderId)) {
        // Later local edits exist: only learn the cloud's new version (the base of the next entry).
        const data = await fetchOrder(orderId);
        if (data && typeof data.order?.updated_at === "string") await recordOrderBase(client, orderId, data.order.updated_at);
      } else {
        await refreshOrder(orderId, true);
      }
    } catch (e: any) {
      // The next pull brings the same rows (its cursor predates this replay): not fatal.
      log(`order ${orderId} refresh after acknowledgement failed (${e?.message ?? e}); the next pull will heal it`);
    }
  }

  /**
   * A kitchen ticket created offline has a temporary local id (>= 1e9) the cloud has never heard of;
   * find the cloud's ticket by its KOT number (the order's cloud rows are fetched for that).
   * null = cannot be mapped (yet).
   */
  async function cloudKotPath(path: string): Promise<string | null> {
    const m = /^\/api\/kot\/(\d+)$/.exec(path);
    if (!m || Number(m[1]) < LOCAL_TEMP_ID_FLOOR) return path;
    const t = (await client.query<{ order_id: number; kot_number: string }>(`SELECT order_id, kot_number FROM kot_tickets WHERE id = $1`, [Number(m[1])])).rows[0];
    if (!t) return null;
    const data = await fetchOrder(t.order_id);
    const hit = data?.kotTickets.find((k: any) => String(k.kot_number) === String(t.kot_number));
    return hit ? `/api/kot/${hit.id}` : null;
  }

  async function sendOne(row: OutboxRow): Promise<"sent" | "problem"> {
    const base = row.base ?? (row.orderId !== null ? await getOrderBase(client, row.orderId) : null);
    const headers: Record<string, string> = {
      "X-Bagicha-Replay": "1",
      "X-Replay-Actor": row.actor,
      "X-Replay-At": row.createdAt,
      "Idempotency-Key": row.idemKey,
    };
    if (row.approver) headers["X-Replay-Approver"] = row.approver;
    if (base) headers["X-Replay-Base"] = base;
    if (row.override) headers["X-Replay-Override"] = String(row.seq);
    let r: { status: number; json: any };
    let sendPath = row.path;
    try {
      const mapped = await cloudKotPath(row.path);
      if (mapped === null) {
        const held = await markProblem(client, row, "The kitchen ticket is not on the cloud yet", "kot_unmapped");
        log(`entry ${row.seq}: kitchen ticket not mappable; ${held.length} held`);
        return "problem";
      }
      sendPath = mapped;
      r = await call(row.method, sendPath, headers, replayBody(row));
    } catch (e: any) {
      await noteAttempt(client, row.seq, e?.message ?? String(e));
      throw e;
    }
    if (r.status >= 200 && r.status < 300) {
      await markSent(client, row.seq);
      await acknowledge(row, r.json);
      return "sent";
    }
    const message = String(r.json?.error ?? r.json?.message ?? `The cloud answered ${r.status}`);
    const code = r.json?.code ? String(r.json.code) : null;
    if (r.status === 401 && !code) {
      await noteAttempt(client, row.seq, message);
      throw new ReplayStop(`device token refused: ${message}`);
    }
    if (r.status >= 500 || r.status === 408 || r.status === 429) {
      await noteAttempt(client, row.seq, message);
      throw new ReplayDeferred(`cloud answered ${r.status}: ${message}`);
    }
    const held = await markProblem(client, row, message, code);
    log(`entry ${row.seq} ${row.method} ${row.path} refused (${r.status}${code ? " " + code : ""}): ${message}; ${held.length} held`);
    if (row.orderId !== null) {
      try { await refreshOrder(row.orderId, row.method !== "POST" || row.path !== "/api/orders"); } catch (e: any) { log(`refresh after problem failed: ${e?.message ?? e}`); }
    }
    return "problem";
  }

  let draining: Promise<void> | null = null;
  async function drainOnce(): Promise<void> {
    for (;;) {
      const rows = await listPending(client, 25);
      if (rows.length === 0) return;
      // Rows are re-listed after a problem (its cascade may have held later rows of the same order).
      for (const row of rows) {
        const outcome = await sendOne(row);
        if (outcome === "problem") break;
      }
    }
  }

  return {
    drain() {
      if (!draining) draining = drainOnce().finally(() => { draining = null; });
      return draining;
    },
    refreshOrder,
    async currentCloudBase(orderId: number) {
      const r = await call("GET", `/api/sync/order/${orderId}`, {}, undefined);
      if (r.status !== 200 || !r.json) throw new Error(`cloud answered ${r.status}`);
      return r.json.deleted ? null : (typeof r.json.order?.updated_at === "string" ? r.json.order.updated_at : null);
    },
  };
}
