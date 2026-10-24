/**
 * Verifies client/src/lib/chargeBoxes.ts — which manual-charge boxes the POS cart totals panel
 * offers. Dine-in → none, pickup → Container, delivery → Container + Delivery. A table session
 * reads the "Adding as" toggle OR any cart line's serviceMode; a standalone order reads its
 * order-type tab. A box holding a non-zero amount never hides, so no charge can sit in the
 * total while its box is invisible.
 * Run: npx tsx scripts/verify-charge-boxes.ts
 */
import { chargeBoxVisibility, type ChargeBoxContext } from "../client/src/lib/chargeBoxes";

const checks: Array<[string, boolean]> = [];
const ctx = (over: Partial<ChargeBoxContext> = {}): ChargeBoxContext => ({
  isTableSession: true, activeItemMode: "dinein", orderType: "dine-in",
  cartModes: [], containerCharge: 0, deliveryCharge: 0, ...over,
});
const table = (over: Partial<ChargeBoxContext> = {}) => chargeBoxVisibility(ctx(over));
const standalone = (over: Partial<ChargeBoxContext> = {}) => chargeBoxVisibility(ctx({ isTableSession: false, ...over }));
const is = (r: { showContainer: boolean; showDelivery: boolean }, container: boolean, delivery: boolean) =>
  r.showContainer === container && r.showDelivery === delivery;

// Table session: the "Adding as" toggle, or what is already in the cart.
checks.push(["table, Adding as Dine-In, empty cart: no boxes", is(table(), false, false)]);
checks.push(["table, Adding as Dine-In, all-dine-in cart: no boxes", is(table({ cartModes: ["dinein", "dinein"] }), false, false)]);
checks.push(["table, Adding as Pickup: Container only", is(table({ activeItemMode: "pickup" }), true, false)]);
checks.push(["table, Adding as Delivery: Container + Delivery", is(table({ activeItemMode: "delivery" }), true, true)]);
checks.push(["table, back on Dine-In with a pickup item in the cart: Container stays", is(table({ cartModes: ["dinein", "pickup"] }), true, false)]);
checks.push(["table, back on Dine-In with a delivery item in the cart: both stay", is(table({ cartModes: ["delivery"] }), true, true)]);
checks.push(["table, Adding as Pickup with a delivery item in the cart: both", is(table({ activeItemMode: "pickup", cartModes: ["delivery"] }), true, true)]);
checks.push(["table session ignores the order-type tab", is(table({ orderType: "delivery" }), false, false)]);
checks.push(["table cart line with no serviceMode counts as dine-in", is(table({ cartModes: [undefined, null] }), false, false)]);

// Standalone order: the order-type tab.
checks.push(["standalone dine-in: no boxes", is(standalone({ orderType: "dine-in" }), false, false)]);
checks.push(["standalone pickup (takeaway): Container only", is(standalone({ orderType: "takeaway" }), true, false)]);
checks.push(["standalone delivery: Container + Delivery", is(standalone({ orderType: "delivery" }), true, true)]);
checks.push(["standalone ignores the Adding as toggle", is(standalone({ orderType: "dine-in", activeItemMode: "delivery" }), false, false)]);

// A non-zero amount always keeps its own box visible.
checks.push(["saved container charge keeps its box on a dine-in table", is(table({ containerCharge: 20 }), true, false)]);
checks.push(["saved delivery charge keeps its box on a dine-in table", is(table({ deliveryCharge: 30 }), false, true)]);
checks.push(["standalone dine-in with both amounts entered: both boxes", is(standalone({ orderType: "dine-in", containerCharge: 10, deliveryCharge: 30 }), true, true)]);
checks.push(["standalone pickup with a delivery amount entered: Delivery too", is(standalone({ orderType: "takeaway", deliveryCharge: 30 }), true, true)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
