/**
 * Settlement math — the single source of truth for turning "which mode did staff pick and
 * what did they type" into the payment breakdown, change, and shortfall.
 *
 * Both the POS settlement dialog (client/src/components/SettlementDialog.tsx) and the
 * settlement route (server/routes.ts POST /api/orders/:id/payment) call this. That's the
 * whole point: the ₹1 tolerance used to be duplicated as a hand-written comparison on each
 * side with a comment on each begging the next person to keep them in sync, which is exactly
 * the kind of pairing that silently drifts. The client can now never be stricter or looser
 * than what the server will actually accept, because it's the same function.
 *
 * The server still recomputes from its OWN orderTotal (read from the DB) and its own copy of
 * the entered per-method amounts — it never trusts a client-computed totalPaid/shortfall.
 * Sharing the math is not the same as trusting the caller's numbers.
 */

export type SettlementMode = "cash" | "upi" | "due" | "part";

/**
 * Rupee tolerance on "did this payment cover the bill".
 *
 * Order totals are paisa-precise (tax math routinely leaves a fractional remainder, e.g.
 * ₹773.40) but real cash and UPI amounts are always whole rupees, so an exact comparison
 * would reject payments that are correct in every way that matters. Anything inside this
 * band is treated as fully settled, NOT as a write-off.
 */
export const SETTLE_TOLERANCE = 1;

export interface SettlementInput {
  mode: SettlementMode;
  cash: number;
  upi: number;
  /** The order's authoritative total. On the server this comes from the DB, never the client. */
  orderTotal: number;
}

export interface SettlementResult {
  payments: Array<{ method: "cash" | "upi"; amount: number }>;
  totalPaid: number;
  /** Money handed back to the customer — max(0, paid - total). Always 0 on a due. */
  changeAmount: number;
  /**
   * Money the bill was short by, to be deliberately written off as a loss — max(0, total - paid).
   *
   * ALWAYS 0 for a due: a due order is owed in full and tracked by paymentStatus, it is not a
   * loss. Conflating the two would double-count every open tab as lost revenue.
   */
  shortfallAmount: number;
  isDue: boolean;
  /** True only when the shortfall is real money, i.e. outside SETTLE_TOLERANCE. */
  isShort: boolean;
}

const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function resolveSettlement({ mode, cash, upi, orderTotal }: SettlementInput): SettlementResult {
  const total = clamp(orderTotal);
  const cashAmt = clamp(cash);
  const upiAmt = clamp(upi);

  if (mode === "due") {
    return {
      payments: [],
      totalPaid: 0,
      changeAmount: 0,
      shortfallAmount: 0,
      isDue: true,
      isShort: false,
    };
  }

  const payments: Array<{ method: "cash" | "upi"; amount: number }> = [];
  if (mode === "cash") {
    if (cashAmt > 0) payments.push({ method: "cash", amount: cashAmt });
  } else if (mode === "upi") {
    if (upiAmt > 0) payments.push({ method: "upi", amount: upiAmt });
  } else {
    // "part" — a split across both methods. Only non-zero legs are recorded, so a split
    // where staff ended up putting everything on one method still produces a clean
    // single-method breakdown rather than a phantom ₹0 leg.
    if (cashAmt > 0) payments.push({ method: "cash", amount: cashAmt });
    if (upiAmt > 0) payments.push({ method: "upi", amount: upiAmt });
  }

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const shortfallAmount = Math.max(0, total - totalPaid);

  return {
    payments,
    totalPaid,
    changeAmount: Math.max(0, totalPaid - total),
    shortfallAmount,
    isDue: false,
    isShort: shortfallAmount > SETTLE_TOLERANCE,
  };
}
