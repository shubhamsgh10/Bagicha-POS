# KOT & Bill Print Format Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the ESC/POS KOT and Bill generators to match the client's Petpooja POS format — large double-size table header on KOT, Petpooja-style 4-column bill grid with CGST/SGST split, NV Flash logo, and round-off line — all driven live from Restaurant Configuration settings.

**Architecture:** All changes are confined to the ESC/POS buffer generators (`printService.ts`), the settings schema (`settingsStore.ts`), and the UI panels (`Settings.tsx`, `PrintSettingsPanel.tsx`). Transport layer (TCP/USB) is untouched. `generateBillBuffer()` already receives the full `RestaurantSettings` object, so every Restaurant Configuration field change automatically flows into the next print — no extra wiring needed.

**Tech Stack:** TypeScript, Node.js ESC/POS (raw bytes via `escpos.ts`), React, TanStack Query, TVS RP 3160 Gold 80mm printer (48 chars / Font A)

---

## File Map

| File | What changes |
|------|-------------|
| `server/escpos.ts` | Add `DOUBLE_SIZE_ON`, `DOUBLE_SIZE_OFF`, `LOGO_NV_FLASH` constants |
| `server/settingsStore.ts` | Add `businessName`, `fssaiNumber` to `RestaurantSettings`; add 5 new toggles to `BillPrintSettings`; add `kotNumbering` to `KOTPrintSettings` |
| `server/printService.ts` | Full rewrite of `generateKOTBuffer()` and `generateBillBuffer()` |
| `server/printRoutes.ts` | Pass `kotNumber` + `cashierName` to generators; update `kotTextLines()` + `billTextLines()` for preview endpoint |
| `client/src/pages/Settings.tsx` | Add `businessName` + `fssaiNumber` fields to Restaurant Config form |
| `client/src/components/PrintSettingsPanel.tsx` | Add 5 new bill toggles + `kotNumbering` toggle; add live receipt preview components |

---

## Task 1 — ESC/POS Primitives

**Files:** Modify `server/escpos.ts`

- [ ] **Add three new constants to `server/escpos.ts`** after the existing `BOLD_OFF` line:

```typescript
// server/escpos.ts  — add after BOLD_OFF line
export const DOUBLE_SIZE_ON  = Buffer.from([0x1B, 0x21, 0x30]); // ESC ! 0x30 — double-width + double-height
export const DOUBLE_SIZE_OFF = Buffer.from([0x1B, 0x21, 0x00]); // ESC ! 0x00 — back to normal
export const LOGO_NV_FLASH   = Buffer.from([0x1C, 0x70, 0x01, 0x00]); // FS p 1 0 — print NV bitmap slot 1
```

- [ ] **Verify** by running `npm run check` — expect zero TypeScript errors.

- [ ] **Commit:**
```bash
git add server/escpos.ts
git commit -m "feat(print): add double-size and NV Flash logo ESC/POS primitives"
```

---

## Task 2 — Settings Schema

**Files:** Modify `server/settingsStore.ts`

- [ ] **Add `businessName` and `fssaiNumber` to the `RestaurantSettings` interface** (after `gstNumber`):

```typescript
// server/settingsStore.ts — in RestaurantSettings interface, after gstNumber
  businessName: string;
  fssaiNumber: string;
```

- [ ] **Add new fields to `BillPrintSettings` interface** (after `billPrinterId`):

```typescript
// server/settingsStore.ts — in BillPrintSettings interface, after billPrinterId
  showLogo: boolean;       // print NV Flash logo command before header
  showFssai: boolean;      // show FSSAI line in header
  showRoundOff: boolean;   // show round-off line in totals
  showNameField: boolean;  // show Name: ___ blank field
```

- [ ] **Add `kotNumbering` to `KOTPrintSettings` interface** (after `autoKOTDebounceMs`):

```typescript
// server/settingsStore.ts — in KOTPrintSettings interface, after autoKOTDebounceMs
  kotNumbering: boolean;   // show KOT# in meta line
```

- [ ] **Update `DEFAULT_SETTINGS`** to include new restaurant fields:

```typescript
// server/settingsStore.ts — in DEFAULT_SETTINGS object
  businessName: "",
  fssaiNumber: "",
```

- [ ] **Update `DEFAULT_PRINT_SETTINGS.bill`** to include new toggles:

```typescript
// server/settingsStore.ts — in DEFAULT_PRINT_SETTINGS.bill object
  showLogo: true,
  showFssai: false,
  showRoundOff: true,
  showNameField: true,
```

- [ ] **Update `DEFAULT_PRINT_SETTINGS.kot`** to include new toggle:

```typescript
// server/settingsStore.ts — in DEFAULT_PRINT_SETTINGS.kot object
  kotNumbering: true,
```

- [ ] **Update the `getSettings()` merge** to include new fields in the deep-merge (the existing spread pattern already handles top-level `RestaurantSettings` fields automatically; only the `kot` and `bill` sub-objects need explicit merging, which the existing code already does):

Verify the existing merge in `getSettings()` looks like this — no changes needed if it already does:
```typescript
kot: { ...DEFAULT_PRINT_SETTINGS.kot, ...(data.printSettings?.kot ?? {}) },
bill: { ...DEFAULT_PRINT_SETTINGS.bill, ...(data.printSettings?.bill ?? {}) },
```

- [ ] **Run `npm run check`** — expect zero errors.

- [ ] **Commit:**
```bash
git add server/settingsStore.ts
git commit -m "feat(print): add businessName, fssaiNumber, bill/KOT format toggles to settings schema"
```

