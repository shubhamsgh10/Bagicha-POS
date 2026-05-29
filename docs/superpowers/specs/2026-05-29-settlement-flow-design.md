# Settlement & Split-Payment Flow — Design Spec

**Date:** 2026-05-29  
**Status:** Approved  
**Scope:** POS cart actions, settlement dialog, due-customer tracking, table status wiring

---

## Problem

The current POS settle flow is a one-tap action: staff picks a single payment method (Cash/Card/UPI) and clicks Settle. The table is freed instantly with no amount entry, no split-payment support, no change/balance calculation, and no intermediate "bill printed" state. This does not match the real restaurant workflow the client uses.

---

## Target Workflow (Petpooja-style)

```
Staff takes order
  → KOT (send to kitchen)         [table: Running]
  → Bill (print customer copy)    [table: Billed]
  → Settle (collect payment)      [table: Free]
```

---

## Table Status State Machine

| Status | Meaning | Trigger |
|--------|---------|---------|
| `free` | Table vacant | App start / after settlement / after hold |
| `running` | Order in progress | Order created |
| `billed` | Bill printed, awaiting payment | Bill button clicked |
| `free` | Customer paid or marked due | Settlement completed |

The `billed` status already exists in `shared/schema.ts` and is already styled in `TableCard.tsx` as "Billing" with a red pulsing dot — it just needs to be wired up.

---

## Cart Button Behavior

| Button | Action | Table Effect |
|--------|--------|--------------|
| **KOT** | Save order → print KOT → notify kitchen | Stays Running |
| **Bill** *(renamed from Print)* | Save order if unsaved → print customer bill copy → set table to Billed | Running → Billed |
| **Save** | Save order draft | No change |
| **Hold** | Park order, free table | Running → Free |
| **Settle** | Open settlement dialog | Billed → Free (after payment) |

---

## Settlement Dialog (Option C — Table with Running Balance)

### Layout
```
Collect Payment · ₹1,025
─────────────────────────────────────────
Method       Amount (₹)    Remaining
─────────────────────────────────────────
💵 Cash      [   500  ]    ₹525  (red)
📱 UPI       [   525  ]    ₹0    (green)
💳 Card      [     0  ]    ₹0
─────────────────────────────────────────
Total entered ₹1,025  ✓ Fully settled

[ 🖨 Print Bill ]  [ Mark Due ]  [ ✓ Settle Now ]
```

### Business Rules
- **Remaining** per row = grand total − (cash + upi + card entered so far)
- **Balance due** shown in red if total entered < grand total
- **Change due** shown in green if total entered > grand total
- **Settle Now** is enabled only when `totalEntered >= grandTotal`
- **Mark Due** bypasses the amount check — table is freed, customer details stored
- **Print Bill** inside dialog prints bill without settling (for re-printing)

---

## Mark Due — Customer Credit Tracking

When "Mark Due" is clicked:
1. Dialog expands to show Name + Phone fields (required)
2. On confirm: order is saved as `status: "served"`, `paymentStatus: "due"`, customer details stored
3. Table freed immediately
4. Order appears in the existing Due Orders list (Billing page) with full details: items, amounts, timestamp, customer name, phone
5. Staff can click "Collect Payment" from the Due Orders list at any time to re-open the settlement dialog and clear the debt

---

## Data Changes

### Schema additions (`shared/schema.ts`)
Three new fields on the `orders` table:
- `paidAmount` DECIMAL — actual amount paid across all methods
- `changeAmount` DECIMAL — change returned to customer
- `paymentBreakdown` JSON — per-method amounts e.g. `{ cash: 500, upi: 525 }`

### API changes (`server/routes.ts`)
1. **New:** `POST /api/orders/:id/bill-requested` — sets `table.status = "billed"`, no order status change
2. **Enhanced:** `POST /api/orders/:id/payment` — accepts rich payload `{ payments: [{method, amount}], totalPaid, changeAmount, isDue, customerName?, customerPhone? }` in addition to legacy single-method payload

### New component
`client/src/components/SettlementDialog.tsx` — isolated dialog with its own state (cash, upi, card amounts), derived balance logic, and "Mark Due" sub-flow

### POS.tsx changes (targeted)
- Add `showSettleDialog` state
- Change `handleSettle` to open dialog (not call API directly)
- Add `handleBillPrint` for the renamed Bill button (prints bill + calls bill-requested)
- Remove the payment method button row + isPaid checkbox (replaced by dialog)
- Wire `SettlementDialog.onSettle` to `settleMutation`

---

## Files NOT Changed
- `server/printRoutes.ts` — KOT and bill print logic untouched
- `client/src/lib/receiptText.ts` — ESC/POS receipt text untouched
- `client/src/lib/printBill.ts` — HTML bill template untouched
- `client/src/pages/KOT.tsx` — KOT page untouched
- `client/src/pages/Orders.tsx`, `Reports.tsx`, `LiveAnalytics.tsx` — untouched
- `client/src/components/live-tables/TableCard.tsx` — already renders `billed` status correctly

---

## Verification

1. Add items → click **Bill** → bill prints, table card turns red "Billing" on live view
2. Click **Settle** → dialog opens with ₹ total
3. Enter ₹500 Cash on ₹1,025 bill → remaining shows ₹525 in red, Settle Now disabled
4. Add ₹525 UPI → remaining ₹0, Settle Now enabled
5. Click Settle Now → table freed, order in Orders page as "served"
6. Enter ₹1,030 Cash on ₹1,025 bill → "Change due ₹5" shown in green
7. Click Mark Due → name/phone prompt appears → table freed → order in Billing > Due Orders with full item list
8. KOT button works unchanged throughout
