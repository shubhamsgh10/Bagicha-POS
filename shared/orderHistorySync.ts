/**
 * Pure helpers for keeping a cached whole-history order list (Orders → "All Dates", Billing →
 * "Show all") current without re-downloading it: fetch only rows whose updated_at moved
 * (`GET /api/orders?updatedSince=`) and merge them in. Used by client/src/lib/orderHistorySync.ts.
 *
 * What a delta can't see — a row deleted outright (merge removes the source order) or a write that
 * doesn't stamp updated_at (print counters, the CRM phone backfill) — is picked up by the
 * periodic full reload the hook also does.
 */

type Row = { id: number; createdAt?: string | Date | null; updatedAt?: string | Date | null };

/** Re-fetch a little before the newest updated_at we hold, so a write landing in the same instant isn't missed. */
export const ORDER_SYNC_OVERLAP_MS = 2_000;

const ms = (v: string | Date | null | undefined): number => (v ? new Date(v).getTime() : NaN);

/** The `updatedSince` instant to ask for, or null when the list has no usable updatedAt (do a full reload). */
export function deltaSince(rows: Row[]): Date | null {
  let max = -Infinity;
  for (const r of rows) {
    const t = ms(r.updatedAt);
    if (t > max) max = t;
  }
  return Number.isFinite(max) ? new Date(max - ORDER_SYNC_OVERLAP_MS) : null;
}

/**
 * Replace changed rows by id, add new ones, keep the list newest-first by createdAt (id breaks
 * ties). Returns `current` itself when nothing came back, so callers can skip a cache write.
 */
export function mergeOrderRows<T extends Row>(current: T[], changed: T[]): T[] {
  if (changed.length === 0) return current;
  const byId = new Map<number, T>();
  for (const r of current) byId.set(r.id, r);
  for (const r of changed) byId.set(r.id, r);
  return Array.from(byId.values()).sort(
    (a, b) => (ms(b.createdAt) - ms(a.createdAt)) || (b.id - a.id),
  );
}
