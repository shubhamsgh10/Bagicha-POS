// The shop PC's outbox: every successful local write on the replay list is appended here and later
// re-sent to the cloud in order by replayWorker.ts. Plain SQL on the PGlite client (no drizzle), so
// it can be used from the worker, the gate middleware and the verify script alike.
//
// status: pending (to send) | sent (acknowledged) | problem (the cloud refused it: needs a person) |
//         discarded (a person gave up on a problem entry).
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";

export type OutboxStatus = "pending" | "sent" | "problem" | "discarded";

/** Numbers the local request took from its leases; they ride to the cloud as clientId / clientOrderNumber / clientKotNumber. */
export interface RequestNumbers { id?: number; billNo?: number; kotNos: number[] }
export interface RequestCtx { numbers: RequestNumbers }
export const requestCtx = new AsyncLocalStorage<RequestCtx>();

export function noteIssued(kind: "order_id" | "bill_counter" | "kot_counter", value: number): void {
  const c = requestCtx.getStore();
  if (!c) return;
  if (kind === "order_id") c.numbers.id = value;
  else if (kind === "bill_counter") c.numbers.billNo = value;
  else c.numbers.kotNos.push(value);
}

export interface OutboxRow {
  seq: number;
  orderId: number | null;
  method: string;
  path: string;
  body: any;
  idemKey: string;
  actor: string;
  approver: string | null;
  base: string | null;
  numbers: RequestNumbers | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  lastCode: string | null;
  createdAt: string;
}