---

## Task 3 — KOT Generator Rewrite

**Files:** Modify `server/printService.ts` — rewrite `generateKOTBuffer()` only

- [ ] **Replace the entire `generateKOTBuffer` function** with the Petpooja-style implementation. The function signature adds `kotNumber` to params (it existed as optional before; now it's actively used):

```typescript
// server/printService.ts — full replacement of generateKOTBuffer()
export function generateKOTBuffer(params: {
  orderNumber: string;
  tableNumber: string | null;
  kotNumber?: string | number;
  isReprint: boolean;
  isDelta: boolean;
  newItems: KOTItem[];
  modifiedItems: Array<KOTItem & { previousQty: number }>;
  cancelledItems: Array<{ name: string; quantity: number; size?: string | null }>;
  kotSettings: KOTPrintSettings;
  width?: number;
}): Buffer {
  const W = params.width ?? 48;
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  // Duplicate watermark
  if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('** DUPLICATE **'), E.BOLD_OFF);
    parts.push(E.divider('=', W));
  }

  // Large table / takeaway header in double-size bold
  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : 'TAKEAWAY';
  parts.push(E.ALIGN_CENTER);
  parts.push(E.DOUBLE_SIZE_ON, E.line(tableHeader), E.DOUBLE_SIZE_OFF);

  // Sub-header: KITCHEN ORDER / MODIFIED KOT
  const subHeader = params.isDelta ? 'MODIFIED KOT' : 'KITCHEN ORDER';
  parts.push(E.BOLD_ON, E.line(subHeader), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_LEFT);

  // KOT# + date + time meta line
  if (params.kotSettings.kotNumbering !== false) {
    const kotNum = String(params.kotNumber ?? 1).padStart(3, '0');
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    parts.push(E.line(`KOT#: ${kotNum}   ${dd}/${mo}/${yy}   ${hh}:${mi}`));
  }
  parts.push(E.divider('-', W));

  // New items: [ 02 ]  Item Name (bold), >> instructions (normal)
  for (const item of params.newItems) {
    const label = item.size ? `${item.name} (${item.size})` : item.name;
    const qty = `[ ${String(item.quantity).padStart(2, '0')} ]`;
    parts.push(E.BOLD_ON, E.line(`${qty}  ${label}`), E.BOLD_OFF);
    if (params.kotSettings.printAddons && item.instructions) {
      parts.push(E.line(`        >> ${item.instructions}`));
    }
  }

  // Modified items: [ QQ ]  Name  was NN
  if (params.kotSettings.printModifiedItemsOnly && params.modifiedItems.length > 0) {
    for (const item of params.modifiedItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, '0')} ]`;
      parts.push(E.BOLD_ON, E.twoColumns(`${qty}  ${label}`, `was ${item.previousQty}`, W), E.BOLD_OFF);
      if (params.kotSettings.printAddons && item.instructions) {
        parts.push(E.line(`        >> ${item.instructions}`));
      }
    }
  }

  // Cancelled items: ** VOID ** [ QQ ]  Name
  if (params.kotSettings.printCancelledKOT && params.cancelledItems.length > 0) {
    parts.push(E.divider('-', W));
    for (const item of params.cancelledItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, '0')} ]`;
      parts.push(E.BOLD_ON, E.line(`** VOID **  ${qty}  ${label}`), E.BOLD_OFF);
    }
  }

  // Footer
  const totalItems = params.newItems.reduce((s, i) => s + i.quantity, 0);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(`Total Items: ${totalItems}`), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}
