/**
 * Pure decisions behind PUT /api/orders/:id/items (server/routes.ts), unit-tested in
 * scripts/verify-order-items-save.ts. No DB, no Express.
 *
 *  - orderEditBlock:      may this save write to the order at all? (missing / cancelled / settled)
 *  - isNoopItemsSave:     does the save change anything? An unchanged cart — Settle right after a
 *                         Bill, or the Auto-KOT timer re-sending the same cart — skips the
 *                         delete/reinsert, the stock reconcile and the audit diff entirely.
 *  - kitchenTicketLines:  what the Kitchen screen ticket (kot_tickets row) for this save lists.
 */
import { computeDelta, instructionsByKey, snapKey, type SnapshotItem } from "./kotDelta";
import { buildSpecialInstructions } from "./orderItemText";

export type OrderEditBlockCode = "not_found" | "cancelled" | "settled";
export interface OrderEditBlock {
  status: 404 | 409;
  code: OrderEditBlockCode;
  error: string;
}

/**
 * A save that would CHANGE a settled order is refused; an unchanged one (a reprint of a paid
 * order's bill goes through the same save-with-print request) is let through as a no-op. A
 * cancelled order is never written to; a missing one (deleted by a merge) is a 404 — saving to it
 * used to insert orphan order_items, deduct real stock for a ghost order and put a ticket on the
 * Kitchen screen.
 */
export function orderEditBlock(
  order: { status?: string | null; paymentStatus?: string | null } | null | undefined,
  changes: boolean,
): OrderEditBlock | null {
  if (!order) {
    return {
      status: 404,
      code: "not_found",
      error: "This order no longer exists (it may have been merged into another table). Reopen the table and try again.",
    };
  }
  if (order.status === "cancelled") {
    return { status: 409, code: "cancelled", error: "This order was cancelled — it can't be changed." };
  }
  if (order.paymentStatus === "paid" && changes) {
    return {
      status: 409,
      code: "settled",
      error: "This order is already settled — the change was not saved. Start a new order for anything else.",
    };
  }
  return null;
}

/** One order_items row as persisted (or about to be). */
export interface PersistedLine {
  menuItemId: number;
  name: string | null;
  quantity: number;
  price: string | number;
  specialInstructions: string | null;
  size: string | null;
  serviceMode: string | null;
  parcelLeftover: boolean | null;
}

/** The six money columns PUT /items rewrites. */
export interface OrderMoneyColumns {
  totalAmount: string | number | null;
  taxAmount: string | number | null;
  discountAmount: string | number | null;
  subtotalAmount: string | number | null;
  containerCharge: string | number | null;
  deliveryCharge: string | number | null;
}

const money = (v: unknown): string => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
};
const text = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

const lineKey = (l: PersistedLine): string =>
  JSON.stringify([
    Number(l.menuItemId),
    text(l.name),
    Number(l.quantity),
    money(l.price),
    text(l.specialInstructions),
    text(l.size),
    text(l.serviceMode),
    !!l.parcelLeftover,
  ]);

/** Same rows regardless of order (order_items is read without an ORDER BY). */
export function sameLines(a: PersistedLine[], b: PersistedLine[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const l of a) counts.set(lineKey(l), (counts.get(lineKey(l)) ?? 0) + 1);
  for (const l of b) {
    const k = lineKey(l);
    const c = counts.get(k) ?? 0;
    if (c === 0) return false;
    counts.set(k, c - 1);
  }
  return true;
}

const MONEY_COLUMNS: Array<keyof OrderMoneyColumns> = [
  "totalAmount", "taxAmount", "discountAmount", "subtotalAmount", "containerCharge", "deliveryCharge",
];

export function sameMoney(existing: OrderMoneyColumns, next: OrderMoneyColumns): boolean {
  // A legacy row with no persisted subtotal never matches a real one, so it gets rewritten once.
  if (existing.subtotalAmount == null && Number(next.subtotalAmount ?? 0) !== 0) return false;
  return MONEY_COLUMNS.every((c) => money(existing[c]) === money(next[c]));
}

/** A customer field the request leaves out (undefined) keeps its value; "" clears it. */
const sameCustomerField = (existing: unknown, next: unknown): boolean => next === undefined || text(existing) === text(next);

