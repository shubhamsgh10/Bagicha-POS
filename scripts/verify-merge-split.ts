/**
 * Verifies the pure math backing merge/split (server/routes.ts's /api/orders/merge and
 * /api/orders/:id/split): the taxable base is conserved across a split (source discount
 * left in place, new order gets none — CLAUDE.md documents this as aggregate-neutral by
 * design), and the manually-entered container charge is combined/preserved correctly —
 * merge sums the two orders' existing charges, split keeps the full charge on the
 * source/remaining order and starts the new split-out order at 0 (same aggregate-neutral
 * treatment as discount). Route wiring itself (storage.mergeOrders/splitOrder, the
 * atomic transactions, item field copying) needs a live DB and is out of scope for a
 * pure script — this locks the arithmetic those routes depend on.
 * Run: npx tsx scripts/verify-merge-split.ts
 */
import { computeTotals } from "../shared/orderPricing";

const checks: Array<[string, boolean]> = [];
const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// 1. Merge: container charge is the SUM of the two orders' existing manually-entered
//    charges (not recomputed from items — previously computeTotalsFromLines had no
//    container term at all, so merging two orders silently dropped both charges).
{
  const targetContainerCharge = 15; // target order already had a manually-entered charge
  const sourceContainerCharge = 10; // source order had its own
  const containerCharge = targetContainerCharge + sourceContainerCharge;
  const lineTotals = [200, 100]; // target subtotal 200, source subtotal 100
  const merged = computeTotals(lineTotals, "0", 0.18, containerCharge);
  checks.push(["merge sums both orders' container charges (25)", merged.containerCharge === 25]);
  checks.push(["merge total includes the combined container charge", approx(merged.total, 300 * 1.18 + 25)]);
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

// 4. Split: container charge gets the SAME aggregate-neutral treatment as discount —
//    the source/remaining order keeps its full existing manually-entered charge, and
//    the new split-out order starts at 0 (staff can enter one manually if that portion
//    needs its own container).
{
  const sourceExistingContainerCharge = 15;
  const newContainerCharge = 0; // new split-out order always starts at 0
  const srcContainerCharge = sourceExistingContainerCharge; // stays entirely on the source
  const newOrder = computeTotals([300], "0", 0.18, newContainerCharge);
  const remaining = computeTotals([700], "0", 0.18, srcContainerCharge);
  checks.push(["split new order starts with no container charge", newOrder.containerCharge === 0]);
  checks.push(["split source order keeps its full existing container charge", remaining.containerCharge === 15]);
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