```

- [ ] **Run `npm run check`** — expect zero errors.

- [ ] **Commit:**
```bash
git add server/printService.ts
git commit -m "feat(print): rewrite KOT generator to Petpooja style — double-size header, bracket qty, >> modifiers"
```

---

## Task 4 — Bill Generator Rewrite

**Files:** Modify `server/printService.ts` — rewrite `generateBillBuffer()` only

- [ ] **Replace the entire `generateBillBuffer` function**. Note the new `cashierName` param added to the params object:

```typescript
// server/printService.ts — full replacement of generateBillBuffer()
export function generateBillBuffer(params: {
  order: {
    orderNumber: string;
    tableNumber: string | null;
    customerName: string | null;
    orderType: string;
    totalAmount: string;
    taxAmount: string;
    discountAmount: string | null;
    paymentMethod: string | null;
    billPrintCount: number;
    createdAt: Date | string;
  };
  items: Array<{
    name: string;
    quantity: number;
    price: string;
    size?: string | null;
    specialInstructions?: string | null;
  }>;
  restaurant: RestaurantSettings;
  billSettings: BillPrintSettings;
  cashierName?: string;
  width?: number;
}): Buffer {
  const W = params.width ?? 48;
  const { order, items, restaurant, billSettings } = params;
  const sym = restaurant.currencySymbol || '₹';
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  // Duplicate watermark
  if (order.billPrintCount > 0 && billSettings.showDuplicate) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('** DUPLICATE **'), E.BOLD_OFF);
    parts.push(E.divider('=', W));
  }

  // ── Header ─────────────────────────────────────────────────────────
  parts.push(E.ALIGN_CENTER);

  // NV Flash logo (silently ignored by printer if slot 1 is empty)
  if (billSettings.showLogo) {
    parts.push(E.LOGO_NV_FLASH, E.LF);
  }

  // Restaurant name (bold)
  parts.push(E.BOLD_ON, E.line(restaurant.restaurantName), E.BOLD_OFF);

  // Business / trading name
  if (restaurant.businessName) {
    parts.push(E.centered(restaurant.businessName, W));
  }

  // GST
  if (restaurant.gstNumber) {
    parts.push(E.centered(`GST -${restaurant.gstNumber}`, W));
  }

  // Phone
  if (restaurant.phone) {
    parts.push(E.centered(`M - ${restaurant.phone}`, W));
  }

  // Address — split on comma so each segment prints on its own line
  if (restaurant.address) {
    for (const seg of restaurant.address.split(',').map(s => s.trim()).filter(Boolean)) {
      parts.push(E.centered(seg.substring(0, W), W));
    }
  }

  // FSSAI (optional)
  if (billSettings.showFssai && restaurant.fssaiNumber) {
    parts.push(E.centered(`FSSAI: ${restaurant.fssaiNumber}`, W));
  }

  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_LEFT);

  // ── Customer / Order Info ───────────────────────────────────────────
  if (billSettings.showNameField) {
    parts.push(E.line(`Name:${'_'.repeat(Math.max(10, W - 5))}`));
    parts.push(E.LF);
  }

  const created = new Date(order.createdAt);
  const dd = String(created.getDate()).padStart(2, '0');
  const mo = String(created.getMonth() + 1).padStart(2, '0');
  const yy = String(created.getFullYear()).slice(-2);
  const hh = String(created.getHours()).padStart(2, '0');
  const mi = String(created.getMinutes()).padStart(2, '0');
  const dateStr = `${dd}/${mo}/${yy}`;
  const timeStr = `${hh}:${mi}`;
  const orderTypeLabel = order.orderType || (order.tableNumber ? 'Dine In' : 'Pick Up');

  // "Date: DD/MM/YY     ORDER TYPE" — order type bold on right
  const datePrefix = `Date: ${dateStr}   `;
  const padLen = Math.max(0, W - datePrefix.length - orderTypeLabel.length);
  parts.push(
    E.text(datePrefix + ' '.repeat(padLen)),
    E.BOLD_ON, E.line(orderTypeLabel), E.BOLD_OFF,
  );
  parts.push(E.line(timeStr));
  parts.push(E.twoColumns(`Cashier: ${params.cashierName ?? 'Admin'}`, `Bill No.: ${order.orderNumber}`, W));
  parts.push(E.divider('-', W));

  // ── Item Table ──────────────────────────────────────────────────────
  // Column widths for W=48: Item=24 | Qty=4 | Price=9 | Amt=8 + 3 spaces = 48
  const IW = W - 4 - 9 - 8 - 3;

  parts.push(E.BOLD_ON);
  parts.push(E.line(
    `${'Item'.padEnd(IW)} ${'Qty'.padStart(4)} ${'Price'.padStart(9)} ${'Amt'.padStart(8)}`
  ));
  parts.push(E.BOLD_OFF);
  parts.push(E.divider('-', W));

  // Merge duplicate items if enabled
  let displayItems = items;
  if (billSettings.mergeDuplicateItems) {
    const map = new Map<string, typeof items[0] & { totalQty: number; totalAmt: number }>();
    for (const item of items) {
      const key = `${item.name}:${item.size ?? ''}`;
      const ex = map.get(key);
      if (ex) {
        ex.totalQty += item.quantity;
        ex.totalAmt += item.quantity * parseFloat(item.price);
      } else {
        map.set(key, { ...item, totalQty: item.quantity, totalAmt: item.quantity * parseFloat(item.price) });
      }
    }
    displayItems = Array.from(map.values()).map(i => ({
      ...i,
      quantity: i.totalQty,
      price: String(i.totalAmt / i.totalQty),
    }));
  }

  let totalQty = 0;
  for (const item of displayItems) {
    const fullName = item.size ? `${item.name} (${item.size})` : item.name;
    const unitPrice = parseFloat(item.price);
    const lineAmt = unitPrice * item.quantity;
    const qtyStr   = String(item.quantity).padStart(4);
    const priceStr = unitPrice.toFixed(2).padStart(9);
    const amtStr   = lineAmt.toFixed(2).padStart(8);

    // Word-wrap long item names — first chunk gets qty/price/amt, continuations are plain
    let remaining = fullName;
    let first = true;
    while (remaining.length > 0) {
      const chunk = remaining.substring(0, IW);
      remaining = remaining.substring(IW);
      if (first) {
        parts.push(E.line(`${chunk.padEnd(IW)} ${qtyStr} ${priceStr} ${amtStr}`));
        first = false;
      } else {
        parts.push(E.line(chunk));
      }
    }

    if (billSettings.showAddons && item.specialInstructions) {
      parts.push(E.line(`  [${item.specialInstructions}]`));
    }
    totalQty += item.quantity;
  }

  parts.push(E.divider('-', W));

  // ── Totals ──────────────────────────────────────────────────────────
  const tax       = parseFloat(order.taxAmount);
  const discount  = parseFloat(order.discountAmount || '0');
  const subtotal  = parseFloat(order.totalAmount) - tax;
  const rawTotal  = parseFloat(order.totalAmount);
  const rounded   = Math.round(rawTotal);
  const roundOff  = rounded - rawTotal;
  const cgstRate  = restaurant.taxRate / 2;
  const sgstRate  = restaurant.taxRate / 2;
  const cgst      = tax / 2;
  const sgst      = tax / 2;

  parts.push(E.twoColumns(`Total Qty: ${totalQty}`, `Sub Total ${subtotal.toFixed(2)}`, W));
  parts.push(E.twoColumns('', `CGST ${cgstRate}%  ${cgst.toFixed(2)}`, W));
  parts.push(E.twoColumns('', `SGST ${sgstRate}%  ${sgst.toFixed(2)}`, W));
  if (discount > 0) {
    parts.push(E.twoColumns('', `Discount  -${discount.toFixed(2)}`, W));
  }
  if (billSettings.showRoundOff && Math.abs(roundOff) >= 0.005) {
    parts.push(E.twoColumns('', `Round off  ${roundOff.toFixed(2)}`, W));
  }
  parts.push(E.divider('=', W));
  parts.push(E.BOLD_ON, E.twoColumns('', `Grand Total  ${sym}${rounded.toFixed(2)}`, W), E.BOLD_OFF);
  if (order.paymentMethod) {
    parts.push(E.twoColumns('', order.paymentMethod.toUpperCase(), W));
  }
  parts.push(E.divider('=', W));

  // Footer
  if (restaurant.footerNote) {
    parts.push(E.ALIGN_CENTER, E.centered(restaurant.footerNote.substring(0, W), W));
  }
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}
```

- [ ] **Run `npm run check`** — expect zero errors.

- [ ] **Commit:**
```bash
git add server/printService.ts
git commit -m "feat(print): rewrite bill generator to Petpooja style — 4-col grid, CGST/SGST split, round-off, NV logo"
```

---

## Task 5 — Print Routes Update

**Files:** Modify `server/printRoutes.ts`

- [ ] **In the KOT route (`app.post('/api/print/kot', ...)`)**, pass `kotNumber` to `generateKOTBuffer`. Find the `generateKOTBuffer({` call and add `kotNumber`:

```typescript
// server/printRoutes.ts — inside POST /api/print/kot, in the generateKOTBuffer call
const buffer = generateKOTBuffer({
  orderNumber: order.orderNumber,
  tableNumber: order.tableNumber,
  kotNumber: (order.kotPrintCount ?? 0) + 1,   // ← ADD THIS LINE
  isReprint: reprint,
  isDelta,
  newItems,
  modifiedItems,
  cancelledItems,
  kotSettings,
  width: printer.width ?? 48,                   // ← change 32 to 48 (80mm default)
});
```

- [ ] **In the Bill route (`app.post('/api/print/bill', ...)`)**, pass `cashierName` to `generateBillBuffer`. Find the `generateBillBuffer({` call and add `cashierName`:

```typescript
// server/printRoutes.ts — inside POST /api/print/bill, in the generateBillBuffer call
const buffer = generateBillBuffer({
  order: { ... },   // unchanged
  items: [...],     // unchanged
  restaurant: settings,
  billSettings,
  cashierName: (req.user as any)?.username ?? 'Admin',   // ← ADD THIS LINE
  width: printer.width ?? 48,                             // ← change 32 to 48
});
```

- [ ] **Update `kotTextLines()` function** to match the new KOT format (used by `/api/print/preview` endpoint):

```typescript
// server/printRoutes.ts — replace the entire kotTextLines() function
function kotTextLines(params: {
  orderNumber: string;
  tableNumber: string | null;
  isReprint: boolean;
  isDelta: boolean;
  newItems: Array<{ name: string; quantity: number; size?: string | null; instructions?: string | null }>;
  modifiedItems: Array<{ name: string; quantity: number; size?: string | null; previousQty: number }>;
  cancelledItems: Array<{ name: string; quantity: number; size?: string | null }>;
  kotSettings: import('./settingsStore').KOTPrintSettings;
  width: number;
  kotNumber?: number;
}): string[] {
  const W = params.width;
  const div = (c: string) => c.repeat(W);
  const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  const two = (l: string, r: string) => l.substring(0, Math.max(1, W - r.length - 1)).padEnd(Math.max(1, W - r.length - 1)) + ' ' + r;
  const lines: string[] = [];

  if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
    lines.push(center('** DUPLICATE **'), div('='));
  }

  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : 'TAKEAWAY';
  lines.push(center(`[ ${tableHeader} ]`)); // text preview can't do double-size, use brackets
  lines.push(center(params.isDelta ? 'MODIFIED KOT' : 'KITCHEN ORDER'));
  lines.push(div('='));

  if (params.kotSettings.kotNumbering !== false) {
    const kotNum = String(params.kotNumber ?? 1).padStart(3, '0');
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    lines.push(`KOT#: ${kotNum}   ${dd}/${mo}/${yy}   ${hh}:${mi}`);
  }
  lines.push(div('-'));

  for (const item of params.newItems) {
    const label = item.size ? `${item.name} (${item.size})` : item.name;
    const qty = `[ ${String(item.quantity).padStart(2, '0')} ]`;
    lines.push(`${qty}  ${label}`);
    if (params.kotSettings.printAddons && item.instructions) {
      lines.push(`        >> ${item.instructions}`);
    }
  }

  if (params.kotSettings.printModifiedItemsOnly) {
    for (const item of params.modifiedItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, '0')} ]`;
      lines.push(two(`${qty}  ${label}`, `was ${item.previousQty}`));
    }
  }

  if (params.kotSettings.printCancelledKOT && params.cancelledItems.length > 0) {
    lines.push(div('-'));
    for (const item of params.cancelledItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, '0')} ]`;
      lines.push(`** VOID **  ${qty}  ${label}`);
    }
  }

  const total = params.newItems.reduce((s, i) => s + i.quantity, 0);
  lines.push(div('='), center(`Total Items: ${total}`), div('='));
  return lines;
}
```

- [ ] **Update `billTextLines()` function** to match the new Bill format:

```typescript
// server/printRoutes.ts — replace the entire billTextLines() function
function billTextLines(params: {
  order: {
    orderNumber: string; tableNumber: string | null; customerName: string | null;
    orderType: string; totalAmount: string; taxAmount: string;
    discountAmount: string | null; paymentMethod: string | null;
    billPrintCount: number; createdAt: Date | string;
  };
  items: Array<{ name: string; quantity: number; price: string; size?: string | null; specialInstructions?: string | null }>;
  restaurant: import('./settingsStore').RestaurantSettings;
  billSettings: import('./settingsStore').BillPrintSettings;
  width: number;
  cashierName?: string;
}): string[] {
  const W = params.width;
  const { order, items, restaurant, billSettings } = params;
  const sym = restaurant.currencySymbol || '₹';
  const div = (c: string) => c.repeat(W);
  const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  const two = (l: string, r: string) => l.substring(0, Math.max(1, W - r.length - 1)).padEnd(Math.max(1, W - r.length - 1)) + ' ' + r;
  const lines: string[] = [];

  if (order.billPrintCount > 0 && billSettings.showDuplicate) { lines.push(center('** DUPLICATE **'), div('=')); }
  if (billSettings.showLogo) lines.push(center('[LOGO]'));
  lines.push(center(restaurant.restaurantName));
  if (restaurant.businessName) lines.push(center(restaurant.businessName));
  if (restaurant.gstNumber)   lines.push(center(`GST -${restaurant.gstNumber}`));
  if (restaurant.phone)       lines.push(center(`M - ${restaurant.phone}`));
  if (restaurant.address) {
    for (const seg of restaurant.address.split(',').map(s => s.trim()).filter(Boolean)) {
      lines.push(center(seg.substring(0, W)));
    }
  }
  if (billSettings.showFssai && restaurant.fssaiNumber) lines.push(center(`FSSAI: ${restaurant.fssaiNumber}`));
  lines.push(div('='));

  if (billSettings.showNameField) { lines.push(`Name:${'_'.repeat(Math.max(10, W - 5))}`); lines.push(''); }

  const created = new Date(order.createdAt);
  const dd = String(created.getDate()).padStart(2, '0');
  const mo = String(created.getMonth() + 1).padStart(2, '0');
  const yy = String(created.getFullYear()).slice(-2);
  const hh = String(created.getHours()).padStart(2, '0');
  const mi = String(created.getMinutes()).padStart(2, '0');
  const orderTypeLabel = order.orderType || (order.tableNumber ? 'Dine In' : 'Pick Up');
  lines.push(two(`Date: ${dd}/${mo}/${yy}`, orderTypeLabel));
  lines.push(`${hh}:${mi}`);
  lines.push(two(`Cashier: ${params.cashierName ?? 'Admin'}`, `Bill No.: ${order.orderNumber}`));
  lines.push(div('-'));

  const IW = W - 4 - 9 - 8 - 3;
  lines.push(`${'Item'.padEnd(IW)} ${'Qty'.padStart(4)} ${'Price'.padStart(9)} ${'Amt'.padStart(8)}`);
  lines.push(div('-'));

  let displayItems = items;
  if (billSettings.mergeDuplicateItems) {
    const map = new Map<string, typeof items[0] & { totalQty: number; totalAmt: number }>();
    for (const item of items) {
      const key = `${item.name}:${item.size ?? ''}`;
      const ex = map.get(key);
      if (ex) { ex.totalQty += item.quantity; ex.totalAmt += item.quantity * parseFloat(item.price); }
      else map.set(key, { ...item, totalQty: item.quantity, totalAmt: item.quantity * parseFloat(item.price) });
    }
    displayItems = Array.from(map.values()).map(i => ({ ...i, quantity: i.totalQty, price: String(i.totalAmt / i.totalQty) }));
  }

  let totalQty = 0;
  for (const item of displayItems) {
    const fullName = item.size ? `${item.name} (${item.size})` : item.name;
    const unitPrice = parseFloat(item.price);
    let remaining = fullName; let first = true;
    while (remaining.length > 0) {
      const chunk = remaining.substring(0, IW); remaining = remaining.substring(IW);
      if (first) {
        lines.push(`${chunk.padEnd(IW)} ${String(item.quantity).padStart(4)} ${unitPrice.toFixed(2).padStart(9)} ${(unitPrice * item.quantity).toFixed(2).padStart(8)}`);
        first = false;
      } else { lines.push(chunk); }
    }
    if (billSettings.showAddons && item.specialInstructions) lines.push(`  [${item.specialInstructions}]`);
    totalQty += item.quantity;
  }
  lines.push(div('-'));

  const tax = parseFloat(order.taxAmount);
  const discount = parseFloat(order.discountAmount || '0');
  const subtotal = parseFloat(order.totalAmount) - tax;
  const rawTotal = parseFloat(order.totalAmount);
  const rounded = Math.round(rawTotal);
  const roundOff = rounded - rawTotal;
  const cgstRate = restaurant.taxRate / 2;
  lines.push(two(`Total Qty: ${totalQty}`, `Sub Total ${subtotal.toFixed(2)}`));
  lines.push(two('', `CGST ${cgstRate}%  ${(tax/2).toFixed(2)}`));
  lines.push(two('', `SGST ${cgstRate}%  ${(tax/2).toFixed(2)}`));
  if (discount > 0) lines.push(two('', `Discount  -${discount.toFixed(2)}`));
  if (billSettings.showRoundOff && Math.abs(roundOff) >= 0.005) lines.push(two('', `Round off  ${roundOff.toFixed(2)}`));
  lines.push(div('='));
  lines.push(two('', `Grand Total  ${sym}${rounded.toFixed(2)}`));
  if (order.paymentMethod) lines.push(two('', order.paymentMethod.toUpperCase()));
  lines.push(div('='));
  if (restaurant.footerNote) lines.push(center(restaurant.footerNote.substring(0, W)));
  return lines;
}
```

- [ ] **In the preview endpoint** (`app.post('/api/print/preview', ...)`), fix the hard-coded `W = 32` to use `48` (the 80mm default), and pass `kotNumber`:

```typescript
// server/printRoutes.ts — in POST /api/print/preview
const W = 48; // 80mm paper default for preview

