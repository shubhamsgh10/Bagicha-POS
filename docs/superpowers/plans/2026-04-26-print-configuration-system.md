# Print Configuration System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct ESC/POS thermal printer support with KOT delta engine, bill printing, and admin settings UI without breaking any existing functionality.

**Architecture:** Express backend owns all printer communication (network via raw TCP socket, USB via `usb` npm package). Frontend calls `/api/print/*` endpoints. Print settings extend `restaurant-settings.json`. KOT delta tracked via `lastKotSnapshot` JSON column on `orders` table.

**Tech Stack:** Node.js `net` module (network printers), `usb` npm package (USB printers), raw ESC/POS bytes, React + shadcn/ui Switch (settings UI), existing `apiRequest` helper.

---

## File Map

**Create:**
- `server/escpos.ts` — ESC/POS byte constants + builder functions (pure, no I/O)
- `server/kotDelta.ts` — Delta computation function (pure, no I/O)
- `server/printService.ts` — Printer transport (network + USB) + ESC/POS document generation
- `server/printRoutes.ts` — Express handlers: POST /api/print/kot, /bill, /test
- `client/src/components/PrintSettingsPanel.tsx` — 3-tab print settings UI

**Modify:**
- `shared/schema.ts` — Add 3 columns to orders table
- `server/settingsStore.ts` — Add PrintSettings types + defaults, extend RestaurantSettings
- `server/routes.ts` — Call `registerPrintRoutes(app)` inside `registerRoutes`
- `client/src/pages/Settings.tsx` — Add Print card to ACTION_CARDS + modal handler
- `client/src/pages/POS.tsx` — Replace printKOT/printOrderBill calls with fetch to API
- `client/src/pages/KOT.tsx` — Replace local printKOT() popup with API call
- `client/src/pages/Orders.tsx` — Add Reprint Bill button in expanded order detail

---

## Task 1: Install `usb` Package + Schema Changes

**Files:**
- Modify: `shared/schema.ts` (orders table, lines 51–70)
- Run: `npm install usb` then `npm run db:push`

- [ ] **Step 1: Install usb package**

```bash
npm install usb
```

Expected: package added to package.json, no build errors (prebuilt binaries available for Node v22 on Windows x64).

- [ ] **Step 2: Add 3 columns to orders table in `shared/schema.ts`**

Find the orders table definition ending at:
```typescript
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Replace with:
```typescript
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  kotPrintCount: integer("kot_print_count").default(0).notNull(),
  billPrintCount: integer("bill_print_count").default(0).notNull(),
  lastKotSnapshot: json("last_kot_snapshot").$type<{
    items: Array<{ itemId: number; name: string; quantity: number; size: string | null }>;
    printedAt: string;
  } | null>(),
});
```

- [ ] **Step 3: Push schema to database**

```bash
npm run db:push
```

Expected: output shows columns added to `orders` table, no errors.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts package.json package-lock.json
git commit -m "feat: add print tracking columns to orders + install usb package"
```

---

## Task 2: Extend `server/settingsStore.ts`

**Files:**
- Modify: `server/settingsStore.ts` (full replacement)

- [ ] **Step 1: Replace the entire file content**

```typescript
import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "restaurant-settings.json");

// ── Print types ───────────────────────────────────────────────────────────────

export interface PrinterConfig {
  id: string;
  name: string;
  type: 'network' | 'usb';
  ip?: string;
  port?: number;
  vendorId?: number;
  productId?: number;
  width?: number; // chars per line: 32 (58mm) or 48 (80mm)
}

export interface KOTPrintSettings {
  enabled: boolean;
  printOnBill: boolean;
  printModifiedKOT: boolean;
  printModifiedItemsOnly: boolean;
  printCancelledKOT: boolean;
  printAddons: boolean;
  showDuplicateWatermark: boolean;
  printDeletedItems: boolean;
  printDeletedSeparate: boolean;
  printOnTableMove: boolean;
  kotPrinterId: string | null;
}

export interface BillPrintSettings {
  taxDisplay: 'none' | 'category-wise';
  itemPriceMode: 'exclusive' | 'inclusive';
  showBackwardTax: boolean;
  showDuplicate: boolean;
  showCustomerPayment: boolean;
  showKotAsToken: boolean;
  showAddons: boolean;
  mergeDuplicateItems: boolean;
  showOrderBarcode: boolean;
  showQuantityBreakdown: boolean;
  billPrinterId: string | null;
}

export interface PrintConfigSettings {
  printers: PrinterConfig[];
  kot: KOTPrintSettings;
  bill: BillPrintSettings;
}

// ── Restaurant settings ───────────────────────────────────────────────────────

export interface RestaurantSettings {
  restaurantName: string;
  address: string;
  phone: string;
  email: string;
  gstNumber: string;
  taxRate: number;
  currency: string;
  currencySymbol: string;
  footerNote: string;
  posRoleTimeout: number;
  printSettings: PrintConfigSettings;
}

const DEFAULT_PRINT_SETTINGS: PrintConfigSettings = {
  printers: [],
  kot: {
    enabled: true,
    printOnBill: true,
    printModifiedKOT: true,
    printModifiedItemsOnly: true,
    printCancelledKOT: true,
    printAddons: true,
    showDuplicateWatermark: true,
    printDeletedItems: true,
    printDeletedSeparate: false,
    printOnTableMove: false,
    kotPrinterId: null,
  },
  bill: {
    taxDisplay: 'none',
    itemPriceMode: 'exclusive',
    showBackwardTax: true,
    showDuplicate: true,
    showCustomerPayment: false,
    showKotAsToken: false,
    showAddons: true,
    mergeDuplicateItems: true,
    showOrderBarcode: false,
    showQuantityBreakdown: false,
    billPrinterId: null,
  },
};

const DEFAULT_SETTINGS: RestaurantSettings = {
  restaurantName: "Bagicha Restaurant",
  address: "",
  phone: "",
  email: "",
  gstNumber: "",
  taxRate: 18,
  currency: "INR",
  currencySymbol: "₹",
  footerNote: "Thank you for dining with us!",
  posRoleTimeout: 2,
  printSettings: DEFAULT_PRINT_SETTINGS,
};

export function getSettings(): RestaurantSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      return {
        ...DEFAULT_SETTINGS,
        ...data,
        printSettings: {
          ...DEFAULT_PRINT_SETTINGS,
          ...(data.printSettings ?? {}),
          kot: { ...DEFAULT_PRINT_SETTINGS.kot, ...(data.printSettings?.kot ?? {}) },
          bill: { ...DEFAULT_PRINT_SETTINGS.bill, ...(data.printSettings?.bill ?? {}) },
        },
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Partial<RestaurantSettings>): RestaurantSettings {
  const current = getSettings();
  const updated: RestaurantSettings = { ...current, ...settings };
  if (settings.printSettings) {
    updated.printSettings = {
      ...current.printSettings,
      ...settings.printSettings,
      kot: { ...current.printSettings.kot, ...(settings.printSettings.kot ?? {}) },
      bill: { ...current.printSettings.bill, ...(settings.printSettings.bill ?? {}) },
    };
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/settingsStore.ts
git commit -m "feat: extend settingsStore with PrintSettings types and defaults"
```

