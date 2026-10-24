# POS Delivery Charge + Mode-Aware Charge Boxes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual, untaxed **Delivery Charge** to orders. In the POS cart, show the Container / Delivery boxes only when they apply: dine-in shows none, pickup shows Container, delivery shows both.

**Architecture:** `orders.delivery_charge` is a new first-class column. It mirrors `containerCharge` through every layer:
- the pure pricing core (`shared/orderPricing.ts`)
- the order routes, merge/split and coupon/loyalty recompute
- both bill renderers, the e-bill, and every totals display

A pure helper (`client/src/lib/chargeBoxes.ts`) decides which boxes the POS totals panel shows.

**Tech Stack:** TypeScript, Express + Drizzle (node-postgres → Supabase), React (POS.tsx), `tsx` verify scripts (`npm run test:pure`).

**Spec:** `docs/superpowers/specs/2026-10-24-pos-delivery-charge-design.md` (read it first).

**Rules that apply to every task**
- `DATABASE_URL` is the one shared **production** DB. No task writes to it except:
  - Task 10's migration (only after the user confirms).
  - Task 10's throwaway e2e script, which cleans up after itself.
- `npm run check` (`tsc`) does **not** cover `scripts/`. Validate scripts by running them with `tsx`.
- `tsconfig` has no `target` (ES5 default), so never `for…of` or spread a `Map`/`Set` in `client/`, `shared/` or `server/`.
- The server half of `npm run dev` does not hot-reload. Never start a second `npm run dev` (it would start the WhatsApp driver and print workers against the shared DB). Use Task 10's in-process harness instead.
- Commit locally on branch `fixes` after each task. **Never push.** End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit anything under `backups/`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `shared/orderPricing.ts` | Modify | `priceResolved` / `computeTotals` / `deriveBillTotals` gain `deliveryCharge` (untaxed, clamped ≥ 0) |
| `shared/schema.ts` | Modify | `orders.deliveryCharge` column |
| `scripts/migrate-order-delivery-charge.mjs` | Create | Idempotent `ADD COLUMN IF NOT EXISTS` |
| `server/services/orderPricing.ts` | Modify | `priceOrder` / `computeTotalsFromLines` pass delivery through |
| `server/routes.ts` | Modify | POST/PUT orders persist it; merge sums; split keeps on source; audit metadata |
| `shared/orderAudit.ts`, `server/services/auditService.ts` | Modify | "Bill Modified" classification includes delivery (pure twin + SQL) |
| `server/growthRoutes.ts` | Modify | Coupon/loyalty recompute keeps delivery in the total |
| `shared/print/generators.ts`, `server/printRoutes.ts`, `server/services/printDispatch.ts` | Modify | "Delivery" bill line (ESC/POS + preview text), order fields passed through |
| `shared/ebillText.ts` | Modify | "Delivery:" e-bill line |
| `client/src/lib/chargeBoxes.ts` | Create | Pure visibility rule for the two boxes |
| `client/src/lib/receiptText.ts` | Modify | Last-resort text preview prints delivery |
| `client/src/components/SettlementDialog.tsx`, `DueSettleDialog.tsx` | Modify | Summary row |
| `client/src/pages/Orders.tsx`, `Billing.tsx` | Modify | Totals rows + preview param |
| `client/src/pages/POS.tsx` | Modify | State, payloads, reopen, resets, visibility, delivery box, previews |
| `scripts/verify-*.ts` (6 existing + 1 new), `package.json` | Modify/Create | Pure tests |
| `CLAUDE.md` | Modify | Document the feature |

---

### Task 1: Pricing core — untaxed delivery charge

**Files:**
- Modify: `shared/orderPricing.ts`
- Test: `scripts/verify-order-pricing.ts`, `scripts/verify-bill-derivation.ts`, `scripts/verify-merge-split.ts`

- [ ] **Step 1: Write the failing pricing tests.** In `scripts/verify-order-pricing.ts`, insert directly after the `// 6c.` block (before `// 7. Unknown menu item rejected.`):

```ts
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
```

And after the `// 8. computeTotals clamps discount` block:

```ts
// 8b. computeTotals carries the delivery charge untaxed (merge/split path).
{
  const t = computeTotals([200, 300], 0, 0.18, 20, 40);
  checks.push(["computeTotals adds delivery untaxed (500×1.18+20+40=650)", near(t.deliveryCharge, 40) && near(t.total, 650)]);
}
```

- [ ] **Step 2: Write the failing bill-derivation tests.** In `scripts/verify-bill-derivation.ts`, insert after the `// 3. Legacy fallback` block (before `let failed = 0;`):

```ts
// 4. Delivery charge (flat, untaxed — same as container): recovered exactly, and the five
//    components foot to the total: total = (subtotal − discount)(1 + t) + container + delivery.
{
  const subtotal = 1000, discount = 100, container = 20, delivery = 40, taxRate = 0.05;
  const tax = (subtotal - discount) * taxRate; // 45
  const total = subtotal - discount + tax + container + delivery; // 1005
  const derived = deriveBillTotals({
    totalAmount: total.toFixed(2), taxAmount: tax.toFixed(2), discountAmount: discount.toFixed(2),
    subtotalAmount: subtotal.toFixed(2), containerCharge: container.toFixed(2), deliveryCharge: delivery.toFixed(2),
  });
  checks.push(["delivery charge recovered exactly (40)", approx(derived.deliveryCharge, 40)]);
  checks.push(["with delivery: subtotal − discount + tax + container + delivery foots to total", approx(
    derived.subtotal - derived.discount + derived.tax + derived.containerCharge + derived.deliveryCharge,
    derived.total,
  )]);
}

// 5. Rows written before delivery_charge existed (NULL or absent) read delivery as 0.
{
  const withNull = deriveBillTotals({ totalAmount: "1070.00", taxAmount: "50.00", discountAmount: "0", subtotalAmount: "1000.00", containerCharge: "20.00", deliveryCharge: null });
  const absent = deriveBillTotals({ totalAmount: "1070.00", taxAmount: "50.00", discountAmount: "0", subtotalAmount: "1000.00", containerCharge: "20.00" });
  checks.push(["delivery NULL or absent → 0", withNull.deliveryCharge === 0 && absent.deliveryCharge === 0]);
}
```

- [ ] **Step 3: Write the failing merge/split tests.** In `scripts/verify-merge-split.ts`, insert after the `// 5. Discount-guard boundary` block (before `let failed = 0;`):

```ts
// 6. Delivery charge gets the same aggregate-neutral treatment as the container charge:
//    merge sums both orders' charges; split leaves the full charge on the source/remaining
//    order and starts the new split-out order at 0 — so the two bills still add up.
{
  const merged = computeTotals([200, 100], "0", 0.05, 0, 30 + 20);
  checks.push(["merge sums both orders' delivery charges (50)", merged.deliveryCharge === 50]);
  checks.push(["merge total includes the combined delivery charge, untaxed", approx(merged.total, 300 * 1.05 + 50)]);
  const before = computeTotals([1000], "0", 0.05, 15, 40);
  const newOrder = computeTotals([300], "0", 0.05, 0, 0);
  const remaining = computeTotals([700], "0", 0.05, 15, 40);
  checks.push(["split: new order starts with no delivery charge", newOrder.deliveryCharge === 0]);
  checks.push(["split: source keeps its full delivery charge", remaining.deliveryCharge === 40]);
  checks.push(["split: the two bills together equal the pre-split bill", approx(newOrder.total + remaining.total, before.total)]);
}
```

- [ ] **Step 4: Run the three scripts and confirm they fail.**

Run: `npx tsx scripts/verify-order-pricing.ts; npx tsx scripts/verify-bill-derivation.ts; npx tsx scripts/verify-merge-split.ts`
Expected: each ends `RESULT: FAIL ❌`. The new delivery checks print `FAIL` because `deliveryCharge` is `undefined`. Every pre-existing check still prints `PASS`.

- [ ] **Step 5: Implement in `shared/orderPricing.ts`.**

