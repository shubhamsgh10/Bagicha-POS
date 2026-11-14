// Number leases for the shop PC (local-first phase 4).
//
// Why leases: an order created offline is printed on paper with its bill number and KOT number, and
// its row id is shown as #<id>. Those must be final, so the cloud hands the PC blocks it will honour
// later: `order_id` (orders.id), `bill_counter` (ORD#### numbers) and `kot_counter`. A replayed
// POST /api/orders / PUT /items may then carry clientId / clientOrderNumber / clientKotNumber, accepted
// ONLY inside a lease held by that device (acceptReplayNumber), else 409 lease_violation.
//
// Keeping normal cloud inserts out of an issued block:
//  - counters: the block is taken with the same row-locked jsonb_set UPDATE as issueCounter, just
//    `+ size`, so every later cloud issuance continues after the block. Atomic with the lease row.
//  - order ids: orders.id is a serial. Inside one transaction we `LOCK TABLE orders IN SHARE ROW
//    EXCLUSIVE MODE`, which conflicts with the ROW EXCLUSIVE lock every INSERT/UPDATE/DELETE on orders
//    takes at statement start (before its default nextval() runs). So no insert is mid-flight and none
//    can start until COMMIT; under the lock we nextval() once (block start) and setval() the sequence to
//    the block end. Every later cloud insert therefore gets an id past the block. A transaction-scoped
//    lock + SET LOCAL lock_timeout is pooler-safe (no session state), and unlike an advisory lock it
//    needs no cooperation from the insert paths. Cost: orders writes wait a few ms during an issuance,
//    which happens about once per 200 orders.
//  - the one thing it cannot stop is someone moving the sequence BACK afterwards (the documented
//    `setval(seq, max(id))` cleanup after deleting test orders); see CLAUDE.md.
import { pool } from "../db";
import {
  LEASE_KINDS, LEASE_DEFAULT_SIZE, LEASE_MAX_SIZE, LEASE_MAX_PER_HOUR, type LeaseKind,
} from "../../shared/syncTables";
import {
  parseClientId, parseClientKotNumber, parseClientOrderNumber,
} from "../../shared/replayRules";
import {
  LOCK_ORDERS_SQL, LEASE_RATE_SQL, ORDER_ID_BLOCK_SQL, COUNTER_BLOCK_SQL, INSERT_LEASE_SQL, IN_LEASE_SQL,
} from "./changeLogSql";
import type { QueryRunner } from "./authBlob";

export class LeaseError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function isLeaseKind(v: unknown): v is LeaseKind {
  return typeof v === "string" && (LEASE_KINDS as readonly string[]).includes(v);
}

export function clampLeaseSize(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return LEASE_DEFAULT_SIZE;
  return Math.min(Math.floor(n), LEASE_MAX_SIZE);
}

export interface IssuedLease { id: number; kind: LeaseKind; start: number; end: number }

/** Issues the next block. MUST run inside a transaction already opened on `tx` (BEGIN … COMMIT by the caller). */
export async function issueLeaseIn(tx: QueryRunner, deviceId: number, kind: LeaseKind, size: number): Promise<IssuedLease> {
  if (kind === "order_id") await tx.query(LOCK_ORDERS_SQL);
  const recent = Number((await tx.query(LEASE_RATE_SQL, [deviceId, kind])).rows[0]?.n ?? 0);
  if (recent >= LEASE_MAX_PER_HOUR) throw new LeaseError(429, "lease_rate_limited", "Too many leases issued to this device in the last hour");
  let start: number;
  let end: number;
  if (kind === "order_id") {
    const r = (await tx.query(ORDER_ID_BLOCK_SQL, [size])).rows[0];
    start = Number(r.start_value);
    end = Number(r.end_value);
  } else {
    const field = kind === "bill_counter" ? "billCounter" : "kotCounter";
    const r = (await tx.query(COUNTER_BLOCK_SQL, [field, size])).rows[0];
    if (!r) throw new LeaseError(500, "settings_missing", "Settings row missing; cannot issue a counter block");
    end = Number(r.value);
    start = end - size + 1;
  }
  const row = (await tx.query(INSERT_LEASE_SQL, [deviceId, kind, start, end])).rows[0];
  return { id: Number(row.id), kind, start: Number(row.start_value), end: Number(row.end_value) };
}

/** Production wrapper: one explicit transaction on one pooled client, SET LOCAL only (transaction pooler). */
export async function issueLease(deviceId: number, kind: LeaseKind, size: number): Promise<IssuedLease> {
  if (!pool) throw new LeaseError(503, "no_pool", "Leases need the cloud database");
  const client = await pool.connect();
  let failed: unknown = null;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const lease = await issueLeaseIn(client, deviceId, kind, size);
    await client.query("COMMIT");
    return lease;
  } catch (err) {
    failed = err;
    await client.query("ROLLBACK").catch(() => {});
    if ((err as any)?.code === "55P03") throw new LeaseError(503, "lock_timeout", "Busy; try again");
    throw err;
  } finally {
    client.release(failed ? (failed as Error) : undefined);
  }
}

export async function valueInDeviceLease(runner: QueryRunner, deviceId: number, kind: LeaseKind, value: number): Promise<boolean> {
  if (!Number.isSafeInteger(value) || value < 1) return false;
  return (await runner.query(IN_LEASE_SQL, [deviceId, kind, value])).rows.length > 0;
}

export type ReplayNumbers =
  | { ok: true; id?: number; billNo?: number; kotNo?: number }
  | { ok: false; code: "lease_violation"; message: string };

/**
 * Validates the client-supplied id / order number / KOT number of a replayed create/edit. A missing
 * value is simply not used (the cloud issues one). A present but malformed or out-of-lease value is a
 * lease violation. `wantKot` false ignores a supplied KOT number (the cloud decided no ticket is needed).
 */
export async function acceptReplayNumbers(
  runner: QueryRunner,
  deviceId: number,
  body: { clientId?: unknown; clientOrderNumber?: unknown; clientKotNumber?: unknown },
  wantKot: boolean,
): Promise<ReplayNumbers> {
  const bad = (what: string): ReplayNumbers => ({ ok: false, code: "lease_violation", message: `${what} is outside this device's leased range` });
  const out: { id?: number; billNo?: number; kotNo?: number } = {};
  if (body.clientId !== undefined && body.clientId !== null) {
    const id = parseClientId(body.clientId);
    if (id === null || !(await valueInDeviceLease(runner, deviceId, "order_id", id))) return bad("Order id");
    out.id = id;
  }
  if (body.clientOrderNumber !== undefined && body.clientOrderNumber !== null) {
    const n = parseClientOrderNumber(body.clientOrderNumber);
    if (n === null || !(await valueInDeviceLease(runner, deviceId, "bill_counter", n))) return bad("Order number");
    out.billNo = n;
  }
  if (wantKot && body.clientKotNumber !== undefined && body.clientKotNumber !== null) {
    const n = parseClientKotNumber(body.clientKotNumber);
    if (n === null || !(await valueInDeviceLease(runner, deviceId, "kot_counter", n))) return bad("KOT number");
    out.kotNo = n;
  }
  return { ok: true, ...out };
}

/** The pool as a QueryRunner (cloud only). */
export function cloudRunner(): QueryRunner {
  if (!pool) throw new LeaseError(503, "no_pool", "Leases need the cloud database");
  return pool as unknown as QueryRunner;
}

/** pg unique_violation (also when drizzle nests the driver error). */
export function isUniqueViolation(err: any): boolean {
  return err?.code === "23505" || err?.cause?.code === "23505";
}