---

## Task 3: Create `server/escpos.ts`

**Files:**
- Create: `server/escpos.ts`

- [ ] **Step 1: Create the file**

```typescript
// Raw ESC/POS byte generation — no external dependencies, no I/O.
// Supports 58mm (32 chars) and 80mm (48 chars) paper widths.

const ESC = 0x1B;
const GS  = 0x1D;
const LF_CODE = 0x0A;

export const INIT         = Buffer.from([ESC, 0x40]);
export const LF           = Buffer.from([LF_CODE]);
export const ALIGN_LEFT   = Buffer.from([ESC, 0x61, 0x00]);
export const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
export const ALIGN_RIGHT  = Buffer.from([ESC, 0x61, 0x02]);
export const BOLD_ON      = Buffer.from([ESC, 0x45, 0x01]);
export const BOLD_OFF     = Buffer.from([ESC, 0x45, 0x00]);
export const CUT          = Buffer.from([GS,  0x56, 0x41, 0x00]);

export function feed(n: number): Buffer {
  return Buffer.from([ESC, 0x64, Math.min(n, 255)]);
}

export function text(str: string): Buffer {
  return Buffer.from(str, 'utf8');
}

export function line(str = ''): Buffer {
  return Buffer.concat([Buffer.from(str, 'utf8'), Buffer.from([LF_CODE])]);
}

export function divider(char = '-', width = 32): Buffer {
  return line(char.repeat(width));
}

export function twoColumns(left: string, right: string, width = 32): Buffer {
  const maxLeft = Math.max(1, width - right.length - 1);
  const l = left.substring(0, maxLeft).padEnd(maxLeft);
  return line(`${l} ${right}`);
}

export function centered(str: string, width = 32): Buffer {
  const pad = Math.max(0, Math.floor((width - str.length) / 2));
  return line(' '.repeat(pad) + str);
}

export function build(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/escpos.ts
git commit -m "feat: add ESC/POS byte generation utility (no deps)"
```

---

## Task 4: Create `server/kotDelta.ts`

**Files:**
- Create: `server/kotDelta.ts`

- [ ] **Step 1: Create the file**

```typescript
export interface SnapshotItem {
  itemId: number;
  name: string;
  quantity: number;
  size: string | null;
}

export interface KotSnapshot {
  items: SnapshotItem[];
  printedAt: string;
}

export interface KotDelta {
  newItems: SnapshotItem[];
  modifiedItems: Array<SnapshotItem & { previousQty: number }>;
  cancelledItems: SnapshotItem[];
}

export function computeDelta(current: SnapshotItem[], last: SnapshotItem[]): KotDelta {
  const lastMap = new Map<string, SnapshotItem>();
  for (const item of last) {
    lastMap.set(`${item.itemId}:${item.size ?? ''}`, item);
  }
  const currentMap = new Map<string, SnapshotItem>();
  for (const item of current) {
    currentMap.set(`${item.itemId}:${item.size ?? ''}`, item);
  }

  const newItems: SnapshotItem[] = [];
  const modifiedItems: Array<SnapshotItem & { previousQty: number }> = [];
  const cancelledItems: SnapshotItem[] = [];

  for (const [key, item] of currentMap) {
    const prev = lastMap.get(key);
    if (!prev) {
      newItems.push(item);
    } else if (item.quantity > prev.quantity) {
      // Only print the incremental increase as "new"
      newItems.push({ ...item, quantity: item.quantity - prev.quantity });
    } else if (item.quantity < prev.quantity) {
      modifiedItems.push({ ...item, previousQty: prev.quantity });
    }
  }

  for (const [key, item] of lastMap) {
    if (!currentMap.has(key)) {
      cancelledItems.push(item);
    }
  }

  return { newItems, modifiedItems, cancelledItems };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/kotDelta.ts
git commit -m "feat: add KOT delta computation (pure function)"
```

---

## Task 5: Create `server/printService.ts`

**Files:**
- Create: `server/printService.ts`

- [ ] **Step 1: Create the file**

