/**
 * Verifies server-side order pricing: DB-floor validation (anti-under-ring),
 * discount clamping, tax recompute, and container charge.
 * Run: npx tsx scripts/verify-order-pricing.ts
 */
import { priceResolved, computeTotals, type ResolvedMenuItem } from "../shared/orderPricing";

const menu = new Map<number, ResolvedMenuItem>([
  [1, { id: 1, price: "500", sizes: null }],
  [2, { id: 2, price: "200", sizes: [{ size: "Large", price: 350 }] }],
]);
const rates = { taxRate: 0.18, containerRate: 15 };

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

// 6. Container charge added for pickup lines.
{
  const r = priceResolved([{ menuItemId: 1, quantity: 2, price: 500, serviceMode: "pickup" }], menu, rates, 0);
  // subtotal 1000, tax 180, container 2×15=30 → 1210
  checks.push(["pickup container charge (1210)", near(r.total, 1210)]);
}

// 7. Unknown menu item rejected.
{
  let threw = false;
  try { priceResolved([{ menuItemId: 999, quantity: 1, price: 10 }], menu, rates, 0); } catch { threw = true; }
  checks.push(["unknown menu item throws", threw]);
}

// 8. computeTotals clamps discount and recomputes tax.
{
  const t = computeTotals([200, 300], 99999, 0.18);
  checks.push(["computeTotals clamps discount", near(t.discount, 500) && near(t.total, 0)]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
