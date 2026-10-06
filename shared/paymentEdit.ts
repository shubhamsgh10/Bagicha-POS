/**
 * Correcting a settled order's payment METHOD — "staff tapped Cash, the customer actually
 * paid UPI" — without ever changing how much money was collected.
 *
 * Why this is a separate, narrow operation rather than a re-settle: POST /api/orders/:id/payment
 * owns the money (it derives paidAmount/change/shortfall and fires loyalty points, the
 * customer WhatsApp message and feedback scheduling exactly once, guarded by
 * storage.settleOrderIfUnpaid). Re-running it to fix a label would either fire all of that a
 * second time or require unpicking the guard. This plans a re-LABEL only.
 *
 * The invariant that makes it safe behind a manager PIN: the new Cash + UPI must equal
 * exactly what shared/paymentSplit.ts's collectedByMethod already reports for the order, so
 * an edit can never hide, invent or move money out of the day's takings — only re-label it.
 * Everything else about the order (bill total, write-off, status, customer) is untouched.
 *
 * Pure (no DB, no React) so the route, the dialog and scripts/verify-payment-edit.ts all
 * share one implementation — same discipline as shared/settlement.ts.
 */
import { businessDateOf } from "./businessDay";
import { collectedByMethod, paymentLabel, type PaymentOrderLike } from "./paymentSplit";

export interface PaymentEditOrder extends PaymentOrderLike {
  status?: string | null;
  createdAt: string | Date;
  shortfallAmount?: string | number | null;
}

export interface PaymentEditRequest {
  /** Money collected as cash, NET of any change handed back — what the manager typed. */
  cash: number;
  /** Money collected by UPI. */
  upi: number;
  reason: string;
}

export type PaymentEditErrorCode =
  | "not_paid"
  | "cancelled"
  | "too_old"
  | "reason_required"
  | "negative_amount"
  | "amount_mismatch"
  | "unsupported_method"
  | "no_change";

export interface PaymentEditRejection {
  ok: false;
  code: PaymentEditErrorCode;
  message: string;
}

export interface PaymentEditPlan {
  ok: true;
  /** The requested split, normalised (zero legs dropped). */
  collected: { cash: number; upi: number };
  /** What was collected in total — identical before and after, by construction. */
  collectedTotal: number;
  /** Exactly what to persist into orders.payment_breakdown (gross: cash carries any change). */
  breakdown: Record<string, string>;
  /** orders.payment_method — the largest leg, same rule the settle route uses. */
  primaryMethod: string;
  /** orders.paid_amount — unchanged unless the change could no longer be carried (see below). */
  paidAmount: string;
  /** orders.change_amount — unchanged unless the cash leg it came out of is gone. */
  changeAmount: string;
  before: { cash: number; upi: number; label: string };
  after: { cash: number; upi: number; label: string };
  reason: string;
}

/** Paisa-level tolerance — the entered split is compared against a stored decimal. */
export const PAYMENT_EDIT_TOLERANCE = 0.01;

/** Methods this correction understands. Anything else is left alone rather than rewritten. */
const EDITABLE_METHODS = ["cash", "upi"];

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => String(round2(n));
const reject = (code: PaymentEditErrorCode, message: string): PaymentEditRejection => ({ ok: false, code, message });

/**
 * Decide whether a payment-method correction is allowed and, if so, exactly what to write.
 *
 * `todayBusinessDate` is passed in rather than read from the clock so the server, the client
 * and the tests all agree on "today" — and so a test can pin it.
 */
