/**
 * Verifies shared/orderItemsSave.ts — the pure decisions behind PUT /api/orders/:id/items:
 * who may write (missing / cancelled / settled orders), when a save is a no-op (unchanged cart),
 * and which lines go on the Kitchen-screen ticket (new dishes, new sizes, quantity increases).
 * Run: npx tsx scripts/verify-order-items-save.ts
 */
import {
  orderEditBlock,
  isNoopItemsSave,
  sameLines,
  sameMoney,
  kitchenTicketLines,
  discountNeedsApproval,
  type PersistedLine,
  type OrderMoneyColumns,
} from "../shared/orderItemsSave";

const checks: Array<[string, boolean]> = [];

// ── orderEditBlock ──
checks.push(["missing order → 404 not_found", orderEditBlock(undefined, true)?.status === 404 && orderEditBlock(null, false)?.code === "not_found"]);
checks.push(["cancelled order → 409 even for a no-op save", orderEditBlock({ status: "cancelled", paymentStatus: "pending" }, false)?.code === "cancelled"]);
checks.push(["paid order + a change → 409 settled", orderEditBlock({ status: "served", paymentStatus: "paid" }, true)?.code === "settled"]);
checks.push(["paid order + no change → allowed (bill reprint)", orderEditBlock({ status: "served", paymentStatus: "paid" }, false) === null]);
checks.push(["running order → allowed", orderEditBlock({ status: "preparing", paymentStatus: "pending" }, true) === null]);
checks.push(["due order (served + pending) → still editable", orderEditBlock({ status: "served", paymentStatus: "pending" }, true) === null]);
checks.push(["held order → editable", orderEditBlock({ status: "hold", paymentStatus: "pending" }, true) === null]);

// ── sameLines / sameMoney / isNoopItemsSave ──
const L = (over: Partial<PersistedLine> = {}): PersistedLine => ({
  menuItemId: 7, name: "Butter Naan", quantity: 1, price: "40.00", specialInstructions: null,
  size: null, serviceMode: "dinein", parcelLeftover: false, ...over,
});
checks.push(["identical rows are the same", sameLines([L()], [L()])]);
checks.push(["row order does not matter", sameLines([L(), L({ menuItemId: 9, name: "Dal" })], [L({ menuItemId: 9, name: "Dal" }), L()])]);
checks.push(["price '40.00' equals 40 / '40'", sameLines([L({ price: "40.00" })], [L({ price: 40 })]) && sameLines([L()], [L({ price: "40" })])]);
checks.push(["'' and null instructions are the same", sameLines([L({ specialInstructions: "" })], [L({ specialInstructions: null })])]);
checks.push(["a quantity change differs", !sameLines([L()], [L({ quantity: 2 })])]);
checks.push(["a price change differs", !sameLines([L()], [L({ price: "45.00" })])]);
checks.push(["an instructions change differs", !sameLines([L()], [L({ specialInstructions: "Note: less oil" })])]);
checks.push(["a service-mode flip differs", !sameLines([L()], [L({ serviceMode: "pickup" })])]);
checks.push(["a parcel flag differs", !sameLines([L()], [L({ parcelLeftover: true })])]);
checks.push(["an added row differs", !sameLines([L()], [L(), L()])]);
checks.push(["duplicate rows are counted, not just matched", !sameLines([L(), L()], [L(), L({ quantity: 3 })])]);

const M = (over: Partial<OrderMoneyColumns> = {}): OrderMoneyColumns => ({
  totalAmount: "42.00", taxAmount: "2.00", discountAmount: "0.00", subtotalAmount: "40.00",
  containerCharge: "0.00", deliveryCharge: "0.00", ...over,
});
checks.push(["same money columns", sameMoney(M(), M({ totalAmount: "42" }))]);
checks.push(["a container charge change differs", !sameMoney(M(), M({ containerCharge: "10.00" }))]);
checks.push(["a discount change differs", !sameMoney(M(), M({ discountAmount: "5.00" }))]);
checks.push(["null delivery equals 0", sameMoney(M({ deliveryCharge: null }), M())]);
checks.push(["legacy row with no subtotal is rewritten once", !sameMoney(M({ subtotalAmount: null }), M())]);

const order = { ...M(), customerName: "Ravi", customerPhone: "9876543210" };
const noop = (over: Record<string, unknown> = {}) =>
  isNoopItemsSave({ existingLines: [L()], nextLines: [L()], existingOrder: order, nextMoney: M(), ...over } as any);
checks.push(["unchanged cart, no customer fields sent → no-op", noop()]);
checks.push(["unchanged cart, same customer sent → no-op", noop({ customerName: "Ravi", customerPhone: "9876543210" })]);
checks.push(["a customer name change is a change", !noop({ customerName: "Ravi K" })]);
checks.push(["clearing the phone ('') is a change", !noop({ customerPhone: "" })]);
checks.push(["a quantity change is a change", !noop({ nextLines: [L({ quantity: 2 })] })]);
checks.push(["a money change is a change", !noop({ nextMoney: M({ totalAmount: "50.00" }) })]);

