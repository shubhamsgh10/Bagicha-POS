/**
 * Verifies shared/paymentEdit.ts — the rules for correcting a settled order's payment
 * METHOD (staff tapped Cash when the customer actually paid UPI) without ever changing
 * how much money was collected.
 *
 * The invariant that makes this safe to expose behind a manager PIN: the new Cash + UPI
 * must equal exactly what `collectedByMethod` already reported for that order, so no edit
 * can hide, invent, or move money out of the day's takings — only re-label it.
 *
 * Run: npx tsx scripts/verify-payment-edit.ts
 */
import { planPaymentEdit, type PaymentEditOrder } from "../shared/paymentEdit";
import { collectedByMethod } from "../shared/paymentSplit";

const checks: Array<[string, boolean]> = [];
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const TODAY = "2026-10-06";
// 10:30 IST on the business day above — well clear of the 5am cutoff at either end.
const todayAt = (hhmm: string) => `2026-10-06T${hhmm}:00.000+05:30`;

const order = (o: Partial<PaymentEditOrder>): PaymentEditOrder => ({
  paymentStatus: "paid",
  status: "served",
  createdAt: todayAt("10:30"),
  totalAmount: "63.00",
  paidAmount: "63.00",
  changeAmount: "0.00",
  paymentBreakdown: { cash: "53", upi: "10" },
  paymentMethod: "cash",
  ...o,
});

const ok = (r: ReturnType<typeof planPaymentEdit>) => r.ok === true;
const code = (r: ReturnType<typeof planPaymentEdit>) => (r.ok ? "" : r.code);

// 1. The headline case: #1792 was 53 cash + 10 UPI; the customer actually paid all UPI.
{
  const r = planPaymentEdit(order({}), { cash: 0, upi: 63, reason: "wrong method tapped" }, TODAY);
  checks.push(["swap to all-UPI is allowed", ok(r)]);
  if (r.ok) {
    checks.push(["swap to all-UPI: breakdown has only a upi leg", JSON.stringify(r.breakdown) === JSON.stringify({ upi: "63" })]);
    checks.push(["swap to all-UPI: primary method follows the money", r.primaryMethod === "upi"]);
    checks.push(["swap to all-UPI: paid amount untouched", near(Number(r.paidAmount), 63)]);
    // The whole point: re-reading the edited order must give exactly the new split.
    const after = collectedByMethod({ paymentStatus: "paid", paymentBreakdown: r.breakdown, changeAmount: r.changeAmount, paidAmount: r.paidAmount });
    checks.push(["swap to all-UPI: re-reads as upi 63, no cash", near(after.upi ?? 0, 63) && (after.cash ?? 0) === 0]);
  }
}

// 2. Fixing a mistyped split (53/10 entered the wrong way round).
{
  const r = planPaymentEdit(order({}), { cash: 10, upi: 53, reason: "split entered reversed" }, TODAY);
  checks.push(["reversing a split is allowed", ok(r)]);
  if (r.ok) {
    const after = collectedByMethod({ paymentStatus: "paid", paymentBreakdown: r.breakdown, changeAmount: r.changeAmount, paidAmount: r.paidAmount });
    checks.push(["reversed split re-reads as cash 10 / upi 53", near(after.cash ?? 0, 10) && near(after.upi ?? 0, 53)]);
    checks.push(["reversed split: primary method is the larger leg", r.primaryMethod === "upi"]);
  }
}

// 3. The total collected can never move — this is the guard that makes the PIN enough.
{
  const more = planPaymentEdit(order({}), { cash: 60, upi: 10, reason: "x" }, TODAY);
  checks.push(["refuses a split that totals MORE than was collected", code(more) === "amount_mismatch"]);
  const less = planPaymentEdit(order({}), { cash: 20, upi: 10, reason: "x" }, TODAY);
  checks.push(["refuses a split that totals LESS than was collected", code(less) === "amount_mismatch"]);
  const neg = planPaymentEdit(order({}), { cash: -10, upi: 73, reason: "x" }, TODAY);
  checks.push(["refuses a negative leg", code(neg) === "negative_amount"]);
  const mismatch = planPaymentEdit(order({}), { cash: 60, upi: 10, reason: "x" }, TODAY);
  checks.push(["mismatch message names both figures", !mismatch.ok && mismatch.message.indexOf("63") !== -1]);
}

// 4. Change handed back stays out of the collected figure, on both sides of the edit.
//    #1791: 1000 cash + 969 upi on a 1968.75 bill, 0.25 change → 1968.75 collected.
{
  const o = order({ totalAmount: "1968.75", paidAmount: "1969.00", changeAmount: "0.25", paymentBreakdown: { cash: "1000", upi: "969" } });
  const before = collectedByMethod(o);
  checks.push(["fixture: collected before is 999.75 + 969", near(before.cash ?? 0, 999.75) && near(before.upi ?? 0, 969)]);

  const r = planPaymentEdit(o, { cash: 1968.75, upi: 0, reason: "all cash" }, TODAY);
  checks.push(["all-cash on an order with change is allowed", ok(r)]);
  if (r.ok) {
    // The stored cash leg is GROSS (what was handed over), so netting the change back out
    // reproduces the requested figure exactly.
    checks.push(["change is re-added to the stored cash leg", near(Number(r.breakdown.cash), 1969)]);
    checks.push(["change itself is untouched", near(Number(r.changeAmount), 0.25)]);
    const after = collectedByMethod({ paymentStatus: "paid", paymentBreakdown: r.breakdown, changeAmount: r.changeAmount, paidAmount: r.paidAmount });
    checks.push(["all-cash with change re-reads as exactly 1968.75", near(after.cash ?? 0, 1968.75)]);
  }

  // Moving everything to UPI leaves no cash leg to carry the change — there is no such
  // thing as cash change on a pure UPI payment, so it is dropped and paid == collected.
  const u = planPaymentEdit(o, { cash: 0, upi: 1968.75, reason: "all upi" }, TODAY);
  checks.push(["all-UPI on an order with change is allowed", ok(u)]);
  if (u.ok) {
    checks.push(["all-UPI drops the cash change", near(Number(u.changeAmount), 0)]);
    checks.push(["all-UPI sets paid to what was collected", near(Number(u.paidAmount), 1968.75)]);
    const after = collectedByMethod({ paymentStatus: "paid", paymentBreakdown: u.breakdown, changeAmount: u.changeAmount, paidAmount: u.paidAmount });
    checks.push(["all-UPI with change re-reads as exactly 1968.75", near(after.upi ?? 0, 1968.75) && (after.cash ?? 0) === 0]);
  }
}

