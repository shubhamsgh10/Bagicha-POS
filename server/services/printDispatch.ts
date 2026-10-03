import type { Request } from "express";
import { db } from "../db";
import { orders, orderItems, menuItems, kotTickets, printJobs } from "@shared/schema";
import { eq, asc, inArray, sql } from "drizzle-orm";
import type { PrinterConfig } from "@shared/print/types";
import { getSettings } from "../settingsStore";
import { computeDelta, type SnapshotItem, type KotSnapshot } from "@shared/kotDelta";
import {
  generateKOTBuffer,
  generateBillBuffer,
  sendToPrinter,
  canExecutePrintOnServer,
} from "../printService";
import { toPrintJob } from "@shared/print/generators";
import { nonEscPosPrinterMessage, supportsRawEscPos } from "@shared/print/printerCapabilities";
import { storage } from "../storage";
import { publishRealtime, publishRealtimeMany } from "../realtime/publisher";
import {
  executePrintStep,
  isSkippableKotResult,
  shouldMarkBilled,
  type MarkBilled,
  type PrintMode,
} from "@shared/printRequest";
import { logAudit } from "./auditService";
import { createStageTimer, type StageTimer } from "@shared/printPerf";

/**
 * The KOT / Bill print pipeline, extracted from printRoutes.ts so ONE request can run it —
 * both the standalone /api/print/* routes and (Phase 2) the order-save routes call these.
 * Response bodies are exactly what client/src/lib/printGateway.ts's handlePrintResponse
 * consumes; do not change their shape without updating that function.
 */
export type PrintResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; message: string };

type OrderRow = typeof orders.$inferSelect;

/**
 * Wraps res.json ONCE so every return path of a handler emits the Server-Timing header
 * and the [print-perf] log line — no per-return-site edits.
 */
export function instrumentJson(res: any, timer: StageTimer, label: string): void {
  const original = res.json.bind(res);
  res.json = (body: unknown) => {
    if (!res.headersSent) res.setHeader("Server-Timing", timer.toServerTiming());
    console.log(timer.toLogLine(label));
    return original(body);
  };
}

/**
 * Persists ALL of one tap's print_jobs rows in ONE multi-row INSERT and broadcasts them as ONE
 * Pusher batch. Returns printerId → job id (a tap never routes two jobs to the same printer).
 */
async function dispatchRemotePrintJobs(
  jobs: Array<{ orderId: number; jobType: "kot" | "bill"; printerId: string; payload: string }>,
  timer: StageTimer,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (jobs.length === 0) return ids;
  const rows = await timer.time("insert_job", () => db.insert(printJobs).values(jobs).returning());
  for (const r of rows) ids.set(r.printerId, r.id);
  await timer.time("pusher", () =>
    publishRealtimeMany(
      rows.map((r) => ({
        type: "PRINT_JOB",
        jobId: r.id,
        orderId: r.orderId,
        jobType: r.jobType,
        printerId: r.printerId,
        payload: r.payload,
      })),
    ),
  );
  return ids;
}

/**
 * Returns `{ ok: false }` only for a missing order (404). THROWS on a DB failure or when every
 * direct printer failed — a caller that runs after an already-committed write must catch (see
 * runPrintStep / executePrintStep).
 */