In `interface PricedOrder`, replace:
```ts
  containerCharge: number;
  total: number;
  lines: PricedLine[]; // same order as input
```
with:
```ts
  containerCharge: number;
  deliveryCharge: number;
  total: number;
  lines: PricedLine[]; // same order as input
```

In `priceResolved`'s parameter list, replace:
```ts
  containerChargeRaw: unknown = 0,
): PricedOrder {
```
with:
```ts
  containerChargeRaw: unknown = 0,
  deliveryChargeRaw: unknown = 0,
): PricedOrder {
```

Replace the tail of `priceResolved`:
```ts
  const containerCharge = Math.max(0, Number(containerChargeRaw) || 0);
  const discount = Math.min(Math.max(0, Number(discountAmountRaw) || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  const total = taxable + tax + containerCharge;

  return { subtotal, discount, taxRate, tax, containerCharge, total, lines };
```
with:
```ts
  const containerCharge = Math.max(0, Number(containerChargeRaw) || 0);
  // Delivery charge: the same contract as the container charge — a staff-typed flat amount
  // for a delivery order, untaxed (added after tax), only clamped non-negative.
  const deliveryCharge = Math.max(0, Number(deliveryChargeRaw) || 0);
  const discount = Math.min(Math.max(0, Number(discountAmountRaw) || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  const total = taxable + tax + containerCharge + deliveryCharge;

  return { subtotal, discount, taxRate, tax, containerCharge, deliveryCharge, total, lines };
```

Replace the whole `computeTotals` function (keep its doc comment, then add one sentence to it: "`deliveryCharge` is the same kind of manual flat amount and defaults to 0 too."):
```ts
export function computeTotals(
  lineTotals: number[],
  discountAmountRaw: unknown,
  taxRate: number,
  containerCharge = 0,
  deliveryCharge = 0,
): { subtotal: number; discount: number; tax: number; total: number; containerCharge: number; deliveryCharge: number } {
  const subtotal = lineTotals.reduce((s, v) => s + v, 0);
  const discount = Math.min(Math.max(0, Number(discountAmountRaw) || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  return { subtotal, discount, tax, containerCharge, deliveryCharge, total: taxable + tax + containerCharge + deliveryCharge };
}
```

In `interface BillTotals`, add `deliveryCharge: number;` after `containerCharge: number;`.

In `deriveBillTotals`:
- Add `deliveryCharge?: string | number | null;` to the parameter type, after `containerCharge?: ...`.
- Replace:
```ts
  const containerCharge =
    order.containerCharge != null ? Number(order.containerCharge) || 0 : 0;
  return { subtotal, discount, containerCharge, tax, total };
```
with:
```ts
  const containerCharge =
    order.containerCharge != null ? Number(order.containerCharge) || 0 : 0;
  // NULL/absent for every row written before orders.delivery_charge existed.
  const deliveryCharge =
    order.deliveryCharge != null ? Number(order.deliveryCharge) || 0 : 0;
  return { subtotal, discount, containerCharge, deliveryCharge, tax, total };
```
- In its doc comment, change `total = (subtotal - discount) * (1 + taxRate) + containerCharge` to `total = (subtotal - discount) * (1 + taxRate) + containerCharge + deliveryCharge`.

- [ ] **Step 6: Run the three scripts and confirm they pass.**

Run: `npx tsx scripts/verify-order-pricing.ts; npx tsx scripts/verify-bill-derivation.ts; npx tsx scripts/verify-merge-split.ts`
Expected: all three end `RESULT: PASS ✅`.

- [ ] **Step 7: Type-check.** Run `npm run check`. Expected: exit 0. The new field is additive, and `Billing.tsx`'s literal `{ subtotal: 0, … }` fallback is typed by inference, not by `BillTotals`. If tsc *does* flag `client/src/pages/Billing.tsx` around line 461, add `deliveryCharge: 0,` after `containerCharge: 0,` in that literal now; Task 8 covers it otherwise.

- [ ] **Step 8: Commit.**
```bash
git add shared/orderPricing.ts scripts/verify-order-pricing.ts scripts/verify-bill-derivation.ts scripts/verify-merge-split.ts
git commit -m "feat(pricing): untaxed manual delivery charge in the pricing core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema column + migration script (do NOT run it yet)

**Files:**
- Modify: `shared/schema.ts` (orders table, after `containerCharge`)
- Create: `scripts/migrate-order-delivery-charge.mjs`

- [ ] **Step 1: Add the column to the schema.** In `shared/schema.ts`, replace:
```ts
  containerCharge: decimal("container_charge", { precision: 10, scale: 2 }).default("0"),
```
with:
```ts
  containerCharge: decimal("container_charge", { precision: 10, scale: 2 }).default("0"),
  // Staff-typed flat delivery charge for a delivery order (the POS cart's "Delivery Charge"
  // box) — untaxed and added after tax exactly like containerCharge (shared/orderPricing.ts).
  // Added by scripts/migrate-order-delivery-charge.mjs; 0 on every row older than the column.
  deliveryCharge: decimal("delivery_charge", { precision: 10, scale: 2 }).default("0"),
```

- [ ] **Step 2: Create `scripts/migrate-order-delivery-charge.mjs`:**
```js
/**
 * Additive migration: adds orders.delivery_charge (the POS cart's manual Delivery Charge),
 * defaulted to 0 so existing rows and the currently deployed code are untouched (db:push is
 * unsafe — see CLAUDE.md). MUST run before any server build whose schema has the column:
 * Drizzle selects every schema column, so new code against an un-migrated DB fails every
 * GET /api/orders with "column delivery_charge does not exist" (the subtotal_amount incident).
 * Idempotent. Rollback: ALTER TABLE orders DROP COLUMN IF EXISTS delivery_charge
 * Run: node scripts/migrate-order-delivery-charge.mjs
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statement = `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charge decimal(10,2) DEFAULT '0'`;
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ADD COLUMN takes a brief ACCESS EXCLUSIVE lock on orders. Never queue behind a long-running
  // query (which would block the live POS behind us) — give up after 5s; just re-run later.
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  await client.query(statement);
  await client.query('COMMIT');
  console.log('  OK:', statement);
  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'delivery_charge'`);
  console.log('Resulting column:', cols.rows);
  console.log('DONE');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('MIGRATION ERROR:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
```

- [ ] **Step 3: Type-check.** Run `npm run check`. Expected: exit 0.

- [ ] **Step 4: Commit.**
```bash
git add shared/schema.ts scripts/migrate-order-delivery-charge.mjs
git commit -m "feat(schema): orders.delivery_charge + idempotent migration script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server — price, persist, merge/split, audit

**Files:**
- Modify: `server/services/orderPricing.ts`, `server/routes.ts`, `shared/orderAudit.ts`, `server/services/auditService.ts`
- Test: `scripts/verify-kot-bill-classify.ts`

- [ ] **Step 1: Write the failing classification test.** In `scripts/verify-kot-bill-classify.ts`, change the `base` helper's defaults line:
```ts
  containerBefore: 0, containerAfter: 0,
```
to:
```ts
  containerBefore: 0, containerAfter: 0,
  deliveryBefore: 0, deliveryAfter: 0,
```
Then insert after the `// 3. Container-charge-only edit` block:
```ts
// 3b. Delivery-charge-only edit, item lines unchanged: only Bill (same rule as container).
{
  const r = classifyItemsEditRow(base({ deliveryBefore: 0, deliveryAfter: 40 }));
  checks.push(["delivery-charge-only edit: billModified true, kotModified false", !r.kotModified && r.billModified]);
}
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npx tsx scripts/verify-kot-bill-classify.ts`. Expected: `FAIL  delivery-charge-only edit…`, then `RESULT: FAIL ❌ (1)`.

- [ ] **Step 3: Update the pure classifier.** In `shared/orderAudit.ts`:

In `interface ItemsEditMetadata`, after `containerAfter?: number;` add:
```ts
  deliveryBefore?: number;
  deliveryAfter?: number;
```

In `classifyItemsEditRow`, replace:
```ts
    meta.discountBefore !== meta.discountAfter ||
    meta.containerBefore !== meta.containerAfter;
```
with:
```ts
    meta.discountBefore !== meta.discountAfter ||
    meta.containerBefore !== meta.containerAfter ||
    meta.deliveryBefore !== meta.deliveryAfter;
```

- [ ] **Step 4: Update the SQL twin.** In `server/services/auditService.ts`'s `billModified` filter, replace:
```ts
      or (${auditLogs.metadata}->>'containerBefore')::numeric is distinct from (${auditLogs.metadata}->>'containerAfter')::numeric
    ))`,
```
with:
```ts
      or (${auditLogs.metadata}->>'containerBefore')::numeric is distinct from (${auditLogs.metadata}->>'containerAfter')::numeric
      or (${auditLogs.metadata}->>'deliveryBefore')::numeric is distinct from (${auditLogs.metadata}->>'deliveryAfter')::numeric
    ))`,
```
(Old rows have no delivery keys: `NULL is distinct from NULL` is false, so their classification is unchanged.)

- [ ] **Step 5: Run the test and confirm it passes.** Run `npx tsx scripts/verify-kot-bill-classify.ts`. Expected: `RESULT: PASS ✅`.

- [ ] **Step 6: Pass delivery through the server pricing wrapper.** In `server/services/orderPricing.ts`, replace the `priceOrder` doc comment and signature:
```ts
/** DB-backed pricing for POST /orders and PUT /orders/:id/items. `containerChargeRaw`
 * is the staff-typed manual container charge for this order (see shared/orderPricing.ts). */