// ... in the KOT branch, update the kotTextLines call to pass kotNumber:
const lines = kotTextLines({
  orderNumber: order.orderNumber,
  tableNumber: order.tableNumber,
  isReprint: reprint,
  isDelta,
  newItems,
  modifiedItems,
  cancelledItems,
  kotSettings,
  width: W,
  kotNumber: (order.kotPrintCount ?? 0) + 1,   // ← ADD
});
```

- [ ] **Run `npm run check`** — expect zero errors.

- [ ] **Commit:**
```bash
git add server/printRoutes.ts
git commit -m "feat(print): pass kotNumber + cashierName to generators; update text preview to new format"
```

---

## Task 6 — Restaurant Configuration UI

**Files:** Modify `client/src/pages/Settings.tsx`

- [ ] **Add `businessName` and `fssaiNumber` to the `RestaurantSettings` interface** at the top of the file (around line 31):

```typescript
// client/src/pages/Settings.tsx — in RestaurantSettings interface
interface RestaurantSettings {
  restaurantName: string;
  businessName: string;   // ← ADD
  fssaiNumber: string;    // ← ADD
  address: string;
  phone: string;
  email: string;
  gstNumber: string;
  taxRate: number;
  currency: string;
  currencySymbol: string;
  footerNote: string;
  posRoleTimeout: number;
}
```

- [ ] **Add default values** in the `useState` initializer (around line 1209):

```typescript
// client/src/pages/Settings.tsx — in useState<RestaurantSettings>({...})
  restaurantName: "Bagicha Restaurant",
  businessName: "",    // ← ADD
  fssaiNumber: "",     // ← ADD
  address: "",
  // ... rest unchanged