```typescript
import net from 'net';
import type { PrinterConfig, KOTPrintSettings, BillPrintSettings, RestaurantSettings } from './settingsStore';
import type { SnapshotItem } from './kotDelta';
import * as E from './escpos';

// ── Transport ─────────────────────────────────────────────────────────────────

export async function sendToNetworkPrinter(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port }, () => {
      socket.write(data, (err) => {
        if (err) { socket.destroy(); reject(err); return; }
        socket.end();
        resolve();
      });
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`Printer at ${ip}:${port} did not respond within 5 seconds`));
    });
    socket.on('error', reject);
  });
}

export async function sendToUsbPrinter(vendorId: number, productId: number, data: Buffer): Promise<void> {
  let usbModule: any;
  try {
    usbModule = await import('usb');
  } catch {
    throw new Error('USB printing requires the "usb" package (npm install usb) and Zadig WinUSB driver setup on Windows.');
  }
  const device = usbModule.findByIds(vendorId, productId);
  if (!device) {
    throw new Error(
      `USB printer not found (VID:0x${vendorId.toString(16).padStart(4,'0')} PID:0x${productId.toString(16).padStart(4,'0')}). ` +
      `Ensure the printer is connected and Zadig WinUSB driver is installed.`
    );
  }
  device.open();
  const iface = device.interfaces[0];
  if (iface.isKernelDriverActive?.()) iface.detachKernelDriver();
  iface.claim();
  const endpoint = iface.endpoints.find((e: any) => e.direction === 'out');
  if (!endpoint) {
    iface.release(true, () => device.close());
    throw new Error('No OUT endpoint found on USB printer interface');
  }
  await new Promise<void>((resolve, reject) => {
    endpoint.transfer(data, (err: Error | null) => {
      iface.release(true, () => device.close());
      if (err) reject(err); else resolve();
    });
  });
}

export async function sendToPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (printer.type === 'network') {
    if (!printer.ip) throw new Error(`Network printer "${printer.name}" has no IP configured`);
    await sendToNetworkPrinter(printer.ip, printer.port ?? 9100, data);
  } else {
    if (!printer.vendorId || !printer.productId) {
      throw new Error(`USB printer "${printer.name}" is missing vendorId or productId`);
    }
    await sendToUsbPrinter(printer.vendorId, printer.productId, data);
  }
}

// ── KOT Document ──────────────────────────────────────────────────────────────

export interface KOTItem {
  name: string;
  quantity: number;
  size?: string | null;
  instructions?: string | null;
}

export function generateKOTBuffer(params: {
  orderNumber: string;
  tableNumber: string | null;
  kotNumber?: string;
  isReprint: boolean;
  isDelta: boolean;
  newItems: KOTItem[];
  modifiedItems: Array<KOTItem & { previousQty: number }>;
  cancelledItems: Array<{ name: string; quantity: number; size?: string | null }>;
  kotSettings: KOTPrintSettings;
  width?: number;
}): Buffer {
  const W = params.width ?? 32;
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('** DUPLICATE **'), E.BOLD_OFF);
    parts.push(E.divider('=', W));
  }

  const header = params.isDelta ? 'MODIFIED KOT' : 'KITCHEN ORDER';
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(header), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_LEFT);

  const table = params.tableNumber ? `Table: ${params.tableNumber}` : 'Takeaway';
  const kotRef = params.kotNumber ? `KOT#: ${params.kotNumber}` : `Ord: ${params.orderNumber.slice(-6)}`;
  parts.push(E.twoColumns(table, kotRef, W));

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  parts.push(E.twoColumns(dateStr, timeStr, W));
  parts.push(E.divider('-', W));

  // New items (always printed)
  for (const item of params.newItems) {
    const label = item.size ? `${item.name} (${item.size})` : item.name;
    parts.push(E.BOLD_ON, E.line(`  ${item.quantity}x ${label}`), E.BOLD_OFF);
    if (params.kotSettings.printAddons && item.instructions) {
      parts.push(E.line(`     [${item.instructions}]`));
    }
  }

  // Modified items (qty decreased but item still present)
  if (params.kotSettings.printModifiedItemsOnly && params.modifiedItems.length > 0) {
    for (const item of params.modifiedItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      parts.push(E.twoColumns(`  ${item.quantity}x ${label}`, `was ${item.previousQty}`, W));
    }
  }

  // Cancelled/deleted items
  if (params.kotSettings.printCancelledKOT && params.cancelledItems.length > 0) {
    parts.push(E.divider('-', W));
    for (const item of params.cancelledItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      parts.push(E.BOLD_ON, E.line(`  ** VOID **  ${item.quantity}x ${label}`), E.BOLD_OFF);
    }
  }

  const totalItems = params.newItems.reduce((s, i) => s + i.quantity, 0);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(`Items: ${totalItems}`), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}

// ── Bill Document ─────────────────────────────────────────────────────────────

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
  width?: number;
}): Buffer {
  const W = params.width ?? 32;
  const { order, items, restaurant, billSettings } = params;
  const sym = restaurant.currencySymbol || '₹';
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  if (order.billPrintCount > 0 && billSettings.showDuplicate) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('** DUPLICATE **'), E.BOLD_OFF);
    parts.push(E.divider('=', W));
  }

  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(restaurant.restaurantName), E.BOLD_OFF);
  if (restaurant.address) parts.push(E.centered(restaurant.address.substring(0, W), W));
  if (restaurant.phone)   parts.push(E.centered(`Tel: ${restaurant.phone}`, W));
  if (restaurant.gstNumber) parts.push(E.centered(`GST: ${restaurant.gstNumber}`, W));
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('RETAIL INVOICE'), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_LEFT);

  const created = new Date(order.createdAt);
  const dateStr = created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  parts.push(E.twoColumns(`Order: ${order.orderNumber}`, dateStr, W));
  parts.push(E.twoColumns(
    order.tableNumber ? `Table: ${order.tableNumber}` : order.orderType,
    timeStr, W
  ));
  if (order.customerName) parts.push(E.line(`Customer: ${order.customerName}`));
  parts.push(E.divider('-', W));

  // Column widths: name | qty | amount
  const QW = 4, AW = 7, NW = W - QW - AW - 2;
  parts.push(E.BOLD_ON);
  parts.push(E.line(`${'Item'.padEnd(NW)} ${'Qty'.padStart(QW)} ${'Amt'.padStart(AW)}`));
  parts.push(E.BOLD_OFF);
  parts.push(E.divider('-', W));

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

  for (const item of displayItems) {
    const label = (item.size ? `${item.name}(${item.size})` : item.name).substring(0, NW).padEnd(NW);
    const qty   = String(item.quantity).padStart(QW);
    const amt   = `${sym}${(item.quantity * parseFloat(item.price)).toFixed(0)}`.padStart(AW);
    parts.push(E.line(`${label} ${qty} ${amt}`));
    if (billSettings.showAddons && item.specialInstructions) {
      parts.push(E.line(`  [${item.specialInstructions}]`));
    }
  }

  parts.push(E.divider('-', W));

  const subtotal = parseFloat(order.totalAmount) - parseFloat(order.taxAmount);
  const discount = parseFloat(order.discountAmount || '0');
  const tax      = parseFloat(order.taxAmount);
  const total    = parseFloat(order.totalAmount);

  parts.push(E.twoColumns('Subtotal:', `${sym}${subtotal.toFixed(0)}`, W));
  if (discount > 0) parts.push(E.twoColumns('Discount:', `-${sym}${discount.toFixed(0)}`, W));
  if (billSettings.showBackwardTax && tax > 0) {
    parts.push(E.twoColumns(`Tax (${restaurant.taxRate}%):`, `${sym}${tax.toFixed(0)}`, W));
  }
  parts.push(E.divider('=', W));
  parts.push(E.BOLD_ON, E.twoColumns('TOTAL:', `${sym}${total.toFixed(0)}`, W), E.BOLD_OFF);
  if (order.paymentMethod) {
    parts.push(E.twoColumns('Payment:', order.paymentMethod.toUpperCase(), W));
  }
  parts.push(E.divider('=', W));
  if (restaurant.footerNote) {
    parts.push(E.centered(restaurant.footerNote.substring(0, W), W));
  }
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/printService.ts
git commit -m "feat: add print service with ESC/POS document generation and network/USB transport"
```

---

## Task 6: Create `server/printRoutes.ts`

**Files:**
- Create: `server/printRoutes.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { Express } from 'express';
import { db } from './db';
import { orders, orderItems, menuItems } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getSettings } from './settingsStore';
import { computeDelta, type SnapshotItem, type KotSnapshot } from './kotDelta';
import { generateKOTBuffer, generateBillBuffer, sendToPrinter } from './printService';
import * as E from './escpos';