export async function priceOrder(
  items: PricingItemInput[],
  discountAmountRaw: unknown,
  containerChargeRaw: unknown = 0,
): Promise<PricedOrder> {
```
with:
```ts
/** DB-backed pricing for POST /orders and PUT /orders/:id/items. `containerChargeRaw` and
 * `deliveryChargeRaw` are the staff-typed manual charges for this order (see shared/orderPricing.ts). */
export async function priceOrder(
  items: PricingItemInput[],
  discountAmountRaw: unknown,
  containerChargeRaw: unknown = 0,
  deliveryChargeRaw: unknown = 0,
): Promise<PricedOrder> {
```
and its return line:
```ts
  return priceResolved(list, byId, pricingRates(), discountAmountRaw, containerChargeRaw);
```
with:
```ts
  return priceResolved(list, byId, pricingRates(), discountAmountRaw, containerChargeRaw, deliveryChargeRaw);
```
Replace `computeTotalsFromLines`'s signature and body:
```ts
export function computeTotalsFromLines(
  lineTotals: number[],
  discountAmountRaw: unknown,
  containerCharge = 0,
): { subtotal: number; discount: number; tax: number; total: number; containerCharge: number } {
  return computeTotals(lineTotals, discountAmountRaw, pricingRates().taxRate, containerCharge);
}
```
with:
```ts
export function computeTotalsFromLines(
  lineTotals: number[],
  discountAmountRaw: unknown,
  containerCharge = 0,
  deliveryCharge = 0,
): { subtotal: number; discount: number; tax: number; total: number; containerCharge: number; deliveryCharge: number } {
  return computeTotals(lineTotals, discountAmountRaw, pricingRates().taxRate, containerCharge, deliveryCharge);
}
```
Also append to its doc comment: "`deliveryCharge` follows the same rule."

- [ ] **Step 7: `POST /api/orders` in `server/routes.ts`.**

Replace:
```ts
        priced = await priceOrder(lineItems, orderInfo.discountAmount, orderInfo.containerCharge);
```
with:
```ts
        priced = await priceOrder(lineItems, orderInfo.discountAmount, orderInfo.containerCharge, orderInfo.deliveryCharge);
```

Replace (inside the `storage.createOrderWithItems({...})` literal):
```ts
          containerCharge: priced.containerCharge.toFixed(2),
          createdBy: isStaffMemberActor ? null : (actor?.id ?? null),
```
with:
```ts
          containerCharge: priced.containerCharge.toFixed(2),
          deliveryCharge: priced.deliveryCharge.toFixed(2),
          createdBy: isStaffMemberActor ? null : (actor?.id ?? null),
```
(`...orderInfo` is spread first, so the client's raw string is always overwritten by the server's clamped value.)

- [ ] **Step 8: `PUT /api/orders/:id/items` in `server/routes.ts`.**

Replace:
```ts
      const { items, discountAmount, containerCharge, customerName, customerPhone } = req.body;
```
with:
```ts
      const { items, discountAmount, containerCharge, deliveryCharge, customerName, customerPhone } = req.body;
```

Replace:
```ts
        priced = await priceOrder(lineItems, discountAmount, containerCharge);
```
with:
```ts
        priced = await priceOrder(lineItems, discountAmount, containerCharge, deliveryCharge);
```

Replace (inside the `storage.replaceOrderItems(...)` totals literal):
```ts
        containerCharge: priced.containerCharge.toFixed(2),
        ...(customerName !== undefined ? { customerName: customerName || null } : {}),
```
with:
```ts
        containerCharge: priced.containerCharge.toFixed(2),
        deliveryCharge: priced.deliveryCharge.toFixed(2),
        ...(customerName !== undefined ? { customerName: customerName || null } : {}),
```

Replace the audit block's money fields:
```ts
        const containerBefore = parseFloat(String((existingOrderRow as any)?.containerCharge ?? 0));
        const containerAfter = priced.containerCharge;
        const totalBefore = parseFloat(String((existingOrderRow as any)?.totalAmount ?? 0));
        const totalAfter = priced.total;
        const moneyChanged = discountBefore !== discountAfter || containerBefore !== containerAfter || totalBefore !== totalAfter;
```
with:
```ts
        const containerBefore = parseFloat(String((existingOrderRow as any)?.containerCharge ?? 0));
        const containerAfter = priced.containerCharge;
        const deliveryBefore = parseFloat(String((existingOrderRow as any)?.deliveryCharge ?? 0));
        const deliveryAfter = priced.deliveryCharge;
        const totalBefore = parseFloat(String((existingOrderRow as any)?.totalAmount ?? 0));
        const totalAfter = priced.total;
        const moneyChanged = discountBefore !== discountAfter || containerBefore !== containerAfter
          || deliveryBefore !== deliveryAfter || totalBefore !== totalAfter;
```
And in the `logAudit(req, "order.items_edit", …)` metadata, replace:
```ts
            containerBefore,
            containerAfter,
          });
```
with:
```ts
            containerBefore,
            containerAfter,
            deliveryBefore,
            deliveryAfter,
          });
```

- [ ] **Step 9: Merge (`POST /api/orders/merge`).** Replace:
```ts
      const containerCharge = (Number((targetOrder as any).containerCharge) || 0)
        + (Number((sourceOrder as any).containerCharge) || 0);
      const merged = computeTotalsFromLines(
        allItems.map((i) => parseFloat(i.price as any) * i.quantity),
        (targetOrder as any).discountAmount,
        containerCharge,
      );
```
with:
```ts
      const containerCharge = (Number((targetOrder as any).containerCharge) || 0)
        + (Number((sourceOrder as any).containerCharge) || 0);
      // Delivery charge: same rule — the merged order carries both orders' charges.
      const deliveryCharge = (Number((targetOrder as any).deliveryCharge) || 0)
        + (Number((sourceOrder as any).deliveryCharge) || 0);
      const merged = computeTotalsFromLines(
        allItems.map((i) => parseFloat(i.price as any) * i.quantity),
        (targetOrder as any).discountAmount,
        containerCharge,
        deliveryCharge,
      );
```
And replace:
```ts
          containerCharge: merged.containerCharge.toFixed(2),
```
with:
```ts
          containerCharge: merged.containerCharge.toFixed(2),
          deliveryCharge: merged.deliveryCharge.toFixed(2),
```

- [ ] **Step 10: Split (`POST /api/orders/:id/split`).** Replace:
```ts
      const newContainerCharge = 0;
      const splitTotals = computeTotalsFromLines(
        splitItems.map((i) => parseFloat(i.price as any) * i.quantity),
        "0",
        newContainerCharge,
      );

      const srcContainerCharge = Number((sourceOrder as any).containerCharge) || 0;
      const srcTotals = computeTotalsFromLines(
        remainingItems.map((i) => parseFloat(i.price as any) * i.quantity),
        (sourceOrder as any).discountAmount,
        srcContainerCharge,
      );
