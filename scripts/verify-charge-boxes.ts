/**
 * Verifies client/src/lib/chargeBoxes.ts — which manual-charge boxes the POS cart totals panel
 * offers. A table session (always dine-in) → Container only. A standalone order reads its
 * order-type tab: dine-in → none, pickup → Container, delivery → Container + Delivery. A box
 * holding a non-zero amount never hides, so no charge can sit in the total while its box is
 * invisible.
 * Run: npx tsx scripts/verify-charge-boxes.ts
 */
import { chargeBoxVisibility, type ChargeBoxContext } from "../client/src/lib/chargeBoxes";

const checks: Array<[string, boolean]> = [];
const ctx = (over: Partial<ChargeBoxContext> = {}): ChargeBoxContext => ({
  isTableSession: true, orderType: "dine-in", containerCharge: 0, deliveryCharge: 0, ...over,
});
const table = (over: Partial<ChargeBoxContext> = {}) => chargeBoxVisibility(ctx(over));
const standalone = (over: Partial<ChargeBoxContext> = {}) => chargeBoxVisibility(ctx({ isTableSession: false, ...over }));
const is = (r: { showContainer: boolean; showDelivery: boolean }, container: boolean, delivery: boolean) =>
  r.showContainer === container && r.showDelivery === delivery;

// Table session: always the Container box, never Delivery, whatever the order-type tab says.
checks.push(["table session, no amounts: Container only", is(table(), true, false)]);
checks.push(["table session ignores a delivery order-type tab", is(table({ orderType: "delivery" }), true, false)]);
checks.push(["table session with a container amount: Container only", is(table({ containerCharge: 20 }), true, false)]);
// A legacy table order saved with a delivery charge keeps its box so the amount can be seen/cleared.
checks.push(["table session with a saved delivery amount: Delivery box stays", is(table({ deliveryCharge: 30 }), true, true)]);

// Standalone order: the order-type tab.
checks.push(["standalone dine-in: no boxes", is(standalone({ orderType: "dine-in" }), false, false)]);
checks.push(["standalone pickup (takeaway): Container only", is(standalone({ orderType: "takeaway" }), true, false)]);
checks.push(["standalone delivery: Container + Delivery", is(standalone({ orderType: "delivery" }), true, true)]);
checks.push(["standalone with no order type yet: no boxes", is(standalone({ orderType: undefined }), false, false)]);

// A non-zero amount always keeps its own box visible.
checks.push(["standalone dine-in with a container amount: Container box", is(standalone({ orderType: "dine-in", containerCharge: 20 }), true, false)]);
checks.push(["standalone dine-in with a delivery amount: Delivery box", is(standalone({ orderType: "dine-in", deliveryCharge: 30 }), false, true)]);
checks.push(["standalone dine-in with both amounts entered: both boxes", is(standalone({ orderType: "dine-in", containerCharge: 10, deliveryCharge: 30 }), true, true)]);
checks.push(["standalone pickup with a delivery amount entered: Delivery too", is(standalone({ orderType: "takeaway", deliveryCharge: 30 }), true, true)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
