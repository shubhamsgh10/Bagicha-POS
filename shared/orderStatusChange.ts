/** Statuses PUT /api/orders/:id may set. Cancel, hold, recall and settle each have their own gated route. */
export const PLAIN_STATUS_TARGETS = ["pending", "preparing", "ready", "served", "delivered"] as const;

export type StatusChangeBlock = { status: 400 | 409; code: string; error: string };

/**
 * May PUT /api/orders/:id move this order to `next`? It used to accept any status, so Order
 * History's dropdown (or a curl from any session) could cancel an order with no PIN, reason,
 * audit row, table release or stock reversal; un-cancel one back into the day's sales; move a
 * paid order back onto the kitchen board; or turn a due into "delivered", which drops it off
 * every dues list. Only the kitchen-progress labels are plain edits now:
 *  - never TO cancelled (use Cancel Order) and never FROM cancelled or hold (use Recall);
 *  - a paid order or an open due may only switch between served and delivered labels — moving
 *    it back to pending/preparing/ready would put a settled bill back on the floor, and
 *    "delivered" on an unpaid order would hide the due;
 *  - an unpaid running order can't be marked served/delivered here — settling does that (and
 *    records the money); marking it served without payment would invent a nameless due.
 * Same status → always fine (no-op). Pure and dependency-free (the Orders page uses it too); locked by
 * scripts/verify-order-mutation-guard.ts.
 */
export function planStatusChange(
  order: { status?: string | null; paymentStatus?: string | null },
  next: string,
): StatusChangeBlock | null {
  const cur = order.status ?? "pending";
  if (next === cur) return null;
  if (next === "cancelled") {
    return { status: 400, code: "use_cancel", error: "Use Cancel Order — it needs a reason and a manager PIN, and frees the table and stock." };
  }
  if (!(PLAIN_STATUS_TARGETS as readonly string[]).includes(next)) {
    return { status: 400, code: "bad_status", error: `"${next}" isn't a status this can set.` };
  }
  if (cur === "cancelled") return { status: 409, code: "cancelled", error: "This order was cancelled — it can't be reopened." };
  if (cur === "hold") return { status: 409, code: "hold", error: "This order is on hold — recall it from the POS first." };
  const paid = order.paymentStatus === "paid";
  const isDue = !paid && cur === "served";
  if (paid || isDue) {
    if (next === "served" || (paid && next === "delivered")) return null;
    return paid
      ? { status: 409, code: "settled", error: "This order is already paid — its status can't go back to the kitchen." }
      : { status: 409, code: "due", error: "This order is an open due — settle it instead of changing its status." };
  }
  if (next === "served" || next === "delivered") {
    return { status: 409, code: "unpaid", error: "Settle the order to mark it served — that records the payment." };
  }
  return null;
}

/**
 * May `source` be merged into `target`? Merging an order into itself deleted it (the source is
 * deleted after its items are copied), and merge never looked at status, so a paid, cancelled,
 * held or due order could be merged — and then deleted. Both must be open, unpaid, running orders.
 */
export function mergeBlock(
  target: { id: number; status?: string | null; paymentStatus?: string | null },
  source: { id: number; status?: string | null; paymentStatus?: string | null },
): StatusChangeBlock | null {
  if (Number(target.id) === Number(source.id)) {
    return { status: 400, code: "same_order", error: "An order can't be merged into itself." };
  }
  for (const [o, label] of [[target, "target"], [source, "source"]] as const) {
    if (o.paymentStatus === "paid") return { status: 409, code: "settled", error: `The ${label} order is already paid.` };
    if (o.status === "cancelled") return { status: 409, code: "cancelled", error: `The ${label} order was cancelled.` };
    if (o.status === "hold") return { status: 409, code: "hold", error: `The ${label} order is on hold — recall it first.` };
    if (o.status === "served" || o.status === "delivered") return { status: 409, code: "due", error: `The ${label} order is already billed as a due.` };
  }
  return null;
}