```
with:
```ts
      const newContainerCharge = 0;
      // Delivery charge gets the same treatment: stays on the source, new order starts at 0.
      const newDeliveryCharge = 0;
      const splitTotals = computeTotalsFromLines(
        splitItems.map((i) => parseFloat(i.price as any) * i.quantity),
        "0",
        newContainerCharge,
        newDeliveryCharge,
      );

      const srcContainerCharge = Number((sourceOrder as any).containerCharge) || 0;
      const srcDeliveryCharge = Number((sourceOrder as any).deliveryCharge) || 0;
      const srcTotals = computeTotalsFromLines(
        remainingItems.map((i) => parseFloat(i.price as any) * i.quantity),
        (sourceOrder as any).discountAmount,
        srcContainerCharge,
        srcDeliveryCharge,
      );
```
Replace:
```ts
          containerCharge: splitTotals.containerCharge.toFixed(2),
```
with:
```ts
          containerCharge: splitTotals.containerCharge.toFixed(2),
          deliveryCharge: splitTotals.deliveryCharge.toFixed(2),
```
Replace:
```ts
          containerCharge: srcTotals.containerCharge.toFixed(2),
```
with:
```ts
          containerCharge: srcTotals.containerCharge.toFixed(2),
          deliveryCharge: srcTotals.deliveryCharge.toFixed(2),
```

- [ ] **Step 11: Type-check and re-run the affected pure tests.**
Run: `npm run check; npx tsx scripts/verify-kot-bill-classify.ts; npx tsx scripts/verify-merge-split.ts`
Expected: tsc exit 0; both scripts `RESULT: PASS ✅`.

- [ ] **Step 12: Commit.**
```bash
git add server/services/orderPricing.ts server/routes.ts shared/orderAudit.ts server/services/auditService.ts scripts/verify-kot-bill-classify.ts
git commit -m "feat(orders): persist delivery charge; merge/split/audit carry it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Coupon / loyalty recompute keeps the delivery charge

**Files:** Modify `server/growthRoutes.ts` (two handlers)

- [ ] **Step 1: Coupon apply.** In `POST /api/coupons/apply`, replace:
```ts
      const { subtotal, containerCharge } = deriveBillTotals(order);
```
with:
```ts
      const { subtotal, containerCharge, deliveryCharge } = deriveBillTotals(order);
```
and:
```ts
      const total = taxable + tax + containerCharge;

      const updated = await storage.updateOrder(Number(orderId), {
```
with:
```ts
      const total = taxable + tax + containerCharge + deliveryCharge;

      const updated = await storage.updateOrder(Number(orderId), {
```
Also update that comment block's phrase "keeps the container charge" to "keeps the container and delivery charges".

- [ ] **Step 2: Loyalty redeem.** In `POST /api/loyalty/redeem`, replace:
```ts
        const { subtotal, containerCharge } = deriveBillTotals(order);
```
with:
```ts
        const { subtotal, containerCharge, deliveryCharge } = deriveBillTotals(order);
```
and:
```ts
        const total = taxable + tax + containerCharge;
        const updated = await storage.updateOrder(order.id, {
```
with:
```ts
        const total = taxable + tax + containerCharge + deliveryCharge;
        const updated = await storage.updateOrder(order.id, {
```
Update the matching comment the same way.

- [ ] **Step 3: Type-check.** Run `npm run check`. Expected: exit 0.

- [ ] **Step 4: Commit.**
```bash
git add server/growthRoutes.ts
git commit -m "fix(growth): coupon/loyalty recompute keeps the delivery charge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bill renderers print a "Delivery" line

**Files:**
- Modify: `shared/print/generators.ts`, `server/printRoutes.ts`, `server/services/printDispatch.ts`
- Test: `scripts/verify-escpos-interpret.ts`

- [ ] **Step 1: Write the failing test.** In `scripts/verify-escpos-interpret.ts`, insert after the `// ── 1. The real bill, interpreted` block's closing `}` (before `// ── 2. Duplicate watermark`):
```ts
// ── 1b. Container + Delivery: flat, untaxed lines, Container then Delivery, before Grand Total ─
{
  const doc = interpretEscPos(
    generateBillBuffer({
      order: { ...order(0), totalAmount: "437.45", containerCharge: "20.00", deliveryCharge: "30.00" },
      items, restaurant, billSettings, cashierName: "rajbhaghel", width: 48,
    }),
    48,
  );
  const texts = lines(doc).map((l) => l.text);
  const ci = texts.findIndex((t) => t.includes("Container  20.00"));
  const di = texts.findIndex((t) => t.includes("Delivery  30.00"));
  const gi = texts.findIndex((t) => t.includes("Grand Total"));
  check("bill: Delivery line printed when the order has a delivery charge", di >= 0);
  check("bill: Delivery sits after Container and before Grand Total", ci >= 0 && ci < di && di < gi);
  check("bill: no Delivery line on an order without one", !findLine(bill(), "Delivery"));
}
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npx tsx scripts/verify-escpos-interpret.ts`. Expected: the two new "Delivery line printed" / "Delivery sits after" checks `FAIL`, then `RESULT: FAIL ❌ (2)`.

- [ ] **Step 3: ESC/POS generator.** In `shared/print/generators.ts`, `generateBillBuffer`'s `order` param type: after `containerCharge?: string | null;` add `deliveryCharge?: string | null;`. Then replace:
```ts
  const { subtotal, discount, containerCharge, tax } = deriveBillTotals(order);
```
with:
```ts
  const { subtotal, discount, containerCharge, deliveryCharge, tax } = deriveBillTotals(order);
```
and replace:
```ts
  if (containerCharge > 0) {
    parts.push(tw("", `Container  ${containerCharge.toFixed(2)}`));
  }
```
with:
```ts
  if (containerCharge > 0) {
    parts.push(tw("", `Container  ${containerCharge.toFixed(2)}`));
  }
  if (deliveryCharge > 0) {
    parts.push(tw("", `Delivery  ${deliveryCharge.toFixed(2)}`));
  }
```

- [ ] **Step 4: Preview text (must match the generator).** In `server/printRoutes.ts`'s `billTextLines` `order` param type, after `containerCharge?: string | null;` add `deliveryCharge?: string | null;`. Replace:
```ts
  const { subtotal, discount, containerCharge, tax } = deriveBillTotals(order);
```
with:
```ts
  const { subtotal, discount, containerCharge, deliveryCharge, tax } = deriveBillTotals(order);
```
and:
```ts
  if (containerCharge > 0) lines.push(two("", `Container  ${containerCharge.toFixed(2)}`));
```
with:
```ts
  if (containerCharge > 0) lines.push(two("", `Container  ${containerCharge.toFixed(2)}`));
  if (deliveryCharge > 0) lines.push(two("", `Delivery  ${deliveryCharge.toFixed(2)}`));
```
In the `/api/print/preview` bill branch's `billTextLines({ order: { … } })` call, replace:
```ts
          containerCharge: order.containerCharge,
```
with:
```ts
          containerCharge: order.containerCharge,
          deliveryCharge: order.deliveryCharge,
```

- [ ] **Step 5: Real print path.** In `server/services/printDispatch.ts`'s `generateBillBuffer({ order: { … } })` call, replace:
```ts
        containerCharge: order.containerCharge,
```
with:
```ts
        containerCharge: order.containerCharge,
        deliveryCharge: order.deliveryCharge,
```
(`order` is a full `orders` row — the `db_bill` query selects `order: orders`, so the new column comes along with no query change.)

- [ ] **Step 6: Run the test + type-check.** Run `npx tsx scripts/verify-escpos-interpret.ts; npm run check`. Expected: `RESULT: PASS ✅`, then tsc exit 0.

