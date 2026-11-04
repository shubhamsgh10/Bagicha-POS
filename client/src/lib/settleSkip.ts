/**
 * Settle used to re-save the whole cart (PUT /api/orders/:id/items) before every payment, even when
 * nothing had changed since the last KOT/Bill — the usual case: print the bill, the customer pays.
 * That is a full request (and, on the shop's network, the one most likely to hit a stalled
 * connection) in front of POST /payment for no reason. These helpers decide when the save can be
 * skipped. Pure; locked by scripts/verify-settle-skip.ts.
 *
 * Skipping is safe only when the server provably already holds this exact cart:
 *  1. this tab saved this exact payload for this order (same signature), and that save succeeded;
 *  2. the server copy has not moved since — the order's `updatedAt` this tab now sees (refreshed by
 *     every realtime ORDER_UPDATE, so another device's edit or this tab's own Auto-KOT sync
 *     changes it) is the one that save returned.
 * Anything else — first settle after reopening, an Auto-KOT sync in between, a stale or missing
 * server copy — saves first, as before. The payment itself is always checked against the server's
 * own total, so even a wrong skip could never record a payment for less than the bill.
 */

export interface SaveFields {
  items: unknown;
  discountAmount?: unknown;
  containerCharge?: unknown;
  deliveryCharge?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  cancelledKotItems?: unknown;
}

/** What a save writes — print directives and the order id deliberately excluded. */
export function saveSignature(p: SaveFields): string {
  return JSON.stringify([
    p.items ?? [],
    String(p.discountAmount ?? "0"),
    String(p.containerCharge ?? "0"),
    String(p.deliveryCharge ?? "0"),
    String(p.customerName ?? ""),
    String(p.customerPhone ?? ""),
    p.cancelledKotItems ?? [],
  ]);
}

export interface LastSave {
  orderId: number;
  signature: string;
  /** `updatedAt` of the order row the save returned (as JSON gave it). */
  updatedAt: string | null;
}

export function canSkipSaveBeforeSettle(p: {
  lastSave: LastSave | null;
  orderId: number | null;
  signature: string;
  /** The order as this tab currently sees it (GET /api/orders/:id). */
  serverOrder: { updatedAt?: unknown; paymentStatus?: unknown; status?: unknown } | null | undefined;
}): boolean {
  const { lastSave, orderId, signature, serverOrder } = p;
  if (!lastSave || orderId == null || lastSave.orderId !== orderId) return false;
  if (lastSave.signature !== signature) return false;
  if (!lastSave.updatedAt || !serverOrder) return false;
  if (String(serverOrder.updatedAt ?? "") !== lastSave.updatedAt) return false;
  if (serverOrder.paymentStatus === "paid" || serverOrder.status === "cancelled") return false;
  return true;
}