// ── kitchenTicketLines ──
const existing = [
  { menuItemId: 7, name: "Butter Naan", quantity: 1, size: null, serviceMode: "dinein" },
  { menuItemId: 12, name: "Pizza (Regular)", quantity: 1, size: "Regular", serviceMode: "dinein" },
];
const line = (over: Record<string, unknown>) => ({ menuItemId: 7, name: "Butter Naan", quantity: 1, size: null, serviceMode: "dinein", ...over });

const up = kitchenTicketLines([line({ quantity: 3 }), line({ menuItemId: 12, name: "Pizza (Regular)", size: "Regular" })], existing);
checks.push(["1 → 3 Butter Naan puts +2 on the ticket", up.length === 1 && up[0].name === "Butter Naan" && up[0].quantity === 2 && up[0].previousQty === 1]);

const newSize = kitchenTicketLines([
  line({}),
  line({ menuItemId: 12, name: "Pizza (Regular)", size: "Regular" }),
  line({ menuItemId: 12, name: "Pizza (Large)", size: "Large" }),
], existing);
checks.push(["a Large next to the Regular Pizza is on the ticket", newSize.length === 1 && newSize[0].name === "Pizza (Large)" && newSize[0].quantity === 1 && newSize[0].previousQty === undefined]);

const fresh = kitchenTicketLines([line({ menuItemId: 30, name: "Lassi", quantity: 2, specialInstructions: "Note: no sugar", addons: [{ name: "Ice" }] })], []);
checks.push(["a new dish keeps its folded instructions", fresh.length === 1 && fresh[0].instructions === "Note: no sugar | + Ice" && fresh[0].quantity === 2]);
checks.push(["service mode is carried", kitchenTicketLines([line({ menuItemId: 31, name: "Tea", serviceMode: "pickup" })], [])[0].serviceMode === "pickup"]);

checks.push(["unchanged items → no ticket", kitchenTicketLines([line({}), line({ menuItemId: 12, name: "Pizza (Regular)", size: "Regular" })], existing).length === 0]);
checks.push(["a quantity decrease → no ticket", kitchenTicketLines([line({ quantity: 0.5 })], [existing[0]]).length === 0]);
checks.push(["a pure dine-in → parcel flip → no ticket", kitchenTicketLines([line({ serviceMode: "pickup" })], [existing[0]]).length === 0]);
checks.push(["removing a dish → no ticket", kitchenTicketLines([line({})], existing).length === 0]);

// Duplicate lines of one dish (reopened order + the same dish added again, or different add-ons).
const dupe = kitchenTicketLines([line({}), line({ addons: [{ name: "Ghee" }] })], [existing[0]]);
checks.push(["a second Naan line → +1 on the ticket (was never sent)", dupe.length === 1 && dupe[0].quantity === 1 && dupe[0].previousQty === 1]);
checks.push(["…with both lines' instructions spelled out", dupe[0].instructions === "1x regular; 1x + Ghee"]);
const twoNew = kitchenTicketLines([line({ menuItemId: 40, name: "Pizza" }), line({ menuItemId: 40, name: "Pizza", addons: [{ name: "Extra Cheese" }] })], []);
checks.push(["two new lines of one dish → one entry of 2 with each variant", twoNew.length === 1 && twoNew[0].quantity === 2 && twoNew[0].instructions === "1x regular; 1x + Extra Cheese"]);

// ── discountNeedsApproval ──
const A = (over: Partial<Parameters<typeof discountNeedsApproval>[0]> = {}) =>
  discountNeedsApproval({ discountAfter: 0, subtotalAfter: 1000, discountBefore: 0, subtotalBefore: 1000, ...over });
checks.push(["no discount → no approval", !A()]);
checks.push(["a new discount → approval", A({ discountAfter: 100 })]);
checks.push(["same approved 10% after adding items (100 of 1000 → 150 of 1500) → no approval", !A({ discountBefore: 100, discountAfter: 150, subtotalAfter: 1500 })]);
checks.push(["unchanged amount and subtotal → no approval", !A({ discountBefore: 100, discountAfter: 100 })]);
checks.push(["lowering the discount → no approval", !A({ discountBefore: 100, discountAfter: 50 })]);
checks.push(["10% → 20% → approval", A({ discountBefore: 100, discountAfter: 200 })]);
checks.push(["rounding (10% of 333.33 = 33.33) → no approval", !A({ discountBefore: 100, subtotalBefore: 1000, discountAfter: 33.33, subtotalAfter: 333.33 })]);
checks.push(["a flat amount kept while items are REMOVED (rate rises) → approval", A({ discountBefore: 100, subtotalBefore: 1000, discountAfter: 100, subtotalAfter: 500 })]);
checks.push(["legacy row with no subtotal → treated as no prior approval", A({ discountBefore: 100, subtotalBefore: 0, discountAfter: 100 })]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? `\nAll ${checks.length} checks passed.` : `\n${failed} of ${checks.length} checks FAILED.`);
process.exit(failed === 0 ? 0 : 1);