- [ ] **Step 7: Commit.**
```bash
git add shared/print/generators.ts server/printRoutes.ts server/services/printDispatch.ts scripts/verify-escpos-interpret.ts
git commit -m "feat(print): Delivery line on the thermal bill and its preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: WhatsApp e-bill text

**Files:** Modify `shared/ebillText.ts`. Test: `scripts/verify-ebill-text.ts`

- [ ] **Step 1: Write the failing test.** In `scripts/verify-ebill-text.ts`, insert after the `// No container charge:` block:
```ts
// Delivery order: an untaxed flat Delivery line after Container, before TOTAL; Subtotal is still the food.
{
  const t = buildEbillText({ orderNumber: "D", totalAmount: "585.00", taxAmount: "25.00", subtotalAmount: "500.00", discountAmount: "0.00", containerCharge: "20.00", deliveryCharge: "40.00" }, []);
  checks.push(["delivery order: a Delivery line is printed", lineOf(t, "Delivery:") === "Delivery: ₹40"]);
  const rows = ["Tax:", "Container:", "Delivery:", "TOTAL:"].map((p) => t.indexOf(p));
  checks.push(["delivery order: rows read Tax → Container → Delivery → TOTAL", rows.every((i) => i >= 0) && rows.every((v, i) => i === 0 || v > rows[i - 1])]);
  checks.push(["delivery order: Subtotal is the food total and TOTAL foots (500+25+20+40=585)", lineOf(t, "Subtotal:") === "Subtotal: ₹500" && lineOf(t, "TOTAL:") === "*TOTAL: ₹585*"]);
}
{
  const t = buildEbillText({ orderNumber: "Y2", totalAmount: "105.00", taxAmount: "5.00", subtotalAmount: "100.00", deliveryCharge: "0.00" }, []);
  checks.push(["no delivery charge: no Delivery line", !t.includes("Delivery")]);
}
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npx tsx scripts/verify-ebill-text.ts`. Expected: the first two delivery checks `FAIL`, ending `RESULT: FAIL ❌ (2)`.

- [ ] **Step 3: Implement.** In `shared/ebillText.ts`, replace:
```ts
  const { subtotal, discount, tax, containerCharge, total } = deriveBillTotals(order);
```
with:
```ts
  const { subtotal, discount, tax, containerCharge, deliveryCharge, total } = deriveBillTotals(order);
```
and:
```ts
    containerCharge > 0 ? `Container: ₹${containerCharge.toFixed(0)}` : null,
```
with:
```ts
    containerCharge > 0 ? `Container: ₹${containerCharge.toFixed(0)}` : null,
    deliveryCharge > 0 ? `Delivery: ₹${deliveryCharge.toFixed(0)}` : null,
```
In the file's doc comment, change `(1 + tax rate) + container, so the rows read Subtotal → Discount → Tax → Container → TOTAL.` to `(1 + tax rate) + container + delivery, so the rows read Subtotal → Discount → Tax → Container → Delivery → TOTAL.`

- [ ] **Step 4: Run the test.** Run `npx tsx scripts/verify-ebill-text.ts`. Expected: `RESULT: PASS ✅`.

- [ ] **Step 5: Commit.**
```bash
git add shared/ebillText.ts scripts/verify-ebill-text.ts
git commit -m "feat(ebill): Delivery line on the WhatsApp e-bill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Visibility helper `chargeBoxes.ts`

**Files:**
- Create: `client/src/lib/chargeBoxes.ts`
- Create: `scripts/verify-charge-boxes.ts`
- Modify: `package.json` (`test:pure` chain)

- [ ] **Step 1: Write the failing test** `scripts/verify-charge-boxes.ts`:
```ts
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
```

- [ ] **Step 2: Run it and confirm it fails.** Run `npx tsx scripts/verify-charge-boxes.ts`. Expected: it crashes with a module-not-found error for `client/src/lib/chargeBoxes`.

- [ ] **Step 3: Implement** `client/src/lib/chargeBoxes.ts`:
```ts
/**
 * Which manual-charge boxes the POS cart totals panel offers (pure — unit-tested by
 * scripts/verify-charge-boxes.ts):
 *   dine-in  → neither box
 *   pickup   → Container Charge
 *   delivery → Container Charge + Delivery Charge
 *
 * A table session tracks service mode per item: new items take the "Adding as" toggle
 * (activeItemMode), and a saved/added line keeps its own serviceMode. So a box applies when
 * EITHER the toggle or any line already in the cart is pickup/delivery — flipping the toggle
 * back to Dine-In must not hide the Container box of a cart that still holds parcel items.
 * A standalone order (pickup/delivery mode, or a new order with no table) reads its
 * order-type tab instead.
 *
 * Whatever the mode, a box holding a non-zero amount is always shown: the amount is inside
 * the total, and a charge nobody can see (or clear) is worse than an extra box.
 *
 * Section POS never reaches this — POS.tsx doesn't render the totals block there
 * (SectionActionBar has its own Container box), so there is no section flag.
 */
export interface ChargeBoxContext {
  /** Table/edit session: items carry their own serviceMode, set by the "Adding as" strip. */
  isTableSession: boolean;
  /** "Adding as" mode for NEW items — "dinein" | "pickup" | "delivery" (table sessions). */
  activeItemMode: string;
  /** The form's order-type tab — "dine-in" | "takeaway" | "delivery" (standalone orders). */
  orderType: string | undefined;
  /** serviceMode of every line currently in the cart (missing = dine-in). */
  cartModes: ReadonlyArray<string | null | undefined>;
  containerCharge: number;
  deliveryCharge: number;
}

export function chargeBoxVisibility(ctx: ChargeBoxContext): { showContainer: boolean; showDelivery: boolean } {
  let deliveryApplies: boolean;
  let containerApplies: boolean;
  if (ctx.isTableSession) {
    deliveryApplies = ctx.activeItemMode === "delivery" || ctx.cartModes.some((m) => m === "delivery");
    containerApplies = deliveryApplies || ctx.activeItemMode === "pickup" || ctx.cartModes.some((m) => m === "pickup");
  } else {
    deliveryApplies = ctx.orderType === "delivery";
    containerApplies = deliveryApplies || ctx.orderType === "takeaway";
  }
  return {
    showContainer: containerApplies || ctx.containerCharge > 0,
    showDelivery: deliveryApplies || ctx.deliveryCharge > 0,
  };
}
```

- [ ] **Step 4: Run the test.** Run `npx tsx scripts/verify-charge-boxes.ts`. Expected: 17 `PASS`, `RESULT: PASS ✅`.

- [ ] **Step 5: Add it to CI's chain.** In `package.json`'s `test:pure`, append ` && tsx scripts/verify-charge-boxes.ts` to the end of the existing command string (after `tsx scripts/verify-egress-helpers.ts`).

- [ ] **Step 6: Commit.**
```bash
git add client/src/lib/chargeBoxes.ts scripts/verify-charge-boxes.ts package.json
git commit -m "feat(pos): pure rule for which charge boxes the cart shows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Show the delivery charge everywhere totals are displayed

**Files:** Modify `client/src/lib/receiptText.ts`, `client/src/components/SettlementDialog.tsx`, `client/src/components/DueSettleDialog.tsx`, `client/src/pages/Orders.tsx`, `client/src/pages/Billing.tsx`

- [ ] **Step 1: `receiptText.ts` (last-resort text preview).** In `billLines`' param type, after `containerCharge?: number;` add `deliveryCharge?: number;`. Replace:
```ts
  const subtotal = params.totalAmount - (params.taxAmount ?? 0) - (params.containerCharge ?? 0);
```
with:
```ts
  const subtotal = params.totalAmount - (params.taxAmount ?? 0) - (params.containerCharge ?? 0) - (params.deliveryCharge ?? 0);
```
and after the container block:
```ts
  if ((params.containerCharge ?? 0) > 0) {
    lines.push(_two('Container Charge:', `${sym}${(params.containerCharge ?? 0).toFixed(0)}`, W));
  }
```
add:
```ts
  if ((params.deliveryCharge ?? 0) > 0) {
    lines.push(_two('Delivery Charge:', `${sym}${(params.deliveryCharge ?? 0).toFixed(0)}`, W));
  }
```

