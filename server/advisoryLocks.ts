import { sql, type SQL } from "drizzle-orm";

/**
 * Namespaces for Postgres transaction-level advisory locks. Every lock uses the TWO-argument form
 * `pg_advisory_xact_lock(namespace, key)`, so locks on different kinds of record never collide.
 * The one-argument form shares one key space, which meant order #42's stock reconciliation, an
 * edit of inventory item #42 and a redemption of coupon #42 all queued behind each other.
 *
 * Never reuse or renumber a namespace: two code paths that must serialize on the same record have
 * to use the same (namespace, key) pair.
 */
export const LOCK_NS = {
  /** storage.reconcileOrderInventory — key: orders.id */
  orderInventory: 1,
  /** storage.updateInventoryItem (manual stock edit) — key: inventory.id */
  inventoryItem: 2,
  /** couponService.redeemCoupon — key: coupons.id */
  couponRedemption: 3,
  /** loyaltyService.redeemPoints — key: hashtext(customerId) */
  loyaltyCustomer: 4,
  /** storage.replaceAutoShiftSessions — key: hashtext("<kind>:<id>:<date>") */
  shiftSessions: 5,
} as const;

/** `SELECT pg_advisory_xact_lock(<ns>, <id>)` for an integer record id. */
export function advisoryXactLock(ns: number, id: number): SQL {
  return sql`SELECT pg_advisory_xact_lock(${ns}::int4, ${id}::int4)`;
}

/** Same, keyed on a string (hashed by Postgres to an int4). */
export function advisoryXactLockText(ns: number, key: string): SQL {
  return sql`SELECT pg_advisory_xact_lock(${ns}::int4, hashtext(${key}))`;
}