export async function runKotPrint(p: {
  req: Request;
  orderId: number;
  reprint?: boolean;
  auto?: boolean;
  /** The order row just written by a save-with-print — skips the db_order read. */
  order?: OrderRow;
  timer?: StageTimer;
}): Promise<PrintResult> {
  const { req, orderId, reprint = false, auto = false } = p;
  const timer = p.timer ?? createStageTimer();

  const settings = getSettings();
  const { kot: kotSettings, printers } = settings.printSettings;

  if (!kotSettings.enabled) {
    return { ok: true, body: { printed: false, reason: "kot_disabled" } };
  }

  // The three reads are independent (all keyed by orderId) — run them concurrently so the
  // tap waits for the slowest of the three round trips, not their sum.
  const [[order], rawItems, orderKotTickets] = await Promise.all([
    p.order
      ? Promise.resolve([p.order])
      : timer.time("db_order", () => db.select().from(orders).where(eq(orders.id, orderId))),
    timer.time("db_items", () =>
      db
        .select({
          menuItemId: orderItems.menuItemId,
          categoryId: menuItems.categoryId,
          name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
          quantity: orderItems.quantity,
          size: orderItems.size,
          specialInstructions: orderItems.specialInstructions,
          serviceMode: orderItems.serviceMode,
        })
        .from(orderItems)
        .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
        .where(eq(orderItems.orderId, orderId)),
    ),
    timer.time("db_tickets", () =>
      db.select().from(kotTickets).where(eq(kotTickets.orderId, orderId)).orderBy(asc(kotTickets.id)),
    ),
  ]);
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  const currentSnapshot: SnapshotItem[] = rawItems.map((i) => ({
    itemId: i.menuItemId,
    name: i.name,
    quantity: i.quantity,
    size: i.size ?? null,
    serviceMode: i.serviceMode ?? null,
  }));

  const kotItemMap = new Map(
    rawItems.map((i) => [
      `${i.menuItemId}:${i.size ?? ""}:${i.serviceMode ?? ""}`,
      { name: i.name, quantity: i.quantity, size: i.size ?? null, instructions: i.specialInstructions ?? null, serviceMode: i.serviceMode ?? null },
    ]),
  );

  let newItems: Array<SnapshotItem & { instructions?: string | null; previousQty?: number }> = currentSnapshot.map((i) => ({
    ...i,
    instructions: kotItemMap.get(`${i.itemId}:${i.size ?? ""}:${i.serviceMode ?? ""}`)?.instructions ?? null,
  }));
  let modifiedItems: Array<SnapshotItem & { previousQty: number; instructions?: string | null }> = [];
  let cancelledItems: SnapshotItem[] = [];
  let isDelta = false;

  const lastSnapshot = order.lastKotSnapshot as KotSnapshot | null;

  if (!reprint && lastSnapshot?.items?.length) {
    const delta = computeDelta(currentSnapshot, lastSnapshot.items);
    const hasNew = delta.newItems.length > 0;
    const hasMod =
      kotSettings.printModifiedKOT &&
      kotSettings.printModifiedItemsOnly &&
      delta.modifiedItems.length > 0;
    const hasCancelled = kotSettings.printCancelledKOT && delta.cancelledItems.length > 0;

    if (!hasNew && !hasMod && !hasCancelled) {
      return { ok: true, body: { printed: false, reason: "no_delta" } };
    }

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

  const printer = printers.find((pr) => pr.id === kotSettings.kotPrinterId);

  if (!printer) {
    if (auto) {
      return { ok: true, body: { printed: false, reason: "no_hardware_printer" } };
    }
    // Fetch KOT tickets to get the real sequential KOT number for the browser preview
    const browserKotTickets = orderKotTickets;
    const browserKotNum = browserKotTickets.length > 0
      ? (reprint ? browserKotTickets[0].kotNumber : browserKotTickets[browserKotTickets.length - 1].kotNumber)
      : undefined;
    if (!reprint) {
      await timer.time("commit", () =>
        db
          .update(orders)
          .set({
            kotPrintCount: sql`${orders.kotPrintCount} + 1`,
            lastKotSnapshot: { items: currentSnapshot, printedAt: new Date().toISOString() },
          })
          .where(eq(orders.id, orderId)),
      );
    } else {
      // A genuine KOT reprint — deliberately NOT counted by kotPrintCount (that
      // increment is skipped above `if (!reprint)`), so this audit row is the ONLY
      // durable trace a reprint happened here, with actor+timestamp for Reports.tsx's
      // KOT & Bill Activity tab.
      logAudit(req, "kot.reprint", "order", orderId, { kotNumber: browserKotNum });
    }
    return {
      ok: true,
      body: {
        browserPrint: true,
        isDelta,
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        kotNumber: browserKotNum,
        items: newItems.map((i) => ({ name: i.name, quantity: i.quantity, size: i.size, serviceMode: i.serviceMode })),
      },
    };
  }

  const kotNumStr = orderKotTickets.length > 0
    ? (reprint ? orderKotTickets[0].kotNumber : orderKotTickets[orderKotTickets.length - 1].kotNumber)
    : String((order.kotPrintCount ?? 0) + 1);

  // ── Category → printer routing (multi-section KOT split) ────────────────
  const overrides = kotSettings.categoryPrinterOverrides ?? {};
  const catByItemId = new Map<number, number | null>(
    rawItems.map((i) => [i.menuItemId, i.categoryId ?? null]),
  );
  const routedItemIds = [...newItems, ...modifiedItems, ...cancelledItems].map((i) => i.itemId);
  const missingCatIds = Array.from(new Set(routedItemIds.filter((id) => !catByItemId.has(id))));
  if (missingCatIds.length > 0) {
    // Cancelled items may no longer be in the order — resolve their categories directly.
    const rows = await timer.time("db_cat", () =>
      db
        .select({ id: menuItems.id, categoryId: menuItems.categoryId })
        .from(menuItems)
        .where(inArray(menuItems.id, missingCatIds)),
    );
    for (const r of rows) catByItemId.set(r.id, r.categoryId ?? null);
  }
  const resolveKotPrinter = (itemId: number): PrinterConfig => {
    const catId = catByItemId.get(itemId);
    const overrideId = catId != null ? overrides[String(catId)] : null;
    return (overrideId ? printers.find((pr) => pr.id === overrideId) : undefined) ?? printer;
  };

  type RoutedGroup = {
    printer: PrinterConfig;
    newItems: typeof newItems;
    modifiedItems: typeof modifiedItems;
    cancelledItems: typeof cancelledItems;
  };
  const groups = new Map<string, RoutedGroup>();
  const groupFor = (pr: PrinterConfig): RoutedGroup => {
    let g = groups.get(pr.id);
    if (!g) {
      g = { printer: pr, newItems: [], modifiedItems: [], cancelledItems: [] };
      groups.set(pr.id, g);
    }
    return g;
  };
  for (const it of newItems) groupFor(resolveKotPrinter(it.itemId)).newItems.push(it);
  for (const it of modifiedItems) groupFor(resolveKotPrinter(it.itemId)).modifiedItems.push(it);
  for (const it of cancelledItems) groupFor(resolveKotPrinter(it.itemId)).cancelledItems.push(it);
  if (groups.size === 0) groupFor(printer);

  const commitKotState = async () => {
    if (!reprint) {
      await db
        .update(orders)
        .set({
          kotPrintCount: sql`${orders.kotPrintCount} + 1`,
          lastKotSnapshot: { items: currentSnapshot, printedAt: new Date().toISOString() },
        })
        .where(eq(orders.id, orderId));
    }
  };

  const browserItems = newItems.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    size: i.size,
    serviceMode: (i as any).serviceMode ?? null,
  }));

  // One ticket per routed printer — same KOT number on every ticket.
  const kotJobs = await timer.time("build", async () =>
    Array.from(groups.values()).map((g) => ({
      printer: g.printer,
      escPosOk: supportsRawEscPos(g.printer),
      buffer: generateKOTBuffer({
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        kotNumber: kotNumStr,
        isReprint: reprint,
        isDelta,
        newItems: g.newItems,
        modifiedItems: g.modifiedItems,
        cancelledItems: g.cancelledItems,
        kotSettings,
        width: g.printer.width ?? 48,
      }),
    })),
  );

  const directJobs = kotJobs.filter((j) => canExecutePrintOnServer() && j.escPosOk && j.printer.type !== "usb");
  const remoteJobs = kotJobs.filter((j) => j.escPosOk && !(canExecutePrintOnServer() && j.printer.type !== "usb"));
  const nonEscPosJobs = kotJobs.filter((j) => !j.escPosOk);

  // Direct hardware sends — each printer is an independent physical device, so one
  // printer being offline/misconfigured must not stop the OTHER printers (direct or
  // remote-dispatched below) from getting their ticket. Previously a bare
  // `for (...) await sendToPrinter(...)` let the first throw abort the whole handler
  // — e.g. a mixed South-Indian/Chinese order would lose BOTH tickets if only the
  // South-Indian printer was offline, even though the Chinese-counter printer (and
  // any remote-dispatched printer) was perfectly reachable.
  const directFailures: { printer: PrinterConfig; error: string }[] = [];
  for (const j of directJobs) {
    try {
      await timer.time("direct_send", () => sendToPrinter(j.printer, j.buffer));
    } catch (err: any) {
      console.error(`[Print/KOT] direct send failed for printer ${j.printer.id}:`, err);
      directFailures.push({ printer: j.printer, error: err?.message || String(err) });
    }
  }

  const jobIds = await dispatchRemotePrintJobs(
    remoteJobs.map((j) => ({ orderId, jobType: "kot" as const, printerId: j.printer.id, payload: j.buffer.toString("base64") })),
    timer,
  );
  const dispatchedJobs = remoteJobs.map((j) =>
    toPrintJob(j.printer.id, j.buffer, { orderId, ackType: "kot", jobId: jobIds.get(j.printer.id) }),
  );

  // If literally nothing went out (every direct printer failed and there's nothing
  // dispatched/non-ESC-POS to fall back on), keep the existing full-failure behavior
  // — throw so the client gets its "KOT print failed" toast + preview fallback.
  if (directFailures.length > 0 && directFailures.length === directJobs.length
    && dispatchedJobs.length === 0 && nonEscPosJobs.length === 0) {
    throw new Error(`Printer error: ${directFailures.map((f) => f.error).join("; ")}`);
  }

  // Commit once per tap — payloads are frozen in print_jobs, so late printing stays
  // correct and acks only flip job rows (no double-increment across multiple tickets).
  // Commit even on a partial direct failure: the printers that DID succeed already
  // printed this delta, so a retry must not re-send it to them.
  await timer.time("commit", commitKotState);
  if (reprint) {
    // Same reasoning as the browser-fallback branch above — kotPrintCount's
    // increment inside commitKotState() is skipped on reprint, so this is the only
    // durable trace. One row per tap (not per routed printer) — the ticket is the
    // same reprinted KOT regardless of how many physical printers it fans out to.
    logAudit(req, "kot.reprint", "order", orderId, { kotNumber: kotNumStr });
  }

  const failureMessage = directFailures.length > 0
    ? `Printer error on ${directFailures.map((f) => f.printer.name ?? f.printer.id).join(", ")}: ${directFailures[0].error}`
    : undefined;

  if (dispatchedJobs.length === 0 && nonEscPosJobs.length === 0) {
    // Some direct printers succeeded (the all-failed case threw above) — report
    // success but surface which printer(s) still need attention.
    return { ok: true, body: { printed: true, isDelta, reprint, message: failureMessage } };
  }

  const allNonEscPos = nonEscPosJobs.length === kotJobs.length;
  return {
    ok: true,
    body: {
      printed: false,
      dispatched: dispatchedJobs.length > 0,
      printJob: dispatchedJobs[0],
      printJobs: dispatchedJobs.length > 0 ? dispatchedJobs : undefined,
      browserPrint: allNonEscPos,
      reason: allNonEscPos ? "non_escpos_printer" : undefined,
      message: nonEscPosJobs.length > 0 ? nonEscPosPrinterMessage(nonEscPosJobs[0].printer) : failureMessage,
      pendingAck: dispatchedJobs.length > 0 && !reprint,
      orderId,
      isDelta,
      reprint,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      items: browserItems,
    },
  };
}

