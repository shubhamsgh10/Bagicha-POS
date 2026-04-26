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

// ── Plain-text receipt generators (for browser preview) ───────────────────────

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
}): string[] {
  const W = params.width;
  const div = (c: string) => c.repeat(W);
  const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  const two = (l: string, r: string) => l.substring(0, Math.max(1, W - r.length - 1)).padEnd(Math.max(1, W - r.length - 1)) + ' ' + r;
  const lines: string[] = [];

  if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
    lines.push(center('** DUPLICATE **'), div('='));
  }
  lines.push(center(params.isDelta ? 'MODIFIED KOT' : 'KITCHEN ORDER'), div('='));
  lines.push(two(params.tableNumber ? `Table: ${params.tableNumber}` : 'Takeaway', `Ord: ${params.orderNumber.slice(-6)}`));
  const now = new Date();
  lines.push(two(
    now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  ));
  lines.push(div('-'));
  for (const item of params.newItems) {
    lines.push(`  ${item.quantity}x ${item.size ? `${item.name} (${item.size})` : item.name}`);
    if (params.kotSettings.printAddons && item.instructions) lines.push(`     [${item.instructions}]`);
  }
  if (params.kotSettings.printModifiedItemsOnly) {
    for (const item of params.modifiedItems) {
      lines.push(two(`  ${item.quantity}x ${item.size ? `${item.name} (${item.size})` : item.name}`, `was ${item.previousQty}`));
    }
  }
  if (params.kotSettings.printCancelledKOT && params.cancelledItems.length > 0) {
    lines.push(div('-'));
    for (const item of params.cancelledItems) {
      lines.push(`  ** VOID **  ${item.quantity}x ${item.size ? `${item.name} (${item.size})` : item.name}`);
    }
  }
  const total = params.newItems.reduce((s, i) => s + i.quantity, 0);
  lines.push(div('='), center(`Items: ${total}`), div('='));
  return lines;
}