export function planPaymentEdit(
  order: PaymentEditOrder,
  request: PaymentEditRequest,
  todayBusinessDate: string,
): PaymentEditPlan | PaymentEditRejection {
  if (order.paymentStatus !== "paid") {
    return reject("not_paid", "Only a settled (paid) order's payment method can be corrected. A due order is still unpaid — settle it instead.");
  }
  if (order.status === "cancelled") {
    return reject("cancelled", "A cancelled order's payment method cannot be changed.");
  }
  // Same business day only (5am IST cutoff). Yesterday's takings have already been counted
  // in the cash book and reported to the owner, so they must not move underneath them.
  if (businessDateOf(new Date(order.createdAt)) !== todayBusinessDate) {
    return reject("too_old", "Only today's orders can be corrected. For an older order, the day's figures have already been reported.");
  }

  // Order matters for the dialog, which renders whichever rejection comes back. The amount
  // and method checks run BEFORE the reason check so a wrong amount explains itself
  // immediately — the reason box is normally still empty at that point, and reporting
  // "a reason is required" there would hide the thing actually blocking the save.
  const before = collectedByMethod(order);
  const unsupported = Object.keys(before).filter(m => EDITABLE_METHODS.indexOf(m) === -1);
  if (unsupported.length > 0) {
    return reject("unsupported_method", `This order was settled by ${unsupported.join(", ")}, which this correction does not handle.`);
  }

  const cash = request.cash;
  const upi = request.upi;
  if (!Number.isFinite(cash) || !Number.isFinite(upi) || cash < 0 || upi < 0) {
    return reject("negative_amount", "Amounts cannot be negative.");
  }

  const beforeCash = before.cash ?? 0;
  const beforeUpi = before.upi ?? 0;
  const collectedTotal = round2(beforeCash + beforeUpi);
  const requestedTotal = round2(cash + upi);
  if (Math.abs(requestedTotal - collectedTotal) > PAYMENT_EDIT_TOLERANCE) {
    return reject(
      "amount_mismatch",
      `Cash + UPI must equal the ₹${collectedTotal} already collected — you entered ₹${requestedTotal}. This corrects the method only, never the amount.`,
    );
  }

  const newCash = round2(cash);
  const newUpi = round2(upi);

  const reason = (request.reason ?? "").trim();
  if (!reason) {
    return reject("reason_required", "A reason is required.");
  }

  // Last: a no-op would otherwise be the code reported the moment the dialog opens showing
  // the current split, which reads as an error before anything has been attempted.
  if (Math.abs(newCash - beforeCash) <= PAYMENT_EDIT_TOLERANCE && Math.abs(newUpi - beforeUpi) <= PAYMENT_EDIT_TOLERANCE) {
    return reject("no_change", "That is already how this order is recorded.");
  }

  // The stored breakdown is GROSS — collectedByMethod nets any change handed back out of the
  // cash leg. So the change rides on the new cash leg, keeping paidAmount as it was. With no
  // cash leg left there is nothing to carry it: a pure UPI payment hands back no cash change,
  // so the change is dropped and paid becomes exactly what was collected.
  const change = num(order.changeAmount);
  const keepsChange = newCash > 0 && change > 0;
  const breakdown: Record<string, string> = {};
  if (newCash > 0) breakdown.cash = money(newCash + (keepsChange ? change : 0));
  if (newUpi > 0) breakdown.upi = money(newUpi);

  const paidAmount = money(newCash + (keepsChange ? change : 0) + newUpi);
  const changeAmount = money(keepsChange ? change : 0);

  // Largest leg wins, ties to cash — the same rule POST /api/orders/:id/payment applies, so
  // orders.payment_method keeps meaning exactly what it meant before anywhere that reads it.
  const primaryMethod = newCash >= newUpi ? "cash" : "upi";

  const afterLabel = paymentLabel({ paymentStatus: "paid", paymentBreakdown: breakdown, changeAmount, paidAmount, paymentMethod: primaryMethod });

  return {
    ok: true,
    collected: { cash: newCash, upi: newUpi },
    collectedTotal,
    breakdown,
    primaryMethod,
    paidAmount,
    changeAmount,
    before: { cash: beforeCash, upi: beforeUpi, label: paymentLabel(order) },
    after: { cash: newCash, upi: newUpi, label: afterLabel },
    reason,
  };
}