type KotCatchUp = Record<string, unknown> | { error: string };

/**
 * The silent "kitchen-first" catch-up that used to be a separate client call before every bill:
 * run the normal KOT delta check and surface the result ONLY when it actually did something
 * (a genuine send, a browser-preview fallback, or a failure). Never throws.
 */
async function runKotCatchUp(req: Request, orderId: number, timer: StageTimer): Promise<KotCatchUp | undefined> {
  try {
    const k = await runKotPrint({ req, orderId, reprint: false, auto: false, timer });
    if (!k.ok) return { error: k.message };
    return isSkippableKotResult(k.body) ? undefined : k.body;
  } catch (err: any) {
    console.error("[Print/Bill] KOT catch-up failed:", err);
    return { error: err?.message || "KOT print failed" };
  }
}

/** Server-side replacement for POST /api/orders/:id/bill-requested. Non-fatal by design. */
async function markTableBilled(order: OrderRow): Promise<void> {
  if (!order.tableId) return;
  try {
    await storage.updateTableStatus(Number(order.tableId), "billed");
    await publishRealtime({ type: "TABLE_UPDATE" });
  } catch (err) {
    console.error("[Print/Bill] table → billed flip failed (non-fatal):", err);
  }
}

/**
 * Returns `{ ok: false }` only for a missing order (404). THROWS on a DB failure or when every
 * direct printer failed — a caller that runs after an already-committed write must catch (see
 * runPrintStep / executePrintStep).
 */