- [ ] **Step 2: `SettlementDialog.tsx`.** In `Props`, replace:
```ts
  containerCharge?: number;
  discountAmount?: number;
```
with:
```ts
  containerCharge?: number;
  // The flat, untaxed delivery charge already inside grandTotal — its own row, same reason.
  deliveryCharge?: number;
  discountAmount?: number;
```
In the destructure, replace `items, subtotal, taxAmount, containerCharge, discountAmount, orderLabel,` with `items, subtotal, taxAmount, containerCharge, deliveryCharge, discountAmount, orderLabel,`. After the Container row:
```tsx
                {containerCharge != null && containerCharge > 0 && (
                  <div className="flex justify-between text-gray-500"><span>Container</span><span>{inr(containerCharge)}</span></div>
                )}
```
add:
```tsx
                {deliveryCharge != null && deliveryCharge > 0 && (
                  <div className="flex justify-between text-gray-500"><span>Delivery</span><span>{inr(deliveryCharge)}</span></div>
                )}
```

- [ ] **Step 3: `DueSettleDialog.tsx`.** Replace:
```tsx
        containerCharge={bill.containerCharge}
```
with:
```tsx
        containerCharge={bill.containerCharge}
        deliveryCharge={bill.deliveryCharge}
```

- [ ] **Step 4: `Orders.tsx`.** In `showBillPreview`'s `billLines({…})`, replace:
```ts
      containerCharge: billTotals.containerCharge,
```
with:
```ts
      containerCharge: billTotals.containerCharge,
      deliveryCharge: billTotals.deliveryCharge,
```
In the expanded-detail totals, after the Container block (ends `{fmt(billTotals.containerCharge)}</span>\n                    </div>\n                  )}`), add:
```tsx
                  {billTotals.deliveryCharge > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Delivery</span>
                      <span>{fmt(billTotals.deliveryCharge)}</span>
                    </div>
                  )}
```

- [ ] **Step 5: `Billing.tsx`.**
  - Replace `: { subtotal: 0, discount: 0, containerCharge: 0, tax: 0, total: 0 };` with `: { subtotal: 0, discount: 0, containerCharge: 0, deliveryCharge: 0, tax: 0, total: 0 };`. Skip this if Task 1 Step 7 already did it.
  - After the order-card Container block (`{deriveBillTotals(order).containerCharge > 0 && ( … )}`, 20-space indent), add:
```tsx
                    {deriveBillTotals(order).deliveryCharge > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Delivery</span>
                        <span>{formatCurrency(deriveBillTotals(order).deliveryCharge)}</span>
                      </div>
                    )}
```
  - After the Collect Payment dialog's Container block (`{payingOrderTotals.containerCharge > 0 && ( … )}`, 14-space indent), add:
```tsx
              {payingOrderTotals.deliveryCharge > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delivery</span>
                  <span>{formatCurrency(payingOrderTotals.deliveryCharge)}</span>
                </div>
              )}
```

- [ ] **Step 6: Type-check.** Run `npm run check`. Expected: exit 0.

- [ ] **Step 7: Commit.**
```bash
git add client/src/lib/receiptText.ts client/src/components/SettlementDialog.tsx client/src/components/DueSettleDialog.tsx client/src/pages/Orders.tsx client/src/pages/Billing.tsx
git commit -m "feat(ui): show the delivery charge in settle dialogs, Orders and Billing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: POS cart — delivery box, mode-aware visibility, payloads

**Files:** Modify `client/src/pages/POS.tsx`

- [ ] **Step 1: Import the helper.** After `import { kotLines, billLines } from "@/lib/receiptText";` add:
```ts
import { chargeBoxVisibility } from "@/lib/chargeBoxes";
```

- [ ] **Step 2: State.** Replace:
```tsx
  const [containerCharge, setContainerCharge] = useState(0);
```
with:
```tsx
  const [containerCharge, setContainerCharge] = useState(0);
  // Manually staff-entered delivery charge (₹) for delivery orders — the same contract as
  // containerCharge: flat, untaxed, resent on every save, restored on reopen.
  const [deliveryCharge, setDeliveryCharge] = useState(0);
```

- [ ] **Step 3: Every cart reset clears it too.** Edit with `replace_all: true`: replace `setContainerCharge(0);` with `setContainerCharge(0); setDeliveryCharge(0);`. Expected: 8 occurrences (save / save-print / save-ebill in both mutations, plus the two Clear Cart buttons). Confirm with Grep that `setContainerCharge(0); setDeliveryCharge(0);` now appears 8 times.

- [ ] **Step 4: Reopen restores it.** Replace:
```tsx
    setContainerCharge(Number(existingOrder.containerCharge) || 0);
```
with:
```tsx
    setContainerCharge(Number(existingOrder.containerCharge) || 0);
    setDeliveryCharge(Number(existingOrder.deliveryCharge) || 0); // same reason as containerCharge
```

- [ ] **Step 5: Auto-KOT sync sends it.** Replace:
```tsx
            containerCharge: containerCharge.toFixed(2),
            // Same "must be resent every save" rule — a reason given at removal time
```
with:
```tsx
            containerCharge: containerCharge.toFixed(2),
            deliveryCharge: deliveryCharge.toFixed(2), // same resend rule as containerCharge
            // Same "must be resent every save" rule — a reason given at removal time
```

- [ ] **Step 6: Totals + visibility.** Replace:
```tsx
  // Container charge is a manually staff-entered flat amount (containerCharge state),
  // not computed from item quantities/serviceMode.
  const grandTotal = total + containerCharge;
```
with:
```tsx
  // Container and delivery charges are manually staff-entered flat amounts, untaxed, not
  // computed from item quantities/serviceMode.
  const grandTotal = total + containerCharge + deliveryCharge;
  // Dine-in → no charge boxes, pickup → Container, delivery → Container + Delivery; a box
  // holding an amount never hides (client/src/lib/chargeBoxes.ts).
  const { showContainer: showContainerBox, showDelivery: showDeliveryBox } = chargeBoxVisibility({
    isTableSession,
    activeItemMode,
    orderType: currentOrderType,
    cartModes: cartItems.map((i) => i.serviceMode),
    containerCharge,
    deliveryCharge,
  });
```

- [ ] **Step 7: onSubmit payloads.** Update branch — replace:
```tsx
        containerCharge: containerCharge.toFixed(2),
        customerName: data.customerName || "",
```
with:
```tsx
        containerCharge: containerCharge.toFixed(2),
        deliveryCharge: deliveryCharge.toFixed(2),
        customerName: data.customerName || "",
```
Create branch — replace:
```tsx
        containerCharge: containerCharge.toFixed(2),
        ...(preselectedTableId ? { tableId: preselectedTableId, tableNumber: preselectedTableName || String(preselectedTableId) } : {}),
```
with:
```tsx
        containerCharge: containerCharge.toFixed(2),
        deliveryCharge: deliveryCharge.toFixed(2),
        ...(preselectedTableId ? { tableId: preselectedTableId, tableNumber: preselectedTableName || String(preselectedTableId) } : {}),
