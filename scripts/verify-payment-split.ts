/**
 * Verifies shared/paymentSplit.ts — the one rule for "how much was collected by Cash vs UPI".
 *
 * Background: a part payment (cash + UPI) stores every leg in `orders.payment_breakdown`, but
 * `orders.payment_method` holds only the LARGEST leg. The Tables-page Sales card read the legs
 * (correct); Reports → Payments read the single label and put the whole bill under it (wrong —
 * the UPI half of every part payment showed up as Cash). Both now go through this module.
 *
 * The fixture below is the real 3 Oct 2026 business day (orders #1790–#1809, payment columns
 * only), as read from the shared DB while debugging the report.
 * Run: npx tsx scripts/verify-payment-split.ts
 */
import { collectedByMethod, paymentLabel, summarizeCollected, matchesPaymentFilter, paymentFilterCounts, collectedAt, collectedBusinessDate } from "../shared/paymentSplit";

const checks: Array<[string, boolean]> = [];
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

type Row = {
  id: number; status: string; paymentStatus: string; paymentMethod: string | null;
  paymentBreakdown: Record<string, string> | null;
  totalAmount: string; paidAmount: string | null; changeAmount: string; shortfallAmount: string;
};
const R = (id: number, paymentStatus: string, paymentMethod: string | null, paymentBreakdown: Record<string, string> | null,
  totalAmount: string, paidAmount: string | null, changeAmount: string, shortfallAmount: string, status = "served"): Row =>
  ({ id, status, paymentStatus, paymentMethod, paymentBreakdown, totalAmount, paidAmount, changeAmount, shortfallAmount });

const oct3: Row[] = [
  R(1790, "paid", "cash", { cash: "889" }, "889.35", "889.00", "0.00", "0.35"),
  R(1791, "paid", "cash", { cash: "1000", upi: "969" }, "1968.75", "1969.00", "0.25", "0.00"),   // PART
  R(1792, "paid", "cash", { cash: "53", upi: "10" }, "63.00", "63.00", "0.00", "0.00"),         // PART (the order in the bug report)
  R(1793, "paid", "upi", { upi: "743" }, "743.40", "743.00", "0.00", "0.40"),
  R(1794, "paid", "upi", { upi: "1373" }, "1373.40", "1373.00", "0.00", "0.40"),
  R(1795, "paid", "cash", { cash: "150", upi: "8" }, "157.50", "158.00", "0.50", "0.00"),       // PART
  R(1796, "paid", "cash", { cash: "797" }, "796.95", "797.00", "0.05", "0.00"),
  R(1797, "paid", "upi", { upi: "900" }, "899.85", "900.00", "0.15", "0.00"),
  R(1798, "paid", "upi", { upi: "857" }, "856.90", "857.00", "0.10", "0.00"),
  R(1799, "pending", null, null, "2581.20", null, "0.00", "0.00", "cancelled"),
  R(1800, "paid", "cash", { cash: "1460" }, "1461.80", "1460.00", "0.00", "1.80"),
  R(1801, "paid", "upi", { upi: "741" }, "741.45", "741.00", "0.00", "0.45"),
  R(1802, "paid", "upi", { upi: "365" }, "365.45", "365.00", "0.00", "0.45"),
  R(1803, "paid", "upi", { upi: "315" }, "333.95", "315.00", "0.00", "18.95"),
  R(1804, "paid", "cash", { cash: "3000" }, "3934.14", "3000.00", "0.00", "934.14"),
  R(1805, "pending", null, null, "2955.75", null, "0.00", "0.00", "cancelled"),
  R(1806, "pending", "cash", {}, "397.95", "0.00", "0.00", "0.00"),                              // a DUE (not collected)
  R(1807, "paid", "cash", { cash: "540" }, "543.95", "540.00", "0.00", "3.95"),
  R(1808, "pending", null, null, "261.45", null, "0.00", "0.00", "cancelled"),
  R(1809, "paid", "upi", { upi: "131" }, "131.25", "131.00", "0.00", "0.25"),
];
const paid = oct3.filter(o => o.paymentStatus === "paid");

// 0. The OLD Reports rule, kept here only to document the bug: whole paidAmount under the single label.
{
  const old: Record<string, number> = {};
  for (const o of paid) old[o.paymentMethod || "cash"] = (old[o.paymentMethod || "cash"] ?? 0) + parseFloat(o.paidAmount ?? o.totalAmount);
  checks.push(["old rule reproduces the wrong report: cash 8876", near(old.cash, 8876)]);
  checks.push(["old rule reproduces the wrong report: upi 5425", near(old.upi, 5425)]);
}

