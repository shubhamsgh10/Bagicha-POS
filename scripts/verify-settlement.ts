/**
 * Verifies shared/settlement.ts's resolveSettlement — the shared math used by both
 * SettlementDialog.tsx and POST /api/orders/:id/payment, so the client can never be
 * stricter or looser than what the server actually accepts.
 * Run: npx tsx scripts/verify-settlement.ts
 */
import { resolveSettlement, SETTLE_TOLERANCE } from "../shared/settlement";

const checks: Array<[string, boolean]> = [];
const near = (a: number, b: number) => Math.abs(a - b) < 0.001;

// 1. Exact cash settle covers the bill exactly.
{
  const r = resolveSettlement({ mode: "cash", cash: 1230, upi: 0, orderTotal: 1230 });
  checks.push(["exact cash settle: no change, no shortfall", near(r.totalPaid, 1230) && near(r.changeAmount, 0) && near(r.shortfallAmount, 0) && !r.isShort && !r.isDue]);
  checks.push(["exact cash settle: single payment entry", r.payments.length === 1 && r.payments[0].method === "cash" && near(r.payments[0].amount, 1230)]);
}

// 2. Overpay produces change, not a shortfall.
{
  const r = resolveSettlement({ mode: "upi", cash: 0, upi: 1300, orderTotal: 1230 });
  checks.push(["overpay: change 70, no shortfall", near(r.changeAmount, 70) && near(r.shortfallAmount, 0) && !r.isShort]);
}

// 3. A gap inside the ₹1 tolerance is NOT a shortfall (rounding).
{
  const r = resolveSettlement({ mode: "cash", cash: 1229.6, upi: 0, orderTotal: 1230 });
  checks.push(["₹0.40 gap within tolerance: not short", !r.isShort && r.shortfallAmount <= SETTLE_TOLERANCE]);
}

// 4. A real gap beyond tolerance IS a shortfall.
{
  const r = resolveSettlement({ mode: "upi", cash: 0, upi: 1200, orderTotal: 1230 });
  checks.push(["₹30 gap: shortfall 30, isShort true", near(r.shortfallAmount, 30) && r.isShort]);
  checks.push(["₹30 gap: totalPaid stays what was entered (1200)", near(r.totalPaid, 1200)]);
}

// 5. Part summing to exactly the total: two payments, no shortfall.
{
  const r = resolveSettlement({ mode: "part", cash: 800, upi: 430, orderTotal: 1230 });
  checks.push(["part exact split: two payments, no shortfall", r.payments.length === 2 && near(r.totalPaid, 1230) && !r.isShort]);
}

// 6. Part falling short: shortfall reflects the real gap.
{
  const r = resolveSettlement({ mode: "part", cash: 800, upi: 200, orderTotal: 1230 });
  checks.push(["part short: shortfall 230", near(r.shortfallAmount, 230) && r.isShort]);
}

// 7. Part with one leg at zero produces a single-entry breakdown, not a phantom ₹0 leg.
{
  const r = resolveSettlement({ mode: "part", cash: 1230, upi: 0, orderTotal: 1230 });
  checks.push(["part with zero UPI leg: single payment entry", r.payments.length === 1 && r.payments[0].method === "cash"]);
}

// 8. Due: zero paid, zero shortfall — a due order is owed in full, never a loss.
{
  const r = resolveSettlement({ mode: "due", cash: 500, upi: 200, orderTotal: 1230 });
  checks.push(["due: no payments regardless of entered amounts", r.payments.length === 0 && near(r.totalPaid, 0)]);
  checks.push(["due: shortfall always 0, never a loss", near(r.shortfallAmount, 0) && !r.isShort && r.isDue]);
}

// 9. Negative/garbage inputs clamp to 0 rather than going negative.
{
  const r = resolveSettlement({ mode: "cash", cash: -50, upi: 0, orderTotal: 1230 });
  checks.push(["negative cash input clamped to 0", r.payments.length === 0 && near(r.totalPaid, 0)]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