```

- [ ] **Step 8: Totals panel.** Replace the whole Container row:
```tsx
            <div className="flex items-center gap-1 text-xs">
              <span className="flex-1" style={{ color: "var(--text-2)" }}>Container Charge</span>
              <div className="flex items-center gap-1 justify-end">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={containerCharge || ""}
                  onChange={(e) => setContainerCharge(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  className="w-14 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                  style={{ border: "1px solid var(--line-strong)", background: "var(--paper-0)", color: "var(--text-1)" }}
                />
                <span className="w-3 text-[10px]" style={{ color: "var(--text-3)" }}>₹</span>
              </div>
            </div>
```
with:
```tsx
            {/* Charge boxes only where they apply — dine-in none, pickup Container, delivery
                Container + Delivery (showContainerBox/showDeliveryBox, chargeBoxes.ts). */}
            {showContainerBox && (
              <div className="flex items-center gap-1 text-xs">
                <span className="flex-1" style={{ color: "var(--text-2)" }}>Container Charge</span>
                <div className="flex items-center gap-1 justify-end">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    aria-label="Container charge"
                    value={containerCharge || ""}
                    onChange={(e) => setContainerCharge(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0"
                    className="w-14 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                    style={{ border: "1px solid var(--line-strong)", background: "var(--paper-0)", color: "var(--text-1)" }}
                  />
                  <span className="w-3 text-[10px]" style={{ color: "var(--text-3)" }}>₹</span>
                </div>
              </div>
            )}

            {showDeliveryBox && (
              <div className="flex items-center gap-1 text-xs">
                <span className="flex-1" style={{ color: "var(--text-2)" }}>Delivery Charge</span>
                <div className="flex items-center gap-1 justify-end">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    aria-label="Delivery charge"
                    value={deliveryCharge || ""}
                    onChange={(e) => setDeliveryCharge(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0"
                    className="w-14 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                    style={{ border: "1px solid var(--line-strong)", background: "var(--paper-0)", color: "var(--text-1)" }}
                  />
                  <span className="w-3 text-[10px]" style={{ color: "var(--text-3)" }}>₹</span>
                </div>
              </div>
            )}
```

- [ ] **Step 9: Settle dialog prop.** Replace:
```tsx
            containerCharge={containerCharge}
            discountAmount={discountAmt}
```
with:
```tsx
            containerCharge={containerCharge}
            deliveryCharge={deliveryCharge}
            discountAmount={discountAmt}
```

- [ ] **Step 10: In-page bill preview.** In `showBillPreview`, replace:
```ts
      containerCharge: order.containerCharge != null ? parseFloat(order.containerCharge) : containerCharge,
```
with:
```ts
      containerCharge: order.containerCharge != null ? parseFloat(order.containerCharge) : containerCharge,
      deliveryCharge: order.deliveryCharge != null ? parseFloat(order.deliveryCharge) : deliveryCharge,
```

- [ ] **Step 11: Inline e-bill (`handleSaveEBill`).** Replace:
```ts
        containerCharge > 0 ? `Container Charge: ₹${containerCharge.toFixed(0)}` : null,
```
with:
```ts
        containerCharge > 0 ? `Container Charge: ₹${containerCharge.toFixed(0)}` : null,
        deliveryCharge > 0 ? `Delivery Charge: ₹${deliveryCharge.toFixed(0)}` : null,
```

- [ ] **Step 12: Type-check + full pure suite.** Run `npm run check; npm run test:pure`. Expected: tsc exit 0; every script prints `RESULT: PASS ✅` and the chain exits 0.

- [ ] **Step 13: Commit.**
```bash
git add client/src/pages/POS.tsx
git commit -m "feat(pos): delivery charge box; charge boxes follow dine-in/pickup/delivery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Migration + end-to-end verification

**Files (throwaway, deleted in Step 8):** `scripts/_tmp-e2e-delivery-server.ts`, `scripts/_tmp-e2e-delivery-api.ts`

- [ ] **Step 1: Ask the user before touching the shared DB.** Explain:
  - The migration is a single idempotent `ADD COLUMN IF NOT EXISTS`.
  - It's safe for the code currently deployed.
  - It must exist before this branch's server code runs anywhere.
  
  Then wait for an explicit yes.

- [ ] **Step 2: Run the migration.** Run `node scripts/migrate-order-delivery-charge.mjs`. Expected: `OK: ALTER TABLE …`, then `Resulting column: [ { column_name: 'delivery_charge', data_type: 'numeric', … column_default: '0'::numeric } ]`, then `DONE`. On `lock timeout`, re-run it after a minute.

- [ ] **Step 3: Create the in-process harness** `scripts/_tmp-e2e-delivery-server.ts`:
```ts
/**
 * THROWAWAY — delete after use. server/index.ts WITHOUT its listen callback: the real routes and
 * the Vite client run, but no scheduler / WhatsApp driver / outbound worker starts against the
 * shared DB. Refuses to start unless BOTH Pusher channels point at the same private test channel,
 * so the production channel never sees test events and this tab never subscribes to production.
 * Run (PowerShell):
 *   $env:PUSHER_CHANNEL="private-bagicha-e2e-<rand>"; $env:VITE_PUSHER_CHANNEL=$env:PUSHER_CHANNEL; npx tsx scripts/_tmp-e2e-delivery-server.ts
 */
import "dotenv/config";
import express from "express";
import session from "express-session";
import passport from "passport";
import MemoryStore from "memorystore";
import { registerRoutes } from "../server/routes";
import { initSettings, settingsGuard } from "../server/settingsStore";
import { resolveSessionSecret } from "../server/sessionSecret";
import { setupVite } from "../server/vite";

const channel = process.env.PUSHER_CHANNEL ?? "";
if (!/^private-bagicha-e2e-/.test(channel) || process.env.VITE_PUSHER_CHANNEL !== channel) {
  console.error("Refusing to start: set PUSHER_CHANNEL and VITE_PUSHER_CHANNEL to the same private-bagicha-e2e-<rand> channel");
  process.exit(1);
}
const PORT = Number(process.env.E2E_PORT ?? 5199);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const MemoryStoreSession = MemoryStore(session);
const sessionMiddleware = session({
  secret: resolveSessionSecret(), resave: false, saveUninitialized: false,
  store: new MemoryStoreSession({ checkPeriod: 86400000 }),
  cookie: { maxAge: 86400000, httpOnly: true, secure: false, sameSite: "lax" },
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

(async () => {
  await initSettings();
  app.use("/api", settingsGuard);
  const server = await registerRoutes(app, sessionMiddleware);
  await setupVite(app, server);
  server.listen(PORT, "127.0.0.1", () => console.log(`[e2e] harness on http://127.0.0.1:${PORT} (channel ${channel})`));
})();
```
Start it in the background with the PowerShell command from its header (`run_in_background`). Wait for the `[e2e] harness on …` line.

- [ ] **Step 4: API check** — create `scripts/_tmp-e2e-delivery-api.ts`:
```ts
/**
 * THROWAWAY — delete after use. Exercises the delivery-charge wiring of PUT /api/orders/:id/items,
 * GET /api/orders/:id, POST /api/print/preview and the order.items_edit audit row against the
 * in-process harness. Seeds ONE order straight into SQL:
 * - ZZTEST marker
 * - status 'cancelled' + backdated, so it is in no sales figure and on no live screen
 * - one OPEN item, so inventory reconciliation never touches stock
 * - no customer name/phone, so no loyalty/WhatsApp can fire
 * - consumes no bill/KOT counters
 * The re-PUTs send the same item, so no KOT ticket is created. Everything it created is
 * deleted in `finally`, and the orders id sequence is restored.
 * Run: $env:E2E_USER="…"; $env:E2E_PASS="…"; npx tsx scripts/_tmp-e2e-delivery-api.ts
 */
import "dotenv/config";
import { pool } from "../server/db";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5199";
const MARK = `ZZTEST-DELIV-${Date.now()}`;
const checks: Array<[string, boolean]> = [];
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.E2E_USER, password: process.env.E2E_PASS }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const api = (path: string, method: string, body?: unknown) =>
    fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });

  let orderId: number | null = null;
  try {
    const { rows: [o] } = await pool.query(
      `INSERT INTO orders (order_number, order_type, status, total_amount, tax_amount, subtotal_amount, container_charge, notes, created_at)
       VALUES ($1, 'delivery', 'cancelled', '0', '0', '0', '0', $1, now() - interval '3 days') RETURNING id`, [MARK]);
    orderId = o.id as number;
    await pool.query(
      `INSERT INTO order_items (order_id, menu_item_id, name, quantity, price, service_mode) VALUES ($1, -999001, 'ZZTEST item', 1, '100.00', 'delivery')`,
      [orderId]);
    const item = { menuItemId: -999001, quantity: 1, price: "100.00", name: "ZZTEST item", serviceMode: "delivery" };

    const put1 = await api(`/api/orders/${orderId}/items`, "PUT", { items: [item], discountAmount: "0", containerCharge: "20.00", deliveryCharge: "40.00" });
    checks.push(["PUT with a delivery charge → 200", put1.ok]);
    const g1 = await (await api(`/api/orders/${orderId}`, "GET")).json();
    const tax1 = Number(g1.taxAmount), total1 = Number(g1.totalAmount);
    checks.push(["delivery_charge persisted (40)", near(Number(g1.deliveryCharge), 40)]);
    checks.push(["total = subtotal + tax + container + delivery", near(total1, 100 + tax1 + 20 + 40)]);

    const preview = await (await api(`/api/print/preview`, "POST", { type: "bill", orderId })).json();
    const lines: string[] = preview.lines ?? [];
    const ci = lines.findIndex((l) => l.includes("Container  20.00"));
    const di = lines.findIndex((l) => l.includes("Delivery  40.00"));
    checks.push(["bill preview prints Delivery after Container", ci >= 0 && di > ci]);

    let audit: any = null;
    for (let i = 0; i < 10 && !audit; i++) {
      const { rows } = await pool.query(
        `SELECT metadata FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 AND action = 'order.items_edit' ORDER BY id DESC LIMIT 1`,
        [String(orderId)]);
      audit = rows[0]?.metadata ?? null;
      if (!audit) await sleep(500);
    }
    checks.push(["audit row records deliveryBefore 0 → deliveryAfter 40", !!audit && Number(audit.deliveryBefore) === 0 && Number(audit.deliveryAfter) === 40]);

    // A save that omits deliveryCharge is read as 0 — the reason the client must resend it.
    const put2 = await api(`/api/orders/${orderId}/items`, "PUT", { items: [item], discountAmount: "0", containerCharge: "20.00" });
    const g2 = await (await api(`/api/orders/${orderId}`, "GET")).json();
    checks.push(["omitted deliveryCharge saves as 0", put2.ok && near(Number(g2.deliveryCharge), 0)]);
    checks.push(["delivery is untaxed: tax unchanged, total drops by exactly 40", near(Number(g2.taxAmount), tax1) && near(Number(g2.totalAmount), total1 - 40)]);
  } finally {
    if (orderId != null) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const { rows: tbls } = await c.query(
          `SELECT DISTINCT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'order_id' AND table_name <> 'orders'`);
        for (const { table_name } of tbls) await c.query(`DELETE FROM "${table_name}" WHERE order_id = $1`, [orderId]);
        await c.query(`DELETE FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1`, [String(orderId)]);
        const del = await c.query(`DELETE FROM orders WHERE id = $1 AND order_number = $2 AND notes = $2`, [orderId, MARK]);
        await c.query("COMMIT");
        console.log(`cleanup: removed order ${orderId} (${del.rowCount} row)`);
        await c.query("BEGIN");
        await c.query(`SET LOCAL lock_timeout = '3s'`);
        await c.query(`LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE`);
        await c.query(`SELECT setval(pg_get_serial_sequence('orders','id'), (SELECT max(id) FROM orders))`);
        await c.query("COMMIT");
        console.log("cleanup: orders id sequence restored");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        console.error(`CLEANUP FAILED — remove order ${orderId} (${MARK}) by hand:`, e);
      } finally { c.release(); }
    }
  }
}