```

- [ ] **Add two input fields to the Restaurant Info section** in the JSX. Place them directly after the Restaurant Name input block (around line 320):

```tsx
{/* Business / Trading Name */}
<div>
  <Label className="text-xs text-gray-500 mb-1">Business / Trading Name</Label>
  <input
    value={formData.businessName}
    onChange={(e) => set("businessName", e.target.value)}
    placeholder="e.g. Salasar Trading (prints below restaurant name on bill)"
    className={inputCls}
  />
</div>

{/* FSSAI License Number */}
<div>
  <Label className="text-xs text-gray-500 mb-1">FSSAI License Number</Label>
  <input
    value={formData.fssaiNumber}
    onChange={(e) => set("fssaiNumber", e.target.value)}
    placeholder="14-digit FSSAI license (enable in Print Settings → Bill)"
    className={inputCls}
  />
</div>
```

- [ ] **Verify the `useEffect` that populates formData from server** already spreads the full settings object. Look for a `useEffect` that calls `setFormData(data)` or similar. If it uses a direct assignment, confirm that `businessName` and `fssaiNumber` will be included. The existing pattern should already work since `currentSettings?.businessName ?? ""` or similar spread is used. If the `useEffect` selects specific fields, add `businessName` and `fssaiNumber` to the selection.

- [ ] **Run `npm run check`** — expect zero errors.

- [ ] **Commit:**
```bash
git add client/src/pages/Settings.tsx
git commit -m "feat(settings): add businessName and fssaiNumber fields to Restaurant Configuration"
```

---

## Task 7 — Print Settings Panel — Toggles + Live Preview

**Files:** Modify `client/src/components/PrintSettingsPanel.tsx`

- [ ] **Add new fields to the client-side `BillPrintSettings` interface** (around line 38):

```typescript
// client/src/components/PrintSettingsPanel.tsx — in BillPrintSettings interface
  showLogo: boolean;
  showFssai: boolean;
  showRoundOff: boolean;
  showNameField: boolean;
