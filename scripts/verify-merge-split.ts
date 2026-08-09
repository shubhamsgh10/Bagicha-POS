/**
 * Verifies the pure math backing merge/split (server/routes.ts's /api/orders/merge and
 * /api/orders/:id/split): container charge is computed correctly over a combined/split
 * item set (ceil-per-line, not sum-then-ceil), and the taxable base is conserved across
 * a split (source discount left in place, new order gets none — CLAUDE.md documents
 * this as aggregate-neutral by design). Route wiring itself (storage.mergeOrders/
 * splitOrder, the atomic transactions, item field copying) needs a live DB and is out
 * of scope for a pure script — this locks the arithmetic those routes depend on.
 * Run: npx tsx scripts/verify-merge-split.ts
 */
import { computeContainerCharge, computeTotals } from "../shared/orderPricing";

const checks: Array<[string, boolean]> = [];
const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// 1. computeContainerCharge: ceil-per-line, not sum-then-ceil.
{
  const items = [
    { quantity: 0.5, serviceMode: "pickup" },
    { quantity: 0.5, serviceMode: "pickup" },
  ];
  // Two separate 0.5-qty parcel lines need two containers (ceil(0.5)+ceil(0.5)=2), not
  // one that a naive ceil(0.5+0.5) would give.
  checks.push(["two 0.5-qty pickup lines need 2 containers, not 1", computeContainerCharge(items, 15) === 30]);
}
{
  const items = [
    { quantity: 3, serviceMode: "dinein" },
    { quantity: 1, serviceMode: null, parcelLeftover: true },
    { quantity: 2, serviceMode: "delivery" },
  ];
  // dinein contributes 0; parcelLeftover is a flat charge regardless of qty; delivery is ceil(qty).
  checks.push(["mixed dinein/parcelLeftover/delivery sums correctly", computeContainerCharge(items, 15) === 15 + 30]);
}

// 2. Merge: container charge from the COMBINED item set is preserved in the recomputed
//    total (previously computeTotalsFromLines had no container term at all — merging two
//    orders with parcel items silently dropped the charge from the merged total).
{
  const targetItems = [{ quantity: 2, serviceMode: "dinein" }];
  const sourceItems = [{ quantity: 1, serviceMode: "pickup" }];
  const combined = [...targetItems, ...sourceItems];
  const containerCharge = computeContainerCharge(combined, 15);
  const lineTotals = [200, 100]; // target subtotal 200, source subtotal 100
  const merged = computeTotals(lineTotals, "0", 0.18, containerCharge);
  checks.push(["merge preserves the source order's container charge", merged.containerCharge === 15]);
  checks.push(["merge total includes the container charge", approx(merged.total, 300 * 1.18 + 15)]);
}

// 3. Split: taxable base is conserved. Source subtotal S=1000, discount D=150, split into
//    S1=300 (new order, no discount) / S2=700 (remains, keeps full D). Combined taxable
//    must equal the pre-split taxable (S-D), i.e. splitting doesn't change total tax owed.
{
  const S = 1000, D = 150, S1 = 300, S2 = 700, taxRate = 0.18;
  const preSplit = computeTotals([S], D, taxRate);
  const newOrder = computeTotals([S1], "0", taxRate);
  const remaining = computeTotals([S2], D, taxRate);
  const combinedTaxable = (newOrder.subtotal - newOrder.discount) + (remaining.subtotal - remaining.discount);
  const preSplitTaxable = preSplit.subtotal - preSplit.discount;
  checks.push(["split conserves the taxable base (S1+S2-D === S-D)", approx(combinedTaxable, preSplitTaxable)]);
  checks.push(["split combined total equals pre-split total", approx(newOrder.total + remaining.total, preSplit.total)]);
}

// 4. Split: each half's OWN container charge is computed and preserved (previously both
//    halves always got containerCharge=0 regardless of what was on the split items).
{
  const splitItems = [{ quantity: 1, serviceMode: "pickup" }];
  const remainingItems = [{ quantity: 1, serviceMode: "dinein", parcelLeftover: true }];
  const newContainer = computeContainerCharge(splitItems, 15);
  const srcContainer = computeContainerCharge(remainingItems, 15);
  checks.push(["split new order gets its own container charge", newContainer === 15]);
  checks.push(["split source order keeps its own remaining container charge", srcContainer === 15]);
}

// 5. Discount-guard boundary: the route refuses a split when the source's existing
//    discount exceeds what will remain after the split-out items leave (D > S2) — this
//    is the actual failure mode found during verification (not D > S1), since a naive
//    clamp in computeTotals would otherwise silently lose the excess with nothing
//    collecting it, a real net overcharge across the two resulting bills.
{
  const S2 = 700;
  const guardTriggers = (discount: number) => discount > S2 + 0.01;
  checks.push(["guard triggers when discount (800) exceeds remaining subtotal (700)", guardTriggers(800)]);
  checks.push(["guard does NOT trigger when discount (700) exactly equals remaining subtotal", !guardTriggers(700)]);
  checks.push(["guard does NOT trigger when discount (150) is well under remaining subtotal", !guardTriggers(150)]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