function billTextLines(params: {
  order: {
    orderNumber: string; tableNumber: string | null; customerName: string | null;
    orderType: string; totalAmount: string; taxAmount: string;
    discountAmount: string | null; paymentMethod: string | null; billPrintCount: number; createdAt: Date | string;
  };
  items: Array<{ name: string; quantity: number; price: string; size?: string | null; specialInstructions?: string | null }>;
  restaurant: import('./settingsStore').RestaurantSettings;
  billSettings: import('./settingsStore').BillPrintSettings;
  width: number;
}): string[] {
  const W = params.width;
  const { order, items, restaurant, billSettings } = params;
  const sym = restaurant.currencySymbol || '₹';
  const div = (c: string) => c.repeat(W);
  const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  const two = (l: string, r: string) => l.substring(0, Math.max(1, W - r.length - 1)).padEnd(Math.max(1, W - r.length - 1)) + ' ' + r;
  const lines: string[] = [];

  if (order.billPrintCount > 0 && billSettings.showDuplicate) { lines.push(center('** DUPLICATE **'), div('=')); }
  lines.push(center(restaurant.restaurantName));
  if (restaurant.address) lines.push(center(restaurant.address.substring(0, W)));
  if (restaurant.phone)   lines.push(center(`Tel: ${restaurant.phone}`));
  if (restaurant.gstNumber) lines.push(center(`GST: ${restaurant.gstNumber}`));
  lines.push(div('='), center('RETAIL INVOICE'), div('='));

  const created = new Date(order.createdAt);
  lines.push(two(`Order: ${order.orderNumber}`, created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })));
  lines.push(two(order.tableNumber ? `Table: ${order.tableNumber}` : order.orderType, created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })));
  if (order.customerName) lines.push(`Customer: ${order.customerName}`);
  lines.push(div('-'));

  const QW = 4, AW = 7, NW = W - QW - AW - 2;
  lines.push(`${'Item'.padEnd(NW)} ${'Qty'.padStart(QW)} ${'Amt'.padStart(AW)}`);
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
  for (const item of displayItems) {
    const label = (item.size ? `${item.name}(${item.size})` : item.name).substring(0, NW).padEnd(NW);
    lines.push(`${label} ${String(item.quantity).padStart(QW)} ${(`${sym}${(item.quantity * parseFloat(item.price)).toFixed(0)}`).padStart(AW)}`);
    if (billSettings.showAddons && item.specialInstructions) lines.push(`  [${item.specialInstructions}]`);
  }
  lines.push(div('-'));

  const subtotal = parseFloat(order.totalAmount) - parseFloat(order.taxAmount);
  const discount = parseFloat(order.discountAmount || '0');
  const tax      = parseFloat(order.taxAmount);
  const total    = parseFloat(order.totalAmount);

  lines.push(two('Subtotal:', `${sym}${subtotal.toFixed(0)}`));
  if (discount > 0) lines.push(two('Discount:', `-${sym}${discount.toFixed(0)}`));
  if (billSettings.showBackwardTax && tax > 0) lines.push(two(`Tax (${restaurant.taxRate}%):`, `${sym}${tax.toFixed(0)}`));
  lines.push(div('='), two('TOTAL:', `${sym}${total.toFixed(0)}`));
  if (order.paymentMethod) lines.push(two('Payment:', order.paymentMethod.toUpperCase()));
  lines.push(div('='));
  if (restaurant.footerNote) lines.push(center(restaurant.footerNote.substring(0, W)));
  return lines;
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

      const kotItemMap = new Map(rawItems.map(i => [
        `${i.menuItemId}:${i.size ?? ''}`,
        { name: i.name, quantity: i.quantity, size: i.size ?? null, instructions: i.specialInstructions ?? null },
      ]));

      let newItems: Array<SnapshotItem & { instructions?: string | null }> = currentSnapshot.map(i => ({
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

  // ── POST /api/print/preview ───────────────────────────────────────────────────
  app.post('/api/print/preview', requireAuth, async (req, res) => {
    try {
      const { type, orderId, reprint = false } = req.body as { type: 'kot' | 'bill'; orderId: number; reprint?: boolean };
      if (!orderId || !type) return res.status(400).json({ message: 'type and orderId are required' });

      const settings = getSettings();
      const W = 32;

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) return res.status(404).json({ message: 'Order not found' });

      if (type === 'kot') {
        const { kot: kotSettings } = settings.printSettings;
        const rawItems = await db
          .select({ menuItemId: orderItems.menuItemId, name: menuItems.name, quantity: orderItems.quantity, size: orderItems.size, specialInstructions: orderItems.specialInstructions })
          .from(orderItems).innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id)).where(eq(orderItems.orderId, orderId));

        const currentSnapshot: import('./kotDelta').SnapshotItem[] = rawItems.map(i => ({ itemId: i.menuItemId, name: i.name, quantity: i.quantity, size: i.size ?? null }));
        const kotItemMap = new Map(rawItems.map(i => [`${i.menuItemId}:${i.size ?? ''}`, { instructions: i.specialInstructions ?? null }]));

        let newItems = currentSnapshot.map(i => ({ ...i, instructions: kotItemMap.get(`${i.itemId}:${i.size ?? ''}`)?.instructions ?? null }));
        let modifiedItems: Array<import('./kotDelta').SnapshotItem & { previousQty: number; instructions?: string | null }> = [];
        let cancelledItems: import('./kotDelta').SnapshotItem[] = [];
        let isDelta = false;

        const lastSnapshot = order.lastKotSnapshot as import('./kotDelta').KotSnapshot | null;
        if (!reprint && lastSnapshot?.items?.length) {
          const delta = computeDelta(currentSnapshot, lastSnapshot.items);
          newItems = delta.newItems.map(ni => ({ ...ni, instructions: kotItemMap.get(`${ni.itemId}:${ni.size ?? ''}`)?.instructions ?? null }));
          modifiedItems = delta.modifiedItems.map(mi => ({ ...mi, instructions: kotItemMap.get(`${mi.itemId}:${mi.size ?? ''}`)?.instructions ?? null }));
          cancelledItems = delta.cancelledItems;
          isDelta = true;
        }

        const lines = kotTextLines({ orderNumber: order.orderNumber, tableNumber: order.tableNumber, isReprint: reprint, isDelta, newItems, modifiedItems, cancelledItems, kotSettings, width: W });
        return res.json({ lines, width: W });
      } else {
        const { bill: billSettings } = settings.printSettings;
        const rawItems = await db
          .select({ name: menuItems.name, quantity: orderItems.quantity, price: orderItems.price, size: orderItems.size, specialInstructions: orderItems.specialInstructions })
          .from(orderItems).innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id)).where(eq(orderItems.orderId, orderId));

        const lines = billTextLines({
          order: { orderNumber: order.orderNumber, tableNumber: order.tableNumber, customerName: order.customerName, orderType: order.orderType, totalAmount: order.totalAmount, taxAmount: order.taxAmount, discountAmount: order.discountAmount, paymentMethod: order.paymentMethod, billPrintCount: order.billPrintCount ?? 0, createdAt: order.createdAt },
          items: rawItems.map(i => ({ name: i.name, quantity: i.quantity, price: String(i.price), size: i.size ?? null, specialInstructions: i.specialInstructions ?? null })),
          restaurant: settings, billSettings, width: W,
        });
        return res.json({ lines, width: W });
      }
    } catch (err: any) {
      console.error('[Print/Preview]', err);
      res.status(500).json({ message: err.message || 'Preview failed' });
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