```

- [ ] **Add `kotNumbering` to client-side `KOTPrintSettings` interface** (around line 35):

```typescript
// client/src/components/PrintSettingsPanel.tsx — in KOTPrintSettings interface
  kotNumbering: boolean;
```

- [ ] **Update `DEFAULT_BILL` constant**:

```typescript
// client/src/components/PrintSettingsPanel.tsx — in DEFAULT_BILL
const DEFAULT_BILL: BillPrintSettings = {
  taxDisplay: 'none', itemPriceMode: 'exclusive', showBackwardTax: true,
  showDuplicate: true, showCustomerPayment: false, showKotAsToken: false,
  showAddons: true, mergeDuplicateItems: true, showOrderBarcode: false,
  showQuantityBreakdown: false, billPrinterId: null,
  showLogo: true,       // ← ADD
  showFssai: false,     // ← ADD
  showRoundOff: true,   // ← ADD
  showNameField: true,  // ← ADD
};
```

- [ ] **Update `DEFAULT_KOT` constant**:

```typescript
// client/src/components/PrintSettingsPanel.tsx — in DEFAULT_KOT
const DEFAULT_KOT: KOTPrintSettings = {
  // ... existing fields ...
  autoKOTPrint: false, autoKOTDebounceMs: 1500,
  kotNumbering: true,  // ← ADD
};
```

- [ ] **Add a `KOTReceiptPreview` component** — paste this before the `PrinterSetupTab` function:

```tsx
// client/src/components/PrintSettingsPanel.tsx — add before PrinterSetupTab

