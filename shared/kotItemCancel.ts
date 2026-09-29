/**
 * Per-item "cancel after KOT sent" reason matching — the new-work half of the item-level
 * cancellation workflow described in CLAUDE.md's "Per-item cancellation after KOT" section.
 * Used by PUT /api/orders/:id/items (server/routes.ts) to decide whether a save that drops
 * an already-KOT'd item may proceed.
 *
 * Deliberately REUSES shared/kotDelta.ts's computeDelta directly rather than reimplementing
 * any diffing — this is the opposite choice from shared/orderAudit.ts's diffOrderLines,
 * which is deliberately NOT a reuse (see that file's own comment for why the two answer
 * different questions). Here, the kitchen-shaped answer IS exactly what's needed: "was this
 * itemId:size:serviceMode already known to the kitchen and is it now gone," flip-netting
 * included — a pure dine-in<->parcel service-mode flip on an otherwise-unchanged line must
 * NOT be treated as a cancellation, and computeDelta already nets that pair out before this
 * module ever sees it. Reusing it directly means that behavior is inherited for free.
 *
 * This function is agnostic to what "last" means — it just diffs two snapshots. Its actual
 * caller (PUT /api/orders/:id/items) deliberately passes the order's PERSISTED item list as
 * of immediately before this save (existingItems), NOT orders.lastKotSnapshot. Found live:
 * an item is unconditionally kitchen-visible (a kot_tickets row is created) the moment it's
 * first ever persisted — at order creation or at the save that first adds it — regardless of
 * whether anyone ever actually PRINTS via /api/print/kot, which is the only thing that
 * writes lastKotSnapshot. A print-based check let a real cancellation through with no guard
 * at all, on an order the kitchen could already see, simply because no printer was
 * configured. "Was this item persisted before this save" is the strictly correct signal.
 */
import { computeDelta, type SnapshotItem } from "./kotDelta";

export interface CancelledKotItemInput {
  itemId: number;
  size: string | null;
  serviceMode: string | null;
  reason: string;
}

const key = (itemId: number, size: string | null, serviceMode: string | null | undefined) =>
  `${itemId}:${size ?? ""}:${serviceMode ?? ""}`;

/**
 * Given the current (post-edit) item snapshot, the item snapshot to diff against (in
 * practice: the order's persisted state immediately before this save — see the file-level
 * comment above for why), and whatever cancellation reasons the client provided, returns the
 * subset of already-known-to-the-kitchen items that are missing a matching, non-empty reason
 * — i.e. still need one before the save may be accepted. An empty return means every dropped
 * item (if any) is accounted for.
 */
export function findMissingKotCancelReasons(
  current: SnapshotItem[],
  last: SnapshotItem[],
  provided: CancelledKotItemInput[],
): SnapshotItem[] {
  const dropped = computeDelta(current, last).cancelledItems;
  if (dropped.length === 0) return [];

  const providedKeys = new Set(
    (Array.isArray(provided) ? provided : [])
      .filter((p) => typeof p?.reason === "string" && p.reason.trim().length > 0)
      .map((p) => key(Number(p.itemId), p.size ?? null, p.serviceMode ?? null)),
  );

  return dropped.filter((d) => !providedKeys.has(key(d.itemId, d.size, d.serviceMode)));
}
