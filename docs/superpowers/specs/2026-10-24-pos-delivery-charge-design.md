# POS Delivery Charge + Mode-Aware Charge Boxes — Design Spec

**Date:** 2026-10-24
**Status:** Approved
**Scope:** POS cart totals panel, order pricing, order persistence, bill/e-bill rendering, merge/split, coupon/loyalty recompute

---

## Problem

The POS cart shows a **Container Charge** box on every order, dine-in tables included, where it never applies. There is no way to charge for delivery at all. The owner wants:

- Dine-in → no Container box, no Delivery box.
- Pickup → Container box.
- Delivery → Container box **and** a new Delivery Charge box.

This applies both to the per-item "Adding as" strip inside a table session and to the standalone Pickup / Delivery POS modes.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Visibility in a mixed table cart | Follow the cart **and** the toggle. A box with an amount > 0 never hides. |
| Tax on delivery charge | None. Flat, added after tax, exactly like container charge. |
| Default amount | Starts at 0 on every order and is typed manually. No admin setting. |
| Storage | New first-class `orders.delivery_charge` column (approach A). Rejected: folding it into `containerCharge` (no separate bill line) and an open-item line (would be taxed, print on the KOT, pollute item reports). |
| PIN gate | None, same as container charge. |
| Sales reporting | Counted in Sales, because it is part of `totalAmount` (same as container today). |

---

## 1. Box visibility

One pure helper, `client/src/lib/chargeBoxes.ts`:

```ts
chargeBoxVisibility({
  isTableSession,
  activeItemMode,            // "dinein" | "pickup" | "delivery" (table "Adding as")
  orderType,                 // form orderType for standalone: "dine-in" | "takeaway" | "delivery"
  cartModes,                 // serviceMode of every cart line
  containerCharge, deliveryCharge,
}) => { showContainer: boolean; showDelivery: boolean }
```

Rules:

| Context | showContainer | showDelivery |
|---|---|---|
| Table session | `activeItemMode !== "dinein"` OR any cart line pickup/delivery | `activeItemMode === "delivery"` OR any cart line delivery |
| Standalone (posMode, or a new order with no table) | `orderType` is takeaway or delivery | `orderType === "delivery"` |
| **Always** | OR `containerCharge > 0` | OR `deliveryCharge > 0` |

Section POS is untouched. POS.tsx doesn't render this totals block in section mode at all. `SectionActionBar` keeps its own Container box, and no delivery box exists there, so the helper takes no section flag.

The "> 0 stays visible" override guarantees no charge is ever silently in the total with its box hidden. That covers a reopened order with a saved charge, a flipped toggle, and a changed order-type tab.

`POS.tsx`'s totals block renders each row conditionally from this helper. The same block serves desktop and the mobile collapsible summary, so both get it.

## 2. Bill math

```
total = (subtotal − discount) × (1 + taxRate) + containerCharge + deliveryCharge
```

- `shared/orderPricing.ts`
  - `priceResolved(items, menuById, opts, discountRaw, containerRaw = 0, deliveryRaw = 0)` clamps `deliveryCharge ≥ 0`, adds it to `total`, and returns it on `PricedOrder`.
  - `computeTotals(lineTotals, discountRaw, taxRate, containerCharge = 0, deliveryCharge = 0)` makes the same change for merge/split.
  - `deriveBillTotals(order)` adds `deliveryCharge` to `BillTotals` and reads `order.deliveryCharge`. A NULL (legacy row) reads as 0.
- `server/services/orderPricing.ts`: the `priceOrder` / `computeTotalsFromLines` wrappers pass the new argument through.
- Client: `POS.tsx`'s `grandTotal = total + containerCharge + deliveryCharge`.

## 3. Persistence

- **Schema:** `shared/schema.ts`, `orders.deliveryCharge: decimal("delivery_charge", { precision: 10, scale: 2 }).default("0")`.
- **Migration:** `scripts/migrate-order-delivery-charge.mjs`, a raw `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charge numeric(10,2) DEFAULT 0`. It is idempotent and follows the same pattern as `migrate-order-subtotal.mjs`. Rollback is `DROP COLUMN IF EXISTS delivery_charge`.
  - **Deploy order:** run the migration against the shared DB **before** any server build that has the new schema. Drizzle selects every schema column, so new code against an un-migrated DB fails every `GET /api/orders` with "column does not exist" (the `subtotal_amount` incident). The column is additive, so old code is unaffected by it.
