/**
 * Settling an order that was marked Due — the customer has come back to pay their tab.
 *
 * A due order is `paymentStatus:"pending"` + `status:"served"` (see paymentSplit.ts's isDueOrder):
 * the food went out and nothing was collected. This plans turning it into a paid order by Cash,
 * UPI or a Cash+UPI split, exactly the way the POS settlement box does — it does NOT re-implement
 * the money math. shared/settlement.ts's `resolveSettlement` is the one implementation of
 * paid / change / shortfall (shared by SettlementDialog and POST /api/orders/:id/payment, so a
 * client can never be stricter or looser than the server); this only adds the due-specific rules
 * on top: who may be settled, and which methods are accepted.
 *
 * Deliberately a separate route from the POS payment route (POST /api/orders/:id/payment):
 * that one also frees the table, completes KOT tickets and fires loyalty points, the settlement
 * WhatsApp message and the feedback request — none of which belong to a customer paying an old tab
 * (the table was freed and the kitchen finished days ago, and they were not thanked for a meal
 * they ate last week). This route changes payment fields and nothing else.
 *
 * Pure (no DB, no React) so the route, the dialog and scripts/verify-due-settlement.ts share it.
 */
import { resolveSettlement } from "./settlement";
import { isDueOrder, paymentLabel } from "./paymentSplit";

export interface DueSettleOrder {
  paymentStatus?: string | null;
  status?: string | null;
  totalAmount?: string | number | null;
}

export interface DueSettleRequest {
  /** What the customer handed over, per method — the same shape the POS dialog sends. */
  payments: Array<{ method: string; amount: number | string }>;
  /** The caller has explicitly confirmed writing off a shortfall beyond the ₹1 rounding tolerance. */
  allowShortfall?: boolean;
}

export type DueSettleErrorCode =
  | "cancelled"
  | "not_due"
  | "bad_method"
  | "bad_amount"
  | "no_payment"
  | "short";

export interface DueSettleRejection {
  ok: false;
  code: DueSettleErrorCode;
  message: string;
}

export interface DueSettlePlan {
  ok: true;
  /** Exactly what to persist into orders.payment_breakdown — GROSS (cash carries any change handed back). */
  breakdown: Record<string, string>;
  /** orders.payment_method — the larger leg, ties to cash (the payment route's rule). */
  primaryMethod: string;
  paidAmount: string;
  changeAmount: string;
  /** Recorded even when tiny, exactly as the payment route does — a ₹0.45 gap on a ₹261.45 bill. */
  shortfallAmount: string;
  /** True only when the gap is real money (beyond SETTLE_TOLERANCE) and was explicitly confirmed. */
  isShort: boolean;
  orderTotal: number;
  /** "Cash", "UPI" or "Cash ₹200 + UPI ₹198" — for the audit row and the toast. */
  label: string;
  /** What actually stays with the restaurant: cash net of change, and UPI as entered. */
  collected: { cash: number; upi: number };
}

const SETTLE_METHODS = ["cash", "upi"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => String(round2(n));
const reject = (code: DueSettleErrorCode, message: string): DueSettleRejection => ({ ok: false, code, message });

export function planDueSettlement(order: DueSettleOrder, request: DueSettleRequest): DueSettlePlan | DueSettleRejection {
  if (order.status === "cancelled") {
    return reject("cancelled", "A cancelled order has nothing to settle.");
  }
  if (!isDueOrder(order)) {
    return reject("not_due", "Only an order marked Due can be settled here — this one is not an open due.");
  }

  let cash = 0;
  let upi = 0;
  const rows = Array.isArray(request.payments) ? request.payments : [];
  for (const row of rows) {
    const amount = Number(row?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return reject("bad_amount", "Amounts must be zero or more.");
    }
    if (amount === 0) continue; // a blank row, whatever its method
    const method = String(row?.method ?? "");
    if (SETTLE_METHODS.indexOf(method) === -1) {
      return reject("bad_method", `A due can be settled by cash or UPI only (got "${method}").`);
    }
    if (method === "cash") cash += amount; else upi += amount;
  }

  if (cash + upi <= 0) {
    // Settling for ₹0 is a comp, not a write-off — refuse it outright, even with allowShortfall.
    return reject("no_payment", "Enter the amount received in cash and/or UPI.");
  }

  const orderTotal = Number(order.totalAmount ?? 0);
  // "part" records only the non-zero legs, so an all-cash or all-UPI entry still produces a clean
  // single-method breakdown (the same reason SettlementDialog uses it for its split mode).
  const s = resolveSettlement({ mode: "part", cash, upi, orderTotal });

  if (s.isShort && !request.allowShortfall) {
    return reject(
      "short",
      `Amount received (₹${round2(s.totalPaid)}) is less than the bill (₹${round2(orderTotal)}). Confirm the write-off to settle short.`,
    );
  }

  const breakdown: Record<string, string> = {};
  if (cash > 0) breakdown.cash = money(cash);
  if (upi > 0) breakdown.upi = money(upi);
  const primaryMethod = cash >= upi ? "cash" : "upi";
  const paidAmount = money(s.totalPaid);
  const changeAmount = money(s.changeAmount);

  return {
    ok: true,
    breakdown,
    primaryMethod,
    paidAmount,
    changeAmount,
    shortfallAmount: money(s.shortfallAmount),
    isShort: s.isShort,
    orderTotal: round2(orderTotal),
    label: paymentLabel({ paymentStatus: "paid", paymentBreakdown: breakdown, changeAmount, paidAmount, paymentMethod: primaryMethod }),
    collected: { cash: round2(Math.max(0, cash - s.changeAmount)), upi: round2(upi) },
  };
}
