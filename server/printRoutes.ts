import type { Express } from "express";
import { db } from "./db";
import { orders, orderItems, menuItems, kotTickets, printJobs } from "@shared/schema";
import { eq, asc, and, gt, or, lt, inArray, isNull, sql } from "drizzle-orm";
import { getSettings } from "./settingsStore";
import { computeDelta, type SnapshotItem, type KotSnapshot } from "@shared/kotDelta";
import {
  sendToPrinter,
  canExecutePrintOnServer,
} from "./printService";
import { toPrintJob } from "@shared/print/generators";
import { deriveBillTotals } from "@shared/orderPricing";
import { stripKitchenNotes } from "@shared/orderItemText";
import { formatISTDateTime } from "@shared/print/formatDate";
import { nonEscPosPrinterMessage, supportsRawEscPos } from "@shared/print/printerCapabilities";
import { runKotPrint, runBillPrint, instrumentJson } from "./services/printDispatch";
import { createStageTimer } from "@shared/printPerf";
import { parseBillRequestFlags } from "@shared/printRequest";
import * as E from "./escpos";

/** Claims older than this are considered abandoned (station crashed mid-print) and become reclaimable. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

function kotTextLines(params: {
  orderNumber: string;
  tableNumber: string | null;
  isReprint: boolean;
  isDelta: boolean;
  newItems: Array<{ name: string; quantity: number; size?: string | null; instructions?: string | null; serviceMode?: string | null; previousQty?: number }>;
  modifiedItems: Array<{ name: string; quantity: number; size?: string | null; previousQty: number; instructions?: string | null }>;
  cancelledItems: Array<{ name: string; quantity: number; size?: string | null }>;
  kotSettings: import("./settingsStore").KOTPrintSettings;
  width: number;
  kotNumber?: string | number;
}): string[] {
  const W = params.width;
  const M = 1;
  const div = (c: string) => c.repeat(W);
  const center = (s: string) => " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  const iW = W - 2 * M;
  const two = (l: string, r: string) =>
    " ".repeat(M) + l.substring(0, Math.max(1, iW - r.length - 1)).padEnd(Math.max(1, iW - r.length - 1)) + " " + r;
  const body = (s: string) => " ".repeat(M) + s;
  const lines: string[] = [];

  if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
    lines.push(center("** DUPLICATE **"), div("="));
  }

  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : "TAKEAWAY";
  lines.push(center(`[ ${tableHeader} ]`));
  lines.push(center(params.isDelta ? "MODIFIED KOT" : "KITCHEN ORDER"));
  lines.push(div("="));

  if (params.kotSettings.kotNumbering !== false) {
    const kotNum = String(params.kotNumber ?? 1).padStart(3, "0");
    const { dateStr, timeStr } = formatISTDateTime(new Date());
    lines.push(body(`KOT#: ${kotNum}   ${dateStr}   ${timeStr}`));
  }
  lines.push(div("-"));

  const renderKotItem = (item: (typeof params.newItems)[0]) => {
    const label = item.size ? `${item.name} (${item.size})` : item.name;
    const isIncrement = item.previousQty != null;
    const qty = isIncrement ? `[+${item.quantity}]` : `[ ${String(item.quantity).padStart(2, "0")} ]`;
    lines.push(body(`${qty}  ${label}`));
    if (isIncrement) {
      lines.push(body(`       now ${item.previousQty! + item.quantity} (was ${item.previousQty})`));
    }
    if (params.kotSettings.printAddons && item.instructions) {
      lines.push(body(`       >> ${item.instructions}`));
    }
  };

  const modeLabels: Record<string, string> = { dinein: '[DINE-IN]', pickup: '[PICKUP]', delivery: '[DELIVERY]' };
  const hasMixed = params.newItems.some(i => i.serviceMode && i.serviceMode !== 'dinein');
  if (hasMixed) {
    for (const mode of ['dinein', 'pickup', 'delivery']) {
      const group = params.newItems.filter(i => (i.serviceMode ?? 'dinein') === mode);
      if (group.length === 0) continue;
      lines.push(center(modeLabels[mode] ?? `[${mode.toUpperCase()}]`));
      group.forEach(renderKotItem);
    }
  } else {
    params.newItems.forEach(renderKotItem);
  }
  if (params.kotSettings.printModifiedItemsOnly) {
    for (const item of params.modifiedItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, "0")} ]`;
      lines.push(two(`${qty}  ${label}`, `was ${item.previousQty}`));
      // Drift fix: generateKOTBuffer (the real hardware print) already shows this line
      // for modified items — this preview-only renderer was missing it, so the browser
      // preview didn't match what actually printed for any modified item carrying addons.
      if (params.kotSettings.printAddons && item.instructions) {
        lines.push(body(`       >> ${item.instructions}`));
      }
    }
  }
  if (params.kotSettings.printCancelledKOT && params.cancelledItems.length > 0) {
    lines.push(div("-"));
    for (const item of params.cancelledItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, "0")} ]`;
      lines.push(body(`** VOID **  ${qty}  ${label}`));
    }
  }
  const total = params.newItems.reduce((s, i) => s + i.quantity, 0);
  lines.push(div("="), center(`Total Items: ${total}`), div("="));
  return lines;
}

function billTextLines(params: {
  order: {
    orderNumber: string;
    tableNumber: string | null;
    customerName: string | null;
    orderType: string;
    totalAmount: string;
    taxAmount: string;
    discountAmount: string | null;
    subtotalAmount?: string | null;
    containerCharge?: string | null;
    paymentMethod: string | null;
    billPrintCount: number;
    kotPrintCount?: number;
    createdAt: Date | string;
  };
  items: Array<{ name: string; quantity: number; price: string; size?: string | null; specialInstructions?: string | null }>;
  restaurant: import("./settingsStore").RestaurantSettings;
  billSettings: import("./settingsStore").BillPrintSettings;
  width: number;
  cashierName?: string;
}): string[] {
  const W = params.width;
  const M = 1;
  const { order, items, restaurant, billSettings } = params;
  const sym = (restaurant.currencySymbol || "Rs.").replace("₹", "Rs.");
  const div = (c: string) => c.repeat(W);
  const center = (s: string) => " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
  const iW = W - 2 * M;
  const two = (l: string, r: string) =>
    " ".repeat(M) + l.substring(0, Math.max(1, iW - r.length - 1)).padEnd(Math.max(1, iW - r.length - 1)) + " " + r;
  const body = (s: string) => " ".repeat(M) + s;
  const lines: string[] = [];

  if (order.billPrintCount > 0 && billSettings.showDuplicate) { lines.push(center("** DUPLICATE **"), div("=")); }
  if (billSettings.showLogo) lines.push(center("[LOGO]"));
  lines.push(center(restaurant.restaurantName));
  if (restaurant.businessName) lines.push(center(restaurant.businessName));
  if (restaurant.gstNumber)    lines.push(center(`GST -${restaurant.gstNumber}`));
  if (restaurant.phone)        lines.push(center(`M - ${restaurant.phone}`));
  if (restaurant.address) {
    for (const seg of restaurant.address.split(",").map((s) => s.trim()).filter(Boolean)) {
      lines.push(center(seg.substring(0, W)));
    }
  }
  if (billSettings.showFssai && restaurant.fssaiNumber) lines.push(center(`FSSAI: ${restaurant.fssaiNumber}`));
  lines.push(div("="));

  if (billSettings.showNameField) {
    if (order.customerName?.trim()) {
      lines.push(body(`Name: ${order.customerName.trim()}`));
    } else {
      lines.push(body(`Name:${"_".repeat(Math.max(10, W - 2 * M - 5))}`));
    }
    lines.push("");
  }

  const { dateStr, timeStr } = formatISTDateTime(order.createdAt);
  const orderTypeLabel = order.orderType || (order.tableNumber ? "Dine In" : "Pick Up");
  lines.push(two(`Date: ${dateStr}`, orderTypeLabel));
  lines.push(body(timeStr));
  lines.push(two(`Cashier: ${params.cashierName ?? "Admin"}`, `Bill No.: ${order.orderNumber}`));
  lines.push(div("-"));

  const IW = W - 2 * M - 4 - 9 - 8 - 3;
  lines.push(body(`${"Item".padEnd(IW)} ${"Qty".padStart(4)} ${"Price".padStart(9)} ${"Amt".padStart(8)}`));
  lines.push(div("-"));

  let displayItems = items;
  if (billSettings.mergeDuplicateItems) {
    const map = new Map<string, typeof items[0] & { totalQty: number; totalAmt: number }>();
    for (const item of items) {
      const key = `${item.name}:${item.size ?? ""}`;
      const ex = map.get(key);
      if (ex) { ex.totalQty += item.quantity; ex.totalAmt += item.quantity * parseFloat(item.price); }
      else map.set(key, { ...item, totalQty: item.quantity, totalAmt: item.quantity * parseFloat(item.price) });
    }
    displayItems = Array.from(map.values()).map((i) => ({ ...i, quantity: i.totalQty, price: String(i.totalAmt / i.totalQty) }));
  }

  let totalQty = 0;
  for (const item of displayItems) {
    const fullName = item.size ? `${item.name} (${item.size})` : item.name;
    const unitPrice = parseFloat(item.price);
    E.wrapWords(fullName, IW).forEach((chunk, i) => {
      if (i === 0) {
        lines.push(body(`${chunk.padEnd(IW)} ${String(item.quantity).padStart(4)} ${unitPrice.toFixed(2).padStart(9)} ${(unitPrice * item.quantity).toFixed(2).padStart(8)}`));
      } else {
        lines.push(body(chunk));
      }
    });
    const billInstructions = stripKitchenNotes(item.specialInstructions);
    if (billSettings.showAddons && billInstructions) lines.push(body(`  [${billInstructions}]`));
    totalQty += item.quantity;
  }
  lines.push(div("-"));

  const { subtotal, discount, containerCharge, tax } = deriveBillTotals(order);
  const rawTotal = parseFloat(order.totalAmount);
  const rounded = Math.round(rawTotal);
  const roundOff = rounded - rawTotal;
  const cgstRate = restaurant.taxRate / 2;
  lines.push(two(`Total Qty: ${totalQty}`, `Sub Total ${subtotal.toFixed(2)}`));
  lines.push(two("", `CGST ${cgstRate}%  ${(tax / 2).toFixed(2)}`));
  lines.push(two("", `SGST ${cgstRate}%  ${(tax / 2).toFixed(2)}`));
  if (discount > 0) lines.push(two("", `Discount  -${discount.toFixed(2)}`));
  if (containerCharge > 0) lines.push(two("", `Container  ${containerCharge.toFixed(2)}`));
  if (billSettings.showRoundOff && Math.abs(roundOff) >= 0.005) lines.push(two("", `Round off  ${roundOff.toFixed(2)}`));
  lines.push(div("="));
  lines.push(two("", `Grand Total  ${sym}${rounded.toFixed(2)}`));
  lines.push(div("="));
  if (restaurant.footerNote) lines.push(center(restaurant.footerNote.substring(0, W)));
  return lines;
}

export function registerPrintRoutes(app: Express): void {
  app.post("/api/print/kot", requireAuth, async (req, res) => {
    try {
      const { orderId, reprint = false, auto = false } = req.body as {
        orderId: number;
        reprint?: boolean;
        auto?: boolean;
      };
      if (!orderId) return res.status(400).json({ message: "orderId is required" });

      const timer = createStageTimer();
      instrumentJson(res, timer, `kot order=${orderId}`);
      const result = await runKotPrint({ req, orderId, reprint, auto, timer });
      if (!result.ok) return res.status(result.status).json({ message: result.message });
      return res.json(result.body);
    } catch (err: any) {
      console.error("[Print/KOT]", err);
      res.status(500).json({ message: err.message || "KOT print failed" });
    }
  });

  app.post("/api/print/bill", requireAuth, async (req, res) => {
    try {
      const { orderId } = req.body as { orderId: number };
      if (!orderId) return res.status(400).json({ message: "orderId is required" });

      const timer = createStageTimer();
      instrumentJson(res, timer, `bill order=${orderId}`);
      const { withKotCatchUp, markBilled } = parseBillRequestFlags(req.body);
      const result = await runBillPrint({ req, orderId, timer, withKotCatchUp, markBilled });
      if (!result.ok) return res.status(result.status).json({ message: result.message });
      return res.json(result.body);
    } catch (err: any) {
      // Log the stack, not the error object: it may carry kotCatchUp (with base64 ESC/POS payloads).
      console.error("[Print/Bill]", err?.stack ?? err?.message ?? err);
      // The KOT catch-up may already have committed before the bill half failed — hand its
      // result back so the client can still show/send those items.
      res.status(500).json({
        message: err.message || "Bill print failed",
        ...(err?.kotCatchUp ? { kotCatchUp: err.kotCatchUp } : {}),
      });
    }
  });

  app.post("/api/print/jobs/:id/claim", requireAuth, async (req, res) => {
    try {
      const jobId = Number(req.params.id);
      if (!jobId) return res.status(400).json({ message: "Invalid job id" });

      const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS);
      const [claimed] = await db
        .update(printJobs)
        .set({ status: "claimed", claimedAt: new Date() })
        .where(
          and(
            eq(printJobs.id, jobId),
            or(
              eq(printJobs.status, "pending"),
              // Stale claim: the claiming station crashed before printing — reclaimable.
              and(
                eq(printJobs.status, "claimed"),
                or(isNull(printJobs.claimedAt), lt(printJobs.claimedAt, staleCutoff)),
              ),
            ),
          ),
        )
        .returning();

      if (!claimed) return res.json({ claimed: false });
      return res.json({
        claimed: true,
        job: {
          jobId: claimed.id,
          orderId: claimed.orderId,
          jobType: claimed.jobType,
          printerId: claimed.printerId,
          payload: claimed.payload,
        },
      });
    } catch (err: any) {
      console.error("[Print/JobClaim]", err);
      res.status(500).json({ message: err.message || "Claim failed" });
    }
  });

  app.get("/api/print/jobs/pending", requireAuth, async (req, res) => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS);
      const printerFilter = String(req.query.printerId ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const base = and(
        gt(printJobs.createdAt, cutoff),
        or(
          eq(printJobs.status, "pending"),
          // Include stale claims so a healthy station can rescue a crashed one's jobs.
          and(
            eq(printJobs.status, "claimed"),
            or(isNull(printJobs.claimedAt), lt(printJobs.claimedAt, staleCutoff)),
          ),
        ),
      );
      const whereClause = printerFilter.length > 0
        ? and(base, inArray(printJobs.printerId, printerFilter))
        : base;

      const rows = await db
        .select()
        .from(printJobs)
        .where(whereClause)
        .orderBy(asc(printJobs.id));
      return res.json({
        jobs: rows.map((r) => ({
          jobId: r.id,
          orderId: r.orderId,
          jobType: r.jobType,
          printerId: r.printerId,
          payload: r.payload,
        })),
      });
    } catch (err: any) {
      console.error("[Print/JobsPending]", err);
      res.status(500).json({ message: err.message || "Failed to list pending jobs" });
    }
  });

  app.post("/api/print/jobs/:id/release", requireAuth, async (req, res) => {
    try {
      const jobId = Number(req.params.id);
      if (!jobId) return res.status(400).json({ message: "Invalid job id" });
      const { error } = (req.body ?? {}) as { error?: string };

      const [released] = await db
        .update(printJobs)
        .set({ status: "pending", claimedAt: null, error: error ? String(error).slice(0, 500) : null })
        .where(and(eq(printJobs.id, jobId), eq(printJobs.status, "claimed")))
        .returning();

      return res.json({ released: !!released });
    } catch (err: any) {
      console.error("[Print/JobRelease]", err);
      res.status(500).json({ message: err.message || "Release failed" });
    }
  });

  app.post("/api/print/ack", requireAuth, async (req, res) => {
    try {
      const { orderId, type, jobId } = req.body as { orderId: number; type: "kot" | "bill"; jobId?: number };
      if (!orderId || !type) return res.status(400).json({ message: "orderId and type are required" });

      if (jobId) {
        // Order state (KOT snapshot / print counts) was already committed at dispatch —
        // a jobId ack only records that this specific ticket physically printed.
        await db
          .update(printJobs)
          .set({ status: "printed", printedAt: new Date() })
          .where(eq(printJobs.id, jobId));
        return res.json({ ok: true, type, jobId });
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (type === "bill") {
        await db
          .update(orders)
          .set({ billPrintCount: sql`${orders.billPrintCount} + 1` })
          .where(eq(orders.id, orderId));
        return res.json({ ok: true, type: "bill" });
      }

      const rawItems = await db
        .select({
          menuItemId: orderItems.menuItemId,
          name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
          quantity: orderItems.quantity,
          size: orderItems.size,
          serviceMode: orderItems.serviceMode,
        })
        .from(orderItems)
        .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .where(eq(orderItems.orderId, orderId));

      const currentSnapshot: SnapshotItem[] = rawItems.map((i) => ({
        itemId: i.menuItemId,
        name: i.name,
        quantity: i.quantity,
        size: i.size ?? null,
        serviceMode: i.serviceMode ?? null,
      }));

      await db
        .update(orders)
        .set({
          kotPrintCount: sql`${orders.kotPrintCount} + 1`,
          lastKotSnapshot: { items: currentSnapshot, printedAt: new Date().toISOString() },
        })
        .where(eq(orders.id, orderId));

      return res.json({ ok: true, type: "kot" });
    } catch (err: any) {
      console.error("[Print/Ack]", err);
      res.status(500).json({ message: err.message || "Print ack failed" });
    }
  });

  app.post("/api/print/preview", requireAuth, async (req, res) => {
    try {
      const { type, orderId, reprint = false } = req.body as {
        type: "kot" | "bill";
        orderId: number;
        reprint?: boolean;
      };
      if (!orderId || !type) return res.status(400).json({ message: "type and orderId are required" });

      const settings = getSettings();
      const W = 48;

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (type === "kot") {
        const { kot: kotSettings } = settings.printSettings;
        const rawItems = await db
          .select({
            menuItemId: orderItems.menuItemId,
            name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
            quantity: orderItems.quantity,
            size: orderItems.size,
            specialInstructions: orderItems.specialInstructions,
            serviceMode: orderItems.serviceMode,
          })
          .from(orderItems)
          .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
          .where(eq(orderItems.orderId, orderId));

        const currentSnapshot: SnapshotItem[] = rawItems.map((i) => ({
          itemId: i.menuItemId,
          name: i.name,
          quantity: i.quantity,
          size: i.size ?? null,
          serviceMode: i.serviceMode ?? null,
        }));
        const kotItemMap = new Map(
          rawItems.map((i) => [`${i.menuItemId}:${i.size ?? ""}:${i.serviceMode ?? ""}`, { instructions: i.specialInstructions ?? null, serviceMode: i.serviceMode ?? null }]),
        );

        let newItems = currentSnapshot.map((i) => ({
          ...i,
          instructions: kotItemMap.get(`${i.itemId}:${i.size ?? ""}:${i.serviceMode ?? ""}`)?.instructions ?? null,
        }));
        let modifiedItems: Array<SnapshotItem & { previousQty: number; instructions?: string | null }> = [];
        let cancelledItems: SnapshotItem[] = [];
        let isDelta = false;

        const lastSnapshot = order.lastKotSnapshot as KotSnapshot | null;
        if (!reprint && lastSnapshot?.items?.length) {
          const delta = computeDelta(currentSnapshot, lastSnapshot.items);
          newItems = delta.newItems.map((ni) => ({
            ...ni,
            instructions: kotItemMap.get(`${ni.itemId}:${ni.size ?? ""}:${ni.serviceMode ?? ""}`)?.instructions ?? null,
          }));
          modifiedItems = delta.modifiedItems.map((mi) => ({
            ...mi,
            instructions: kotItemMap.get(`${mi.itemId}:${mi.size ?? ""}:${mi.serviceMode ?? ""}`)?.instructions ?? null,
          }));
          cancelledItems = delta.cancelledItems;
          isDelta = true;
        }

        // Fetch KOT tickets for this order to retrieve the sequential KOT number
        const orderKotTickets = await db
          .select()
          .from(kotTickets)
          .where(eq(kotTickets.orderId, orderId))
          .orderBy(asc(kotTickets.id));

        const kotNumStr = orderKotTickets.length > 0
          ? (reprint ? orderKotTickets[0].kotNumber : orderKotTickets[orderKotTickets.length - 1].kotNumber)
          : String((order.kotPrintCount ?? 0) + 1);

        const lines = kotTextLines({
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          kotNumber: kotNumStr,
          isReprint: reprint,
          isDelta,
          newItems,
          modifiedItems,
          cancelledItems,
          kotSettings,
          width: W,
        });
        return res.json({ lines, width: W });
      }

      const { bill: billSettings } = settings.printSettings;
      const rawItems = await db
        .select({
          name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
          quantity: orderItems.quantity,
          price: orderItems.price,
          size: orderItems.size,
          specialInstructions: orderItems.specialInstructions,
        })
        .from(orderItems)
        .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .where(eq(orderItems.orderId, orderId));

      const lines = billTextLines({
        order: {
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          customerName: order.customerName,
          orderType: order.orderType,
          totalAmount: order.totalAmount,
          taxAmount: order.taxAmount,
          discountAmount: order.discountAmount,
          subtotalAmount: order.subtotalAmount,
          containerCharge: order.containerCharge,
          paymentMethod: order.paymentMethod,
          billPrintCount: order.billPrintCount ?? 0,
          kotPrintCount: order.kotPrintCount ?? 0,
          createdAt: order.createdAt,
        },
        items: rawItems.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          price: String(i.price),
          size: i.size ?? null,
          specialInstructions: i.specialInstructions ?? null,
        })),
        restaurant: settings,
        billSettings,
        cashierName: order.createdByName ?? (req.user as any)?.username ?? "Admin",
        width: W,
      });
      return res.json({ lines, width: W });
    } catch (err: any) {
      console.error("[Print/Preview]", err);
      res.status(500).json({ message: err.message || "Preview failed" });
    }
  });

  app.post("/api/print/test", requireAdmin, async (req, res) => {
    try {
      const { printerId } = req.body as { printerId: string };
      const settings = getSettings();
      const printer = settings.printSettings.printers.find((p) => p.id === printerId);
      if (!printer) return res.status(404).json({ message: "Printer not found in registry" });

      const W = printer.width ?? 32;
      const buffer = E.build(
        E.INIT,
        E.ALIGN_CENTER,
        E.BOLD_ON,
        E.line("TEST PRINT"),
        E.BOLD_OFF,
        E.divider("-", W),
        E.centered(printer.name, W),
        E.centered(new Date().toLocaleString("en-IN"), W),
        E.divider("=", W),
        E.centered("Printer is working correctly!", W),
        E.feed(3),
        E.CUT,
      );

      const escPosOk = supportsRawEscPos(printer);

      if (canExecutePrintOnServer() && printer.type !== "usb" && escPosOk) {
        await sendToPrinter(printer, buffer);
        return res.json({ success: true, message: `Test page sent to "${printer.name}"` });
      }

      if (canExecutePrintOnServer() && printer.type !== "usb" && !escPosOk) {
        return res.status(400).json({
          success: false,
          message: nonEscPosPrinterMessage(printer),
        });
      }

      return res.json({
        success: true,
        printJob: escPosOk ? toPrintJob(printer.id, buffer) : undefined,
        message: escPosOk
          ? "Test print job ready for local execution"
          : nonEscPosPrinterMessage(printer),
      });
    } catch (err: any) {
      console.error("[Print/Test]", err);
      res.status(500).json({ message: err.message || "Test print failed" });
    }
  });
}