- **`POST /api/orders` + `PUT /api/orders/:id/items`:** read `deliveryCharge` from the body, pass it to `priceOrder`, and persist `priced.deliveryCharge.toFixed(2)`.
- **Client must resend on every save:** the create payload, the update payload, and the Auto-KOT background sync PUT. A missing field is treated as 0 and would wipe an applied charge. This is the same "only what's re-sent survives" rule as `containerCharge` / `discountAmount`.
- **Reopen:** loading an existing order restores `deliveryCharge` into the box (like `containerCharge`, unlike discount). Every cart-clear / new-order reset sets it back to 0 alongside `containerCharge`.
- **Audit:** the `order.items_edit` metadata gains `deliveryBefore` / `deliveryAfter`, and a delivery change counts toward `moneyChanged`. The "Bill Modified" rule in Reports → KOT & Bill Activity lives in three places that must stay in sync: the route, `shared/orderAudit.ts`'s `classifyItemsEditRow`, and the raw SQL in `server/services/auditService.ts`. All three compare delivery before/after the same way they already compare container before/after.

## 4. Merge / split / coupon / loyalty

- **Merge** (`routes.ts` merge handler + `storage.mergeOrders`): target delivery + source delivery, the same as container.
- **Split:** the source keeps its full delivery charge and the new split-out order starts at 0. Both rows get a real `deliveryCharge` persisted.
- **`POST /api/coupons/apply` and `POST /api/loyalty/redeem`** (`growthRoutes.ts`): the recomputed total adds `deliveryCharge` from `deriveBillTotals`, exactly where it already adds `containerCharge`.

## 5. Where it is displayed

The label is "Delivery" everywhere, and the line shows only when > 0. It always sits directly after Container.

| Surface | File |
|---|---|
| Thermal bill (ESC/POS bytes, also the browser-fallback image) | `shared/print/generators.ts` `generateBillBuffer` |
| Bill text preview | `server/printRoutes.ts` `billTextLines` (keep in sync with the above) |
| Order objects handed to those renderers | `server/services/printDispatch.ts`, `server/printRoutes.ts` |
| WhatsApp e-bill (wa.me, POS) | `shared/ebillText.ts` + the inline builder in `POS.tsx` `handleSaveEBill` (the due reminder prints only items + Total, so it needs no change) |
| Last-resort in-page bill preview | `client/src/lib/receiptText.ts` (its subtotal back-derivation must also subtract delivery) + its caller in `POS.tsx` |
| Settle dialog summary | `client/src/components/SettlementDialog.tsx` (new `deliveryCharge` prop) |
| Due settle dialog | `client/src/components/DueSettleDialog.tsx` (passes `bill.deliveryCharge`) |
| Order History expanded detail | `client/src/pages/Orders.tsx` |
| Billing page card + Collect Payment dialog | `client/src/pages/Billing.tsx` |

## 6. Out of scope

- Section POS gets no delivery box (counter orders are never delivered).
- No admin default / prefill, no per-zone pricing, no PIN gate.
- No separate delivery-revenue report line.
- The vestigial Admin → Settings "Container Charge (₹ per item)" field stays as it is.

## 7. Testing

All of these are pure and live in `npm run test:pure`.

- `scripts/verify-order-pricing.ts`: delivery is added untaxed, a negative value clamps to 0, and the default arg keeps old callers unchanged.
- `scripts/verify-bill-derivation.ts`: `deriveBillTotals` reads the delivery charge, a NULL legacy value reads as 0, and the total foots with discount + container + delivery all present.
- `scripts/verify-merge-split.ts`: merge sums the delivery charges, and split leaves the charge on the source with no net change across the two bills.
- `scripts/verify-ebill-text.ts`: the Delivery line appears only when > 0.
- `scripts/verify-escpos-interpret.ts`: the thermal bill prints "Delivery" after "Container" and before Grand Total.
- `scripts/verify-kot-bill-classify.ts`: a delivery-only edit counts as Bill Modified.
- **New** `scripts/verify-charge-boxes.ts`: every row of the visibility table in §1, including the "> 0 stays visible" override.

Plus `npm run check`. Finally, check the three screenshots' scenarios in a real browser: a table on Dine-In, Pickup and Delivery, plus standalone Pickup and Delivery. Do it with an unsaved cart only, so no shared-DB writes happen. Use the dev server once the migration has run.