export function isNoopItemsSave(p: {
  existingLines: PersistedLine[];
  nextLines: PersistedLine[];
  existingOrder: OrderMoneyColumns & { customerName?: string | null; customerPhone?: string | null };
  nextMoney: OrderMoneyColumns;
  customerName?: unknown;
  customerPhone?: unknown;
}): boolean {
  return (
    sameLines(p.existingLines, p.nextLines) &&
    sameMoney(p.existingOrder, p.nextMoney) &&
    sameCustomerField(p.existingOrder.customerName, p.customerName) &&
    sameCustomerField(p.existingOrder.customerPhone, p.customerPhone)
  );
}

export interface KitchenTicketLine {
  name: string;
  quantity: number;
  instructions?: string;
  serviceMode?: string;
  /** Set when this line is MORE of a dish already on the order: the ticket asks for `quantity` more,
   *  and the Kitchen screen shows "now previousQty+quantity". */
  previousQty?: number;
}

type SaveLine = {
  menuItemId: unknown;
  name?: unknown;
  quantity: unknown;
  size?: unknown;
  serviceMode?: unknown;
  specialInstructions?: unknown;
  addons?: unknown;
};

/**
 * The Kitchen-screen ticket for a save: everything the kitchen has to make that the order did not
 * already have — a dish not on it yet, a new size or service mode of one that is, or a quantity
 * increase (as the increment). Same identity rule and dine-in↔parcel flip netting as the printed
 * KOT delta (shared/kotDelta.ts), so the screen and the paper agree. It used to key on menuItemId
 * alone, so "1 → 3 Butter Naan" or "a Large next to the Regular Pizza" never reached the screen.
 */
export function kitchenTicketLines(lineItems: SaveLine[], existingItems: Array<{
  menuItemId: number;
  name: string | null;
  quantity: number;
  size: string | null;
  serviceMode: string | null;
}>): KitchenTicketLine[] {
  const current: SnapshotItem[] = lineItems.map((i) => ({
    itemId: Number(i.menuItemId),
    name: typeof i.name === "string" ? i.name : "",
    quantity: Number(i.quantity),
    size: (i.size as string) || null,
    serviceMode: (i.serviceMode as string) || null,
  }));
  const existing: SnapshotItem[] = existingItems.map((i) => ({
    itemId: i.menuItemId,
    name: i.name || "",
    quantity: Number(i.quantity),
    size: i.size ?? null,
    serviceMode: i.serviceMode ?? null,
  }));
  // Every line of a dish key, merged (computeDelta sums them) — see kotDelta.ts mergedInstructions.
  const instrByKey = instructionsByKey(
    lineItems.map((li, idx) => ({
      ...current[idx],
      instructions: buildSpecialInstructions(li.specialInstructions as string | null | undefined, li.addons as Array<{ name: string }> | null | undefined),
    })),
  );
  return computeDelta(current, existing).newItems.map((n) => {
    const line: KitchenTicketLine = { name: n.name, quantity: n.quantity };
    const instructions = instrByKey.get(snapKey(n));
    if (instructions) line.instructions = instructions;
    if (n.serviceMode) line.serviceMode = n.serviceMode;
    if (n.previousQty !== undefined) line.previousQty = n.previousQty;
    return line;
  });
}

/**
 * Does this save APPLY discount a manager hasn't approved? The POS discount is a percentage of the
 * subtotal (POS.tsx: discountAmt = subtotal x pct), so its rupee amount grows with every item added.
 * Requiring manager elevation for ANY save whose discount was above zero meant a staff (PIN card)
 * session got a 403 just for adding a dish to a table a manager had discounted a few minutes earlier
 * (the elevation grant lasts 90 s). What was approved is the RATE already on the order: a save needs
 * approval only when its discount exceeds that rate applied to the new subtotal (1 paisa tolerance
 * for rounding). A brand-new discount, a higher rate, or keeping a flat amount while removing items
 * (the rate rises) still needs it; lowering or keeping the approved rate does not.
 */
export function discountNeedsApproval(p: {
  discountAfter: number;
  subtotalAfter: number;
  discountBefore: number;
  subtotalBefore: number;
}): boolean {
  if (!(p.discountAfter > 0)) return false;
  const approvedRate = p.subtotalBefore > 0 && p.discountBefore > 0 ? p.discountBefore / p.subtotalBefore : 0;
  const allowed = Math.round(p.subtotalAfter * approvedRate * 100) / 100;
  return p.discountAfter > allowed + 0.01;
}
