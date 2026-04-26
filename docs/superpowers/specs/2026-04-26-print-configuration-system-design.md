# Print Configuration System — Design Spec
Date: 2026-04-26

## Overview
Production-grade direct thermal print system for Bagicha POS. Replaces browser-popup printing with headless ESC/POS output to USB and network thermal printers. Includes KOT delta engine, bill printing, admin settings UI, and full POS integration.

## Approved Decisions
- **Transport**: Direct ESC/POS — network via raw TCP socket (Node `net`), USB via `usb` npm package (requires Zadig WinUSB on Windows)
- **Settings storage**: Extend existing `restaurant-settings.json` with `printSettings` key
- **Printer model**: Flexible registry — any number of printers, each tagged as USB or network, KOT and Bill each pick one

---

## Section 1: Data Model

### `shared/schema.ts` — orders table additions
| Column | Type | Default | Purpose |
|---|---|---|---|
| `kotPrintCount` | integer | 0 | Times KOT sent to printer |
| `billPrintCount` | integer | 0 | Times bill sent to printer |
| `lastKotSnapshot` | json | null | Item snapshot at last KOT print (for delta) |

Snapshot shape:
```typescript
interface KotSnapshot {
  items: { itemId: number; name: string; quantity: number; size: string | null }[];
  printedAt: string;
}
```

### `restaurant-settings.json` — new `printSettings` key
```json
{
  "printSettings": {
    "printers": [
      { "id": "uuid", "name": "Kitchen Printer", "type": "network", "ip": "192.168.1.100", "port": 9100 },
      { "id": "uuid", "name": "Counter Printer", "type": "usb", "vendorId": 1208, "productId": 514 }
    ],
    "kot": {
      "enabled": true,
      "printOnBill": true,
      "printModifiedKOT": true,
      "printModifiedItemsOnly": true,
      "printCancelledKOT": true,
      "printAddons": true,
      "showDuplicateWatermark": true,
      "printDeletedItems": true,
      "printDeletedSeparate": false,
      "printOnTableMove": false,
      "kotPrinterId": null
    },
    "bill": {
      "taxDisplay": "none",
      "itemPriceMode": "exclusive",
      "showBackwardTax": true,
      "showDuplicate": true,
      "showCustomerPayment": false,
      "showKotAsToken": false,
      "showAddons": true,
      "mergeDuplicateItems": true,
      "showOrderBarcode": false,
      "showQuantityBreakdown": false,
      "billPrinterId": null
    }
  }
}
```

---

## Section 2: Backend Architecture

### New files
| File | Responsibility |
|---|---|
| `server/escpos.ts` | Raw ESC/POS byte generation — no npm deps |
| `server/kotDelta.ts` | Pure delta computation function |
| `server/printService.ts` | Printer transport (network TCP + USB) |
| `server/printRoutes.ts` | Express route handlers for print endpoints |

### Modified files
| File | Change |
|---|---|
| `shared/schema.ts` | +3 columns on orders table |
| `server/settingsStore.ts` | Add PrintSettings types + defaults |
| `server/routes.ts` | Mount printRoutes |

### New API endpoints
```
POST /api/print/kot        — delta logic → ESC/POS → printer
POST /api/print/bill       — bill layout → ESC/POS → printer
POST /api/print/test       — test printer connection
```
Settings use existing `GET/PUT /api/settings`.

---

## Section 3: KOT Delta Engine

### Flow
1. Load order + current items from DB
2. Load `lastKotSnapshot` from order
3. Reprint request (`reprint: true`)? → print full items with `** DUPLICATE **` header, skip snapshot update
4. No snapshot? → first print, print full items, save snapshot
5. Snapshot exists → `computeDelta(current, snapshot)`:
   - `newItems` = in current but not in snapshot, or qty increased
   - `modifiedItems` = qty changed (decreased but > 0)
   - `cancelledItems` = in snapshot but removed, or qty → 0
6. Apply settings filters:
   - Always include: `newItems`
   - `kot.printModifiedItemsOnly = true` → include `modifiedItems`
   - `kot.printCancelledKOT = true` → include `cancelledItems` (marked VOID)
7. Nothing to print → return `{ printed: false, reason: "no_delta" }`
8. Generate ESC/POS buffer, send to kitchen printer
9. Update `lastKotSnapshot`, increment `kotPrintCount`

### KOT ticket format (ESC/POS)
```
================================
     ** DUPLICATE **             ← reprint only
================================
   KITCHEN ORDER / MODIFIED KOT
================================
Table: 5          KOT#: 3
26-Apr-2026       12:34 PM

  2  Paneer Tikka
     [No onion, extra spicy]    ← if printAddons=true
  1  Dal Makhani
--------------------------------
  ** VOID **  Butter Naan x1   ← cancelled
================================
     Items: 3
================================
[PAPER CUT]
```

---

## Section 4: Frontend — Settings UI

New "Print" card in Settings page opens `PrintSettingsPanel` with 3 sub-tabs:

### KOT Print tab
Toggles matching reference images:
- Print KOT on Print Bill
- Print Only Modified KOT
- Print Only Modified Items in KOT
- Print Cancelled KOT
- Print add-ons and special notes
- Show Duplicate watermark on reprint
- Print Deleted Items in KOT
- Print Deleted Items in separate KOT
- Print on table move
- KOT Printer selector (dropdown from printer registry)

### Bill Print tab
- Tax display radio (None / Category-wise)
- Item price mode radio (exclusive / inclusive backward tax)
- Show Backward Tax toggle
- Show Duplicate watermark toggle
- Show Customer Payment toggle
- Print KOT no as Token no toggle
- Show Add-ons toggle
- Merge Duplicate Items toggle
- Show Order Barcode toggle
- Show Quantity Breakdown toggle
- Bill Printer selector

### Printer Setup tab
- Table of configured printers (name, type, ip/vendorId)
- Add printer form (name, type → network fields or USB fields)
- Test button per printer
- Delete button per printer

---

## Section 5: Frontend Integration

| Page | Change |
|---|---|
| `POS.tsx` | Replace `printKOT()` calls → `POST /api/print/kot` |
| `POS.tsx` | Replace `printOrderBill()` calls → `POST /api/print/bill` |
| `KOT.tsx` | Replace local `printKOT()` → `POST /api/print/kot` with `reprint: true` |
| `Orders.tsx` | Add "Reprint Bill" button → `POST /api/print/bill` |

---

## Constraints
- No changes to authentication
- No routing changes
- No removal of existing features
- `printBill.ts` kept for potential fallback
- Backward compatible: if no printer configured, API returns error toast
- `npm run db:push` required after schema change
