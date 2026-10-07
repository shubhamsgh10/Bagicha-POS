/**
 * Verifies shared/dueSettlement.ts — the rules for SETTLING an order that was marked Due
 * (served but unpaid) from the Orders page: Cash / UPI / Part, change, and settle-short.
 *
 * Settlement math is NOT re-implemented here: planDueSettlement delegates to
 * shared/settlement.ts's resolveSettlement (the single paid/change/shortfall implementation
 * that SettlementDialog and POST /api/orders/:id/payment already share), and this test checks the
 * result still reads back correctly through shared/paymentSplit.ts's collectedByMethod — the same
 * function the Tables card and Reports use — so a settled due can never count differently there.
 *
 * Run: npx tsx scripts/verify-due-settlement.ts
 */
import { planDueSettlement, type DueSettleOrder } from "../shared/dueSettlement";
import { collectedByMethod, paymentLabel } from "../shared/paymentSplit";

const checks: Array<[string, boolean]> = [];
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// kivi's real due from the 3 Oct book: ₹397.95 billed, served, unpaid.
const due = (o: Partial<DueSettleOrder> = {}): DueSettleOrder => ({
  paymentStatus: "pending",
  status: "served",
  totalAmount: "397.95",
  ...o,
});
const ok = (r: ReturnType<typeof planDueSettlement>) => r.ok === true;
const code = (r: ReturnType<typeof planDueSettlement>) => (r.ok ? "" : r.code);
const pay = (cash: number, upi: number, allowShortfall = false) => {
  const payments: Array<{ method: string; amount: number }> = [];
  if (cash) payments.push({ method: "cash", amount: cash });
  if (upi) payments.push({ method: "upi", amount: upi });
  return { payments, allowShortfall };
};

// 1. The three ways to settle — each must read back, through the shared reader, as exactly what was paid.
{
  const r = planDueSettlement(due(), pay(398, 0));
  checks.push(["full cash settle is accepted", ok(r)]);
  if (r.ok) {
    checks.push(["cash: stored breakdown is just a cash leg", JSON.stringify(r.breakdown) === JSON.stringify({ cash: "398" })]);
    checks.push(["cash: primary method cash", r.primaryMethod === "cash"]);
    checks.push(["cash: ₹0.05 under the bill is rounding, not a write-off decision", !r.isShort && near(Number(r.shortfallAmount), 0)]);
    const back = collectedByMethod({ paymentStatus: "paid", paymentBreakdown: r.breakdown, changeAmount: r.changeAmount, paidAmount: r.paidAmount });
    // ₹398 handed over for a ₹397.95 bill leaves 5 paise of "change"; the shared reader nets it out of
    // cash, so what is counted is the bill (397.95) — identical to every POS settle and the Tables card.
    checks.push(["cash: reads back through collectedByMethod as the bill amount (paise change netted)", near(back.cash ?? 0, 397.95) && (back.upi ?? 0) === 0]);
    checks.push(["cash: the 5 paise 'change' is recorded", near(Number(r.changeAmount), 0.05)]);
  }
}
{
  const r = planDueSettlement(due(), pay(0, 398));
  checks.push(["full UPI settle is accepted", ok(r)]);
  if (r.ok) {
    checks.push(["upi: primary method upi", r.primaryMethod === "upi"]);
    checks.push(["upi: label reads UPI", r.label === "UPI"]);
  }
}
{
  // a whole-rupee bill keeps the part-payment numbers clean (the paise netting is covered above)
  const r = planDueSettlement(due({ totalAmount: "398" }), pay(200, 198));
  checks.push(["part settle (cash + UPI) is accepted", ok(r)]);
  if (r.ok) {
    checks.push(["part: both legs are stored", JSON.stringify(r.breakdown) === JSON.stringify({ cash: "200", upi: "198" })]);
    checks.push(["part: the larger leg is the primary method", r.primaryMethod === "cash"]);
    checks.push(["part: label shows both legs", r.label === "Cash ₹200 + UPI ₹198"]);
    const back = collectedByMethod({ paymentStatus: "paid", paymentBreakdown: r.breakdown, changeAmount: r.changeAmount, paidAmount: r.paidAmount });
    checks.push(["part: reads back as cash 200 / upi 198", near(back.cash ?? 0, 200) && near(back.upi ?? 0, 198)]);
  }
  const flip = planDueSettlement(due(), pay(150, 248));
  checks.push(["part: UPI as the larger leg makes UPI primary", flip.ok && flip.primaryMethod === "upi"]);
  const tie = planDueSettlement(due({ totalAmount: "400" }), pay(200, 200));
  checks.push(["part: an exact tie goes to cash (same rule as the payment route)", tie.ok && tie.primaryMethod === "cash"]);
}