function KOTReceiptPreview({ kot }: { kot: KOTPrintSettings }) {
  return (
    <div style={{
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: 11, lineHeight: 1.65, background: '#fff',
      border: '1px solid #ccc', padding: '12px 10px',
      width: '100%', maxWidth: 280, color: '#000',
      boxShadow: '1px 2px 6px rgba(0,0,0,0.1)',
    }}>
      <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 900, letterSpacing: 2 }}>TABLE - 4</div>
      <div style={{ textAlign: 'center', fontWeight: 700 }}>KITCHEN ORDER</div>
      <div style={{ borderTop: '2px solid #000', margin: '5px 0' }} />
      {kot.kotNumbering !== false && (
        <div>KOT#: 001&nbsp;&nbsp;&nbsp;22/03/26&nbsp;&nbsp;&nbsp;19:26</div>
      )}
      <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
      <div><strong>{'[ 02 ]'}&nbsp;&nbsp;Butter Naan</strong></div>
      {kot.printAddons && <div style={{ paddingLeft: 8, fontSize: 10 }}>{'>> No Onion, Less Spice'}</div>}
      <div><strong>{'[ 01 ]'}&nbsp;&nbsp;Dal Makhani</strong></div>
      <div><strong>{'[ 01 ]'}&nbsp;&nbsp;Paneer Tikka</strong></div>
      {kot.printAddons && <div style={{ paddingLeft: 8, fontSize: 10 }}>{'>> Extra Gravy'}</div>}
      {kot.printCancelledKOT && (
        <>
          <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
          <div><strong>** VOID **&nbsp;&nbsp;{'[ 01 ]'}&nbsp;&nbsp;Masala Chai</strong></div>
        </>
      )}
      <div style={{ borderTop: '2px solid #000', margin: '5px 0' }} />
      <div style={{ textAlign: 'center', fontWeight: 700 }}>Total Items: 4</div>
      <div style={{ borderTop: '2px solid #000', margin: '5px 0' }} />
    </div>
  );
}
```

- [ ] **Add a `BillReceiptPreview` component** — paste after `KOTReceiptPreview`:

```tsx
// client/src/components/PrintSettingsPanel.tsx — add after KOTReceiptPreview

function BillReceiptPreview({ bill, settings }: { bill: BillPrintSettings; settings: any }) {
  const taxRate  = settings?.taxRate ?? 5;
  const cgst     = taxRate / 2;
  const subtotal = 270.00;
  const taxAmt   = subtotal * taxRate / 100;
  const rawTotal = subtotal + taxAmt;
  const rounded  = Math.round(rawTotal);
  const roundOff = rounded - rawTotal;
  const sym      = settings?.currencySymbol || '₹';

  return (
    <div style={{
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: 11, lineHeight: 1.65, background: '#fff',
      border: '1px solid #ccc', padding: '12px 10px',
      width: '100%', maxWidth: 280, color: '#000',
      boxShadow: '1px 2px 6px rgba(0,0,0,0.1)',
    }}>
      {bill.showLogo && (
        <div style={{ textAlign: 'center', fontSize: 9, color: '#888', border: '1px dashed #ccc', padding: 3, marginBottom: 5 }}>
          [LOGO — from printer NV Flash]
        </div>
      )}
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{settings?.restaurantName || 'Restaurant Name'}</div>
      {settings?.businessName && <div style={{ textAlign: 'center' }}>{settings.businessName}</div>}
      {settings?.gstNumber && <div style={{ textAlign: 'center' }}>GST -{settings.gstNumber}</div>}
      {settings?.phone && <div style={{ textAlign: 'center' }}>M - {settings.phone}</div>}
      {settings?.address && settings.address.split(',').map((p: string, i: number) => (
        <div key={i} style={{ textAlign: 'center' }}>{p.trim()}</div>
      ))}
      {bill.showFssai && settings?.fssaiNumber && (
        <div style={{ textAlign: 'center' }}>FSSAI: {settings.fssaiNumber}</div>
      )}
      <div style={{ borderTop: '1px solid #000', margin: '5px 0' }} />
      {bill.showNameField && <><div>Name:{'_'.repeat(22)}</div><br /></>}
      <div>Date: 22/03/26&nbsp;&nbsp;&nbsp;<strong>Pick Up</strong></div>
      <div>19:26</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Cashier: Admin</span><span>Bill No.: 1234</span>
      </div>
      <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
      <div style={{ fontWeight: 700, display: 'flex', gap: 4 }}>
        <span style={{ flex: 1 }}>Item</span>
        <span style={{ width: 24, textAlign: 'right' }}>Qty</span>
        <span style={{ width: 54, textAlign: 'right' }}>Price</span>
        <span style={{ width: 48, textAlign: 'right' }}>Amt</span>
      </div>
      <div style={{ borderTop: '1px dashed #666', margin: '3px 0' }} />
      <div style={{ display: 'flex', gap: 4 }}>
        <span style={{ flex: 1 }}>Butter Naan</span>
        <span style={{ width: 24, textAlign: 'right' }}>2</span>
        <span style={{ width: 54, textAlign: 'right' }}>90.00</span>
        <span style={{ width: 48, textAlign: 'right' }}>180.00</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <span style={{ flex: 1 }}>Dal Makhani</span>
        <span style={{ width: 24, textAlign: 'right' }}>1</span>
        <span style={{ width: 54, textAlign: 'right' }}>90.00</span>
        <span style={{ width: 48, textAlign: 'right' }}>90.00</span>
      </div>
      <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Total Qty: 3</span>
        <span>Sub Total {subtotal.toFixed(2)}</span>
      </div>
      <div style={{ textAlign: 'right' }}>CGST {cgst}%&nbsp;&nbsp;{(taxAmt / 2).toFixed(2)}</div>
      <div style={{ textAlign: 'right' }}>SGST {cgst}%&nbsp;&nbsp;{(taxAmt / 2).toFixed(2)}</div>
      {bill.showRoundOff && Math.abs(roundOff) >= 0.005 && (
        <div style={{ textAlign: 'right' }}>Round off&nbsp;&nbsp;{roundOff.toFixed(2)}</div>
      )}
      <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
      <div style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total {sym}{rounded.toFixed(2)}</div>
      <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
      <div style={{ textAlign: 'center' }}>{settings?.footerNote || 'Thanks'}</div>
    </div>
  );
}
```

- [ ] **Add preview + new toggles to the KOT tab** in the main `PrintSettingsPanel` render. In the `{activeTab === 'kot' && (...)}` block, add the preview at the bottom and the new `kotNumbering` toggle:

```tsx
{/* Add after the last existing ToggleRow in the KOT tab, before the closing </div> */}
<ToggleRow
  label="Show KOT Number"
  description="Prints KOT#: 001 with date and time on each KOT slip."
  checked={ps.kot.kotNumbering !== false}
  onChange={v => setKot('kotNumbering', v)}