function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
}

export function registerPrintRoutes(app: Express): void {

  // ── POST /api/print/kot ───────────────────────────────────────────────────────
  app.post('/api/print/kot', requireAuth, async (req, res) => {
    try {
      const { orderId, reprint = false } = req.body as { orderId: number; reprint?: boolean };
      if (!orderId) return res.status(400).json({ message: 'orderId is required' });

      const settings = getSettings();
      const { kot: kotSettings, printers } = settings.printSettings;

      if (!kotSettings.enabled) {
        return res.json({ printed: false, reason: 'kot_disabled' });
      }

      const printer = printers.find(p => p.id === kotSettings.kotPrinterId);
      if (!printer) {
        return res.status(422).json({
          message: 'No KOT printer configured. Go to Settings → Print Settings → Printer Setup.',
        });
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) return res.status(404).json({ message: 'Order not found' });

      const rawItems = await db
        .select({
          menuItemId: orderItems.menuItemId,
          name: menuItems.name,
          quantity: orderItems.quantity,
          size: orderItems.size,
          specialInstructions: orderItems.specialInstructions,
        })
        .from(orderItems)
        .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .where(eq(orderItems.orderId, orderId));

      const currentSnapshot: SnapshotItem[] = rawItems.map(i => ({
        itemId: i.menuItemId,
        name: i.name,
        quantity: i.quantity,
        size: i.size ?? null,
      }));

      // Build KOT item list with instructions for display
      const kotItemMap = new Map(rawItems.map(i => [
        `${i.menuItemId}:${i.size ?? ''}`,
        { name: i.name, quantity: i.quantity, size: i.size ?? null, instructions: i.specialInstructions ?? null },
      ]));

      let newItems = currentSnapshot.map(i => ({
        ...i,
        instructions: kotItemMap.get(`${i.itemId}:${i.size ?? ''}`)?.instructions ?? null,
      }));
      let modifiedItems: Array<SnapshotItem & { previousQty: number; instructions?: string | null }> = [];
      let cancelledItems: SnapshotItem[] = [];
      let isDelta = false;

      const lastSnapshot = order.lastKotSnapshot as KotSnapshot | null;

      if (!reprint && lastSnapshot?.items?.length) {
        const delta = computeDelta(currentSnapshot, lastSnapshot.items);

        const hasNew       = delta.newItems.length > 0;
        const hasMod       = kotSettings.printModifiedItemsOnly && delta.modifiedItems.length > 0;
        const hasCancelled = kotSettings.printCancelledKOT && delta.cancelledItems.length > 0;

        if (!hasNew && !hasMod && !hasCancelled) {
          return res.json({ printed: false, reason: 'no_delta' });
        }

        newItems = delta.newItems.map(ni => ({
          ...ni,
          instructions: kotItemMap.get(`${ni.itemId}:${ni.size ?? ''}`)?.instructions ?? null,
        }));
        modifiedItems = delta.modifiedItems.map(mi => ({
          ...mi,
          instructions: kotItemMap.get(`${mi.itemId}:${mi.size ?? ''}`)?.instructions ?? null,
        }));
        cancelledItems = delta.cancelledItems;
        isDelta = true;
      }

      const buffer = generateKOTBuffer({
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        isReprint: reprint,
        isDelta,
        newItems,
        modifiedItems,
        cancelledItems,
        kotSettings,
        width: printer.width ?? 32,
      });

      await sendToPrinter(printer, buffer);

      if (!reprint) {
        await db.update(orders).set({
          kotPrintCount: (order.kotPrintCount ?? 0) + 1,
          lastKotSnapshot: { items: currentSnapshot, printedAt: new Date().toISOString() },
        }).where(eq(orders.id, orderId));
      }

      res.json({ printed: true, isDelta, reprint });
    } catch (err: any) {
      console.error('[Print/KOT]', err);
      res.status(500).json({ message: err.message || 'KOT print failed' });
    }
  });

  // ── POST /api/print/bill ──────────────────────────────────────────────────────
  app.post('/api/print/bill', requireAuth, async (req, res) => {
    try {
      const { orderId } = req.body as { orderId: number };
      if (!orderId) return res.status(400).json({ message: 'orderId is required' });

      const settings = getSettings();
      const { bill: billSettings, printers } = settings.printSettings;

      const printer = printers.find(p => p.id === billSettings.billPrinterId);
      if (!printer) {
        return res.status(422).json({
          message: 'No Bill printer configured. Go to Settings → Print Settings → Printer Setup.',
        });
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) return res.status(404).json({ message: 'Order not found' });

      const rawItems = await db
        .select({
          name: menuItems.name,
          quantity: orderItems.quantity,
          price: orderItems.price,
          size: orderItems.size,
          specialInstructions: orderItems.specialInstructions,
        })
        .from(orderItems)
        .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .where(eq(orderItems.orderId, orderId));

      const buffer = generateBillBuffer({
        order: {
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          customerName: order.customerName,
          orderType: order.orderType,
          totalAmount: order.totalAmount,
          taxAmount: order.taxAmount,
          discountAmount: order.discountAmount,
          paymentMethod: order.paymentMethod,
          billPrintCount: order.billPrintCount ?? 0,
          createdAt: order.createdAt,
        },
        items: rawItems.map(i => ({
          name: i.name,
          quantity: i.quantity,
          price: String(i.price),
          size: i.size ?? null,
          specialInstructions: i.specialInstructions ?? null,
        })),
        restaurant: settings,
        billSettings,
        width: printer.width ?? 32,
      });

      await sendToPrinter(printer, buffer);

      await db.update(orders).set({
        billPrintCount: (order.billPrintCount ?? 0) + 1,
      }).where(eq(orders.id, orderId));

      res.json({ printed: true });
    } catch (err: any) {
      console.error('[Print/Bill]', err);
      res.status(500).json({ message: err.message || 'Bill print failed' });
    }
  });

  // ── POST /api/print/test ──────────────────────────────────────────────────────
  app.post('/api/print/test', requireAdmin, async (req, res) => {
    try {
      const { printerId } = req.body as { printerId: string };
      const settings = getSettings();
      const printer = settings.printSettings.printers.find(p => p.id === printerId);
      if (!printer) return res.status(404).json({ message: 'Printer not found in registry' });

      const W = printer.width ?? 32;
      const buffer = E.build(
        E.INIT,
        E.ALIGN_CENTER, E.BOLD_ON, E.line('TEST PRINT'), E.BOLD_OFF,
        E.divider('-', W),
        E.centered(printer.name, W),
        E.centered(new Date().toLocaleString('en-IN'), W),
        E.divider('=', W),
        E.centered('Printer is working correctly!', W),
        E.feed(3),
        E.CUT,
      );

      await sendToPrinter(printer, buffer);
      res.json({ success: true, message: `Test page sent to "${printer.name}"` });
    } catch (err: any) {
      console.error('[Print/Test]', err);
      res.status(500).json({ message: err.message || 'Test print failed' });
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/printRoutes.ts
git commit -m "feat: add print API routes (KOT delta, bill, test)"
```

---

## Task 7: Mount Print Routes in `server/routes.ts`

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: Add import at the top of routes.ts**

Find the last import line (around line 47, the `import { eq, desc } from "drizzle-orm"` line). After it, add:

```typescript
import { registerPrintRoutes } from './printRoutes';
```

- [ ] **Step 2: Call registerPrintRoutes inside registerRoutes**

Inside the `registerRoutes` function, find the `// ── Settings ──` comment block (around line 521). Just before that block, add:

```typescript
  // ── Print routes ──────────────────────────────────────────────────────────────
  registerPrintRoutes(app);

```

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat: mount print routes in Express app"
```

---

## Task 8: Create `client/src/components/PrintSettingsPanel.tsx`

**Files:**
- Create: `client/src/components/PrintSettingsPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Wifi, Usb, TestTube2, CheckCircle2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types (mirror server/settingsStore.ts) ─────────────────────────────────────

interface PrinterConfig {
  id: string;
  name: string;
  type: 'network' | 'usb';
  ip?: string;
  port?: number;
  vendorId?: number;
  productId?: number;
  width?: number;
}

interface KOTPrintSettings {
  enabled: boolean;
  printOnBill: boolean;
  printModifiedKOT: boolean;
  printModifiedItemsOnly: boolean;
  printCancelledKOT: boolean;
  printAddons: boolean;
  showDuplicateWatermark: boolean;
  printDeletedItems: boolean;
  printDeletedSeparate: boolean;
  printOnTableMove: boolean;
  kotPrinterId: string | null;
}

interface BillPrintSettings {
  taxDisplay: 'none' | 'category-wise';
  itemPriceMode: 'exclusive' | 'inclusive';
  showBackwardTax: boolean;
  showDuplicate: boolean;
  showCustomerPayment: boolean;
  showKotAsToken: boolean;
  showAddons: boolean;
  mergeDuplicateItems: boolean;
  showOrderBarcode: boolean;
  showQuantityBreakdown: boolean;
  billPrinterId: string | null;
}

interface PrintConfigSettings {
  printers: PrinterConfig[];
  kot: KOTPrintSettings;
  bill: BillPrintSettings;
}

const DEFAULT_KOT: KOTPrintSettings = {
  enabled: true, printOnBill: true, printModifiedKOT: true,
  printModifiedItemsOnly: true, printCancelledKOT: true, printAddons: true,
  showDuplicateWatermark: true, printDeletedItems: true, printDeletedSeparate: false,
  printOnTableMove: false, kotPrinterId: null,
};

const DEFAULT_BILL: BillPrintSettings = {
  taxDisplay: 'none', itemPriceMode: 'exclusive', showBackwardTax: true,
  showDuplicate: true, showCustomerPayment: false, showKotAsToken: false,
  showAddons: true, mergeDuplicateItems: true, showOrderBarcode: false,
  showQuantityBreakdown: false, billPrinterId: null,
};

// ── Toggle row ────────────────────────────────────────────────────────────────

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && (
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0 mt-0.5" />
    </div>
  );
}

// ── Printer Setup Tab ─────────────────────────────────────────────────────────

function PrinterSetupTab({ printers, onChange, onTest }: {
  printers: PrinterConfig[];
  onChange: (printers: PrinterConfig[]) => void;
  onTest: (printerId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<PrinterConfig>>({ type: 'network', port: 9100, width: 32 });

  const inputCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 w-full bg-gray-50 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors";

  const addPrinter = () => {
    if (!form.name?.trim()) return;
    const newPrinter: PrinterConfig = {
      id: Date.now().toString(),
      name: form.name.trim(),
      type: form.type as 'network' | 'usb',
      ip: form.ip,
      port: form.port ?? 9100,
      vendorId: form.vendorId,
      productId: form.productId,
      width: form.width ?? 32,
    };
    onChange([...printers, newPrinter]);
    setAdding(false);
    setForm({ type: 'network', port: 9100, width: 32 });
  };

  const remove = (id: string) => onChange(printers.filter(p => p.id !== id));

  return (
    <div className="space-y-4">
      {printers.length === 0 && !adding && (
        <div className="text-center py-10 rounded-xl border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-400">No printers configured</p>
          <p className="text-xs text-gray-300 mt-1">Add a network (TCP/IP) or USB thermal printer</p>
        </div>
      )}

      {printers.map(p => (
        <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
          <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0">
            {p.type === 'network'
              ? <Wifi className="w-4 h-4 text-blue-500" />
              : <Usb className="w-4 h-4 text-purple-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">{p.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {p.type === 'network'
                ? `${p.ip ?? '—'}:${p.port ?? 9100}`
                : `VID:0x${(p.vendorId ?? 0).toString(16).padStart(4,'0')} PID:0x${(p.productId ?? 0).toString(16).padStart(4,'0')}`}
              {' · '}{p.width ?? 32} chars
            </p>
          </div>
          <button
            onClick={() => onTest(p.id)}
            title="Send test page"
            className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-400 transition-colors"
          >
            <TestTube2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => remove(p.id)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Add Printer</p>

          <div className="grid grid-cols-2 gap-2">
            {(['network', 'usb'] as const).map(t => (
              <button
                key={t}
                onClick={() => setForm(f => ({ ...f, type: t }))}
                className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                  form.type === t
                    ? t === 'network' ? 'bg-blue-500 text-white border-blue-500' : 'bg-purple-500 text-white border-purple-500'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {t === 'network' ? <><Wifi className="w-3.5 h-3.5 inline mr-1" />Network</> : <><Usb className="w-3.5 h-3.5 inline mr-1" />USB</>}
              </button>
            ))}
          </div>

          <input
            className={inputCls}
            placeholder="Printer name (e.g. Kitchen Printer)"
            value={form.name ?? ''}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />

          {form.type === 'network' ? (
            <div className="grid grid-cols-3 gap-2">
              <input
                className={`${inputCls} col-span-2`}
                placeholder="IP address (e.g. 192.168.1.100)"
                value={form.ip ?? ''}
                onChange={e => setForm(f => ({ ...f, ip: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Port"
                type="number"
                value={form.port ?? 9100}
                onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 9100 }))}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  placeholder="Vendor ID hex (e.g. 04b8)"
                  value={form.vendorId != null ? '0x' + form.vendorId.toString(16).padStart(4,'0') : ''}
                  onChange={e => {
                    const v = parseInt(e.target.value.replace(/^0x/i,''), 16);
                    setForm(f => ({ ...f, vendorId: isNaN(v) ? undefined : v }));
                  }}
                />
                <input
                  className={inputCls}
                  placeholder="Product ID hex (e.g. 0202)"
                  value={form.productId != null ? '0x' + form.productId.toString(16).padStart(4,'0') : ''}
                  onChange={e => {
                    const v = parseInt(e.target.value.replace(/^0x/i,''), 16);
                    setForm(f => ({ ...f, productId: isNaN(v) ? undefined : v }));
                  }}
                />
              </div>
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                USB requires Zadig WinUSB driver setup on Windows. Find VID/PID in Device Manager.
              </p>
            </>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">Paper width:</label>
            <select
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none"
              value={form.width ?? 32}
              onChange={e => setForm(f => ({ ...f, width: parseInt(e.target.value) }))}
            >
              <option value={32}>32 chars (58mm paper)</option>
              <option value={48}>48 chars (80mm paper)</option>
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setAdding(false); setForm({ type: 'network', port: 9100, width: 32 }); }}
              className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={addPrinter}
              className="flex-1 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors"
            >
              Add Printer
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-emerald-600 border-2 border-dashed border-emerald-200 hover:bg-emerald-50 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Printer
        </button>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PrintSettingsPanel({
  currentSettings,
  onClose,
}: {
  currentSettings: any;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'kot' | 'bill' | 'printers'>('kot');

  const [ps, setPs] = useState<PrintConfigSettings>({
    printers: currentSettings?.printSettings?.printers ?? [],
    kot: { ...DEFAULT_KOT, ...(currentSettings?.printSettings?.kot ?? {}) },
    bill: { ...DEFAULT_BILL, ...(currentSettings?.printSettings?.bill ?? {}) },
  });

  const setKot = (key: keyof KOTPrintSettings, val: any) =>
    setPs(p => ({ ...p, kot: { ...p.kot, [key]: val } }));

  const setBill = (key: keyof BillPrintSettings, val: any) =>
    setPs(p => ({ ...p, bill: { ...p.bill, [key]: val } }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('PUT', '/api/settings', { ...currentSettings, printSettings: ps });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({ title: 'Print settings saved' });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleTest = async (printerId: string) => {
    try {
      const res = await fetch('/api/print/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: 'Test page sent!', description: data.message });
    } catch (err: any) {
      toast({ title: 'Test failed', description: err.message, variant: 'destructive' });
    }
  };

  const printerOptions = [
    { value: '', label: '— None —' },
    ...ps.printers.map(p => ({ value: p.id, label: p.name })),
  ];

  const selectCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors";

  const tabs = [
    { id: 'kot' as const,      label: 'KOT Print' },
    { id: 'bill' as const,     label: 'Bill Print' },
    { id: 'printers' as const, label: 'Printer Setup' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(0,0,0,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-800">Print Settings</h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure thermal printer behavior</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === t.id
                  ? 'bg-emerald-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── KOT Print ── */}
          {activeTab === 'kot' && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <label className="text-xs text-gray-500 shrink-0 w-24">KOT Printer:</label>
                <select
                  className={selectCls}
                  value={ps.kot.kotPrinterId ?? ''}
                  onChange={e => setKot('kotPrinterId', e.target.value || null)}
                >
                  {printerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <ToggleRow label="Enable KOT Printing" checked={ps.kot.enabled} onChange={v => setKot('enabled', v)} />
              <ToggleRow
                label="Print KOT on Print Bill"
                description="This setting will only work when the print bill action is initiated for the first time. For reprint of KOT, use the KOT listing page."
                checked={ps.kot.printOnBill} onChange={v => setKot('printOnBill', v)}
              />
              <ToggleRow
                label="Print Only Modified KOT"
                description="When enabled, prints only the KOT where modification (i.e. item change or item deletion) occurred, with the label 'Modified' at the top of the KOT."
                checked={ps.kot.printModifiedKOT} onChange={v => setKot('printModifiedKOT', v)}
              />
              <ToggleRow label="Print Only Modified Items in KOT" checked={ps.kot.printModifiedItemsOnly} onChange={v => setKot('printModifiedItemsOnly', v)} />
              <ToggleRow label="Print Cancelled KOT" checked={ps.kot.printCancelledKOT} onChange={v => setKot('printCancelledKOT', v)} />
              <ToggleRow
                label="Print add-ons and special notes below item row in KOT"
                description="Print add-ons and special notes for the particular item below the item name row in KOT."
                checked={ps.kot.printAddons} onChange={v => setKot('printAddons', v)}
              />
              <ToggleRow
                label="Show Duplicate in KOT in case of multiple prints"
                description="When a KOT is re-printed, it would show Duplicate at the top of the KOT."
                checked={ps.kot.showDuplicateWatermark} onChange={v => setKot('showDuplicateWatermark', v)}
              />
              <ToggleRow label="Print Deleted Items In KOT" checked={ps.kot.printDeletedItems} onChange={v => setKot('printDeletedItems', v)} />
              <ToggleRow label="Print Deleted Items in separate KOT" checked={ps.kot.printDeletedSeparate} onChange={v => setKot('printDeletedSeparate', v)} />
              <ToggleRow
                label="While moving KOT items from one table to another, print KOT"
                checked={ps.kot.printOnTableMove} onChange={v => setKot('printOnTableMove', v)}
              />
            </div>
          )}

          {/* ── Bill Print ── */}
          {activeTab === 'bill' && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <label className="text-xs text-gray-500 shrink-0 w-24">Bill Printer:</label>
                <select
                  className={selectCls}
                  value={ps.bill.billPrinterId ?? ''}
                  onChange={e => setBill('billPrinterId', e.target.value || null)}
                >
                  {printerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className="py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-800 mb-2">Tax Display on Bill</p>
                <div className="flex gap-6">
                  {(['none', 'category-wise'] as const).map(v => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="taxDisplay" checked={ps.bill.taxDisplay === v}
                        onChange={() => setBill('taxDisplay', v)} className="accent-emerald-500" />
                      <span className="text-sm text-gray-600">
                        {v === 'none' ? 'None' : 'Print Category-wise Tax (CWT) on bill'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-800 mb-2">Select item price print option in bill print</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="itemPriceMode" checked={ps.bill.itemPriceMode === 'exclusive'}
                      onChange={() => setBill('itemPriceMode', 'exclusive')} className="accent-emerald-500" />
                    <span className="text-sm text-gray-600">Individual Item price will be shown (without backward tax) on printed bill</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="itemPriceMode" checked={ps.bill.itemPriceMode === 'inclusive'}
                      onChange={() => setBill('itemPriceMode', 'inclusive')} className="accent-emerald-500" />
                    <span className="text-sm text-gray-600">Individual Item price will be shown (including backward tax) on printed bill</span>
                  </label>
                </div>
              </div>

              <ToggleRow label="Show Backward tax on printed bill" checked={ps.bill.showBackwardTax} onChange={v => setBill('showBackwardTax', v)} />
              <ToggleRow
                label="Show Duplicate on a bill in case of multiple prints"
                description="When a bill is re-printed, it would show Duplicate at the top of the bill."
                checked={ps.bill.showDuplicate} onChange={v => setBill('showDuplicate', v)}
              />
              <ToggleRow label="Show Customer paid and return to customer in bill print" checked={ps.bill.showCustomerPayment} onChange={v => setBill('showCustomerPayment', v)} />
              <ToggleRow
                label="Print KOT no on bill as Token no"
                description="If this option is selected then it shows KOT no. on those bills whose KOT's are available."
                checked={ps.bill.showKotAsToken} onChange={v => setBill('showKotAsToken', v)}
              />
              <ToggleRow label="Show addons in bill print" checked={ps.bill.showAddons} onChange={v => setBill('showAddons', v)} />
              <ToggleRow
                label="Merge Duplicate Items"
                description="This setting enables merging same items on bill when printed."
                checked={ps.bill.mergeDuplicateItems} onChange={v => setBill('mergeDuplicateItems', v)}
              />
              <ToggleRow label="Show order barcode on bill print" checked={ps.bill.showOrderBarcode} onChange={v => setBill('showOrderBarcode', v)} />
              <ToggleRow
                label="Display Quantity of ordered items in Bill (ex. Roti 5 + 1 + 2)"
                description="This setting shows item quantity KOT-wise in bill print."
                checked={ps.bill.showQuantityBreakdown} onChange={v => setBill('showQuantityBreakdown', v)}
              />
            </div>
          )}

          {/* ── Printer Setup ── */}
          {activeTab === 'printers' && (
            <PrinterSetupTab
              printers={ps.printers}
              onChange={printers => setPs(p => ({ ...p, printers }))}
              onTest={handleTest}
            />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-6 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors disabled:opacity-60"
          >
            {saveMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <CheckCircle2 className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/PrintSettingsPanel.tsx
git commit -m "feat: add PrintSettingsPanel with KOT/Bill/Printer Setup tabs"
```

---

## Task 9: Update `client/src/pages/Settings.tsx`

**Files:**
- Modify: `client/src/pages/Settings.tsx`

- [ ] **Step 1: Add Printer to lucide-react imports**

Find the lucide-react import line (line 9). Add `Printer` to it:

```typescript
import {
  Loader2, Store, Receipt, ShieldCheck, RefreshCw, Database,
  Trash2, Archive, FileText, Monitor, KeyRound, X, AlertTriangle,
  CheckCircle2, ChevronRight, Settings2, Upload, FileUp, Download,
  Printer,
} from "lucide-react";
```

- [ ] **Step 2: Add PrintSettingsPanel import**

After all existing imports, add:

```typescript
import { PrintSettingsPanel } from "@/components/PrintSettingsPanel";
```

- [ ] **Step 3: Add "print-settings" to the ModalId union type**

Find:
```typescript
  | "generate-code"
  | null;
```

Replace with:
```typescript
  | "generate-code"
  | "print-settings"
  | null;
```

- [ ] **Step 4: Add Print card to ACTION_CARDS array**

Find the closing `];` of the ACTION_CARDS array (after the `generate-code` entry). Add before `];`:

```typescript
  {
    id: "print-settings" as const,
    label: "Print",
    sublabel: "Settings",
    icon: Printer,
  },
```

- [ ] **Step 5: Add the print-settings modal handler in the JSX**

Find the `{/* Generate Code */}` modal block near the bottom. After its closing `)}`, add:

```tsx
      {/* Print Settings */}
      {activeModal === "print-settings" && (
        <PrintSettingsPanel
          currentSettings={formData}
          onClose={closeModal}
        />
      )}
```

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Settings.tsx
git commit -m "feat: add Print Settings card and panel to Settings page"
```

---

## Task 10: Update `client/src/pages/POS.tsx`

**Files:**
- Modify: `client/src/pages/POS.tsx`

- [ ] **Step 1: Remove the printBill import**

Find line 25:
```typescript
import { printOrderBill, printKOT } from "@/lib/printBill";
```

Delete this entire line.

- [ ] **Step 2: Add print helper functions inside the POS component**

Locate `const { toast } = useToast();` inside the `function POS()` component body. Add these two functions immediately after:

```typescript
  const triggerKOTPrint = async (orderId: number) => {
    try {
      const res = await fetch('/api/print/kot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'KOT print failed', description: data.message, variant: 'destructive' });
      } else if (data.printed === false) {
        toast({ title: 'Nothing new to print', description: 'No new items added since last KOT' });
      } else {
        toast({ title: 'KOT sent to printer!' });
      }
    } catch {
      toast({ title: 'KOT print failed', description: 'Could not reach printer', variant: 'destructive' });
    }
  };

  const triggerBillPrint = async (orderId: number) => {
    try {
      const res = await fetch('/api/print/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Bill print failed', description: data.message, variant: 'destructive' });
      } else {
        toast({ title: 'Bill sent to printer!' });
      }
    } catch {
      toast({ title: 'Bill print failed', description: 'Could not reach printer', variant: 'destructive' });
    }
  };
```

- [ ] **Step 3: Replace printKOT call in createOrderMutation.onSuccess (first occurrence)**

Find:
```typescript
        printKOT(order, order.items || cartItems.map(ci => ({ name: ci.name, price: String(ci.basePrice), quantity: ci.quantity })));
```

Replace with:
```typescript
        triggerKOTPrint(order.id);
```

- [ ] **Step 4: Replace printOrderBill call in createOrderMutation.onSuccess**

Find:
```typescript
        printOrderBill(order, order.items || cartItems.map(ci => ({ name: ci.name, price: String(ci.basePrice), quantity: ci.quantity })), settings);
```

Replace with:
```typescript
        triggerBillPrint(order.id);
```

- [ ] **Step 5: Replace printKOT call in updateOrderMutation.onSuccess**

Find:
```typescript
        printKOT(order, order.items || existingOrder?.items || []);
```

Replace with:
```typescript
        triggerKOTPrint(vars.orderId);
```

- [ ] **Step 6: Replace printOrderBill call in updateOrderMutation.onSuccess**

Find:
```typescript
        printOrderBill(order, order.items || existingOrder?.items || [], settings);
```

Replace with:
```typescript
        triggerBillPrint(vars.orderId);
```

- [ ] **Step 7: Replace printOrderBill call in settleMutation.onSuccess**

Find:
```typescript
      printOrderBill(billOrder, billOrder.items || existingOrder?.items || [], settings);
```

Replace with:
```typescript
      if (vars.orderId) triggerBillPrint(vars.orderId);
```

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/POS.tsx
git commit -m "feat: replace browser print dialogs in POS with direct ESC/POS API calls"
```

---

## Task 11: Update `client/src/pages/KOT.tsx`

**Files:**
- Modify: `client/src/pages/KOT.tsx`

- [ ] **Step 1: Delete the local printKOT function**

Delete lines 10–49 entirely — the full `function printKOT(ticket: any) { ... }` block including the closing brace.

- [ ] **Step 2: Add reprintKOT inside the KOT component**

Inside `export default function KOT()`, after `const { toast } = useToast();`, add:

```typescript
  const reprintKOT = async (orderId: number) => {
    try {
      const res = await fetch('/api/print/kot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, reprint: true }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Print failed', description: data.message, variant: 'destructive' });
      } else {
        toast({ title: 'KOT sent to printer!' });
      }
    } catch {
      toast({ title: 'Print failed', description: 'Could not reach printer', variant: 'destructive' });
    }
  };
```

- [ ] **Step 3: Update the Print KOT button onClick in KOTCard**

Find:
```typescript
          onClick={() => printKOT(ticket)}
```

Replace with:
```typescript
          onClick={() => reprintKOT(ticket.orderId)}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/KOT.tsx
git commit -m "feat: replace KOT page popup print with direct ESC/POS reprint API"
```

---

## Task 12: Add Reprint Bill Button to `client/src/pages/Orders.tsx`

**Files:**
- Modify: `client/src/pages/Orders.tsx`

- [ ] **Step 1: Add Printer to lucide-react imports**

Find:
```typescript
import { Plus, RefreshCw, ChevronDown, ChevronUp, User, Phone, ShoppingBag, Search, X } from "lucide-react";
```

Replace with:
```typescript
import { Plus, RefreshCw, ChevronDown, ChevronUp, User, Phone, ShoppingBag, Search, X, Printer } from "lucide-react";
```

- [ ] **Step 2: Add useToast import**

At the top of the file with other imports, add:
```typescript
import { useToast } from "@/hooks/use-toast";
```

- [ ] **Step 3: Add reprintBill function inside OrderDetailRow**

Inside `function OrderDetailRow(...)`, after `const items: any[] = detail?.items || [];`, add:

```typescript
  const { toast } = useToast();

  const reprintBill = async () => {
    try {
      const res = await fetch('/api/print/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Print failed', description: data.message, variant: 'destructive' });
      } else {
        toast({ title: 'Bill sent to printer!' });
      }
    } catch {
      toast({ title: 'Print failed', description: 'Could not reach printer', variant: 'destructive' });
    }
  };
```

- [ ] **Step 4: Add Reprint Bill button in expanded order detail**

Find the expanded items section inside `OrderDetailRow`. Locate the closing `</AnimatePresence>` of the expanded block. Just before the final closing `</motion.div>` of the `OrderDetailRow` return, add:

```tsx
          {expanded && (
            <div className="flex justify-end px-4 pb-3">
              <button
                onClick={reprintBill}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              >
                <Printer className="w-3 h-3" /> Reprint Bill
              </button>
            </div>
          )}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Orders.tsx
git commit -m "feat: add Reprint Bill button to expanded order detail in Orders page"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm run dev` starts without errors
- [ ] `npm run check` passes TypeScript with no new errors
- [ ] Settings page shows "Print Settings" card
- [ ] Clicking Print Settings opens 3-tab panel (KOT Print / Bill Print / Printer Setup)
- [ ] Adding a network printer (e.g. IP 192.168.1.100, port 9100) saves correctly in restaurant-settings.json
- [ ] Test button on printer returns an error (expected — real printer not connected in dev)
- [ ] In POS, pressing KOT sends request to `POST /api/print/kot` (visible in server console log)
- [ ] With no printer configured, response is 422 with helpful message shown as toast
- [ ] Pressing KOT twice on same unchanged order returns `no_delta` toast
- [ ] Adding an item then pressing KOT again sends only the new item
- [ ] KOT page "Print KOT" button calls `/api/print/kot` with `reprint: true`
- [ ] Orders page expanded order shows "Reprint Bill" button
- [ ] `restaurant-settings.json` now contains `printSettings` key after first save
