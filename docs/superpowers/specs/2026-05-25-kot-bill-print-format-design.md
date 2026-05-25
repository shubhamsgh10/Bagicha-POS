# KOT & Bill Print Format Redesign — Petpooja Style
**Date:** 2026-05-25  
**Printer:** TVS Electronics RP 3160 Gold — 80mm paper, 48 chars (Font A), ESC/POS

---

## Context

The client's Bagicha Restaurant POS currently prints KOT and Bill using a basic ESC/POS layout. The client uses Petpooja POS in parallel and wants the print format to match Petpooja exactly — including a prominent kitchen-readable KOT header, the Petpooja-style 4-column bill grid, CGST/SGST split, round-off line, and the restaurant logo printed from the printer's NV Flash memory.

A reference bill photo from the client's Petpooja installation was used as the exact specification for the Bill format. The KOT format follows Petpooja's kitchen-standard large-header style.

---

## Print Architecture (unchanged)

Printing flows through:
1. `POST /api/print/kot` or `POST /api/print/bill` → `server/printRoutes.ts`
2. `generateKOTBuffer()` / `generateBillBuffer()` in `server/printService.ts` → ESC/POS byte buffer
3. `sendToPrinter()` → TCP socket (network) or libusb (USB) → TVS RP 3160 Gold

Only the **format generators** change. Transport layer is untouched.

---

## Bill Format Specification

### Header
```
[NV Flash Logo — ESC command: FS p 1 0, centered]
         Bagicha                    ← bold, centered, font size +1
       Salasar Trading              ← centered (businessName field)
  GST -22BOQPR9570B1ZN             ← centered
     M - 9770022221                ← centered (phone)
      Dhimrapur Road               ← centered (address line 1)
       Raigarh (CG)                ← centered (address line 2)
         496001                    ← centered (pincode)
================================================
```

### Customer / Order Info
```
Name:________________________________

Date: 22/03/26      Pick Up         ← date DD/MM/YY left, orderType bold right
19:26                               ← time on next line
Cashier: Bagicha   Bill No.: 4492  ← req.user.username from auth session + order.orderNumber
------------------------------------------------
```

### Item Table (4 columns, 48 chars)
Column widths: Item=26 | Qty=4 | Price=9 | Amt=9 = 48 total
```
Item                       Qty    Price     Amt
------------------------------------------------
Sloppyjoe                    1   249.00  249.00
Paneer Tikka                 1   299.00  299.00
Sandwich                               ← long names wrap to next line
Margherita                   1   399.00  399.00
(Medium)
```
- Long item names wrap naturally (no truncation)
- Size variants wrap on next line (e.g., `(Medium)`)

### Totals
```
------------------------------------------------
Total Qty: 3            Sub Total   947.00
                        CGST 2.5%    23.68      ← taxRate/2
                        SGST 2.5%    23.68      ← taxRate/2
                        Round off    -0.36      ← Math.round(total) - total
================================================
                  Grand Total  ₹994.00          ← bold
================================================
                       Thanks                   ← footerNote field
```

### Logo — NV Flash Setup (one-time)
- Upload `Bagicha Logo.bmp` via TVS RP 3160 Gold utility software to NV Flash slot 1
- ESC/POS command to print: `FS p 1 0` (Print NV bit image, image 1, normal density)
- If NV Flash not set up, logo line is silently skipped (no error)
- Admin toggle in Print Settings: **"Print logo from printer NV Flash"** (default: on)

---

## KOT Format Specification

### Header
```
================================================
        TABLE - 4                    ← ESC ! 0x30 (double-width + double-height), centered
       KITCHEN ORDER                 ← bold, centered (or MODIFIED KOT / CANCELLED KOT)
================================================
```
- For takeaway/delivery orders: `TAKEAWAY` instead of `TABLE - N`
- For modified KOT: `KITCHEN ORDER` replaced by `MODIFIED KOT`
- DUPLICATE watermark (if reprint + setting enabled): printed above header in bold

### Meta Line
```
KOT#: 001   22/03/26   19:26        ← (order.kotPrintCount + 1) zero-padded to 3 digits, date DD/MM/YY, time HH:MM
------------------------------------------------
```

### Items
```
[ 02 ]  Butter Naan                 ← quantity in brackets, bold
        >> No Onion, Less Spice     ← instructions indented, normal weight
[ 01 ]  Dal Makhani
[ 01 ]  Margherita (Medium)
        >> Extra Cheese
```
- New items: bold with `[ QQ ]` format (zero-padded to 2 digits)
- Modified items: show `[ QQ ] was NN` two-column format
- Cancelled items: `** VOID ** [ QQ ] Item Name` bold

### Footer
```
================================================
             Total Items: 6                     ← sum of quantities
================================================
```

---

## Settings Changes