/>

{/* Live preview */}
<div className="mt-5">
  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Print Preview</p>
  <KOTReceiptPreview kot={ps.kot} />
</div>
```

- [ ] **Add preview + new toggles to the Bill tab**. In the `{activeTab === 'bill' && (...)}` block, add after the last existing ToggleRow:

```tsx
{/* Add after the last existing ToggleRow in the Bill tab, before the closing </div> */}
<ToggleRow
  label="Print Logo from Printer NV Flash"
  description="Prints the logo stored in the printer's NV Flash memory slot 1. Set up once via TVS utility tool."
  checked={ps.bill.showLogo}
  onChange={v => setBill('showLogo', v)}
/>
<ToggleRow
  label="Show FSSAI License Number"
  description="Prints FSSAI number below GST in the bill header. Enter the number in Settings → Restaurant Configuration."
  checked={ps.bill.showFssai}
  onChange={v => setBill('showFssai', v)}
/>
<ToggleRow
  label="Show Round Off Line"
  description="Prints the round-off adjustment line (e.g. -0.36) above Grand Total."
  checked={ps.bill.showRoundOff}
  onChange={v => setBill('showRoundOff', v)}
/>
<ToggleRow
  label="Show Name Field"
  description="Prints a blank Name:___ line at the top of the bill for handwriting the customer name."
  checked={ps.bill.showNameField}
  onChange={v => setBill('showNameField', v)}
/>

{/* Live preview */}
<div className="mt-5">
  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Print Preview</p>
  <BillReceiptPreview bill={ps.bill} settings={currentSettings} />
</div>
```

- [ ] **Run `npm run check`** — expect zero errors.

- [ ] **Commit:**
```bash
git add client/src/components/PrintSettingsPanel.tsx
git commit -m "feat(ui): add bill/KOT format toggles and live receipt preview to Print Settings panel"
```

---

## Final Verification Checklist

- [ ] Start the dev server: `npm run dev`
- [ ] Open Print Settings → Printer Setup → edit your TVS RP 3160 Gold printer → set **Paper width to 48 chars (80mm paper)** → Save (this is required for correct column alignment)
- [ ] Open Settings → Restaurant Configuration → add `businessName` ("Salasar Trading") and `fssaiNumber` → Save
- [ ] Open Print Settings → Bill tab → confirm preview updates with businessName and FSSAI
- [ ] Toggle `showLogo` off → logo placeholder disappears from preview
- [ ] Toggle `showRoundOff` off → round-off line disappears from preview
- [ ] Toggle `showNameField` off → Name: ___ field disappears from preview
- [ ] Open Print Settings → KOT tab → confirm preview shows `TABLE - 4` header, `[ 02 ]` quantities
- [ ] Toggle `kotNumbering` off → KOT# line disappears from preview
- [ ] Configure a network printer (IP:port) → Print a dine-in order KOT → confirm `TABLE - N` double-size prints at top
- [ ] Print a bill → confirm logo (if NV Flash set up), centered header, 4-column grid, CGST/SGST split, round-off, bold Grand Total
- [ ] Create a takeaway order → KOT should show `TAKEAWAY` in double-size instead of `TABLE - N`
- [ ] Change restaurant phone in Settings → reprint bill → new phone appears in header

---

## NV Flash Logo Setup Guide (for client)

1. Download the **TVS RP 3160 Gold Utility Software** from TVS Electronics support
2. Export the Bagicha logo as a `.bmp` file, black-and-white, max 576 × 200 pixels
3. Open the utility → select printer → go to NV Logo section → upload to **slot 1**
4. In Print Settings → Bill Print → enable **"Print Logo from Printer NV Flash"**
5. Print a test bill — logo will appear above the restaurant name
6. If the logo doesn't appear, toggle the setting off (printer will silently skip the command if slot 1 is empty)