// 5. A short-settled order keeps its write-off — the edit only re-labels what WAS paid.
{
  const o = order({ totalAmount: "3934.14", paidAmount: "3000.00", shortfallAmount: "934.14", paymentBreakdown: { cash: "3000" } });
  const r = planPaymentEdit(o, { cash: 0, upi: 3000, reason: "paid by upi" }, TODAY);
  checks.push(["short-settled order can be re-labelled", ok(r)]);
  if (r.ok) checks.push(["short-settled: collected stays 3000, not the bill total", near(r.collectedTotal, 3000)]);
}

// 6. Only paid, non-cancelled orders from the current business day.
{
  checks.push(["refuses a due / unpaid order", code(planPaymentEdit(order({ paymentStatus: "pending", paymentBreakdown: {}, paidAmount: "0.00" }), { cash: 63, upi: 0, reason: "x" }, TODAY)) === "not_paid"]);
  checks.push(["refuses a cancelled order", code(planPaymentEdit(order({ status: "cancelled" }), { cash: 0, upi: 63, reason: "x" }, TODAY)) === "cancelled"]);
  checks.push(["refuses yesterday's order", code(planPaymentEdit(order({ createdAt: "2026-10-05T20:00:00.000+05:30" }), { cash: 0, upi: 63, reason: "x" }, TODAY)) === "too_old"]);
  // 2am today still belongs to YESTERDAY's business day (5am cutoff) — must be refused
  // while 2am TOMORROW still belongs to today's and must be allowed.
  checks.push(["refuses 2am today (previous business day)", code(planPaymentEdit(order({ createdAt: "2026-10-06T02:00:00.000+05:30" }), { cash: 0, upi: 63, reason: "x" }, TODAY)) === "too_old"]);
  checks.push(["allows 1am tomorrow (still today's business day)", ok(planPaymentEdit(order({ createdAt: "2026-10-07T01:00:00.000+05:30" }), { cash: 0, upi: 63, reason: "x" }, TODAY))]);
}

// 7. A reason is required, and a no-op edit is refused rather than logged as a change.
{
  checks.push(["refuses a blank reason", code(planPaymentEdit(order({}), { cash: 0, upi: 63, reason: "   " }, TODAY)) === "reason_required"]);
  // Ordering is deliberate: the dialog shows whichever rejection comes back, and the reason
  // box is still empty while amounts are being typed. If "reason required" won here, a wrong
  // amount would grey out Save with no explanation of what is actually wrong.
  checks.push(["an amount error outranks the blank reason", code(planPaymentEdit(order({}), { cash: 500, upi: 0, reason: "" }, TODAY)) === "amount_mismatch"]);
  checks.push(["a stale/ineligible order outranks the blank reason", code(planPaymentEdit(order({ status: "cancelled" }), { cash: 0, upi: 63, reason: "" }, TODAY)) === "cancelled"]);
  checks.push(["refuses an edit that changes nothing", code(planPaymentEdit(order({}), { cash: 53, upi: 10, reason: "x" }, TODAY)) === "no_change"]);
}

// 8. Legacy rows with no stored legs can still be corrected.
{
  const o = order({ paymentBreakdown: null, paymentMethod: "cash", paidAmount: "80.00", totalAmount: "80.00" });
  const r = planPaymentEdit(o, { cash: 0, upi: 80, reason: "was upi" }, TODAY);
  checks.push(["legacy row (no breakdown) can be corrected", ok(r)]);
  if (r.ok) checks.push(["legacy row: before-label read from paymentMethod", r.before.label === "Cash"]);
}

// 9. Anything that isn't plain cash/UPI is left alone rather than silently rewritten.
{
  const o = order({ paymentBreakdown: { card: "200" }, paymentMethod: "card", paidAmount: "200.00", totalAmount: "200.00" });
  checks.push(["refuses an order settled by an unsupported method", code(planPaymentEdit(o, { cash: 200, upi: 0, reason: "x" }, TODAY)) === "unsupported_method"]);
}

// 10. The audit row's before/after labels are the human-readable split.
{
  const r = planPaymentEdit(order({}), { cash: 0, upi: 63, reason: "wrong method" }, TODAY);
  checks.push(["before label shows the old split", r.ok && r.before.label === "Cash ₹53 + UPI ₹10"]);
  checks.push(["after label shows the new method", r.ok && r.after.label === "UPI"]);
}

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
