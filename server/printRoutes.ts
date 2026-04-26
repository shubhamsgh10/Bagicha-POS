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