export async function runBillPrint(p: {
  req: Request;
  orderId: number;
  timer?: StageTimer;
  /** Run the silent KOT delta check first (what the client used to do in a separate call). */
  withKotCatchUp?: boolean;
  /** Flip the table to "billed" after the print (what the client used to do in a separate call). */
  markBilled?: MarkBilled | null;
  /**
   * The order row just written by a save-with-print — skips the bill's db_order read. Safe even
   * with a catch-up: the bill renders no column the catch-up writes (see the comment below).
   */
  order?: OrderRow;
}): Promise<PrintResult> {
  const { req, orderId } = p;
  const timer = p.timer ?? createStageTimer();

  // Kitchen-first, always (when asked): anything added since the last KOT reaches the kitchen
  // in the same request as the bill — a safety net that now costs zero extra round trips.
  //
  // The bill's own reads (order row + items) run CONCURRENTLY with the catch-up, not after it.
  // Safe because the two touch disjoint data: the catch-up only writes print_jobs and the order's
  // kotPrintCount / lastKotSnapshot (and reads kot_tickets / order_items); the bill renders from
  // order_items (which the catch-up never writes) and from order columns the catch-up never
  // changes — isReprint comes from billPrintCount, and kotPrintCount is passed to
  // generateBillBuffer's order type but never printed. Kitchen-first ordering is kept where it
  // matters: nothing of the bill is dispatched until the catch-up has fully finished.
  const catchUpPromise: Promise<KotCatchUp | undefined> = p.withKotCatchUp
    ? runKotCatchUp(req, orderId, timer.scoped("kot"))
    : Promise.resolve(undefined);
  const readsPromise = readBillData(orderId, timer, p.order);
  // allSettled, not all: a rejected bill read must never orphan an in-flight (or already
  // committed) catch-up — wait for both, keep the catch-up result, then rethrow the read error
  // below with the catch-up attached.
  const [catchUpRes, readsRes] = await Promise.allSettled([catchUpPromise, readsPromise]);
  const kotCatchUp: KotCatchUp | undefined =
    catchUpRes.status === "fulfilled"
      ? catchUpRes.value
      : { error: (catchUpRes.reason as any)?.message || "KOT print failed" }; // runKotCatchUp never throws; defensive

  try {
    if (readsRes.status === "rejected") throw readsRes.reason;
    return await runBillAfterCatchUp(p, timer, kotCatchUp, readsRes.value);
  } catch (err) {
    // The catch-up may already have COMMITTED (kotPrintCount / lastKotSnapshot) — if the bill half
    // then fails, the caller must still get the KOT result (dispatched jobs or a browser-preview
    // payload), or those items would silently never reach the kitchen (a retry finds no_delta).
    if (kotCatchUp) {
      const e: any = err && typeof err === "object" ? err : new Error(String(err));
      e.kotCatchUp = kotCatchUp;
      throw e;
    }
    throw err;
  }
}