### `server/settingsStore.ts` — `RestaurantSettings` additions
Two new fields added to the existing restaurant-level settings:
```typescript
businessName: string;   // trading/sub-name e.g. "Salasar Trading" — printed below restaurantName
fssaiNumber: string;    // FSSAI license number — printed below gstNumber when non-empty
```
All other bill header fields already exist in `RestaurantSettings`:
| Config field | Bill header output |
|---|---|
| `restaurantName` | Bold top line |
| `businessName` (new) | Second line, centered |
| `gstNumber` | `GST -XXXXXXXX` centered |
| `phone` | `M - XXXXXXXXXX` centered |
| `address` | Address lines, centered (split on comma → one line each) |
| `fssaiNumber` (new) | `FSSAI: XXXXXXXX` centered, only if non-empty |
| `footerNote` | Bottom footer ("Thanks") |
| `taxRate` | CGST = taxRate/2, SGST = taxRate/2 |
| `currencySymbol` | ₹ before Grand Total |

**Fully reactive:** `generateBillBuffer()` already receives the full `RestaurantSettings` object — no extra wiring needed. Changing any field in Restaurant Configuration and saving automatically changes the next bill print.

### `server/settingsStore.ts` — `BillPrintSettings` additions
```typescript
showLogo: boolean;        // print NV Flash logo command (default: true)
showFssai: boolean;       // show FSSAI line (default: false)
showRoundOff: boolean;    // show round-off line (default: true)
showNameField: boolean;   // show Name: ___ blank field (default: true)
```

### `server/settingsStore.ts` — `KOTPrintSettings` additions
```typescript
kotNumbering: boolean;    // show KOT# in meta line (default: true)
```

### `client/src/pages/Settings.tsx` — Restaurant Configuration panel additions
Add two new input fields to the existing RESTAURANT INFO section:
- **Business / Trading Name** — maps to `businessName` (e.g. "Salasar Trading")
- **FSSAI License Number** — maps to `fssaiNumber` (shown only when `showFssai` is on in Print Settings)

These sit below the existing Restaurant Name field. All fields save together via the existing `PUT /api/settings` endpoint — no new API needed.

---

## ESC/POS Changes — `server/escpos.ts`

Add:
```typescript
export const DOUBLE_SIZE_ON  = Buffer.from([0x1B, 0x21, 0x30]); // double-width + double-height
export const DOUBLE_SIZE_OFF = Buffer.from([0x1B, 0x21, 0x00]); // normal size
export const LOGO_NV_FLASH   = Buffer.from([0x1C, 0x70, 0x01, 0x00]); // FS p 1 0
```

---

## Files Modified

| File | Change |
|------|--------|
| `server/escpos.ts` | Add `DOUBLE_SIZE_ON`, `DOUBLE_SIZE_OFF`, `LOGO_NV_FLASH` |
| `server/printService.ts` | Rewrite `generateKOTBuffer()` and `generateBillBuffer()` |
| `server/printRoutes.ts` | Update `kotTextLines()` and `billTextLines()` for preview endpoint; pass `req.user.username` to bill generator as cashier name |
| `server/settingsStore.ts` | Add `businessName`, `fssaiNumber` to `RestaurantSettings`; add `showLogo`, `showFssai`, `showRoundOff`, `showNameField` to `BillPrintSettings`; add `kotNumbering` to `KOTPrintSettings` |
| `client/src/components/PrintSettingsPanel.tsx` | Add new toggle rows for new bill/KOT settings; add live sample preview panel |
| `client/src/pages/Settings.tsx` | Add `businessName` and `fssaiNumber` input fields in restaurant info section |

---

## Live Print Preview in Settings Panel

A **"Preview"** section added inside the KOT and Bill tabs of `PrintSettingsPanel`:
- Renders a monospace text preview using sample dummy data
- Pure client-side — no API call needed
- Updates live as toggles change (e.g., toggling `showRoundOff` shows/hides the round-off line)
- Styled as a narrow receipt strip (white background, border, `font-family: monospace`)
- Sample data: hardcoded order with 2-3 items, realistic prices, table 4

---

## Verification

1. Configure a network/USB printer in Print Settings
2. Create a dine-in order with 2+ items, one having special instructions
3. Print KOT → confirm: TABLE-N double-size header, `[ 02 ]` quantities, `>>` modifiers
4. Print Bill → confirm: logo from NV Flash at top, 4-column grid, CGST/SGST split, round-off, Grand Total bold
5. Create a takeaway order → KOT shows `TAKEAWAY` instead of `TABLE - N`
6. Reprint KOT → confirm DUPLICATE watermark appears
7. Toggle `showRoundOff` off in Print Settings → round-off line disappears from bill
8. Toggle `showFssai` on + enter FSSAI number → FSSAI line appears below GST on bill
9. Check preview panel in Print Settings updates live with sample receipt