main()
  .catch((e) => { console.error(e); checks.push(["script ran to completion", false]); })
  .finally(async () => {
    let failed = 0;
    for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failed++; }
    console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
    await pool.end();
    process.exit(failed === 0 ? 0 : 1);
  });
```
- **Credentials:** take `E2E_USER` / `E2E_PASS` from the gitignored `.claude.local.md` (dev login). Never write them into a file.
- **Run it.** Expected: 7 `PASS`, `cleanup: removed order …`, `cleanup: orders id sequence restored`, then `RESULT: PASS ✅`.
- **If it fails:** fix the bug, re-run, and confirm cleanup happened. Check with `SELECT count(*) FROM orders WHERE order_number LIKE 'ZZTEST-DELIV-%'`, which should return 0.

- [ ] **Step 5: Browser check (no saving — unsaved carts write nothing).**
  - **Setup:**
    - Open `http://127.0.0.1:5199` with whichever browser tool connects: Playwright MCP, chrome-devtools MCP, or the user's own browser if neither does.
    - Log in with the dev login.
    - Pick a **free** table id from `GET /api/tables` (read-only).
  - **Check at desktop width:**
    1. `/pos?mode=pickup` → Container box visible, no Delivery box.
    2. `/pos?mode=delivery` → both boxes. Add one item. Type `40` in Delivery → Total goes up by exactly ₹40 and Tax is unchanged.
    3. `/pos?tableId=<freeId>&tableName=<name>`:
       - "Adding as" Dine-In → neither box.
       - Pickup → Container appears.
       - Delivery → both appear.
       - Add one item while on Delivery, then switch back to Dine-In → both boxes stay (a delivery line is in the cart).
       - Remove that unsaved line with × → both boxes disappear.
    4. Section POS (`/pos?section=<id>` if a section exists) → unchanged: SectionActionBar's own Container box, no Delivery box.
  - **Check at phone width:** repeat (2) at ~400px width. The boxes sit in the collapsible cart summary.
  - **Never** tap KOT / Bill / Save / Settle.
  - **Cleanup:** clear the cart (Clear all) and close the tab. Wait ~0.5s before each screenshot. Delete any screenshot PNGs written to the repo root.

- [ ] **Step 6: Stop the harness.** `TaskStop` alone leaves the grandchild `tsx` process on Windows. Kill the whole tree with `taskkill /PID <top bash/pwsh pid> /T /F`, then confirm port 5199 is free (`netstat -ano | findstr :5199` prints nothing).

- [ ] **Step 7: Final static checks.** Run `npm run check; npm run test:pure; npm run build`. Expected: all exit 0.

- [ ] **Step 8: Delete the throwaway scripts.** Remove `scripts/_tmp-e2e-delivery-server.ts` and `scripts/_tmp-e2e-delivery-api.ts`. Confirm `git status` shows neither. They were never committed.

---

### Task 11: Document it in CLAUDE.md

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Add a paragraph.** In the "Printing (KOT/Bill)" section, directly after the paragraph that begins `**Container charge is manual, not computed from items.**`, add:
```markdown
**Delivery charge mirrors the container charge; the cart only offers the boxes that apply.**
- **What it is:** `orders.deliveryCharge` (`scripts/migrate-order-delivery-charge.mjs`, **run against the shared DB on <date from Task 10>**; idempotent) is a staff-typed flat ₹ amount for delivery orders.
- **Same contract as `containerCharge`:**
  - untaxed, added after tax: `total = (subtotal − discount) × (1 + taxRate) + containerCharge + deliveryCharge`
  - not PIN-gated
  - resent on every save (create, update and the Auto-KOT sync PUT — a missing field saves as 0) and restored on reopen
  - merge sums it; split leaves it on the source
  - coupon/loyalty recompute keeps it
  - `deriveBillTotals` returns it (NULL → 0)
  - both bill renderers print "Delivery" after "Container"
  - the e-bill, Settle / Due-Settle dialogs, Order History and Billing show it
- **Audit:** `order.items_edit` records `deliveryBefore`/`deliveryAfter`, and the KOT & Bill "Bill Modified" rule (route + `classifyItemsEditRow` + SQL) compares them.
- **Which boxes show:** `client/src/lib/chargeBoxes.ts`'s `chargeBoxVisibility` decides:
  - dine-in → neither box; pickup → Container; delivery → Container + Delivery
  - table sessions read the "Adding as" toggle **or** any cart line's `serviceMode`; standalone orders read the order-type tab
  - a box holding a non-zero amount never hides
  - Section POS is untouched (`SectionActionBar` keeps its own Container box)
- **Tests:** `scripts/verify-charge-boxes.ts`, plus delivery cases in the pricing, bill-derivation, merge-split, e-bill, escpos-interpret and kot-bill-classify scripts.
```
Replace `<date from Task 10>` with the actual date the migration ran.

- [ ] **Step 2: Commit.**
```bash
git add CLAUDE.md
git commit -m "docs: delivery charge + mode-aware charge boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Report to the user.**
  - Branch `fixes` has the commits, not pushed.
  - The migration has run.
  - Deploy order: server and client together. The column already exists, so any deploy order is DB-safe.
  - An old client simply never sends `deliveryCharge` (saved as 0), and an old server ignores it.
