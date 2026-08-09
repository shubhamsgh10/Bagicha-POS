/**
 * Verifies shared/orderPricing.ts's deriveBillTotals(): with the persisted
 * subtotalAmount/containerCharge columns present, it must recover the exact
 * pre-discount/pre-tax subtotal and container charge for any combination of
 * discount/container/tax rate — the whole point of adding those columns instead
 * of reconstructing subtotal as totalAmount - taxAmount (only correct when
 * discount = 0 AND containerCharge = 0).
 * Run: npx tsx scripts/verify-bill-derivation.ts
 */
import { deriveBillTotals } from "../shared/orderPricing";

const checks: Array<[string, boolean]> = [];
const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// Same relation shared/orderPricing.ts's priceResolved uses:
//   taxable = subtotal - discount
//   tax     = taxable * taxRate
//   total   = taxable + tax + containerCharge
function priceLikeOrder(subtotal: number, discount: number, containerCharge: number, taxRate: number) {
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  const total = taxable + tax + containerCharge;
  return {
    totalAmount: total.toFixed(2),
    taxAmount: tax.toFixed(2),
    discountAmount: discount.toFixed(2),
    subtotalAmount: subtotal.toFixed(2),
    containerCharge: containerCharge.toFixed(2),
  };
}

// 1. Matrix: with persisted columns present, subtotal/containerCharge come back exact
//    (not reconstructed), and the four components foot to the total, for every
//    combination — including the case that was wrong before (discount>0 AND container>0).
const matrix: Array<[number, number, number, number]> = [
  [1000, 0, 0, 0.18],      // no discount, no container — the case the old formula got right
  [1000, 100, 0, 0.18],    // discount only
  [1000, 0, 40, 0.18],     // container only
  [1000, 100, 40, 0.18],   // both — this is the case that was wrong by ~60 before this fix
  [560, 0, 15, 0.05],      // different tax rate, small container
  [0, 0, 0, 0.18],         // empty order edge case
];
for (const [subtotal, discount, containerCharge, taxRate] of matrix) {
  const order = priceLikeOrder(subtotal, discount, containerCharge, taxRate);
  const derived = deriveBillTotals(order);
  const label = `subtotal=${subtotal} discount=${discount} container=${containerCharge} taxRate=${taxRate}`;
  checks.push([`${label}: subtotal recovered exactly`, approx(derived.subtotal, subtotal)]);
  checks.push([`${label}: containerCharge recovered exactly`, approx(derived.containerCharge, containerCharge)]);
  checks.push([`${label}: components foot to total`, approx(
    derived.subtotal - derived.discount + derived.tax + derived.containerCharge,
    derived.total,
  )]);
}

// 2. The specific counterexample from Phase 1 verification: subtotal 1000, discount 100,
//    container 40, tax 18% — the reconstructed "subtotal" (total - tax) used to be 940,
//    not 1000, a 60-rupee discrepancy. Confirm deriveBillTotals gets the real 1000.
{
  const order = priceLikeOrder(1000, 100, 40, 0.18);
  const derived = deriveBillTotals(order);
  checks.push(["known counterexample: subtotal is 1000, not the old wrong 940", approx(derived.subtotal, 1000)]);
}

// 3. Legacy fallback: rows written before subtotalAmount/containerCharge existed
//    (both null) still resolve via total - tax / 0, matching pre-fix behavior exactly
//    (not retroactively "fixed" — there's no reliable source to recompute them from).
{
  const legacy = { totalAmount: "1180.00", taxAmount: "180.00", discountAmount: "0" };
  const derived = deriveBillTotals(legacy);
  checks.push(["legacy row (no persisted columns) falls back to total-tax", approx(derived.subtotal, 1000)]);
  checks.push(["legacy row (no persisted columns) container defaults to 0", derived.containerCharge === 0]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
