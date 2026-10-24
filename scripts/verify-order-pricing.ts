/**
 * Verifies server-side order pricing: DB-floor validation (anti-under-ring),
 * discount clamping, tax recompute, and the manually-entered container charge.
 * Run: npx tsx scripts/verify-order-pricing.ts
 */
import { priceResolved, computeTotals, type ResolvedMenuItem } from "../shared/orderPricing";

const menu = new Map<number, ResolvedMenuItem>([
  [1, { id: 1, price: "500", sizes: null }],
  [2, { id: 2, price: "200", sizes: [{ size: "Large", price: 350 }] }],
]);
const rates = { taxRate: 0.18 };

const checks: Array<[string, boolean]> = [];
const near = (a: number, b: number) => Math.abs(a - b) < 0.001;

// 1. Under-ring blocked: client sends ₹1 for a ₹500 item → pulled up to the floor.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 1, price: 1 }], menu, rates, 0);
  checks.push(["under-ring pulled to floor (500)", near(r.subtotal, 500) && near(r.lines[0].unitPrice, 500)]);
}

// 2. Legitimate add-on upcharge above floor is accepted.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 2, price: 560 }], menu, rates, 0);
  checks.push(["above-floor accepted (2×560=1120)", near(r.subtotal, 1120)]);
}

// 3. Size floor honored: 'Large' floor 350; client sends 300 → up to 350.
{
  const r = priceResolved([{ menuItemId: 2, quantity: 1, price: 300, size: "Large" }], menu, rates, 0);
  checks.push(["size floor applied (350)", near(r.lines[0].unitPrice, 350)]);
}

// 4. Discount clamped to subtotal; tax on non-negative taxable.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 1, price: 500 }], menu, rates, 99999);
  checks.push(["discount clamped to subtotal", near(r.discount, 500) && near(r.tax, 0) && near(r.total, 0)]);
}

// 5. Tax + total recomputed from configured rate (no client trust).
{
  const r = priceResolved([{ menuItemId: 1, quantity: 1, price: 500 }], menu, rates, 100);
  // taxable 400 → tax 72 → total 472
  checks.push(["tax/total recomputed (472)", near(r.tax, 72) && near(r.total, 472)]);
}

// 6. Container charge is a manually staff-entered flat amount, passed through as its
//    own argument — not derived from item quantities/serviceMode.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 2, price: 500, serviceMode: "pickup" }], menu, rates, 0, 30);
  // subtotal 1000, tax 180, manual container charge 30 → 1210
  checks.push(["manual container charge added to total (1210)", near(r.total, 1210) && near(r.containerCharge, 30)]);
}

// 6b. Container charge is unaffected by item serviceMode/quantity — plain dine-in
//     items with no container charge argument still contribute 0.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 2, price: 500, serviceMode: "dinein" }], menu, rates, 0);
  checks.push(["no container charge argument defaults to 0", near(r.containerCharge, 0)]);
}

// 6c. A negative/garbage container charge is clamped to 0, never allowed to reduce
//     the total (there's no floor to validate it against, unlike menu prices).
{
  const r = priceResolved([{ menuItemId: 1, quantity: 1, price: 500 }], menu, rates, 0, -50);
  checks.push(["negative container charge clamped to 0", near(r.containerCharge, 0)]);
}

// 6d. Delivery charge: a manual flat amount like the container charge — added AFTER tax,
//     never taxed.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 2, price: 500, serviceMode: "delivery" }], menu, rates, 0, 30, 40);
  // subtotal 1000, tax 180 (on the food only), container 30, delivery 40 → 1250
  checks.push(["manual delivery charge added untaxed (1250)", near(r.total, 1250) && near(r.deliveryCharge, 40) && near(r.tax, 180)]);
}

// 6e. Omitting the delivery argument keeps every existing caller's total unchanged.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 1, price: 500 }], menu, rates, 0, 30);
  checks.push(["no delivery charge argument defaults to 0 (620)", near(r.deliveryCharge, 0) && near(r.total, 620)]);
}

// 6f. A negative or non-numeric delivery charge is clamped to 0, never reduces the total.
{
  const neg = priceResolved([{ menuItemId: 1, quantity: 1, price: 500 }], menu, rates, 0, 0, -25);
  const junk = priceResolved([{ menuItemId: 1, quantity: 1, price: 500 }], menu, rates, 0, 0, "abc");
  checks.push(["negative / non-numeric delivery charge clamped to 0", near(neg.deliveryCharge, 0) && near(junk.deliveryCharge, 0) && near(neg.total, 590)]);
}

// 7. Unknown menu item rejected.
{
  let threw = false;
  try { priceResolved([{ menuItemId: 999, quantity: 1, price: 10 }], menu, rates, 0); } catch { threw = true; }
  checks.push(["unknown menu item throws", threw]);
}

// 7b. Open item (negative id, no menu row) — client price trusted directly, no floor lookup.
{
  const r = priceResolved([{ menuItemId: -1, quantity: 2, price: 123 }], menu, rates, 0);
  checks.push(["open item trusts client price (2×123=246)", near(r.subtotal, 246) && near(r.lines[0].unitPrice, 123)]);
}

// 7c. Open item with a zero/invalid price still throws (no floor to fall back to).
{
  let threw = false;
  try { priceResolved([{ menuItemId: -1, quantity: 1, price: 0 }], menu, rates, 0); } catch { threw = true; }
  checks.push(["open item with bad price throws", threw]);
}

// 8. computeTotals clamps discount and recomputes tax.
{
  const t = computeTotals([200, 300], 99999, 0.18);
  checks.push(["computeTotals clamps discount", near(t.discount, 500) && near(t.total, 0)]);
}

// 8b. computeTotals carries the delivery charge untaxed (merge/split path).
{
  const t = computeTotals([200, 300], 0, 0.18, 20, 40);
  checks.push(["computeTotals adds delivery untaxed (500×1.18+20+40=650)", near(t.deliveryCharge, 40) && near(t.total, 650)]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