/**
 * The bill's two reads (order row + items), in parallel. Started alongside the KOT catch-up.
 * A preloaded order row (from the save that precedes this print) replaces the db_order read;
 * the items are always read.
 */
async function readBillData(orderId: number, timer: StageTimer, preloaded?: OrderRow) {
  const orderRead: Promise<OrderRow[]> = preloaded
    ? Promise.resolve([preloaded])
    : timer.time("db_order", () => db.select().from(orders).where(eq(orders.id, orderId)));
  const itemsRead = timer.time("db_items", () =>
    db
      .select({
        name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
        quantity: orderItems.quantity,
        price: orderItems.price,
        size: orderItems.size,
        specialInstructions: orderItems.specialInstructions,
        categoryId: menuItems.categoryId,
      })
      .from(orderItems)
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(eq(orderItems.orderId, orderId)),
  );
  const [[order], rawItems] = await Promise.all([orderRead, itemsRead]);
  return { order: order as OrderRow | undefined, rawItems };
}

/** The bill half of runBillPrint — everything after the optional KOT catch-up and the reads. */
async function runBillAfterCatchUp(
  p: { req: Request; orderId: number; markBilled?: MarkBilled | null },
  timer: StageTimer,
  kotCatchUp: KotCatchUp | undefined,
  data: Awaited<ReturnType<typeof readBillData>>,
): Promise<PrintResult> {
  const { req, orderId } = p;
  const settings = getSettings();
  const { bill: billSettings, printers } = settings.printSettings;
  const { order, rawItems } = data;
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  /** Every success exit goes through here: attach the catch-up result, then the optional flip. */
  const done = async (body: Record<string, unknown>): Promise<PrintResult> => {
    if (kotCatchUp) body.kotCatchUp = kotCatchUp;
    if (shouldMarkBilled(p.markBilled ?? null, body as { printed?: boolean; dispatched?: boolean })) {
      await timer.time("mark_billed", () => markTableBilled(order));
    }
    return { ok: true, body };
  };

  // Bills have no client-supplied `reprint` flag (unlike /api/print/kot) — every
  // request sends an identical {orderId} body. billPrintCount>0 (read BEFORE this
  // request's own increment) is the only signal for "has this bill already gone
  // out" — the exact same signal billTextLines/generateBillBuffer already use for
  // the "** DUPLICATE **" watermark, so this new audit signal and that watermark can
  // never disagree.
  const isReprint = (order.billPrintCount ?? 0) > 0;

  // Per-section bill routing. Prefer the explicit marker stamped at creation
  // (orders.posSectionId, set by the quick-POS); fall back to the all-items-in-one-
  // section categories rule for legacy/untagged orders.
  const sections = settings.posSections ?? [];
  const taggedSection = order.posSectionId
    ? sections.find((s) => s.id === order.posSectionId && s.billPrinterId)
    : undefined;
  const itemCatIds = rawItems.map((i) => i.categoryId).filter((c): c is number => c != null);
  const inferredSection = itemCatIds.length > 0
    ? sections.find(
        (s) => s.billPrinterId && itemCatIds.every((c) => s.categoryIds.includes(c)),
      )
    : undefined;
  const billSection = taggedSection ?? inferredSection;
  const printer =
    (billSection?.billPrinterId
      ? printers.find((pr) => pr.id === billSection.billPrinterId)
      : undefined) ?? printers.find((pr) => pr.id === billSettings.billPrinterId);

  if (!printer) {
    await timer.time("commit", () =>
      db
        .update(orders)
        .set({ billPrintCount: sql`${orders.billPrintCount} + 1` })
        .where(eq(orders.id, orderId)),
    );
    if (isReprint) logAudit(req, "bill.reprint", "order", orderId, {});
    return done({ browserPrint: true });
  }

  const buffer = await timer.time("build", async () =>
    generateBillBuffer({
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
      width: printer.width ?? 48,
    }),
  );

  const commitBillState = async () => {
    await db
      .update(orders)
      .set({ billPrintCount: sql`${orders.billPrintCount} + 1` })
      .where(eq(orders.id, orderId));
    // Covers all 3 dispatch branches below that call this closure (hardware,
    // non-ESC-POS browser fallback, remote-to-desktop) in one place — the 4th branch
    // (no printer configured at all, above) logs it inline since it commits before
    // this closure is even defined.
    if (isReprint) logAudit(req, "bill.reprint", "order", orderId, {});
  };

  const escPosOk = supportsRawEscPos(printer);

  if (canExecutePrintOnServer() && escPosOk && printer.type !== "usb") {
    await timer.time("direct_send", () => sendToPrinter(printer, buffer));
    await timer.time("commit", commitBillState);
    return done({ printed: true });
  }

  if (canExecutePrintOnServer() && !escPosOk && printer.type !== "usb") {
    // Same reasoning as the "no printer configured" branch above: a browser print's
    // outcome can never be confirmed back to the server (no client call-back exists
    // for it), so billPrintCount can only ever count requests, not confirmed
    // successes, for this fallback. This branch used to skip the increment entirely
    // — the only difference between it and the "no printer configured" branch is
    // WHY browser print was chosen, not whether a bill is genuinely being (re)printed
    // — so any restaurant with a configured non-ESC-POS bill printer never got the
    // showDuplicate "** DUPLICATE **" watermark on a real reprint.
    await timer.time("commit", commitBillState);
    return done({
      printed: false,
      browserPrint: true,
      message: nonEscPosPrinterMessage(printer),
      orderId,
    });
  }

  let billJobId: number | undefined;
  if (escPosOk) {
    const billJobIds = await dispatchRemotePrintJobs(
      [{ orderId, jobType: "bill", printerId: printer.id, payload: buffer.toString("base64") }],
      timer,
    );
    billJobId = billJobIds.get(printer.id);
    // Commit at dispatch — the ack (jobId) only flips the job row.
    await timer.time("commit", commitBillState);
  }

  return done({
    printed: false,
    dispatched: escPosOk,
    printJob: escPosOk ? toPrintJob(printer.id, buffer, { orderId, ackType: "bill", jobId: billJobId }) : undefined,
    browserPrint: !escPosOk,
    message: escPosOk ? undefined : nonEscPosPrinterMessage(printer),
    pendingAck: escPosOk,
    orderId,
  });
}