function mapRow(r: any): OutboxRow {
  return {
    seq: Number(r.seq), orderId: r.order_id ?? null, method: r.method, path: r.path, body: r.body, idemKey: r.idem_key,
    actor: r.actor, approver: r.approver ?? null, base: r.base ?? null, numbers: r.numbers ?? null, status: r.status,
    attempts: Number(r.attempts), lastError: r.last_error ?? null, lastCode: r.last_code ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export function newIdemKey(): string {
  return crypto.randomUUID();
}

/** The order a replay-list request touches, from its path (null: creation, or not an order). */
export function orderIdOfPath(path: string, body: any): number | null {
  const m = /^\/api\/orders\/(\d+)(\/|$)/.exec(path);
  if (m) return Number(m[1]);
  if ((path === "/api/print/kot" || path === "/api/print/bill") && Number.isInteger(Number(body?.orderId))) return Number(body.orderId);
  return null;
}

export async function appendOutbox(client: PGlite, e: {
  orderId: number | null; method: string; path: string; body: unknown; idemKey: string; actor: string;
  approver: string | null; base: string | null; numbers: RequestNumbers | null;
}): Promise<number> {
  const r = await client.query<{ seq: string }>(
    `INSERT INTO local_outbox (order_id, method, path, body, idem_key, actor, approver, base, numbers)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb) RETURNING seq`,
    [e.orderId, e.method, e.path, JSON.stringify(e.body ?? null), e.idemKey, e.actor, e.approver, e.base,
      e.numbers ? JSON.stringify(e.numbers) : null],
  );
  return Number(r.rows[0].seq);
}

export async function listPending(client: PGlite, limit = 50): Promise<OutboxRow[]> {
  const r = await client.query(`SELECT * FROM local_outbox WHERE status = 'pending' ORDER BY seq LIMIT $1`, [limit]);
  return r.rows.map(mapRow);
}

export async function listProblems(client: PGlite): Promise<OutboxRow[]> {
  const r = await client.query(`SELECT * FROM local_outbox WHERE status = 'problem' ORDER BY seq`);
  return r.rows.map(mapRow);
}

export async function counts(client: PGlite): Promise<{ pending: number; problems: number }> {
  const r = await client.query<{ s: string; n: number }>(`SELECT status AS s, count(*)::int AS n FROM local_outbox WHERE status IN ('pending','problem') GROUP BY status`);
  const o = { pending: 0, problems: 0 };
  for (const row of r.rows) { if (row.s === "pending") o.pending = row.n; else o.problems = row.n; }
  return o;
}

export async function markSent(client: PGlite, seq: number): Promise<void> {
  await client.query(`UPDATE local_outbox SET status='sent', last_error=NULL, last_code=NULL, updated_at=now() WHERE seq=$1`, [seq]);
}

export async function noteAttempt(client: PGlite, seq: number, error: string | null): Promise<void> {
  await client.query(`UPDATE local_outbox SET attempts = attempts + 1, last_error = $2, updated_at = now() WHERE seq = $1`, [seq, error]);
}

/** The entry and every later PENDING entry of the same order become problems (an entry with no order only itself). */
export async function markProblem(client: PGlite, row: OutboxRow, message: string, code: string | null): Promise<number[]> {
  const r = row.orderId === null
    ? await client.query<{ seq: string }>(`UPDATE local_outbox SET status='problem', last_error=$2, last_code=$3, updated_at=now() WHERE seq=$1 RETURNING seq`, [row.seq, message, code])
    : await client.query<{ seq: string }>(
      `UPDATE local_outbox SET status='problem',
         last_error = CASE WHEN seq = $1 THEN $3 ELSE 'Held back because an earlier action on this order was refused' END,
         last_code = CASE WHEN seq = $1 THEN $4 ELSE NULL END, updated_at=now()
       WHERE order_id = $2 AND status = 'pending' AND seq >= $1 RETURNING seq`, [row.seq, row.orderId, message, code]);
  return r.rows.map((x) => Number(x.seq));
}

/** Re-queue a problem entry and every later problem entry of the same order. */
export async function retryProblem(client: PGlite, seq: number): Promise<number> {
  const r = await client.query<{ order_id: number | null }>(`SELECT order_id FROM local_outbox WHERE seq=$1 AND status='problem'`, [seq]);
  if (!r.rows.length) return 0;
  const oid = r.rows[0].order_id;
  const u = oid === null
    ? await client.query(`UPDATE local_outbox SET status='pending', attempts=0, last_error=NULL, last_code=NULL, base=NULL, updated_at=now() WHERE seq=$1 RETURNING seq`, [seq])
    : await client.query(`UPDATE local_outbox SET status='pending', attempts=0, last_error=NULL, last_code=NULL, base=NULL, updated_at=now() WHERE order_id=$1 AND status='problem' AND seq >= $2 RETURNING seq`, [oid, seq]);
  return u.rows.length;
}

/** Give up on a problem entry (and the later problem entries of its order, which can no longer be applied on top of it). */
export async function discardProblem(client: PGlite, seq: number): Promise<number> {
  const r = await client.query<{ order_id: number | null }>(`SELECT order_id FROM local_outbox WHERE seq=$1 AND status='problem'`, [seq]);
  if (!r.rows.length) return 0;
  const oid = r.rows[0].order_id;
  const u = oid === null
    ? await client.query(`UPDATE local_outbox SET status='discarded', updated_at=now() WHERE seq=$1 RETURNING seq`, [seq])
    : await client.query(`UPDATE local_outbox SET status='discarded', updated_at=now() WHERE order_id=$1 AND status='problem' AND seq >= $2 RETURNING seq`, [oid, seq]);
  return u.rows.length;
}

/** An order has an unreplayed (pending) entry: newer local edits exist that a pull must not overwrite. Problem entries do not count: their order was refreshed from the cloud. */
export async function hasPendingFor(client: PGlite, orderId: number): Promise<boolean> {
  const r = await client.query(`SELECT 1 FROM local_outbox WHERE order_id=$1 AND status = 'pending' LIMIT 1`, [orderId]);
  return r.rows.length > 0;
}

/**
 * What a pull must leave alone: orders with pending entries, and their tables. 'problem' entries are
 * excluded: their order was refreshed from the cloud, so the cloud's state is the truth again.
 */
export async function pendingSkipSets(client: PGlite): Promise<{ orderIds: Set<number>; tableIds: Set<number> }> {
  const rows = (await client.query<{ order_id: number | null; path: string; body: any }>(`SELECT order_id, path, body FROM local_outbox WHERE status='pending'`)).rows;
  const orderIds = new Set<number>();
  const tableIds = new Set<number>();
  for (const r of rows) {
    if (r.order_id !== null) orderIds.add(Number(r.order_id));
    const b = r.body ?? {};
    const shift = /^\/api\/tables\/(\d+)\/shift$/.exec(r.path);
    if (shift) tableIds.add(Number(shift[1]));
    for (const k of ["newTableId", "toTableId", "tableId"]) { const n = Number(b?.[k]); if (Number.isInteger(n) && n > 0) tableIds.add(n); }
  }
  if (orderIds.size) {
    const ids = Array.from(orderIds);
    const t = await client.query<{ id: number }>(`SELECT id FROM tables WHERE current_order_id = ANY($1::int[])`, [ids]);
    for (const x of t.rows) tableIds.add(Number(x.id));
    const o = await client.query<{ table_id: number | null }>(`SELECT table_id FROM orders WHERE id = ANY($1::int[])`, [ids]);
    for (const x of o.rows) if (x.table_id !== null) tableIds.add(Number(x.table_id));
  }
  return { orderIds, tableIds };
}

// ── replay base per order ────────────────────────────────────────────────────
export async function getOrderBase(client: PGlite, orderId: number): Promise<string | null> {
  const m = await client.query<{ b: string }>(`SELECT cloud_updated_at AS b FROM local_order_meta WHERE order_id=$1`, [orderId]);
  return m.rows[0]?.b ?? null;
}

export async function setOrderBase(client: Pick<PGlite, "query">, orderId: number, cloudUpdatedAt: string | null | undefined): Promise<void> {
  if (!cloudUpdatedAt) return;
  await client.query(
    `INSERT INTO local_order_meta (order_id, cloud_updated_at) VALUES ($1,$2) ON CONFLICT (order_id) DO UPDATE SET cloud_updated_at = EXCLUDED.cloud_updated_at`,
    [orderId, cloudUpdatedAt]);
}

/** The local row's updated_at as microsecond text: only valid while the order has had no local edit. */
export async function localRowBase(client: PGlite, orderId: number): Promise<string | null> {
  const r = await client.query<{ u: string }>(`SELECT to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS u FROM orders WHERE id=$1`, [orderId]);
  return r.rows[0]?.u ?? null;
}