// 1. Per-order legs.
{
  const c = collectedByMethod(oct3[2]); // #1792
  checks.push(["#1792: cash leg 53", near(c.cash ?? 0, 53)]);
  checks.push(["#1792: upi leg 10 (not lost into cash)", near(c.upi ?? 0, 10)]);
}
{
  const c = collectedByMethod(oct3[1]); // #1791 — 1000 cash, 969 upi, bill 1968.75, change 0.25
  checks.push(["#1791: cash leg is net of change (999.75)", near(c.cash ?? 0, 999.75)]);
  checks.push(["#1791: upi leg 969 as entered", near(c.upi ?? 0, 969)]);
}
{
  const c = collectedByMethod(oct3[7]); // #1797 — UPI 900 on 899.85: UPI rounding is not refunded
  checks.push(["UPI-only rounding stays as entered (900)", near(c.upi ?? 0, 900) && (c.cash ?? 0) === 0]);
}

// 2. Day totals — must equal what the Tables-page Sales card computes from the same legs.
{
  const s = summarizeCollected(paid);
  checks.push(["3 Oct cash = 7888.20", near(s.breakdown.cash?.amount ?? 0, 7888.2)]);
  checks.push(["3 Oct upi = 6412.00", near(s.breakdown.upi?.amount ?? 0, 6412)]);
  checks.push(["3 Oct totalPaid = cash + upi = 14300.20", near(s.totalPaid, 14300.2)]);
  checks.push(["cash tile counts every order with a cash leg (8)", s.breakdown.cash?.count === 8]);
  checks.push(["upi tile counts every order with a upi leg (11)", s.breakdown.upi?.count === 11]);
  checks.push(["partCount = 3", s.partCount === 3]);
  checks.push(["a due order (nothing collected yet) has no legs", Object.keys(collectedByMethod(oct3[16])).length === 0]);
  checks.push(["a cancelled order has no legs", Object.keys(collectedByMethod(oct3[9])).length === 0]);
}

// 3. Cash with change handed back: only what stayed in the drawer counts.
{
  const o = R(1, "paid", "cash", { cash: "500" }, "350.00", "500.00", "150.00", "0.00");
  const s = summarizeCollected([o]);
  checks.push(["₹500 tendered on ₹350 bill → cash collected 350, not 500", near(s.totalPaid, 350) && near(s.breakdown.cash?.amount ?? 0, 350)]);
}

// 4. Legacy / bulk-settled rows with no usable breakdown fall back to the single label + paidAmount.
{
  const a = collectedByMethod(R(2, "paid", "upi", {}, "100.00", "100.00", "0.00", "0.00"));
  checks.push(["empty {} breakdown + method upi → upi 100", near(a.upi ?? 0, 100) && (a.cash ?? 0) === 0]);
  const b = collectedByMethod(R(3, "paid", "cash", null, "80.00", null, "0.00", "0.00"));
  checks.push(["null breakdown + null paidAmount → falls back to totalAmount on the label", near(b.cash ?? 0, 80)]);
  const c = collectedByMethod(R(4, "paid", null, null, "60.00", "60.00", "0.00", "0.00"));
  checks.push(["no label at all → treated as cash", near(c.cash ?? 0, 60)]);
}

// 5. A stray method (Billing's legacy dropdown) keeps its own key and still counts toward the total.
{
  const s = summarizeCollected([R(5, "paid", "card", { card: "200" }, "200.00", "200.00", "0.00", "0.00")]);
  checks.push(["stray 'card' leg is kept under its own key", near(s.breakdown.card?.amount ?? 0, 200)]);
  checks.push(["stray leg counts toward totalPaid", near(s.totalPaid, 200)]);
  checks.push(["single stray leg is not a part payment", s.partCount === 0]);
}

// 6. Human-readable label.
{
  checks.push(["label: part payment shows both legs", paymentLabel(oct3[2]) === "Cash ₹53 + UPI ₹10"]);
  checks.push(["label: fractional leg keeps paise", paymentLabel(oct3[1]) === "Cash ₹999.75 + UPI ₹969"]);
  checks.push(["label: single cash", paymentLabel(oct3[0]) === "Cash"]);
  checks.push(["label: single upi", paymentLabel(oct3[3]) === "UPI"]);
  checks.push(["label: legacy row uses its method", paymentLabel(R(6, "paid", "upi", null, "10", "10", "0", "0")) === "UPI"]);
  checks.push(["label: nothing recorded → empty string", paymentLabel(R(7, "pending", null, null, "10", null, "0", "0")) === ""]);
}