/**
 * The print half of a save-with-print (Phase 2). Never rejects — a failure comes back as
 * `{ error }` so it rides on the save response and can never turn a COMMITTED save into a 5xx.
 * When a bill throws after its KOT catch-up already committed, the catch-up result still comes
 * back as `kotCatchUp` next to the `error` (executePrintStep handles that), so those items
 * never silently miss the kitchen.
 */
export async function runPrintStep(p: {
  req: Request;
  orderId: number;
  /** The row the save just returned. Optional on purpose: `replaceOrderItems` returns undefined for an
   *  unknown id, in which case the print falls back to its own read (and reports "Order not found"). */
  order?: OrderRow;
  mode: PrintMode;
  auto: boolean;
  markBilled: MarkBilled | null;
  timer: StageTimer;
}): Promise<Record<string, unknown>> {
  return executePrintStep(
    p.mode,
    {
      kot: () => runKotPrint({ req: p.req, orderId: p.orderId, reprint: false, auto: p.auto, order: p.order, timer: p.timer }),
      bill: () =>
        runBillPrint({
          req: p.req,
          orderId: p.orderId,
          withKotCatchUp: true,
          markBilled: p.markBilled,
          order: p.order,
          timer: p.timer,
        }),
    },
    // Log the stack, not the error object: it may carry kotCatchUp (with base64 ESC/POS payloads).
    (err: any) => console.error(`[Print/${p.mode}] print step failed after the save committed:`, err?.stack ?? err?.message ?? err),
  );
}
