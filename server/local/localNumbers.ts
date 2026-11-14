// Order ids, bill numbers and KOT numbers for work done on the shop PC, taken from blocks the cloud
// leased to this device (POST /api/sync/lease). A number printed on paper offline is final: the cloud
// honours it at replay only inside a block it issued to this device.
import type { PGlite } from "@electric-sql/pglite";
import { LEASE_KINDS, LEASE_DEFAULT_SIZE, type LeaseKind } from "../../shared/syncTables";
import { noteIssued } from "./outbox";

/** Refill when fewer than this share of the default block is left. */
// Top up at half a block, so the PC holds 15–45 numbers: enough for a typical offline hour.
export const LEASE_REFILL_BELOW = Math.ceil(LEASE_DEFAULT_SIZE * 0.5);

export class LeaseExhaustedError extends Error {
  readonly status = 503;
  readonly code = "LEASE_EXHAUSTED";
  constructor(readonly kind: LeaseKind) {
    super(
      kind === "order_id"
        ? "Out of order numbers while offline — reconnect to the internet to continue."
        : "Out of bill/KOT numbers while offline — reconnect to the internet to continue.",
    );
  }
}

export interface LeaseManager {
  /** Loads the unspent blocks into memory; call once at boot. */
  init(): Promise<void>;
  /**
   * Takes the next value of a kind, recording it on the current request (outbox). Rejects with
   * LeaseExhaustedError. Never touches the database: PUT /api/orders/:id/items awaits its KOT number
   * INSIDE a PGlite transaction, and PGlite has one connection, so a query here would deadlock behind it.
   */
  take(kind: LeaseKind): Promise<number>;
  /** Numbers left in the leased blocks of a kind. */
  remaining(kind: LeaseKind): number;
  /** Asks the cloud for a new block of every kind that is running low (no-op offline; never throws). */
  refillIfLow(): Promise<void>;
}

export interface LeaseManagerOptions {
  client: PGlite;
  /** POST /api/sync/lease; rejects when the cloud is unreachable. */
  requestLease(kind: LeaseKind): Promise<{ start: number; end: number }>;
  isOnline(): boolean;
  /** Keeps the settings display of the counter in step. */
  onCounter?(field: "billCounter" | "kotCounter", value: number): void;
  log?(msg: string): void;
}

interface Block { id: number; next: number; end: number }

export function createLeaseManager(opts: LeaseManagerOptions): LeaseManager {
  const { client } = opts;
  const log = opts.log ?? ((m: string) => console.log(`[local-lease] ${m}`));
  const blocks: Record<LeaseKind, Block[]> = { order_id: [], bill_counter: [], kot_counter: [] };
  let persistChain: Promise<unknown> = Promise.resolve();
  let refilling = false;

  const persist = (b: Block) => {
    const v = b.next;
    persistChain = persistChain
      .then(() => client.query(`UPDATE local_leases SET next_value = GREATEST(next_value, $2) WHERE id = $1`, [b.id, v]))
      .catch((e: any) => log(`could not persist a lease position: ${e?.message ?? e}`));
  };

  function remaining(kind: LeaseKind): number {
    return blocks[kind].reduce((n, b) => n + Math.max(0, b.end - b.next + 1), 0);
  }

  async function init(): Promise<void> {
    const r = await client.query<{ id: number; kind: LeaseKind; end_value: string; next_value: string; start_value: string }>(
      `SELECT id, kind, start_value::text, end_value::text, next_value::text FROM local_leases ORDER BY id`);
    for (const k of LEASE_KINDS) blocks[k] = [];
    for (const row of r.rows) {
      if (!blocks[row.kind]) continue;
      let next = Number(row.next_value);
      const start = Number(row.start_value);
      const end = Number(row.end_value);
      // A crash can lose the last (asynchronous) position write: never reuse a number that a local row already carries.
      try {
        let used: string | null = null;
        if (row.kind === "order_id") used = (await client.query<{ m: string | null }>(`SELECT max(id)::text AS m FROM orders WHERE id BETWEEN $1 AND $2`, [start, end])).rows[0]?.m ?? null;
        else if (row.kind === "bill_counter") used = (await client.query<{ m: string | null }>(
          `SELECT max(substring(order_number from 4)::bigint)::text AS m FROM orders WHERE order_number ~ '^ORD[0-9]+$' AND substring(order_number from 4)::bigint BETWEEN $1 AND $2`, [start, end])).rows[0]?.m ?? null;
        else used = (await client.query<{ m: string | null }>(
          `SELECT max(kot_number::bigint)::text AS m FROM kot_tickets WHERE kot_number ~ '^[0-9]+$' AND kot_number::bigint BETWEEN $1 AND $2`, [start, end])).rows[0]?.m ?? null;
        if (used !== null && Number(used) >= next) next = Number(used) + 1;
      } catch (e: any) {
        log(`lease position check failed: ${e?.message ?? e}`);
      }
      if (next <= end) blocks[row.kind].push({ id: row.id, next, end });
    }
  }

  async function refillKind(kind: LeaseKind): Promise<void> {
    const l = await opts.requestLease(kind);
    if (!Number.isSafeInteger(l.start) || !Number.isSafeInteger(l.end) || l.end < l.start) throw new Error("cloud sent a malformed lease");
    const r = await client.query<{ id: number }>(
      `INSERT INTO local_leases (kind, start_value, end_value, next_value) VALUES ($1,$2,$3,$2) RETURNING id`, [kind, l.start, l.end]);
    blocks[kind].push({ id: r.rows[0].id, next: l.start, end: l.end });
    log(`leased ${kind} ${l.start}..${l.end}`);
  }

  async function refillIfLow(): Promise<void> {
    if (refilling || !opts.isOnline()) return;
    refilling = true;
    try {
      for (const kind of LEASE_KINDS) {
        try {
          if (remaining(kind) < LEASE_REFILL_BELOW) await refillKind(kind);
        } catch (e: any) {
          log(`could not lease ${kind}: ${e?.message ?? e}`);
        }
      }
    } finally {
      refilling = false;
    }
  }

  function take(kind: LeaseKind): Promise<number> {
    const b = blocks[kind].find((x) => x.next <= x.end);
    if (!b) return Promise.reject(new LeaseExhaustedError(kind));
    const value = b.next++;
    persist(b);
    noteIssued(kind, value);
    if (kind !== "order_id") opts.onCounter?.(kind === "bill_counter" ? "billCounter" : "kotCounter", value);
    if (remaining(kind) < LEASE_REFILL_BELOW) void refillIfLow();
    return Promise.resolve(value);
  }

  return { init, take, remaining, refillIfLow };
}