// 7. Order-page filter (Cash / UPI / Due) — same legs the Reports tiles use, so the two can never
//    disagree about which orders are "Cash". A part payment belongs to BOTH.
{
  const ids = (f: "all" | "cash" | "upi" | "due") => oct3.filter(o => matchesPaymentFilter(o, f)).map(o => o.id);
  checks.push(["filter cash = the 8 orders with a cash leg (part payments included)",
    JSON.stringify(ids("cash")) === JSON.stringify([1790, 1791, 1792, 1795, 1796, 1800, 1804, 1807])]);
  checks.push(["filter upi = the 11 orders with a upi leg (part payments included)",
    JSON.stringify(ids("upi")) === JSON.stringify([1791, 1792, 1793, 1794, 1795, 1797, 1798, 1801, 1802, 1803, 1809])]);
  checks.push(["a part payment (#1792) shows under BOTH cash and upi", ids("cash").indexOf(1792) !== -1 && ids("upi").indexOf(1792) !== -1]);
  checks.push(["filter due = only the served-but-unpaid order (#1806)", JSON.stringify(ids("due")) === JSON.stringify([1806])]);
  checks.push(["a due order is NOT counted as cash even though its stored method says cash", ids("cash").indexOf(1806) === -1]);
  checks.push(["cancelled orders match no payment filter", [1799, 1805, 1808].every(id => ids("cash").indexOf(id) === -1 && ids("upi").indexOf(id) === -1 && ids("due").indexOf(id) === -1)]);
  checks.push(["filter all matches everything, cancelled included", ids("all").length === oct3.length]);

  const c = paymentFilterCounts(oct3);
  checks.push(["counts agree with the Reports tiles (cash 8, upi 11)", c.cash === 8 && c.upi === 11]);
  checks.push(["counts: due 1, all 20", c.due === 1 && c.all === 20]);
  checks.push(["counts equal what the filter returns (no second implementation to drift)",
    c.cash === ids("cash").length && c.upi === ids("upi").length && c.due === ids("due").length]);
  checks.push(["counts of an empty list are all zero", JSON.stringify(paymentFilterCounts([])) === JSON.stringify({ all: 0, cash: 0, upi: 0, due: 0 })]);

  // Billing's legacy "mark as paid" path can leave a due order with paymentMethod "due" — still Due.
  const legacyDue = R(9001, "pending", "due", {}, "100.00", null, "0", "0");
  checks.push(["legacy method:'due' order with status served is Due", matchesPaymentFilter(legacyDue, "due")]);
  // an order still being prepared and not yet settled is neither paid nor "due"
  const inProgress = R(9002, "pending", null, null, "100.00", null, "0", "0", "preparing");
  checks.push(["an unsettled order still being prepared is not Due", !matchesPaymentFilter(inProgress, "due") && !matchesPaymentFilter(inProgress, "cash")]);
}

// 8. WHICH DAY did the money arrive? A due is billed on one day and often paid days later; the cash
//    book counts it the day it was received. `paidAt` (set by every server settle path) wins;
//    legacy rows with no paidAt fall back to the day they were billed — exactly the old behaviour.
{
  // kivi's due: billed 3 Oct 22:29 IST (=16:59Z), paid 7 Oct 12:20 IST (=06:50Z)
  const billed = "2026-10-03T16:59:00.000Z";
  const paid = "2026-10-07T06:50:00.000Z";
  checks.push(["collected day = the PAID day, not the billed day", collectedBusinessDate({ createdAt: billed, paidAt: paid }) === "2026-10-07"]);
  checks.push(["no paidAt -> falls back to the billed day (legacy rows unchanged)", collectedBusinessDate({ createdAt: billed, paidAt: null }) === "2026-10-03"]);
  checks.push(["paidAt undefined behaves like null", collectedBusinessDate({ createdAt: billed }) === "2026-10-03"]);
  checks.push(["accepts Date objects as well as ISO strings", collectedBusinessDate({ createdAt: new Date(billed), paidAt: new Date(paid) }) === "2026-10-07"]);
  checks.push(["collectedAt returns the paid instant", collectedAt({ createdAt: billed, paidAt: paid }).toISOString() === paid]);
  // The 5am-IST business-day cutoff applies to the paid time too: 02:00 IST on 8 Oct is still 7 Oct's day.
  checks.push(["paid at 2am IST belongs to the PREVIOUS business day", collectedBusinessDate({ createdAt: billed, paidAt: "2026-10-07T20:30:00.000Z" }) === "2026-10-07"]);
  checks.push(["paid at 5:10am IST starts the NEXT business day", collectedBusinessDate({ createdAt: billed, paidAt: "2026-10-07T23:40:00.000Z" }) === "2026-10-08"]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
