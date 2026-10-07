/**
 * "Who paid how much, by which method" — the single rule behind every Cash/UPI figure.
 *
 * Why this exists: a settled order stores every payment leg in `orders.payment_breakdown`
 * (e.g. { cash: "53", upi: "10" }), but `orders.payment_method` is just ONE label — the largest
 * leg. The Tables-page Sales card read the legs (right); Reports → Payments and several order
 * screens read the single label and credited the WHOLE bill to it, so the UPI half of every
 * part payment showed up as Cash. Anything that adds up or displays a payment method must go
 * through here — never read `paymentMethod` as if it were an amount split.
 *
 * `payment_method` itself is unchanged (other code relies on it); this derives from the legs at
 * read time, so historical orders are corrected too with no data migration.
 *
 * Pure (no DB, no React) so the server routes, the client pages and scripts/verify-payment-split.ts
 * all share the exact same function.
 */
import { businessDateOf } from "./businessDay";

export interface PaymentOrderLike {
  /** When present and not "paid", nothing was collected — see collectedByMethod. */
  paymentStatus?: string | null;
  paymentMethod?: string | null;
  paymentBreakdown?: Record<string, string | number> | null;
  paidAmount?: string | number | null;
  totalAmount?: string | number | null;
  changeAmount?: string | number | null;
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Money that actually stayed with the restaurant, per method. Only methods with an amount > 0
 * appear in the result.
 *
 * - Legs come from `paymentBreakdown`. Cash is NET of `changeAmount` (change handed back comes out
 *   of the drawer; floored at 0). UPI is taken as entered — a ₹900 UPI payment on a ₹899.85 bill
 *   really did land ₹900, nothing is refunded.
 * - No usable breakdown (legacy rows, bulk-settled dues stored as `{}`, Billing's single-method
 *   path before it wrote legs) → one leg: `paymentMethod || "cash"` with `paidAmount ?? totalAmount`.
 * - An order whose `paymentStatus` is present and not "paid" (a due, a cancelled/unsettled order)
 *   collected nothing → `{}`. Without this, the legacy fallback below would credit its whole
 *   `totalAmount` (a null `paidAmount` falls through to it) to a method it never paid by.
 * - Callers still decide which DAYS/orders count (e.g. not cancelled); this only splits one order.
 */
export function collectedByMethod(order: PaymentOrderLike): Record<string, number> {
  const out: Record<string, number> = {};
  if (order.paymentStatus != null && order.paymentStatus !== "paid") return out;
  const bd = order.paymentBreakdown;
  const keys = bd && typeof bd === "object" ? Object.keys(bd) : [];

  if (keys.length > 0) {
    const change = num(order.changeAmount);
    for (const k of keys) {
      const raw = num(bd![k]);
      const amt = k === "cash" ? Math.max(0, raw - change) : raw;
      if (amt > 0) out[k] = round2(amt);
    }
    if (Object.keys(out).length > 0) return out;
  }

  const method = order.paymentMethod || "cash";
  const collected = num(order.paidAmount ?? order.totalAmount);
  if (collected > 0) out[method] = round2(collected);
  return out;
}

export interface CollectedSummary {
  /** method → { count: orders that took money by this method, amount }. A part order counts under both. */
  breakdown: Record<string, { count: number; amount: number }>;
  /** Sum of every leg — what was really collected, change and write-offs already excluded. */
  totalPaid: number;
  /** Orders paid with more than one method (e.g. cash + UPI). */
  partCount: number;
}

/** Aggregate `collectedByMethod` over orders the caller has already filtered (paid, not cancelled). */
export function summarizeCollected(paidOrders: PaymentOrderLike[]): CollectedSummary {
  const breakdown: Record<string, { count: number; amount: number }> = {};
  let totalPaid = 0;
  let partCount = 0;
  for (const o of paidOrders) {
    const legs = collectedByMethod(o);
    const methods = Object.keys(legs);
    if (methods.length > 1) partCount++;
    for (const m of methods) {
      if (!breakdown[m]) breakdown[m] = { count: 0, amount: 0 };
      breakdown[m].count++;
      breakdown[m].amount = round2(breakdown[m].amount + legs[m]);
      totalPaid += legs[m];
    }
  }
  return { breakdown, totalPaid: round2(totalPaid), partCount };
}

/** An order's billed time and (once settled by a server settle path) its paid time. */
export interface CollectedDateOrder {
  createdAt: string | Date;
  paidAt?: string | Date | null;
}

/**
 * WHEN the money for this order was received. A due is billed on one day and often paid days
 * later; the owner's cash book counts it the day it arrived. `paidAt` is stamped by every server
 * settle path (payment route, settle-due, Reports' bulk "Mark all paid"); rows that predate it
 * — and Razorpay confirmations, which don't stamp it — have no `paidAt` and fall back to the day
 * they were billed, which is exactly how they were counted before the column existed.
 */
export function collectedAt(order: CollectedDateOrder): Date {
  return new Date((order.paidAt ?? order.createdAt) as string | Date);
}

/** The business day (5am-IST cutoff) the money was received on. */
export function collectedBusinessDate(order: CollectedDateOrder): string {
  return businessDateOf(collectedAt(order));
}

export type PaymentFilter = "all" | "cash" | "upi" | "due";

export interface PaymentFilterOrder extends PaymentOrderLike {
  status?: string | null;
}

/**
 * A bill served but not yet paid — the open-tab set, identical to the Reports "Due" figure, the
 * amber Due tag on the Orders page and storage.getOpenTabsByCustomer. NOT keyed on
 * `paymentMethod`: a due order's stored method is a placeholder ("cash", or "due" from Billing's
 * legacy path), so reading it would call every open tab Cash.
 */
export function isDueOrder(order: PaymentFilterOrder): boolean {
  return order.paymentStatus === "pending" && order.status === "served";
}

/**
 * Does an order belong under the Orders-page Cash / UPI / Due filter?
 *
 * Cash and UPI come from the same legs as the Reports tiles (collectedByMethod), so the two can
 * never disagree about which orders are "Cash" — and a part payment belongs to BOTH, exactly as
 * it counts in both Reports tiles. Cancelled and unsettled orders collected nothing, so they
 * match neither; "all" matches everything.
 */
export function matchesPaymentFilter(order: PaymentFilterOrder, filter: PaymentFilter): boolean {
  if (filter === "all") return true;
  if (filter === "due") return isDueOrder(order) && order.status !== "cancelled";
  return (collectedByMethod(order)[filter] ?? 0) > 0;
}

/** One pass over the list for the filter chips' counts — built on matchesPaymentFilter so the
 *  numbers on the chips and the rows the filter returns cannot drift apart. */
export function paymentFilterCounts(orders: PaymentFilterOrder[]): Record<PaymentFilter, number> {
  const counts: Record<PaymentFilter, number> = { all: 0, cash: 0, upi: 0, due: 0 };
  for (const o of orders) {
    counts.all++;
    if (matchesPaymentFilter(o, "cash")) counts.cash++;
    if (matchesPaymentFilter(o, "upi")) counts.upi++;
    if (matchesPaymentFilter(o, "due")) counts.due++;
  }
  return counts;
}

const METHOD_NAMES: Record<string, string> = { cash: "Cash", upi: "UPI" };
const ORDER = ["cash", "upi"];

export function methodName(method: string): string {
  return METHOD_NAMES[method] ?? (method ? method.charAt(0).toUpperCase() + method.slice(1) : "");
}

const rupees = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;

/**
 * Human-readable payment: "Cash", "UPI", or "Cash ₹53 + UPI ₹10" for a part payment.
 * Returns "" when nothing was recorded (callers show their own placeholder / Due state).
 */
export function paymentLabel(order: PaymentOrderLike): string {
  const legs = collectedByMethod(order);
  const methods = Object.keys(legs).sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  if (methods.length === 0) {
    const unpaid = order.paymentStatus != null && order.paymentStatus !== "paid";
    return !unpaid && order.paymentMethod ? methodName(order.paymentMethod) : "";
  }
  if (methods.length === 1) return methodName(methods[0]);
  return methods.map(m => `${methodName(m)} ${rupees(legs[m])}`).join(" + ");
}
