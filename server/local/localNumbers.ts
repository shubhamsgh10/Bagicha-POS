// Order ids, bill numbers and KOT numbers for work done on the shop PC, taken from blocks the cloud
// leased to this device (POST /api/sync/lease). A number printed on paper offline is final: the cloud
// honours it at replay only inside a block it issued to this device.
import type { PGlite } from "@electric-sql/pglite";
import { LEASE_KINDS, LEASE_DEFAULT_SIZE, type LeaseKind } from "../../shared/syncTables";
import { noteIssued } from "./outbox";

/** Refill when fewer than this share of the default block is left. */
export const LEASE_REFILL_BELOW = Math.floor(LEASE_DEFAULT_SIZE * 0.25);

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
  /** Takes the next value of a kind, recording it on the current request (outbox). Throws LeaseExhaustedError. */
  take(kind: LeaseKind): Promise<number>;
  /** Numbers left in the leased blocks of a kind. */
  remaining(kind: LeaseKind): Promise<number>;
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

export function createLeaseManager(opts: LeaseManagerOptions): LeaseManager {
  const { client } = opts;
  const log = opts.log ?? ((m: string) => console.log(`[local-lease] ${m}`));
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  let refilling = false;

  async function remaining(kind: LeaseKind): Promise<number> {
    const r = await client.query<{ n: string | null }>(
      `SELECT COALESCE(sum(end_value - next_value + 1), 0)::text AS n FROM local_leases WHERE kind = $1 AND next_value <= end_value`, [kind]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async function refillKind(kind: LeaseKind): Promise<void> {
    const l = await opts.requestLease(kind);
    if (!Number.isSafeInteger(l.start) || !Number.isSafeInteger(l.end) || l.end < l.start) throw new Error("cloud sent a malformed lease");
    await client.query(`INSERT INTO local_leases (kind, start_value, end_value, next_value) VALUES ($1,$2,$3,$2)`, [kind, l.start, l.end]);
    log(`leased ${kind} ${l.start}..${l.end}`);
  }

  async function refillIfLow(): Promise<void> {
    if (refilling || !opts.isOnline()) return;
    refilling = true;
    try {
      for (const kind of LEASE_KINDS) {
        try {
          if ((await remaining(kind)) < LEASE_REFILL_BELOW) await refillKind(kind);
        } catch (e: any) {
          log(`could not lease ${kind}: ${e?.message ?? e}`);
        }
      }
    } finally {
      refilling = false;
    }
  }

  async function take(kind: LeaseKind): Promise<number> {
    const value = await serial(async () => {
      const r = await client.query<{ id: number; v: string }>(
        `SELECT id, next_value::text AS v FROM local_leases WHERE kind = $1 AND next_value <= end_value ORDER BY id LIMIT 1`, [kind]);
      if (!r.rows.length) {
        // Nothing in hand: one blocking attempt if the cloud is reachable.
        if (opts.isOnline()) {
          try { await refillKind(kind); } catch (e: any) { log(`could not lease ${kind}: ${e?.message ?? e}`); }
        }
        const again = await client.query<{ id: number; v: string }>(
          `SELECT id, next_value::text AS v FROM local_leases WHERE kind = $1 AND next_value <= end_value ORDER BY id LIMIT 1`, [kind]);
        if (!again.rows.length) throw new LeaseExhaustedError(kind);
        r.rows.push(again.rows[0]);
      }
      const { id, v } = r.rows[0];
      await client.query(`UPDATE local_leases SET next_value = next_value + 1 WHERE id = $1`, [id]);
      return Number(v);
    });
    noteIssued(kind, value);
    if (kind !== "order_id") opts.onCounter?.(kind === "bill_counter" ? "billCounter" : "kotCounter", value);
    void remaining(kind).then((n) => { if (n < LEASE_REFILL_BELOW) void refillIfLow(); }).catch(() => {});
    return value;
  }

  return { take, remaining, refillIfLow };
}