// 2. Change: the customer hands over more cash than owed.
{
  const r = planDueSettlement(due(), pay(500, 0));
  checks.push(["overpaying cash is accepted", ok(r)]);
  if (r.ok) {
    checks.push(["overpay: change is handed back", near(Number(r.changeAmount), 102.05)]);
    checks.push(["overpay: the stored cash leg is GROSS (what was handed over)", r.breakdown.cash === "500"]);
    const back = collectedByMethod({ paymentStatus: "paid", paymentBreakdown: r.breakdown, changeAmount: r.changeAmount, paidAmount: r.paidAmount });
    checks.push(["overpay: what stays in the drawer is the bill, not the ₹500 handed over", near(back.cash ?? 0, 397.95)]);
  }
}

// 3. A bill with paise: whole-rupee payment inside the ₹1 tolerance settles WITHOUT a write-off prompt.
{
  const r = planDueSettlement(due({ totalAmount: "261.45" }), pay(0, 261));
  checks.push(["₹261 UPI on a ₹261.45 due is accepted without allowShortfall", ok(r)]);
  if (r.ok) {
    checks.push(["…and the 45 paise is recorded as the shortfall, like POS settles", near(Number(r.shortfallAmount), 0.45) && !r.isShort]);
  }
}

// 4. Settling SHORT needs an explicit opt-in, and collecting nothing is never a write-off.
{
  const refused = planDueSettlement(due(), pay(300, 0));
  checks.push(["paying ₹98 short WITHOUT allowShortfall is refused", code(refused) === "short"]);
  checks.push(["the refusal names both figures", !refused.ok && refused.message.indexOf("300") !== -1 && refused.message.indexOf("397.95") !== -1]);
  const allowed = planDueSettlement(due(), pay(300, 0, true));
  checks.push(["the same payment WITH allowShortfall is accepted", ok(allowed)]);
  if (allowed.ok) checks.push(["short: the write-off amount is recorded", near(Number(allowed.shortfallAmount), 97.95) && allowed.isShort]);
  checks.push(["collecting ₹0 is refused even with allowShortfall (that is a comp, not a write-off)", code(planDueSettlement(due(), pay(0, 0, true))) === "no_payment"]);
}

// 5. Only a real, still-open due can be settled here.
{
  checks.push(["an already-paid order is refused", code(planDueSettlement(due({ paymentStatus: "paid" }), pay(398, 0))) === "not_due"]);
  checks.push(["an order still being prepared (unpaid, not served) is not a due", code(planDueSettlement(due({ status: "preparing" }), pay(398, 0))) === "not_due"]);
  checks.push(["a cancelled order is refused with its own reason", code(planDueSettlement(due({ status: "cancelled" }), pay(398, 0))) === "cancelled"]);
}

// 6. Garbage in.
{
  checks.push(["a method other than cash/UPI is refused", code(planDueSettlement(due(), { payments: [{ method: "card", amount: 398 }] })) === "bad_method"]);
  checks.push(["a negative amount is refused", code(planDueSettlement(due(), { payments: [{ method: "cash", amount: -5 }, { method: "upi", amount: 403 }] })) === "bad_amount"]);
  checks.push(["NaN is refused", code(planDueSettlement(due(), { payments: [{ method: "cash", amount: NaN }] })) === "bad_amount"]);
  checks.push(["a non-array payments body is refused, not a crash", code(planDueSettlement(due(), { payments: undefined as any })) === "no_payment"]);
  checks.push(["a zero-amount unknown method is ignored (a blank row)", ok(planDueSettlement(due(), { payments: [{ method: "card", amount: 0 }, { method: "cash", amount: 398 }] }))]);
  const dup = planDueSettlement(due(), { payments: [{ method: "cash", amount: 100 }, { method: "cash", amount: 298 }] });
  checks.push(["repeated rows for one method are summed", dup.ok && dup.breakdown.cash === "398"]);
  const str = planDueSettlement(due({ totalAmount: 397.95 }), { payments: [{ method: "cash", amount: "398" as any }] });
  checks.push(["numeric strings (as JSON sends decimals) are accepted", ok(str)]);
}

// 7. The label the audit trail and Orders page will show.
{
  const r = planDueSettlement(due(), pay(0, 398));
  checks.push(["label matches paymentLabel on the stored shape", r.ok && r.label === paymentLabel({ paymentStatus: "paid", paymentBreakdown: r.breakdown, changeAmount: r.changeAmount, paidAmount: r.paidAmount, paymentMethod: r.primaryMethod })]);
}

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
