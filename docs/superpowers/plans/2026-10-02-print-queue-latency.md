# Print Call → Queue: One Request Per Tap + Measured Latency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every KOT/Bill print tap exactly one HTTP request, and measure then reduce the tap → job-queued time, with no physical printer needed for testing.

**Architecture:** (A) a pure stage timer + `Server-Timing` instrumentation, a hardware-free bench harness (fake `bench-*` printers, own Pusher channel, backdated bench orders, virtual print station), and a stage probe; (B) the print pipeline moves into `server/services/printDispatch.ts` so `/api/print/bill` can absorb the KOT catch-up and the `bill-requested` flip, with parallel reads and one-insert/one-batch dispatch; (C) `PUT /api/orders/:id/items` and `POST /api/orders` accept `print: "kot" | "bill"` and run the same service after the save commits.

**Tech Stack:** TypeScript, Express, Drizzle (node-postgres → Neon), Pusher (`pusher` server SDK `triggerBatch`, `pusher-js` for the virtual station), React + TanStack Query (POS.tsx), `tsx` verify scripts.

**Spec:** `docs/superpowers/specs/2026-10-02-print-queue-latency-design.md` (read it first).

**Rules that apply to every task**
- Repo rule: `DATABASE_URL` is the one shared production DB. Nothing in this plan may print a real ticket or leave rows behind. Only the bench harness writes (its own `BENCH-*` rows) and it cleans up.
- `npm run check` (`tsc`) does **not** cover `scripts/` — scripts are validated by running them with `tsx`.
- Server half of `npm run dev` does not hot-reload; restart after server edits.
- Commit steps are listed per task. **Only run `git commit` when the user has asked you to** (session rule); otherwise stop at "stage" and report. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never commit anything under `backups/` (gitignored on purpose).

**Manual app checks (Tasks 12, 15, 16) — safety rules.** Tapping KOT/Bill in the running app creates a real order on the shared DB and runs the real print pipeline, which broadcasts `PRINT_JOB` on the restaurant's real Pusher channel — their live Electron host could print a stray ticket in the kitchen. So, for every manual tap:
1. Start the dev server with a private Pusher channel the restaurant's host is not subscribed to (server-side only). PowerShell: `$env:PUSHER_CHANNEL = "private-bagicha-dev-<random>"; npm run dev`. The shell variable wins over `.env`.
2. Use one throwaway table/order. Right after each print tap run `npx tsx scripts/dev-quiet-print-jobs.ts <orderId>` (Task 12 Step 0) so no `pending` row can be picked up by the host's catch-up poll.
3. Finish by cancelling the throwaway order through the app's own **Cancel Order** flow.
If you cannot do all three, skip the manual check and rely on the automated checks.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `shared/printPerf.ts` | Create | Pure stage timer (`createStageTimer`) used by server + client |
| `shared/printRequest.ts` | Create | Pure helpers: parse request flags, `shouldMarkBilled`, `printFieldsForSubmitMode`, `isSkippableKotResult`, `executePrintStep` |
| `server/services/printDispatch.ts` | Create | `runKotPrint`, `runBillPrint`, `runPrintStep`, `instrumentJson` — the print pipeline moved out of `printRoutes.ts` |
| `server/printRoutes.ts` | Modify | Thin `/api/print/kot` + `/api/print/bill` wrappers; claim/pending/release/ack/preview/test stay |
| `server/realtime/publisher.ts` | Modify | `publishMany` (Pusher `triggerBatch`) + `publishRealtimeMany` |
| `server/settingsStore.ts` | Modify | `__setSettingsForBench` seam (gated on `PRINT_BENCH=1`) |
| `server/routes.ts` | Modify | `print` param on `POST /api/orders` and `PUT /api/orders/:id/items` |
| `shared/print/types.ts` | Modify | `kotCatchUp` on `PrintApiResponse` |
| `client/src/lib/printPerfClient.ts` | Create | POS tap marks (`startPrintTap`, `timePrintStage`, `endPrintTap`) |
| `client/src/lib/printGateway.ts` | Modify | `printBillDirect` accepts `markBilled` |
| `client/src/pages/POS.tsx` | Modify | Single-call KOT/Bill/Auto-KOT flows |
| `client/src/pages/Tables.tsx` | Modify | Tables-card bill uses `markBilled: "on_send"` |
| `scripts/lib/virtualStation.ts` | Create | Pusher-subscribing fake print station (claim → no-op print → ack) |
| `scripts/virtual-print-station.ts` | Create | Standalone CLI over the lib |
| `scripts/dev-quiet-print-jobs.ts` | Create | Marks one order's pending `print_jobs` printed (safety helper for manual app checks) |
| `scripts/bench-print-latency.ts` | Create | Hardware-free bench harness + cleanup |
| `scripts/probe-print-stages.ts` | Create | Neon/Pusher stage probe |
| `scripts/verify-print-perf.ts` | Create | Pure test for the timer |
| `scripts/verify-print-request.ts` | Create | Pure test for the request helpers |
| `scripts/verify-realtime-batch.ts` | Create | Pure test for `publishMany` |
| `package.json` | Modify | Append the three verify scripts to `test:pure` |
| `CLAUDE.md` | Modify | Document the single-call print contract + bench tooling |

---

# PART A — Measure (no behaviour change)

### Task 1: Pure stage timer

**Files:**
- Create: `shared/printPerf.ts`
- Create: `scripts/verify-print-perf.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-print-perf.ts`:

```ts
/**
 * Verifies shared/printPerf.ts — the stage timer behind the Server-Timing header and the
 * [print-perf] log lines. The clock is injected so the numbers are exact.
 * Run: npx tsx scripts/verify-print-perf.ts
 */
import { createStageTimer } from "../shared/printPerf";

const checks: Array<[string, boolean]> = [];

async function main() {
  let t = 0;
  const timer = createStageTimer(() => t);

  const v = await timer.time("db_order", async () => { t += 12.34; return "ok"; });
  checks.push(["time() returns fn's value", v === "ok"]);

  await timer.time("db_order", async () => { t += 1; });
  checks.push(["a repeated stage name sums (13.34 → 13.3)", timer.stages().db_order === 13.3]);

  await timer.time("bad name!", async () => { t += 5; });
  checks.push(["unsafe characters are sanitised to _", timer.stages().bad_name_ === 5]);

  let threw = false;
  try {
    await timer.time("boom", async () => { t += 2; throw new Error("x"); });
  } catch {
    threw = true;
  }
  checks.push(["time() rethrows the error", threw]);
  checks.push(["time() still records a failed stage", timer.stages().boom === 2]);

  timer.scoped("kot").add("db_order", 7);
  checks.push(["scoped() prefixes into the same timer", timer.stages().kot_db_order === 7]);
  timer.scoped("kot").scoped("x").add("y", 1);
  checks.push(["scoped() nests", timer.stages().kot_x_y === 1]);

  checks.push(["totalMs() measures since creation (20.34 → 20.3)", timer.totalMs() === 20.3]);

  checks.push([
    "toServerTiming() format",
    timer.toServerTiming() ===
      "db_order;dur=13.3, bad_name_;dur=5, boom;dur=2, kot_db_order;dur=7, kot_x_y;dur=1, total;dur=20.3",
  ]);
  checks.push([
    "toLogLine() format",
    timer.toLogLine("kot order=1") ===
      "[print-perf] kot order=1 db_order=13.3 bad_name_=5 boom=2 kot_db_order=7 kot_x_y=1 total=20.3",
  ]);

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-print-perf.ts`
Expected: FAIL — module `../shared/printPerf` not found.

- [ ] **Step 3: Write the implementation**

Create `shared/printPerf.ts`:

```ts
/**
 * Dependency-free stage timer shared by the server print pipeline (Server-Timing header +
 * [print-perf] log line) and the POS tap marks. Pure: the clock is injected so
 * scripts/verify-print-perf.ts can drive it deterministically.
 */
export interface StageTimer {
  /** Runs fn, adds its wall time to stage `name` (summed when a name repeats), rethrows on failure. */
  time<T>(name: string, fn: () => PromiseLike<T>): Promise<T>;
  add(name: string, ms: number): void;
  /** A view that writes `${prefix}_${name}` into the SAME underlying timer. */
  scoped(prefix: string): StageTimer;
  stages(): Record<string, number>;
  totalMs(): number;
  /** `db_order;dur=12.3, …, total;dur=40.2` — the Server-Timing header value. */
  toServerTiming(): string;
  /** `[print-perf] <label> db_order=12.3 … total=40.2` */
  toLogLine(label: string): string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const safeName = (n: string) => n.replace(/[^A-Za-z0-9_-]/g, "_");

export function createStageTimer(now: () => number = () => performance.now()): StageTimer {
  const start = now();
  const acc = new Map<string, number>();

  const build = (prefix: string): StageTimer => {
    const key = (name: string) => safeName(prefix ? `${prefix}_${name}` : name);
    const add = (name: string, ms: number) => {
      const k = key(name);
      acc.set(k, (acc.get(k) ?? 0) + ms);
    };
    return {
      async time<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
        const t0 = now();
        try {
          return await fn();
        } finally {
          add(name, now() - t0);
        }
      },
      add,
      scoped: (p: string) => build(prefix ? `${prefix}_${p}` : p),
      stages() {
        const out: Record<string, number> = {};
        for (const [k, v] of Array.from(acc)) out[k] = round1(v);
        return out;
      },
      totalMs: () => round1(now() - start),
      toServerTiming() {
        const parts = Array.from(acc).map(([k, v]) => `${k};dur=${round1(v)}`);
        parts.push(`total;dur=${round1(now() - start)}`);
        return parts.join(", ");
      },
      toLogLine(label: string) {
        const parts = Array.from(acc).map(([k, v]) => `${k}=${round1(v)}`);
        parts.push(`total=${round1(now() - start)}`);
        return `[print-perf] ${label} ${parts.join(" ")}`;
      },
    };
  };

  return build("");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx scripts/verify-print-perf.ts`
Expected: every line `PASS`, final `RESULT: PASS ✅`.

Run: `npm run check`
Expected: exits 0. (`tsconfig.json` has no `target`, so TypeScript defaults to ES5: **never `for…of` or spread a `Map`/`Set` in code under `client/`, `shared/`, `server/`** — use `Array.from(map)`. `scripts/` is not type-checked, so the bench/probe scripts may spread freely.)

- [ ] **Step 5: Add to `test:pure`**

In `package.json`, change the end of the `"test:pure"` value from `... && tsx scripts/verify-kot-item-cancel.ts"` to `... && tsx scripts/verify-kot-item-cancel.ts && tsx scripts/verify-print-perf.ts"`.

Run: `npm run test:pure 2>&1 | tail -5`
Expected: ends with `RESULT: PASS ✅` for the last script and exit code 0.

- [ ] **Step 6: Commit** (only if the user has asked)

```bash
git add shared/printPerf.ts scripts/verify-print-perf.ts package.json
git commit -m "feat(print): pure stage timer for Server-Timing and tap marks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Move the print pipeline into a service + instrument it (behaviour-neutral)

This is a **move**, not a rewrite: same queries, same order, same response bodies. The only additions are `timer.time(...)` wrappers and the `Server-Timing` header. The baseline in Task 7 is measured on this code.

**Files:**
- Create: `server/services/printDispatch.ts`
- Modify: `server/printRoutes.ts` (imports, remove `dispatchRemotePrintJob`, replace the two handlers)

- [ ] **Step 1: Create the service**

Create `server/services/printDispatch.ts` with exactly this content:

```ts
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
import { publishRealtime } from "../realtime/publisher";
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

/** Persists a print_jobs row and broadcasts PRINT_JOB so a remote Electron host can claim+print it. */
async function dispatchRemotePrintJob(
  params: { orderId: number; jobType: "kot" | "bill"; printerId: string; payload: string },
  timer: StageTimer,
): Promise<number> {
  const [row] = await timer.time("insert_job", () =>
    db
      .insert(printJobs)
      .values({ orderId: params.orderId, jobType: params.jobType, printerId: params.printerId, payload: params.payload })
      .returning(),
  );
  await timer.time("pusher", () =>
    publishRealtime({
      type: "PRINT_JOB",
      jobId: row.id,
      orderId: params.orderId,
      jobType: params.jobType,
      printerId: params.printerId,
      payload: params.payload,
    }),
  );
  return row.id;
}

export async function runKotPrint(p: {
  req: Request;
  orderId: number;
  reprint?: boolean;
  auto?: boolean;
  timer?: StageTimer;
}): Promise<PrintResult> {
  const { req, orderId, reprint = false, auto = false } = p;
  const timer = p.timer ?? createStageTimer();

  const settings = getSettings();
  const { kot: kotSettings, printers } = settings.printSettings;

  if (!kotSettings.enabled) {
    return { ok: true, body: { printed: false, reason: "kot_disabled" } };
  }

  const [order] = await timer.time("db_order", () =>
    db.select().from(orders).where(eq(orders.id, orderId)),
  );
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  const rawItems = await timer.time("db_items", () =>
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
  );

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
    const browserKotTickets = await timer.time("db_tickets", () =>
      db.select().from(kotTickets).where(eq(kotTickets.orderId, orderId)).orderBy(asc(kotTickets.id)),
    );
    const browserKotNum = browserKotTickets.length > 0
      ? (reprint ? browserKotTickets[0].kotNumber : browserKotTickets[browserKotTickets.length - 1].kotNumber)
      : undefined;
    if (!reprint) {
      await db
        .update(orders)
        .set({
          kotPrintCount: sql`${orders.kotPrintCount} + 1`,
          lastKotSnapshot: { items: currentSnapshot, printedAt: new Date().toISOString() },
        })
        .where(eq(orders.id, orderId));
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

  // Fetch KOT tickets for this order to retrieve the sequential KOT number
  const orderKotTickets = await timer.time("db_tickets", () =>
    db.select().from(kotTickets).where(eq(kotTickets.orderId, orderId)).orderBy(asc(kotTickets.id)),
  );

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

  const dispatchedJobs = [] as ReturnType<typeof toPrintJob>[];
  for (const j of remoteJobs) {
    const jobId = await dispatchRemotePrintJob(
      { orderId, jobType: "kot", printerId: j.printer.id, payload: j.buffer.toString("base64") },
      timer,
    );
    dispatchedJobs.push(toPrintJob(j.printer.id, j.buffer, { orderId, ackType: "kot", jobId }));
  }

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

export async function runBillPrint(p: {
  req: Request;
  orderId: number;
  timer?: StageTimer;
}): Promise<PrintResult> {
  const { req, orderId } = p;
  const timer = p.timer ?? createStageTimer();

  const settings = getSettings();
  const { bill: billSettings, printers } = settings.printSettings;

  const [order] = await timer.time("db_order", () =>
    db.select().from(orders).where(eq(orders.id, orderId)),
  );
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  // Bills have no client-supplied `reprint` flag (unlike /api/print/kot) — every
  // request sends an identical {orderId} body. billPrintCount>0 (read BEFORE this
  // request's own increment) is the only signal for "has this bill already gone
  // out" — the exact same signal billTextLines/generateBillBuffer already use for
  // the "** DUPLICATE **" watermark, so this new audit signal and that watermark can
  // never disagree.
  const isReprint = (order.billPrintCount ?? 0) > 0;

  const rawItems = await timer.time("db_items", () =>
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
    await db
      .update(orders)
      .set({ billPrintCount: sql`${orders.billPrintCount} + 1` })
      .where(eq(orders.id, orderId));
    if (isReprint) logAudit(req, "bill.reprint", "order", orderId, {});
    return { ok: true, body: { browserPrint: true } };
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
    return { ok: true, body: { printed: true } };
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
    return {
      ok: true,
      body: {
        printed: false,
        browserPrint: true,
        message: nonEscPosPrinterMessage(printer),
        orderId,
      },
    };
  }

  let billJobId: number | undefined;
  if (escPosOk) {
    billJobId = await dispatchRemotePrintJob(
      { orderId, jobType: "bill", printerId: printer.id, payload: buffer.toString("base64") },
      timer,
    );
    // Commit at dispatch — the ack (jobId) only flips the job row.
    await timer.time("commit", commitBillState);
  }

  return {
    ok: true,
    body: {
      printed: false,
      dispatched: escPosOk,
      printJob: escPosOk ? toPrintJob(printer.id, buffer, { orderId, ackType: "bill", jobId: billJobId }) : undefined,
      browserPrint: !escPosOk,
      message: escPosOk ? undefined : nonEscPosPrinterMessage(printer),
      pendingAck: escPosOk,
      orderId,
    },
  };
}
```

- [ ] **Step 2: Fix `printRoutes.ts` imports**

In `server/printRoutes.ts`, replace the import header (lines 1–21) so it reads exactly:

```ts
import type { Express } from "express";
import { db } from "./db";
import { orders, orderItems, menuItems, kotTickets, printJobs } from "@shared/schema";
import { eq, asc, and, gt, or, lt, inArray, isNull, sql } from "drizzle-orm";
import type { PrinterConfig } from "@shared/print/types";
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
import * as E from "./escpos";
```

(`publishRealtime` and `logAudit` and `generateKOTBuffer`/`generateBillBuffer` are no longer used here. `kotTickets` stays: the preview route uses it.)

- [ ] **Step 3: Delete `dispatchRemotePrintJob` from `printRoutes.ts`**

Delete the block that starts with the comment `/** Persists a print_jobs row and broadcasts PRINT_JOB so a remote Electron host can claim+print it. */` and ends at the closing `}` of `async function dispatchRemotePrintJob(...)` (the function is ~20 lines, right after `STALE_CLAIM_MS`). Keep `STALE_CLAIM_MS`.

- [ ] **Step 4: Replace the two handlers**

In `registerPrintRoutes`, replace everything from `app.post("/api/print/kot", requireAuth, async (req, res) => {` through the end of the `app.post("/api/print/bill", ...)` handler (its closing `});` immediately before `app.post("/api/print/jobs/:id/claim"`) with:

```ts
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
      const result = await runBillPrint({ req, orderId, timer });
      if (!result.ok) return res.status(result.status).json({ message: result.message });
      return res.json(result.body);
    } catch (err: any) {
      console.error("[Print/Bill]", err);
      res.status(500).json({ message: err.message || "Bill print failed" });
    }
  });
```

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: exits 0. If `tsc` reports `'PrinterConfig' is declared but never used` it will not (no `noUnusedLocals`); but check `grep -n "PrinterConfig" server/printRoutes.ts` — if the only hit is the import line, delete that import line.

- [ ] **Step 6: Smoke-check the module loads**

Run:

```bash
npx tsx -r dotenv/config -e "import('./server/services/printDispatch').then(m => { console.log(Object.keys(m).sort().join(',')); process.exit(0); })"
```

Expected output: `instrumentJson,runBillPrint,runKotPrint`. Do **not** tap KOT/Bill in the app here — that writes real orders and broadcasts on the real print channel (see the "Manual app checks" safety rules at the top). The end-to-end behaviour is exercised by the bench harness in Task 5.

- [ ] **Step 7: Commit** (only if the user has asked)

```bash
git add server/services/printDispatch.ts server/printRoutes.ts
git commit -m "refactor(print): move KOT/bill pipeline into printDispatch service and add Server-Timing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bench settings seam

**Files:**
- Modify: `server/settingsStore.ts` (after `getSettingsFresh`, currently ending at line 296)

- [ ] **Step 1: Add the seam**

In `server/settingsStore.ts`, directly after

```ts
export function getSettingsFresh(): Promise<RestaurantSettings> {
  return readSettingsFromDb();
}
```

add:

```ts

/**
 * BENCH ONLY (scripts/bench-print-latency.ts): swaps the in-memory settings snapshot so the
 * print pipeline can run with fake printers WITHOUT reading or writing the restaurant's real
 * settings. Hard-gated on PRINT_BENCH=1, which no server entry point ever sets — calling it
 * from a request path throws.
 */
export function __setSettingsForBench(next: RestaurantSettings | null): void {
  if (process.env.PRINT_BENCH !== "1") {
    throw new Error("__setSettingsForBench is only available to bench scripts (PRINT_BENCH=1)");
  }
  settingsCache = next;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: exits 0.

- [ ] **Step 3: Commit** (only if the user has asked)

```bash
git add server/settingsStore.ts
git commit -m "chore(print): bench-only settings seam gated on PRINT_BENCH=1" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Virtual print station

**Files:**
- Create: `scripts/lib/virtualStation.ts`
- Create: `scripts/virtual-print-station.ts`

- [ ] **Step 1: Create the library**

Create `scripts/lib/virtualStation.ts`:

```ts
/**
 * A fake print station — stands in for the Electron host / RawBT phone so the delivery chain
 * (PRINT_JOB broadcast → claim → "print" → ack) can be exercised with NO physical printer.
 * It subscribes to ONE Pusher channel (the bench channel) and only touches jobs whose
 * printerId starts with `printerIdPrefix` (default "bench-"), so it can never claim a real job.
 * Manual-only tooling; not part of test:pure.
 */
import PusherJs from "pusher-js";
import PusherServer from "pusher";

// pusher-js's node build is a CJS bundle; under this ESM project (pusher-js 8.5.0) the default
// import is the module object `{ Pusher }`, not the constructor. Unwrap it.
const Pusher = ((PusherJs as any).Pusher ?? (PusherJs as any).default ?? PusherJs) as typeof PusherJs;

export interface StationEvent {
  jobId: number;
  orderId: number;
  jobType: string;
  printerId: string;
  tEvent: number;
  tClaim: number;
  tAck: number;
}

export interface VirtualStation {
  events: Map<number, StationEvent>;
  /** Resolves true when every job id has been acked, false on timeout. */
  waitForJobs(jobIds: number[], timeoutMs: number): Promise<boolean>;
  stop(): void;
}

export async function startVirtualStation(opts: {
  baseUrl: string;
  channel: string;
  printerIdPrefix?: string;
  headers?: Record<string, string>;
  onEvent?: (e: StationEvent) => void;
}): Promise<VirtualStation> {
  const { PUSHER_APP_ID: appId, PUSHER_KEY: key, PUSHER_SECRET: secret } = process.env;
  const cluster = process.env.PUSHER_CLUSTER || "ap2";
  if (!appId || !key || !secret) {
    throw new Error("PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET are required for the virtual station");
  }
  const prefix = opts.printerIdPrefix ?? "bench-";
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };

  // Authorise the private channel locally with the same credentials the server uses.
  const signer = new PusherServer({ appId, key, secret, cluster, useTLS: true });
  const client = new Pusher(key, {
    cluster,
    channelAuthorization: {
      customHandler: (
        { socketId, channelName }: { socketId: string; channelName: string },
        callback: (err: Error | null, data: any) => void,
      ) => {
        try {
          callback(null, signer.authorizeChannel(socketId, channelName) as any);
        } catch (err) {
          callback(err as Error, null as any);
        }
      },
    } as any,
  });

  const events = new Map<number, StationEvent>();
  const channel = client.subscribe(opts.channel);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Pusher subscription to ${opts.channel} timed out after 10s (Pusher unreachable?)`)),
      10_000,
    );
    channel.bind("pusher:subscription_succeeded", () => {
      clearTimeout(timer);
      resolve();
    });
    channel.bind("pusher:subscription_error", (e: unknown) => {
      clearTimeout(timer);
      reject(new Error(`subscription failed: ${JSON.stringify(e)}`));
    });
  }).catch((err) => {
    client.disconnect(); // don't keep a dangling socket alive after a failed start
    throw err;
  });

  channel.bind("PRINT_JOB", async (data: any) => {
    if (!String(data?.printerId ?? "").startsWith(prefix)) return;
    const tEvent = performance.now();
    try {
      const claimRes = await fetch(`${opts.baseUrl}/api/print/jobs/${data.jobId}/claim`, { method: "POST", headers });
      const claim: any = await claimRes.json();
      const tClaim = performance.now();
      if (!claim?.claimed) return; // someone else owns it — never ack
      // "Print" is a no-op: there is no printer.
      await fetch(`${opts.baseUrl}/api/print/ack`, {
        method: "POST",
        headers,
        body: JSON.stringify({ orderId: data.orderId, type: data.jobType, jobId: data.jobId }),
      });
      const tAck = performance.now();
      const evt: StationEvent = {
        jobId: data.jobId,
        orderId: data.orderId,
        jobType: data.jobType,
        printerId: data.printerId,
        tEvent,
        tClaim,
        tAck,
      };
      events.set(data.jobId, evt);
      opts.onEvent?.(evt);
    } catch (err) {
      console.error("[virtual-station] failed handling job", data?.jobId, err);
    }
  });

  return {
    events,
    async waitForJobs(jobIds, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (jobIds.every((id) => events.has(id))) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return jobIds.every((id) => events.has(id));
    },
    stop() {
      client.disconnect();
    },
  };
}
```

- [ ] **Step 2: Create the standalone CLI**

Create `scripts/virtual-print-station.ts`:

```ts
/**
 * Standalone virtual print station.
 * Run: npx tsx scripts/virtual-print-station.ts --base-url http://127.0.0.1:5000 --channel private-bagicha-bench-xyz [--cookie "connect.sid=..."]
 * It only handles jobs whose printerId starts with "bench-". Ctrl+C to stop.
 */
import "dotenv/config";
import { startVirtualStation } from "./lib/virtualStation";

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const baseUrl = opt("--base-url");
const channel = opt("--channel");
const cookie = opt("--cookie");
if (!baseUrl || !channel) {
  console.error("usage: tsx scripts/virtual-print-station.ts --base-url <url> --channel <pusher channel> [--cookie <cookie header>]");
  process.exit(2);
}

const station = await startVirtualStation({
  baseUrl,
  channel,
  headers: cookie ? { Cookie: cookie } : undefined,
  onEvent: (e) =>
    console.log(
      `job ${e.jobId} (${e.jobType}, ${e.printerId}): event→claim ${(e.tClaim - e.tEvent).toFixed(0)}ms, claim→ack ${(e.tAck - e.tClaim).toFixed(0)}ms`,
    ),
});
console.log(`virtual station listening on ${channel}; Ctrl+C to stop`);
process.on("SIGINT", () => {
  station.stop();
  process.exit(0);
});
```

- [ ] **Step 3: Verify both files load**

Run: `npx tsx -e "import('./scripts/lib/virtualStation').then(m => console.log(typeof m.startVirtualStation))"`
Expected: prints `function`.

Run: `npx tsx scripts/virtual-print-station.ts`
Expected: prints the `usage:` line and exits with code 2.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add scripts/lib/virtualStation.ts scripts/virtual-print-station.ts
git commit -m "chore(print): virtual print station for hardware-free delivery checks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bench harness

**Files:**
- Create: `scripts/bench-print-latency.ts`

- [ ] **Step 1: Create the harness**

Create `scripts/bench-print-latency.ts`:

> **As shipped (hardened over three review rounds):** the code below is the final file — it adds an activity guard (refuses to run within 15 min of real print activity unless `--force`), flips pending/claimed bench jobs after every call, SIGINT/SIGTERM-safe single-flight cleanup with a `bench-%` print_jobs sweep, strict argument parsing and a failed-cleanup `RESULT: FAIL`. **Run it outside service hours / with no `/print-station` device open** (a RawBT station would claim any pending job regardless of printerId).

```ts
/**
 * Print latency bench — measures tap→job-queued for /api/print/kot and /api/print/bill with NO
 * physical printer and NO effect on the restaurant's live print stations. Manual-only
 * (not in test:pure). Spec: docs/superpowers/specs/2026-10-02-print-queue-latency-design.md §A2.
 *
 * PRECONDITION: run outside service hours (or with no /print-station device open): a bench
 * print_jobs row is briefly `pending`/`claimed`, and a RawBT print station with default ownership
 * would claim any pending job (or a claim older than 2 min) regardless of printerId. An activity
 * guard refuses to run when real print jobs were created in the last 15 minutes (override with --force).
 *
 * Safety layers:
 *  1. fake `bench-*` printers injected through settingsStore's PRINT_BENCH seam — production
 *     settings are never read or written, and no real printer id is targeted. A live Electron
 *     host that sees a bench job fails harmlessly on the unknown printer id, but a RawBT station
 *     would print it — hence layers 4 and the activity guard;
 *  2. a private-bagicha-bench-<rand> Pusher channel — no real station receives the PRINT_JOB
 *     broadcast (they could still see a `pending`/`claimed` row through the catch-up poll);
 *  3. bench orders are inserted directly: BENCH-<run>-<n>, customer "__PRINT_BENCH__", createdAt
 *     2020, served + paid — in no report or live view, and no bill/KOT counter is consumed;
 *  4. every pending/claimed print_jobs row is flipped to `printed` right after its call (also in
 *     --station mode, on SIGINT/SIGTERM, and in --cleanup-only even without --confirm);
 *  5. before deleting, the rows are snapshotted to backups/ (gitignored), then everything this
 *     run created is removed in ONE transaction. The delete refuses non-bench orders. Cleanup also
 *     sweeps any print_jobs row whose printer_id is `bench-%` (real printer ids are numeric
 *     `Date.now()` strings), catching jobs the order-based cleanup cannot find.
 *
 * Run:  npx tsx scripts/bench-print-latency.ts [--iterations 20] [--station] [--label baseline] [--force]
 *       npx tsx scripts/bench-print-latency.ts --cleanup-only [--confirm]   # leftover recovery; dry-run unless --confirm
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, pool } from "../server/db";
import { menuItems, orderItems, orders } from "@shared/schema";
import { registerPrintRoutes } from "../server/printRoutes";
import { getSettings, __setSettingsForBench } from "../server/settingsStore";
import { createRealtimePublisher, setRealtimePublisher } from "../server/realtime/publisher";
import { startVirtualStation, type VirtualStation } from "./lib/virtualStation";

process.env.PRINT_BENCH = "1";

const BENCH_NAME = "__PRINT_BENCH__";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE =
  "usage: npx tsx scripts/bench-print-latency.ts [--iterations <positive int>] [--station] [--label <name>] [--force]\n" +
  "       npx tsx scripts/bench-print-latency.ts --cleanup-only [--confirm]";
// Strict argument parsing: unknown flags, `--flag=value` forms and missing values are errors.
const BOOL_FLAGS = new Set(["--station", "--force", "--cleanup-only", "--confirm"]);
const VALUE_FLAGS = new Set(["--iterations", "--label"]);
function usageExit(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}
const argv = process.argv.slice(2);
const boolArgs = new Set<string>();
const valueArgs = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (BOOL_FLAGS.has(a)) {
    boolArgs.add(a);
  } else if (VALUE_FLAGS.has(a)) {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) usageExit(`${a} needs a value`);
    valueArgs.set(a, v);
    i++;
  } else {
    usageExit(`unknown argument: ${a}`);
  }
}
const flag = (name: string) => boolArgs.has(name);
const opt = (name: string, dflt: string) => valueArgs.get(name) ?? dflt;

// ── stats ────────────────────────────────────────────────────────────────────────────
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function parseServerTiming(h: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of h.split(",")) {
    const m = part.trim().match(/^([A-Za-z0-9_-]+);dur=([0-9.]+)$/);
    if (m) out[m[1]] = parseFloat(m[2]);
  }
  return out;
}
function report(title: string, samples: Map<string, number[]>) {
  const rows = Array.from(samples.entries()).map(([metric, vals]) => {
    const s = [...vals].sort((a, b) => a - b);
    return {
      metric,
      n: s.length,
      min: +s[0].toFixed(1),
      p50: +pct(s, 50).toFixed(1),
      p95: +pct(s, 95).toFixed(1),
      max: +s[s.length - 1].toFixed(1),
    };
  });
  console.log(`\n== ${title} (ms) ==`);
  console.table(rows);
}

// ── cleanup ──────────────────────────────────────────────────────────────────────────
// print_jobs rows owned by the bench: those of the given BENCH orders, plus any row on a `bench-*`
// printer (sweep — catches e.g. a job inserted after its order was already deleted). Real printer
// ids are numeric Date.now() strings (PrintSettingsPanel addPrinter), so `bench-%` never matches one.
const BENCH_JOBS_WHERE = "(order_id = ANY($1) OR printer_id LIKE 'bench-%')";

/** Flips every pending/claimed bench print_jobs row to printed (so no real station can claim it). */
async function flipBenchJobs(orderIds: number[]): Promise<number> {
  const r = await pool.query(
    `UPDATE print_jobs SET status = 'printed', printed_at = now() WHERE ${BENCH_JOBS_WHERE} AND status IN ('pending','claimed')`,
    [orderIds],
  );
  return r.rowCount ?? 0;
}

async function cleanupBenchRows(orderIds: number[], confirm: boolean): Promise<void> {
  if (orderIds.length > 0) {
    const marker = await pool.query(
      "SELECT count(*)::int AS n FROM orders WHERE id = ANY($1) AND order_number LIKE 'BENCH-%' AND customer_name = $2",
      [orderIds, BENCH_NAME],
    );
    if (marker.rows[0].n !== orderIds.length) {
      throw new Error("cleanup refused: not every selected order carries the BENCH marker");
    }
  }
  // Always (dry-run too): remove the claimable-job window before anything else.
  try {
    const flipped = await flipBenchJobs(orderIds);
    if (flipped > 0) console.log(`cleanup: flipped ${flipped} pending/claimed bench print job(s) to printed`);
  } catch (err) {
    console.error("cleanup: flipping pending/claimed bench jobs failed:", err);
  }
  const benchJobs = (await pool.query(`SELECT * FROM print_jobs WHERE ${BENCH_JOBS_WHERE}`, [orderIds])).rows;
  if (orderIds.length === 0) {
    console.log("cleanup: no bench orders found");
    if (benchJobs.length === 0) return;
    console.log(`cleanup: ${benchJobs.length} stray bench print_jobs row(s) on bench-* printers`);
  }
  const entityIds = orderIds.map(String);
  const snap = {
    orders: (await pool.query("SELECT * FROM orders WHERE id = ANY($1)", [orderIds])).rows,
    order_items: (await pool.query("SELECT * FROM order_items WHERE order_id = ANY($1)", [orderIds])).rows,
    kot_tickets: (await pool.query("SELECT * FROM kot_tickets WHERE order_id = ANY($1)", [orderIds])).rows,
    print_jobs: benchJobs,
    audit_logs: (
      await pool.query("SELECT * FROM audit_logs WHERE entity_type = 'order' AND entity_id = ANY($1)", [entityIds])
    ).rows,
  };
  console.log(
    `cleanup: ${Object.entries(snap).map(([k, v]) => `${k}=${v.length}`).join(" ")}`,
  );
  if (!confirm) {
    console.log("cleanup: dry-run — re-run with --confirm to snapshot + delete");
    return;
  }
  const backupsDir = path.join(REPO_ROOT, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const file = path.join(backupsDir, `print-bench-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));
  console.log(`cleanup: snapshot written to ${file}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM audit_logs WHERE entity_type = 'order' AND entity_id = ANY($1)", [entityIds]);
    await client.query(`DELETE FROM print_jobs WHERE ${BENCH_JOBS_WHERE}`, [orderIds]);
    await client.query("DELETE FROM kot_tickets WHERE order_id = ANY($1)", [orderIds]);
    await client.query("DELETE FROM order_items WHERE order_id = ANY($1)", [orderIds]);
    await client.query("DELETE FROM orders WHERE id = ANY($1)", [orderIds]);
    await client.query("COMMIT");
    console.log("cleanup: bench rows deleted");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function cleanupOnly(confirm: boolean) {
  const r = await pool.query(
    "SELECT id FROM orders WHERE order_number LIKE 'BENCH-%' AND customer_name = $1",
    [BENCH_NAME],
  );
  await cleanupBenchRows(r.rows.map((x: any) => x.id as number), confirm);
}

// ── bench data ───────────────────────────────────────────────────────────────────────
async function createBenchOrder(
  runId: string,
  n: number,
  lines: Array<{ menuItemId: number; quantity: number; price: string }>,
  createdIds: number[],
): Promise<number> {
  const past = new Date("2020-01-01T00:00:00Z");
  const [o] = await db
    .insert(orders)
    .values({
      orderNumber: `BENCH-${runId}-${n}`,
      customerName: BENCH_NAME,
      orderType: "dine-in",
      tableNumber: "BENCH",
      status: "served",
      totalAmount: "100.00",
      taxAmount: "4.76",
      discountAmount: "0",
      subtotalAmount: "95.24",
      containerCharge: "0",
      paymentStatus: "paid",
      paymentMethod: "cash",
      createdAt: past,
      updatedAt: past,
    })
    .returning({ id: orders.id });
  createdIds.push(o.id); // tracked before the items insert, so a half-created order is still cleaned
  await db.insert(orderItems).values(
    lines.map((l) => ({
      orderId: o.id,
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      price: l.price,
      serviceMode: "dinein",
    })),
  );
  return o.id;
}

// ── scenarios ────────────────────────────────────────────────────────────────────────
async function timedPost(base: string, route: string, body: object) {
  const t0 = performance.now();
  const res = await fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  return {
    t0,
    wallMs: performance.now() - t0,
    status: res.status,
    json,
    stages: parseServerTiming(res.headers.get("server-timing") ?? ""),
  };
}

const jobIdsOf = (json: any): number[] =>
  (json.printJobs ?? (json.printJob ? [json.printJob] : [])).map((j: any) => j.jobId).filter((x: any) => typeof x === "number");

// ── shutdown coordination (normal finally path vs SIGINT/SIGTERM) ───────────────────
class AbortedBySignal extends Error {}
let aborted = false;
let poolEnded = false;
let cleanupFailed = false;
let cleanupPromise: Promise<void> | null = null;
async function endPool(): Promise<void> {
  if (poolEnded) return;
  poolEnded = true;
  await pool.end();
}
/**
 * Single-flight: the first caller starts flip → snapshot → delete (+ bench-* sweep); every later
 * caller awaits that same run. Never throws — a failure sets `cleanupFailed`.
 */
function finalCleanup(createdIds: number[]): Promise<void> {
  cleanupPromise ??= (async () => {
    try {
      await cleanupBenchRows(createdIds.slice(), true);
    } catch (err) {
      cleanupFailed = true;
      console.error(CLEANUP_HINT, err);
    }
  })();
  return cleanupPromise;
}
const RECOVERY_CMD = "npx tsx scripts/bench-print-latency.ts --cleanup-only --confirm";
const CLEANUP_HINT = `cleanup failed — run \`${RECOVERY_CMD}\``;

async function main() {
  if (flag("--cleanup-only")) {
    await cleanupOnly(flag("--confirm"));
    await endPool();
    return;
  }

  const iterationsRaw = opt("--iterations", "20");
  const iterations = Number(iterationsRaw);
  if (!/^\d+$/.test(iterationsRaw) || !Number.isInteger(iterations) || iterations <= 0) {
    console.error(`--iterations must be a positive integer (got "${iterationsRaw}")\n${USAGE}`);
    process.exit(2);
  }

  // Activity guard — a pending bench row could be claimed by a real (RawBT) print station.
  if (!flag("--force")) {
    const live = await pool.query(
      "SELECT count(*)::int AS n FROM print_jobs WHERE printer_id NOT LIKE 'bench-%' AND created_at > now() - interval '15 minutes'",
    );
    if (live.rows[0].n > 0) {
      console.error(
        `real print activity in the last 15 minutes (${live.rows[0].n} job(s)) — the restaurant looks live; ` +
          "a pending bench job could be picked up by a real print station. Re-run outside service hours or pass --force",
      );
      await endPool();
      process.exit(3);
    }
  }

  // Registered before any bench row exists, with process.on (not once) so a repeat Ctrl+C can't
  // fall through to the default/tsx handler and kill the process mid-cleanup. Flips pending/claimed
  // jobs first (safety), waits (bounded) for the in-flight bench step to settle so nothing is
  // inserted after the cleanup snapshot, then runs the single-flight cleanup (+ bench-* sweep).
  const createdIds: number[] = [];
  let benchRunning = false;
  let resolveBenchDone: () => void = () => {};
  const benchDone = new Promise<void>((r) => (resolveBenchDone = r));
  const onSignal = (sig: NodeJS.Signals) => {
    if (aborted) {
      console.error("cleanup in progress — please wait");
      return;
    }
    aborted = true;
    if (poolEnded) process.exit(130); // the normal path already cleaned up and closed the pool
    console.error(`\n${sig} received — flipping pending/claimed bench jobs to printed, then cleaning up…`);
    void (async () => {
      try {
        await flipBenchJobs(createdIds.slice());
      } catch (err) {
        console.error("flipping pending/claimed bench jobs failed:", err);
      }
      let settled = !benchRunning;
      if (benchRunning) {
        settled = await Promise.race([
          benchDone.then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), 20_000)),
        ]);
        if (!settled) console.error("in-flight bench step did not settle within 20s — cleaning up anyway");
      }
      await finalCleanup(createdIds); // awaits the finally's run if that one started first
      if (!settled) {
        // A late insert could still land after this cleanup's snapshot — have the operator re-check.
        console.error(`if anything was still in flight, verify with \`${RECOVERY_CMD}\``);
      }
      if (cleanupFailed) console.error(CLEANUP_HINT);
      if (settled) {
        try {
          await endPool(); // only once nothing else is using the pool
        } catch {}
      }
      process.exit(130);
    })();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const checkAbort = () => {
    if (aborted) throw new AbortedBySignal("aborted by signal");
  };

  const label = opt("--label", "baseline");
  const withStation = flag("--station");
  const runId = Date.now().toString(36);
  const channel = `private-bagicha-bench-${runId}`;
  process.env.PUSHER_CHANNEL = channel;
  const pusherConfigured = !!(process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET);
  if (!pusherConfigured) {
    console.warn("⚠ PUSHER_* not set — the `pusher` stage will read ~0 and --station is unavailable.");
    if (withStation) throw new Error("--station needs PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET");
  }
  setRealtimePublisher(await createRealtimePublisher());

  // Two real menu items from two different categories (read-only) → exercises category routing.
  const menuRows = await db
    .select({ id: menuItems.id, categoryId: menuItems.categoryId, price: menuItems.price })
    .from(menuItems)
    .where(and(isNotNull(menuItems.categoryId), eq(menuItems.isDeleted, false)));
  const byCat = new Map<number, { id: number; price: string }>();
  for (const r of menuRows) {
    if (r.categoryId != null && !byCat.has(r.categoryId)) byCat.set(r.categoryId, { id: r.id, price: String(r.price) });
  }
  const picks = Array.from(byCat.entries()).slice(0, 2);
  if (picks.length < 2) throw new Error("need menu items in at least 2 categories for the routed scenario");
  const [[catA, itemA], [catB, itemB]] = picks;

  // Fake printers — usb type with no vendor/product → remote-dispatch path, never executable here.
  const s = structuredClone(getSettings());
  s.printSettings.printers = [
    { id: "bench-usb-1", name: "Bench Thermal 1", type: "usb", width: 48 },
    { id: "bench-usb-2", name: "Bench Thermal 2", type: "usb", width: 48 },
  ];
  s.printSettings.kot.enabled = true;
  s.printSettings.kot.kotPrinterId = "bench-usb-1";
  s.printSettings.kot.categoryPrinterOverrides = {};
  s.printSettings.bill.billPrinterId = "bench-usb-1";
  s.posSections = [];
  __setSettingsForBench(s);

  // In-process server with a stubbed session.
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 0, username: "bench", role: "admin" };
    next();
  });
  registerPrintRoutes(app);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  let station: VirtualStation | null = null;
  if (withStation) station = await startVirtualStation({ baseUrl: base, channel });

  const lines = [
    { menuItemId: itemA.id, quantity: 2, price: itemA.price },
    { menuItemId: itemB.id, quantity: 1, price: itemB.price },
  ];

  const scenarios: Array<{ name: string; overrides: Record<string, string | null>; route: string; expectJobs: number }> = [
    { name: "kot-1-printer", overrides: {}, route: "/api/print/kot", expectJobs: 1 },
    { name: "kot-2-printers", overrides: { [String(catB)]: "bench-usb-2" }, route: "/api/print/kot", expectJobs: 2 },
    { name: "bill", overrides: {}, route: "/api/print/bill", expectJobs: 1 },
  ];

  let problems = 0;
  checkAbort();
  benchRunning = true;
  try {
    for (const sc of scenarios) {
      s.printSettings.kot.categoryPrinterOverrides = sc.overrides;
      const ids: number[] = [];
      for (let i = 0; i < iterations + 2; i++) {
        checkAbort();
        const id = await createBenchOrder(runId, createdIds.length, lines, createdIds);
        ids.push(id);
      }
      const samples = new Map<string, number[]>();
      const push = (k: string, v: number) => {
        if (!samples.has(k)) samples.set(k, []);
        samples.get(k)!.push(v);
      };

      for (let i = 0; i < ids.length; i++) {
        checkAbort();
        const orderId = ids[i];
        const r = await timedPost(base, sc.route, { orderId });
        const jobIds = jobIdsOf(r.json);
        const shapeOk =
          r.status === 200 &&
          jobIds.length === sc.expectJobs &&
          (sc.route === "/api/print/bill" ? r.json.dispatched === true : r.json.dispatched === true && r.json.pendingAck === true);
        if (!shapeOk) {
          problems++;
          console.error(`✗ ${sc.name} #${i}: unexpected response`, r.status, JSON.stringify(r.json).slice(0, 200));
        }

        if (station && !(await station.waitForJobs(jobIds, 8000))) {
          problems++;
          console.error(`✗ ${sc.name} #${i}: virtual station did not ack every job within 8s`, jobIds);
        }
        // Always (station mode too): no bench job may stay claimable by a real print station.
        await pool.query(
          "UPDATE print_jobs SET status = 'printed', printed_at = now() WHERE order_id = $1 AND status IN ('pending','claimed')",
          [orderId],
        );

        if (i < 2) continue; // 2 warm-up calls per scenario (connection pool, JIT) are discarded
        push("wall(client)", r.wallMs);
        for (const [k, v] of Object.entries(r.stages)) push(k, v);
        if (station) {
          for (const jid of jobIds) {
            const e = station.events.get(jid);
            if (!e) continue; // already counted as a problem by the waitForJobs check above
            push("station:request→event", e.tEvent - r.t0);
            push("station:event→claim", e.tClaim - e.tEvent);
            push("station:claim→ack", e.tAck - e.tClaim);
          }
        }
      }
      // NB: in multi-printer scenarios the insert_job / pusher stage values are the SUM over all
      // routed jobs of the call, not per job.
      report(`${label} · ${sc.name}`, samples);
    }
  } finally {
    try {
      try {
        station?.stop();
      } catch (err) {
        console.error("virtual station stop failed:", err);
      }
      await new Promise<void>((r) => server.close(() => r()));
      await finalCleanup(createdIds); // never throws; a failure sets cleanupFailed (original error still propagates)
      if (!aborted) {
        try {
          await endPool(); // on abort the signal handler ends the pool after its own steps
        } catch {}
      }
    } finally {
      resolveBenchDone();
    }
  }
  if (aborted) return; // the signal handler owns the exit
  if (cleanupFailed) {
    console.error(`\n${CLEANUP_HINT}`);
    console.error(`RESULT: FAIL ❌ (cleanup failed — run \`${RECOVERY_CMD}\`)`);
    process.exit(1);
  }
  if (problems > 0) {
    console.error(`\nRESULT: FAIL ❌ (${problems} problem(s))`);
    process.exit(1);
  }
  console.log("\nRESULT: PASS ✅ (all responses had the expected shape)");
}

main().catch((err) => {
  if (!(err instanceof AbortedBySignal)) console.error(err);
  if (aborted) return; // the signal handler owns the exit (it exits 130 once cleanup is done)
  if (cleanupFailed) console.error(`\n${CLEANUP_HINT}\nRESULT: FAIL ❌ (cleanup failed — run \`${RECOVERY_CMD}\`)`);
  process.exit(1);
});
```

- [ ] **Step 2: Run a short bench to prove it works**

Run: `npx tsx scripts/bench-print-latency.ts --iterations 3 --label smoke`
Expected: three `== smoke · <scenario> (ms) ==` tables (`kot-1-printer`, `kot-2-printers`, `bill`), each containing `wall(client)`, `db_order`, `db_items`, `db_tickets` (KOT only), `build`, `insert_job`, `pusher`, `commit`, `total` rows; then `cleanup: orders=… order_items=… …`, `cleanup: snapshot written to backups/print-bench-….json`, `cleanup: bench rows deleted`, and `RESULT: PASS ✅`.

- [ ] **Step 3: Prove nothing is left behind**

Run: `npx tsx scripts/bench-print-latency.ts --cleanup-only`
Expected: `cleanup: no bench orders found`.

Also run: `npx tsx -r dotenv/config -e "import('./server/db').then(async ({pool}) => { const r = await pool.query(\"select count(*)::int n from print_jobs where printer_id like 'bench-%'\"); console.log(r.rows[0]); await pool.end(); })"`
Expected: `{ n: 0 }`.

- [ ] **Step 4: Prove the virtual station path works**

Run: `npx tsx scripts/bench-print-latency.ts --iterations 3 --station --label smoke-station`
Expected: same tables plus `station:request→event`, `station:event→claim`, `station:claim→ack` rows, and `RESULT: PASS ✅`. (If `PUSHER_*` is missing from `.env` the script exits with the explicit error from the guard — then Step 4 cannot run on this machine; record that in the baseline.)

- [ ] **Step 5: Commit** (only if the user has asked)

```bash
git add scripts/bench-print-latency.ts
git commit -m "chore(print): hardware-free bench harness with snapshot+transactional cleanup" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stage probe

**Files:**
- Create: `scripts/probe-print-stages.ts`

- [ ] **Step 1: Create the probe**

Create `scripts/probe-print-stages.ts`:

```ts
/**
 * Stage probe — times the building blocks of the print call in isolation so each stage's SHARE
 * of the total is known. Read-only except one INSERT per iteration inside a transaction that is
 * ROLLED BACK; Pusher events go to a throwaway channel nobody subscribes to.
 * NOTE: run from a dev machine this measures THAT machine's RTT to Neon/Pusher, not Vercel bom1's —
 * use it for ratios; absolute production numbers come from the Server-Timing header (Task 2).
 * Manual-only (not in test:pure).
 * Run: npx tsx scripts/probe-print-stages.ts [--iterations 20]
 */
import "dotenv/config";
import PusherServer from "pusher";
import { pool } from "../server/db";

const argv = process.argv.slice(2);
const iterations = (() => {
  const i = argv.indexOf("--iterations");
  return i >= 0 && argv[i + 1] ? parseInt(argv[i + 1], 10) : 20;
})();

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

async function sample(name: string, fn: () => Promise<unknown>) {
  await fn(); // warm-up, discarded
  const vals: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    vals.push(performance.now() - t0);
  }
  vals.sort((a, b) => a - b);
  return { stage: name, n: vals.length, p50: +pct(vals, 50).toFixed(1), p95: +pct(vals, 95).toFixed(1), max: +vals[vals.length - 1].toFixed(1) };
}

async function main() {
  const rows: Array<Record<string, unknown>> = [];

  const latest = await pool.query("SELECT id FROM orders ORDER BY id DESC LIMIT 1");
  const orderId: number | undefined = latest.rows[0]?.id;
  if (!orderId) throw new Error("no orders in the DB to probe against");

  rows.push(await sample("neon: SELECT 1 (RTT floor)", () => pool.query("SELECT 1")));
  rows.push(await sample("db_order: orders by id", () => pool.query("SELECT * FROM orders WHERE id = $1", [orderId])));
  rows.push(
    await sample("db_items: order_items ⟕ menu_items", () =>
      pool.query(
        `SELECT oi.menu_item_id, mi.category_id, coalesce(oi.name, mi.name, 'Item') AS name, oi.quantity, oi.size,
                oi.special_instructions, oi.service_mode
           FROM order_items oi LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
          WHERE oi.order_id = $1`,
        [orderId],
      ),
    ),
  );
  rows.push(
    await sample("db_tickets: kot_tickets by order", () =>
      pool.query("SELECT * FROM kot_tickets WHERE order_id = $1 ORDER BY id ASC", [orderId]),
    ),
  );

  // print_jobs INSERT, always rolled back — one row (≈3 KB base64 payload) and a 2-row variant.
  // There is deliberately NO COMMIT anywhere in this file. On any error the transaction is rolled
  // back and the client is released with the error so pg discards the connection.
  const payload = Buffer.alloc(2200, 7).toString("base64");
  const timedRolledBackInsert = async (sql: string): Promise<number> => {
    const c = await pool.connect();
    let failure: Error | undefined;
    try {
      await c.query("BEGIN");
      const t0 = performance.now();
      await c.query(sql, [orderId, payload]);
      const ms = performance.now() - t0;
      await c.query("ROLLBACK");
      return ms;
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e));
      try {
        await c.query("ROLLBACK");
      } catch {
        /* connection is discarded below */
      }
      throw e;
    } finally {
      c.release(failure);
    }
  };
  const insertOne = () =>
    timedRolledBackInsert("INSERT INTO print_jobs (order_id, job_type, printer_id, payload) VALUES ($1,'kot','probe-1',$2)");
  const insertTwo = () =>
    timedRolledBackInsert(
      "INSERT INTO print_jobs (order_id, job_type, printer_id, payload) VALUES ($1,'kot','probe-1',$2),($1,'kot','probe-2',$2)",
    );
  for (const [name, fn] of [["insert_job: 1 row (rolled back)", insertOne], ["insert_job: 2 rows, one statement (rolled back)", insertTwo]] as const) {
    await fn();
    const vals: number[] = [];
    for (let i = 0; i < iterations; i++) vals.push(await fn());
    vals.sort((a, b) => a - b);
    rows.push({ stage: name, n: vals.length, p50: +pct(vals, 50).toFixed(1), p95: +pct(vals, 95).toFixed(1), max: +vals[vals.length - 1].toFixed(1) });
  }

  const { PUSHER_APP_ID: appId, PUSHER_KEY: key, PUSHER_SECRET: secret } = process.env;
  if (appId && key && secret) {
    const pusher = new PusherServer({ appId, key, secret, cluster: process.env.PUSHER_CLUSTER || "ap2", useTLS: true });
    // Throwaway channel: random suffix, NEVER the restaurant's PUSHER_CHANNEL.
    const channel = `private-bagicha-probe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const data = { jobId: 0, orderId, jobType: "kot", printerId: "probe-1", payload };
    rows.push(await sample("pusher: trigger ×1", () => pusher.trigger(channel, "PRINT_JOB", data)));
    rows.push(
      await sample("pusher: trigger ×2 sequential (today's multi-printer cost)", async () => {
        await pusher.trigger(channel, "PRINT_JOB", data);
        await pusher.trigger(channel, "PRINT_JOB", data);
      }),
    );
    rows.push(
      await sample("pusher: triggerBatch ×2 (one call)", () =>
        pusher.triggerBatch([
          { channel, name: "PRINT_JOB", data },
          { channel, name: "PRINT_JOB", data },
        ]),
      ),
    );
  } else {
    console.warn("⚠ PUSHER_* not set — Pusher stages skipped");
  }

  console.log(`\n== stage probe (${iterations} iterations, ms) ==`);
  console.table(rows);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/probe-print-stages.ts --iterations 10`
Expected: a `== stage probe (10 iterations, ms) ==` table with one row per stage (`neon: SELECT 1`, `db_order`, `db_items`, `db_tickets`, two `insert_job` rows, and — if `PUSHER_*` is set — three `pusher:` rows). Exit code 0.

- [ ] **Step 3: Confirm it left no rows**

Run: `npx tsx -r dotenv/config -e "import('./server/db').then(async ({pool}) => { const r = await pool.query(\"select count(*)::int n from print_jobs where printer_id like 'probe-%'\"); console.log(r.rows[0]); await pool.end(); })"`
Expected: `{ n: 0 }`.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add scripts/probe-print-stages.ts
git commit -m "chore(print): stage probe for Neon/Pusher round-trip shares" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Baseline and CHECKPOINT

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-print-queue-latency-design.md` (add a `## Baseline` section)

- [ ] **Step 1: Run the baseline**

Run each, from a quiet moment (no one else hammering the DB):

```bash
npx tsx scripts/bench-print-latency.ts --iterations 20 --label baseline
npx tsx scripts/bench-print-latency.ts --iterations 20 --station --label baseline-station
npx tsx scripts/probe-print-stages.ts --iterations 20
```

Expected: three `RESULT`/table outputs. Save the console tables.

- [ ] **Step 2: Record the baseline in the spec**

Append to the spec a `## Baseline` section containing: date, the machine/network used, the three tables (paste p50/p95 columns), and one sentence naming the largest stage per scenario.

- [ ] **Step 3: CHECKPOINT — stop and agree the target**

Show the user the table and the sentence above. **Do not start Part B until the user states the numeric target** for tap → job-queued (the spec deliberately defers this). Write the agreed target into the spec's Goals section.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add docs/superpowers/specs/2026-10-02-print-queue-latency-design.md
git commit -m "docs(print): record latency baseline and agreed target" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

# PART B — Phase 1: each print endpoint becomes a single call

### Task 8: Pure request helpers

**Files:**
- Create: `shared/printRequest.ts`
- Create: `scripts/verify-print-request.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-print-request.ts`:

```ts
/**
 * Verifies shared/printRequest.ts — the pure helpers behind "one request per print tap":
 * request-flag parsing, the bill-requested rule, the submit-mode → print mapping, the KOT
 * catch-up "nothing to say" test, and executePrintStep's never-throws contract.
 * Run: npx tsx scripts/verify-print-request.ts
 */
import {
  parseBillRequestFlags,
  parseSavePrintRequest,
  shouldMarkBilled,
  printFieldsForSubmitMode,
  isSkippableKotResult,
  executePrintStep,
} from "../shared/printRequest";

const checks: Array<[string, boolean]> = [];
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── parseBillRequestFlags ──
checks.push(["bill flags: empty body", eq(parseBillRequestFlags({}), { withKotCatchUp: false, markBilled: null })]);
checks.push(["bill flags: null body", eq(parseBillRequestFlags(null), { withKotCatchUp: false, markBilled: null })]);
checks.push([
  "bill flags: both set",
  eq(parseBillRequestFlags({ withKotCatchUp: true, markBilled: "always" }), { withKotCatchUp: true, markBilled: "always" }),
]);
checks.push(["bill flags: on_send accepted", parseBillRequestFlags({ markBilled: "on_send" }).markBilled === "on_send"]);
checks.push(["bill flags: bogus markBilled → null", parseBillRequestFlags({ markBilled: "yes" }).markBilled === null]);
checks.push(["bill flags: withKotCatchUp must be a real boolean", parseBillRequestFlags({ withKotCatchUp: "true" }).withKotCatchUp === false]);

// ── parseSavePrintRequest ──
checks.push(["save print: kot + auto", eq(parseSavePrintRequest({ print: "kot", auto: true }), { mode: "kot", auto: true, markBilled: null })]);
checks.push(["save print: auto ignored for bill", parseSavePrintRequest({ print: "bill", auto: true }).auto === false]);
checks.push([
  "save print: bill + markBilled",
  eq(parseSavePrintRequest({ print: "bill", markBilled: "always" }), { mode: "bill", auto: false, markBilled: "always" }),
]);
checks.push(["save print: markBilled ignored for kot", parseSavePrintRequest({ print: "kot", markBilled: "always" }).markBilled === null]);
checks.push(["save print: unknown mode → null", parseSavePrintRequest({ print: "x" }).mode === null]);
checks.push(["save print: no body", parseSavePrintRequest(undefined).mode === null]);

// ── shouldMarkBilled ──
checks.push(["markBilled null never flips", shouldMarkBilled(null, { printed: true, dispatched: true }) === false]);
checks.push(["always flips even for a browser fallback", shouldMarkBilled("always", {}) === true]);
checks.push(["on_send flips when printed", shouldMarkBilled("on_send", { printed: true }) === true]);
checks.push(["on_send flips when dispatched", shouldMarkBilled("on_send", { dispatched: true }) === true]);
checks.push(["on_send does not flip for a browser fallback", shouldMarkBilled("on_send", { browserPrint: true } as any) === false]);

// ── printFieldsForSubmitMode ──
checks.push(["mode kot-print", eq(printFieldsForSubmitMode("kot-print"), { print: "kot" })]);
checks.push(["mode save-print", eq(printFieldsForSubmitMode("save-print"), { print: "bill" })]);
checks.push(["mode bill-print", eq(printFieldsForSubmitMode("bill-print"), { print: "bill", markBilled: "always" })]);
checks.push(["mode save → nothing", eq(printFieldsForSubmitMode("save"), {})]);
checks.push(["mode settle → nothing", eq(printFieldsForSubmitMode("settle"), {})]);

// ── isSkippableKotResult ──
checks.push(["skippable: no_delta", isSkippableKotResult({ reason: "no_delta" }) === true]);
checks.push(["skippable: kot_disabled", isSkippableKotResult({ reason: "kot_disabled" }) === true]);
checks.push(["not skippable: a real dispatch", isSkippableKotResult({ dispatched: true }) === false]);
checks.push(["not skippable: browser preview", isSkippableKotResult({ browserPrint: true }) === false]);

async function main() {
  // ── executePrintStep ──
  let kotCalls = 0;
  let billCalls = 0;
  const run = {
    kot: async () => { kotCalls++; return { ok: true as const, body: { printed: true } }; },
    bill: async () => { billCalls++; return { ok: true as const, body: { dispatched: true } }; },
  };
  const k = await executePrintStep("kot", run);
  checks.push(["step kot: body passes through", eq(k, { printed: true })]);
  checks.push(["step kot: only the kot runner ran", kotCalls === 1 && billCalls === 0]);
  const b = await executePrintStep("bill", run);
  checks.push(["step bill: body passes through", eq(b, { dispatched: true }) && billCalls === 1]);

  const notOk = await executePrintStep("kot", { ...run, kot: async () => ({ ok: false as const, message: "Order not found" }) });
  checks.push(["step: ok:false becomes {error}", eq(notOk, { error: "Order not found" })]);

  let reported: unknown = null;
  const thrown = await executePrintStep(
    "bill",
    { ...run, bill: async () => { throw new Error("Printer error: offline"); } },
    (e) => { reported = e; },
  );
  checks.push(["step: a throw becomes {error} (never rejects)", eq(thrown, { error: "Printer error: offline" })]);
  checks.push(["step: onError is told about the throw", reported instanceof Error]);

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-print-request.ts`
Expected: FAIL — module `../shared/printRequest` not found.

- [ ] **Step 3: Write the implementation**

Create `shared/printRequest.ts`:

```ts
/**
 * Pure helpers for the "one request per print tap" contract. Everything here is DB-free so
 * scripts/verify-print-request.ts can lock it in test:pure.
 */
export type PrintMode = "kot" | "bill";
/**
 * When the server flips a table to "billed" after a bill print:
 *  - "always"  — POS Bill button: any request that got past dispatch (today's POS behaviour);
 *  - "on_send" — Tables-card print: only when something was actually sent (printed or dispatched).
 */
export type MarkBilled = "always" | "on_send";

const parseMarkBilled = (v: unknown): MarkBilled | null =>
  v === "always" || v === "on_send" ? v : null;

const asRecord = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" ? (body as Record<string, unknown>) : {};

/** Flags on POST /api/print/bill. */
export function parseBillRequestFlags(body: unknown): { withKotCatchUp: boolean; markBilled: MarkBilled | null } {
  const b = asRecord(body);
  return { withKotCatchUp: b.withKotCatchUp === true, markBilled: parseMarkBilled(b.markBilled) };
}

/** `print` fields on POST /api/orders and PUT /api/orders/:id/items (Phase 2). */
export function parseSavePrintRequest(body: unknown): { mode: PrintMode | null; auto: boolean; markBilled: MarkBilled | null } {
  const b = asRecord(body);
  const mode: PrintMode | null = b.print === "kot" || b.print === "bill" ? b.print : null;
  return {
    mode,
    auto: mode === "kot" && b.auto === true,
    markBilled: mode === "bill" ? parseMarkBilled(b.markBilled) : null,
  };
}

export function shouldMarkBilled(
  rule: MarkBilled | null,
  body: { printed?: boolean; dispatched?: boolean },
): boolean {
  if (rule === "always") return true;
  if (rule === "on_send") return body.printed === true || body.dispatched === true;
  return false;
}

/** The `print` fields POS.tsx adds to a save, derived from which button was pressed. */
export function printFieldsForSubmitMode(mode: string): { print?: PrintMode; markBilled?: MarkBilled } {
  if (mode === "kot-print") return { print: "kot" };
  if (mode === "save-print") return { print: "bill" };
  if (mode === "bill-print") return { print: "bill", markBilled: "always" };
  return {};
}

/** A KOT result that has nothing to tell the user (no new items / KOT disabled). */
export function isSkippableKotResult(body: { reason?: unknown }): boolean {
  return body.reason === "no_delta" || body.reason === "kot_disabled";
}

export type PrintRunResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Runs the print half of a save-with-print. NEVER rejects: a print failure is returned as
 * `{ error }` so it can ride on the save response without turning a committed save into a 5xx.
 */
export async function executePrintStep(
  mode: PrintMode,
  run: { kot: () => Promise<PrintRunResult>; bill: () => Promise<PrintRunResult> },
  onError: (err: unknown) => void = () => {},
): Promise<Record<string, unknown>> {
  try {
    const r = await (mode === "kot" ? run.kot() : run.bill());
    return r.ok ? r.body : { error: r.message };
  } catch (err: any) {
    onError(err);
    return { error: err?.message || "Print failed" };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx scripts/verify-print-request.ts`
Expected: all `PASS`, `RESULT: PASS ✅`.

- [ ] **Step 5: Add to `test:pure`**

In `package.json`, append `&& tsx scripts/verify-print-request.ts` to the end of the `"test:pure"` value (after `verify-print-perf.ts`).

Run: `npm run test:pure 2>&1 | tail -3`
Expected: ends with `RESULT: PASS ✅`, exit 0.

- [ ] **Step 6: Commit** (only if the user has asked)

```bash
git add shared/printRequest.ts scripts/verify-print-request.ts package.json
git commit -m "feat(print): pure request helpers for the one-request-per-tap contract" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Batch realtime publish

**Files:**
- Modify: `server/realtime/publisher.ts`
- Create: `scripts/verify-realtime-batch.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-realtime-batch.ts`:

```ts
/**
 * Verifies the realtime publishers' batch path: PusherPublisher.publishMany sends ONE
 * triggerBatch per 10 events (Pusher's per-call cap) instead of one HTTPS call per event, and
 * falls back to per-event trigger when the SDK has no triggerBatch. DB-free.
 * Run: npx tsx scripts/verify-realtime-batch.ts
 */
import { PusherPublisher, LocalWsPublisher, CompositePublisher } from "../server/realtime/publisher";

const checks: Array<[string, boolean]> = [];
const ev = (n: number) => ({ type: "PRINT_JOB", jobId: n, printerId: `p${n}` });

async function main() {
  // 1 event → plain trigger, no batch
  {
    const triggers: any[] = [];
    const batches: any[] = [];
    const pub = new PusherPublisher(
      { trigger: async (c: string, n: string, d: unknown) => { triggers.push([c, n, d]); }, triggerBatch: async (b: any) => { batches.push(b); } },
      "ch",
    );
    await pub.publishMany([ev(1)]);
    checks.push(["1 event uses trigger()", triggers.length === 1 && batches.length === 0]);
    checks.push(["trigger() payload drops `type` into the event name", triggers[0][1] === "PRINT_JOB" && !("type" in (triggers[0][2] as object))]);
  }

  // 3 events → exactly one batch with channel/name/data per entry
  {
    const batches: any[][] = [];
    const pub = new PusherPublisher({ trigger: async () => {}, triggerBatch: async (b: any) => { batches.push(b); } }, "ch");
    await pub.publishMany([ev(1), ev(2), ev(3)]);
    checks.push(["3 events → one triggerBatch call", batches.length === 1 && batches[0].length === 3]);
    checks.push([
      "batch entries carry channel, name and data without type",
      batches[0].every((e: any) => e.channel === "ch" && e.name === "PRINT_JOB" && !("type" in e.data)) && batches[0][2].data.jobId === 3,
    ]);
  }

  // 25 events → chunks of 10, 10, 5
  {
    const batches: any[][] = [];
    const pub = new PusherPublisher({ trigger: async () => {}, triggerBatch: async (b: any) => { batches.push(b); } }, "ch");
    await pub.publishMany(Array.from({ length: 25 }, (_, i) => ev(i)));
    checks.push(["25 events → 3 batches of 10/10/5", eq(batches.map((b) => b.length), [10, 10, 5])]);
  }

  // empty → nothing
  {
    let calls = 0;
    const pub = new PusherPublisher({ trigger: async () => { calls++; }, triggerBatch: async () => { calls++; } }, "ch");
    await pub.publishMany([]);
    checks.push(["empty list makes no call", calls === 0]);
  }

  // SDK without triggerBatch → per-event trigger
  {
    const triggers: any[] = [];
    const pub = new PusherPublisher({ trigger: async (c: string, n: string, d: unknown) => { triggers.push([c, n, d]); } } as any, "ch");
    await pub.publishMany([ev(1), ev(2)]);
    checks.push(["no triggerBatch → falls back to trigger() per event", triggers.length === 2]);
  }

  // Local WS publisher broadcasts each event
  {
    const seen: any[] = [];
    const pub = new LocalWsPublisher((d) => { seen.push(d); });
    await pub.publishMany([ev(1), ev(2)]);
    checks.push(["LocalWsPublisher.publishMany broadcasts each event", seen.length === 2 && seen[1].jobId === 2]);
  }

  // Composite fans publishMany out to every member (member without publishMany → publish loop)
  {
    const seenA: any[] = [];
    const seenB: any[] = [];
    const a = new LocalWsPublisher((d) => { seenA.push(d); });
    const b = { publish: async (e: any) => { seenB.push(e); } };
    await new CompositePublisher([a, b as any]).publishMany([ev(1), ev(2)]);
    checks.push(["CompositePublisher.publishMany reaches every member", seenA.length === 2 && seenB.length === 2]);
  }

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

function eq(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

main();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-realtime-batch.ts`
Expected: FAIL — `pub.publishMany is not a function` (TypeError).

- [ ] **Step 3: Implement `publishMany`**

In `server/realtime/publisher.ts`:

1. Replace the `RealtimePublisher` interface with:

```ts
export interface RealtimePublisher {
  publish(event: RealtimeEvent): Promise<void>;
  /**
   * Optional batch path — one network call for many events. Callers use publishRealtimeMany(),
   * never this directly; a publisher without it is driven through publish() per event.
   */
  publishMany?(events: RealtimeEvent[]): Promise<void>;
}
```

2. Replace the `LocalWsPublisher` class with:

```ts
export class LocalWsPublisher implements RealtimePublisher {
  constructor(private broadcast: (data: RealtimeEvent) => void) {}

  async publish(event: RealtimeEvent): Promise<void> {
    this.broadcast(event);
  }

  async publishMany(events: RealtimeEvent[]): Promise<void> {
    for (const event of events) this.broadcast(event);
  }
}
```

3. Replace the `PusherServer` interface and the `PusherPublisher` class with:

```ts
interface PusherServer {
  trigger: (channel: string, event: string, data: unknown) => Promise<unknown>;
  triggerBatch?: (batch: Array<{ channel: string; name: string; data: unknown }>) => Promise<unknown>;
  authorizeChannel?: (socketId: string, channel: string) => unknown;
}

/** Pusher's HTTP API accepts at most 10 events per triggerBatch call. */
const PUSHER_BATCH_LIMIT = 10;

/** Pusher Channels — works on Vercel + browser + Electron. */
export class PusherPublisher implements RealtimePublisher {
  private pusher: PusherServer;
  private channel: string;

  constructor(pusher: PusherServer, channel: string) {
    this.pusher = pusher;
    this.channel = channel;
  }

  async publish(event: RealtimeEvent): Promise<void> {
    const { type, ...data } = event;
    await this.pusher.trigger(this.channel, type, data);
  }

  async publishMany(events: RealtimeEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (events.length === 1 || !this.pusher.triggerBatch) {
      await Promise.all(events.map((e) => this.publish(e)));
      return;
    }
    for (let i = 0; i < events.length; i += PUSHER_BATCH_LIMIT) {
      const chunk = events
        .slice(i, i + PUSHER_BATCH_LIMIT)
        .map(({ type, ...data }) => ({ channel: this.channel, name: type, data }));
      await this.pusher.triggerBatch(chunk);
    }
  }
}
```

4. Replace the `CompositePublisher` class with:

```ts
export class CompositePublisher implements RealtimePublisher {
  constructor(private publishers: RealtimePublisher[]) {}

  async publish(event: RealtimeEvent): Promise<void> {
    await Promise.all(this.publishers.map((p) => p.publish(event)));
  }

  async publishMany(events: RealtimeEvent[]): Promise<void> {
    await Promise.all(
      this.publishers.map((p) =>
        p.publishMany ? p.publishMany(events) : Promise.all(events.map((e) => p.publish(e))).then(() => undefined),
      ),
    );
  }
}
```

5. Directly after the existing `publishRealtime` function add:

```ts
/** Batch variant of publishRealtime — one Pusher call for many events. Never throws. */
export async function publishRealtimeMany(events: RealtimeEvent[]): Promise<void> {
  try {
    if (publisher.publishMany) {
      await publisher.publishMany(events);
    } else {
      await Promise.all(events.map((e) => publisher.publish(e)));
    }
  } catch (err) {
    console.error("[realtime] publishMany failed:", err);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx scripts/verify-realtime-batch.ts`
Expected: all `PASS`, `RESULT: PASS ✅`.

- [ ] **Step 5: Type-check and add to `test:pure`**

Run: `npm run check`
Expected: exits 0.

Append `&& tsx scripts/verify-realtime-batch.ts` to `"test:pure"` in `package.json`.

Run: `npm run test:pure 2>&1 | tail -3`
Expected: ends with `RESULT: PASS ✅`, exit 0.

- [ ] **Step 6: Commit** (only if the user has asked)

```bash
git add server/realtime/publisher.ts scripts/verify-realtime-batch.ts package.json
git commit -m "feat(realtime): batch publish via Pusher triggerBatch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Service — parallel reads and one-insert / one-batch dispatch

**Files:**
- Modify: `server/services/printDispatch.ts`

- [ ] **Step 1: Switch the dispatch helper to batch**

In `server/services/printDispatch.ts`:

a) Change the publisher import line from `import { publishRealtime } from "../realtime/publisher";` to:

```ts
import { publishRealtimeMany } from "../realtime/publisher";
```

b) Replace the whole `dispatchRemotePrintJob` function (from its doc comment through its closing `}`) with:

```ts
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
```

c) In `runKotPrint`, replace

```ts
  const dispatchedJobs = [] as ReturnType<typeof toPrintJob>[];
  for (const j of remoteJobs) {
    const jobId = await dispatchRemotePrintJob(
      { orderId, jobType: "kot", printerId: j.printer.id, payload: j.buffer.toString("base64") },
      timer,
    );
    dispatchedJobs.push(toPrintJob(j.printer.id, j.buffer, { orderId, ackType: "kot", jobId }));
  }
```

with:

```ts
  const jobIds = await dispatchRemotePrintJobs(
    remoteJobs.map((j) => ({ orderId, jobType: "kot" as const, printerId: j.printer.id, payload: j.buffer.toString("base64") })),
    timer,
  );
  const dispatchedJobs = remoteJobs.map((j) =>
    toPrintJob(j.printer.id, j.buffer, { orderId, ackType: "kot", jobId: jobIds.get(j.printer.id) }),
  );
```

d) In `runBillPrint`, replace

```ts
    billJobId = await dispatchRemotePrintJob(
      { orderId, jobType: "bill", printerId: printer.id, payload: buffer.toString("base64") },
      timer,
    );
```

with:

```ts
    const billJobIds = await dispatchRemotePrintJobs(
      [{ orderId, jobType: "bill", printerId: printer.id, payload: buffer.toString("base64") }],
      timer,
    );
    billJobId = billJobIds.get(printer.id);
```

- [ ] **Step 2: Read order, items and tickets in parallel (KOT)**

In `runKotPrint`, replace this block

```ts
  const [order] = await timer.time("db_order", () =>
    db.select().from(orders).where(eq(orders.id, orderId)),
  );
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  const rawItems = await timer.time("db_items", () =>
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
  );
```

with:

```ts
  // The three reads are independent (all keyed by orderId) — run them concurrently so the
  // tap pays one Neon round trip, not three.
  const [[order], rawItems, orderKotTickets] = await Promise.all([
    timer.time("db_order", () => db.select().from(orders).where(eq(orders.id, orderId))),
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
```

Then replace the browser-branch tickets read

```ts
    const browserKotTickets = await timer.time("db_tickets", () =>
      db.select().from(kotTickets).where(eq(kotTickets.orderId, orderId)).orderBy(asc(kotTickets.id)),
    );
```

with:

```ts
    const browserKotTickets = orderKotTickets;
```

and delete the normal-branch read (the comment line `// Fetch KOT tickets for this order to retrieve the sequential KOT number` plus the `const orderKotTickets = await timer.time("db_tickets", …);` statement that follows it, 4 lines in total).

- [ ] **Step 3: Read order and items in parallel (Bill)**

In `runBillPrint`, replace

```ts
  const [order] = await timer.time("db_order", () =>
    db.select().from(orders).where(eq(orders.id, orderId)),
  );
  if (!order) return { ok: false, status: 404, message: "Order not found" };
```

with:

```ts
  const orderRead = timer.time("db_order", () =>
    db.select().from(orders).where(eq(orders.id, orderId)),
  );
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
  if (!order) return { ok: false, status: 404, message: "Order not found" };
```

and delete the later standalone `const rawItems = await timer.time("db_items", () => … );` statement (the one that starts right after the `isReprint` block and ends before the `// Per-section bill routing.` comment).

- [ ] **Step 4: Type-check, run the unit tests, re-run the bench**

Run: `npm run check`
Expected: exits 0.

Run: `npm run test:pure 2>&1 | tail -3`
Expected: `RESULT: PASS ✅`.

Run: `npx tsx scripts/bench-print-latency.ts --iterations 20 --label after-parallel`
Expected: `RESULT: PASS ✅` (same response shapes); the `db_*` stages overlap, so `total` should be lower than the Task 7 baseline for each scenario. If the shape check fails, do **not** proceed — diff the response against the baseline run.

- [ ] **Step 5: Commit** (only if the user has asked)

```bash
git add server/services/printDispatch.ts
git commit -m "perf(print): parallel reads, one INSERT and one Pusher batch per tap" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Bill absorbs the KOT catch-up and the bill-requested flip

**Files:**
- Modify: `shared/print/types.ts`
- Modify: `server/services/printDispatch.ts`
- Modify: `server/printRoutes.ts` (bill handler)

- [ ] **Step 1: Extend the response type**

In `shared/print/types.ts`, inside `interface PrintApiResponse`, after the `dispatched?: boolean;` line add:

```ts
  /**
   * Bill requests sent with `withKotCatchUp`: the result of the silent KOT catch-up the server ran
   * BEFORE the bill (same shape as a /api/print/kot response). Absent when the catch-up had nothing
   * to send (no_delta / kot_disabled); `{ error }` when it failed.
   */
  kotCatchUp?: PrintApiResponse | { error: string };
```

- [ ] **Step 2: Add the imports and helpers to the service**

In `server/services/printDispatch.ts`:

a) Add to the imports:

```ts
import { storage } from "../storage";
import { publishRealtime, publishRealtimeMany } from "../realtime/publisher";
import {
  isSkippableKotResult,
  shouldMarkBilled,
  type MarkBilled,
} from "@shared/printRequest";
```

(and delete the earlier `import { publishRealtimeMany } from "../realtime/publisher";` line so the module is imported once).

b) Directly above `export async function runBillPrint` add:

```ts
type OrderRow = typeof orders.$inferSelect;
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
```

- [ ] **Step 3: Teach `runBillPrint` about the catch-up and the flip**

a) Replace the `runBillPrint` signature and its first two lines

```ts
export async function runBillPrint(p: {
  req: Request;
  orderId: number;
  timer?: StageTimer;
}): Promise<PrintResult> {
  const { req, orderId } = p;
  const timer = p.timer ?? createStageTimer();
```

with:

```ts
export async function runBillPrint(p: {
  req: Request;
  orderId: number;
  timer?: StageTimer;
  /** Run the silent KOT delta check first (what the client used to do in a separate call). */
  withKotCatchUp?: boolean;
  /** Flip the table to "billed" after the print (what the client used to do in a separate call). */
  markBilled?: MarkBilled | null;
}): Promise<PrintResult> {
  const { req, orderId } = p;
  const timer = p.timer ?? createStageTimer();

  // Kitchen-first, always (when asked): anything added since the last KOT reaches the kitchen
  // before the bill prints — a safety net that now costs zero extra round trips. Runs BEFORE
  // the order is read so the bill sees the updated kotPrintCount.
  const kotCatchUp = p.withKotCatchUp ? await runKotCatchUp(req, orderId, timer.scoped("kot")) : undefined;
```

b) Directly after `if (!order) return { ok: false, status: 404, message: "Order not found" };` in `runBillPrint` add:

```ts

  /** Every success exit goes through here: attach the catch-up result, then the optional flip. */
  const done = async (body: Record<string, unknown>): Promise<PrintResult> => {
    if (kotCatchUp) body.kotCatchUp = kotCatchUp;
    if (shouldMarkBilled(p.markBilled ?? null, body as { printed?: boolean; dispatched?: boolean })) {
      await timer.time("mark_billed", () => markTableBilled(order));
    }
    return { ok: true, body };
  };
```

c) In `runBillPrint`, change each of the four success returns to go through `done`:

- `return { ok: true, body: { browserPrint: true } };` → `return done({ browserPrint: true });`
- `return { ok: true, body: { printed: true } };` → `return done({ printed: true });`
- the non-ESC/POS browser return →

```ts
    return done({
      printed: false,
      browserPrint: true,
      message: nonEscPosPrinterMessage(printer),
      orderId,
    });
```

- the final remote-dispatch return →

```ts
  return done({
    printed: false,
    dispatched: escPosOk,
    printJob: escPosOk ? toPrintJob(printer.id, buffer, { orderId, ackType: "bill", jobId: billJobId }) : undefined,
    browserPrint: !escPosOk,
    message: escPosOk ? undefined : nonEscPosPrinterMessage(printer),
    pendingAck: escPosOk,
    orderId,
  });
```

- [ ] **Step 4: Wire the handler**

In `server/printRoutes.ts`:

a) Add to the imports: `import { parseBillRequestFlags } from "@shared/printRequest";`

b) In the `/api/print/bill` handler, replace

```ts
      const result = await runBillPrint({ req, orderId, timer });
```

with:

```ts
      const { withKotCatchUp, markBilled } = parseBillRequestFlags(req.body);
      const result = await runBillPrint({ req, orderId, timer, withKotCatchUp, markBilled });
```

(`POST /api/orders/:id/bill-requested` in `routes.ts` is left in place — it is harmless and keeps old cached clients working — but nothing in this repo will call it after Task 12.)

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: exits 0.

Run: `npm run test:pure 2>&1 | tail -3`
Expected: `RESULT: PASS ✅`.

Extend the bench for this task now (small edit so Task 13 only has to run it): in `scripts/bench-print-latency.ts`, add two entries to the `scenarios` array, right after the `bill` entry:

```ts
    { name: "bill+catchup", overrides: {}, route: "/api/print/bill", expectJobs: 2, body: { withKotCatchUp: true } },
```

and change the scenario type, the `timedPost(base, sc.route, { orderId })` call and the shape check so the body can carry extra flags and the job count includes the catch-up job:

- scenarios element type: add `body?: Record<string, unknown>`;
- the call becomes `const r = await timedPost(base, sc.route, { orderId, ...(sc.body ?? {}) });`
- `jobIdsOf(r.json)` must also count the catch-up jobs: replace its definition with

```ts
const jobIdsOf = (json: any): number[] => {
  const own = (json.printJobs ?? (json.printJob ? [json.printJob] : [])).map((j: any) => j.jobId);
  const catchUp = json.kotCatchUp && !json.kotCatchUp.error
    ? (json.kotCatchUp.printJobs ?? (json.kotCatchUp.printJob ? [json.kotCatchUp.printJob] : [])).map((j: any) => j.jobId)
    : [];
  return [...catchUp, ...own].filter((x: any) => typeof x === "number");
};
```

With a fresh bench order (never KOT-printed) the catch-up sends the full order, so `bill+catchup` returns 1 KOT job + 1 bill job = `expectJobs: 2`.

Run: `npx tsx scripts/bench-print-latency.ts --iterations 5 --label t11`
Expected: `RESULT: PASS ✅`; the `bill+catchup` table includes `kot_db_order`, `kot_db_items`, `kot_db_tickets`, `kot_insert_job`, `kot_pusher`, `kot_commit` stages, proving the catch-up ran inside the single request.

- [ ] **Step 6: Commit** (only if the user has asked)

```bash
git add shared/print/types.ts server/services/printDispatch.ts server/printRoutes.ts scripts/bench-print-latency.ts
git commit -m "feat(print): bill absorbs the KOT catch-up and the bill-requested flip server-side" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Client cutover — Phase 1

**Files:**
- Create: `scripts/dev-quiet-print-jobs.ts`
- Create: `client/src/lib/printPerfClient.ts`
- Modify: `client/src/lib/printGateway.ts` (`printBillDirect`)
- Modify: `client/src/pages/Tables.tsx` (`printTableBill`)
- Modify: `client/src/pages/POS.tsx` (`triggerKOTPrint`, `triggerBillPrint`, two `bill-print` branches, tap marks)

- [ ] **Step 0: Helper for the manual checks**

Create `scripts/dev-quiet-print-jobs.ts`:

```ts
/**
 * Marks one order's pending print_jobs as printed. Use right after a manual KOT/Bill tap on a
 * throwaway order so the restaurant host's catch-up poll can never pick the job up.
 * Run: npx tsx scripts/dev-quiet-print-jobs.ts <orderId>
 */
import "dotenv/config";
import { pool } from "../server/db";

const orderId = Number(process.argv[2]);
if (!orderId) {
  console.error("usage: tsx scripts/dev-quiet-print-jobs.ts <orderId>");
  process.exit(2);
}
const r = await pool.query(
  "UPDATE print_jobs SET status = 'printed', printed_at = now() WHERE order_id = $1 AND status = 'pending' RETURNING id",
  [orderId],
);
console.log(`marked ${r.rowCount} job(s) printed for order ${orderId}`);
await pool.end();
```

- [ ] **Step 1: Client tap marks**

Create `client/src/lib/printPerfClient.ts`:

```ts
import { createStageTimer, type StageTimer } from "@shared/printPerf";

/**
 * POS tap → printed-response marks. One tap at a time (a POS has one cart). Logs a single
 * `[print-perf]` console line per tap so real-use numbers (Vercel, Electron host) can be read
 * from DevTools without any test data. Never throws, never affects the print flow.
 */
let current: { kind: string; timer: StageTimer } | null = null;

export function startPrintTap(kind: string): void {
  current = { kind, timer: createStageTimer() };
}

export function timePrintStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return current ? current.timer.time(name, fn) : fn();
}

export function endPrintTap(): void {
  if (!current) return;
  try {
    console.log(current.timer.toLogLine(`tap:${current.kind}`));
  } finally {
    current = null;
  }
}
```

- [ ] **Step 2: `printBillDirect` accepts `markBilled`**

In `client/src/lib/printGateway.ts`, replace the whole `printBillDirect` function with:

```ts
/** Direct bill print via API → thermal/Electron/server (no browser dialog unless fallback requested). */
export async function printBillDirect(
  orderId: number,
  options: Omit<PrintHandleOptions, "orderId" | "ackType"> & { markBilled?: "always" | "on_send" } = {},
): Promise<PrintHandleResult> {
  const { markBilled, ...handleOptions } = options;
  const res = await fetch(apiUrl("/api/print/bill"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, ...(markBilled ? { markBilled } : {}) }),
    credentials: "include",
  });
  const data = (await res.json()) as PrintApiResponse & {
    orderId?: number;
    pendingAck?: boolean;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.message ?? "Bill print failed");
  }
  return handlePrintResponse(data, {
    ...handleOptions,
    orderId,
    ackType: "bill",
    pendingAck: data.pendingAck,
  });
}
```

- [ ] **Step 3: Tables-card bill uses the server-side flip**

In `client/src/pages/Tables.tsx`, replace the `printTableBill` body's first branch

```ts
      const { printBillDirect } = await import("@/lib/printGateway");
      const outcome = await printBillDirect(orderId);
      if (outcome === "hardware" || outcome === "dispatched") {
        toast({ title: "Bill sent to printer!" });
        // Same status flip POS.tsx's Bill button does (POST bill-requested) — marks
        // the table "billed" so this card matches the POS cart's Print Bill outcome
        // instead of staying "running" with the print button still showing.
        apiRequest("POST", `/api/orders/${orderId}/bill-requested`, {})
          .then(() => queryClient.invalidateQueries({ queryKey: ["/api/tables"] }))
          .catch(() => {
            // non-critical — bill is printed even if status update fails
          });
      } else if (outcome === "browser") {
```

with:

```ts
      const { printBillDirect } = await import("@/lib/printGateway");
      // markBilled:"on_send" — the SERVER flips the table to "billed" inside the same request, and
      // only when something was actually sent (browser/noop outcomes deliberately don't flip).
      const outcome = await printBillDirect(orderId, { markBilled: "on_send" });
      if (outcome === "hardware" || outcome === "dispatched") {
        toast({ title: "Bill sent to printer!" });
        queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      } else if (outcome === "browser") {
```

(`apiRequest` is still used elsewhere in `Tables.tsx`; keep its import.)

- [ ] **Step 4: POS — split the response handling out of the fetchers**

In `client/src/pages/POS.tsx`:

a) Add to the imports near the other `@/lib` imports: `import { startPrintTap, timePrintStage, endPrintTap } from "@/lib/printPerfClient";`

b) Replace the whole block from `const triggerKOTPrint = async (orderId: number, order?: any, silent = false) => {` through the end of `triggerBillPrint` (its closing `};` just before `const form = useForm<OrderForm>({`) with:

```ts
  // ── Print result handlers ───────────────────────────────────────────────────
  // One handler per print kind, shared by EVERY path that can produce a result: the standalone
  // /api/print/* fetchers below, a bill response's `kotCatchUp` part, and (Phase 2) the `print`
  // result that rides back on an order save.

  const handleKotResult = async (data: any, orderId: number, order: any, silent: boolean) => {
    const { handlePrintResponse } = await import('@/lib/printGateway');
    const outcome = await timePrintStage('handle_kot', () =>
      handlePrintResponse(data, {
        orderId,
        ackType: 'kot',
        pendingAck: data.pendingAck,
        onBrowserKOT: () => {
          if (!order) {
            printKOT(
              { orderNumber: data.orderNumber, tableNumber: data.tableNumber, createdAt: new Date() },
              data.items ?? [],
            );
          }
        },
      }),
    );
    if (outcome === 'skipped') {
      // silent: the KOT part of a bill print (the quiet catch-up check) — a no-op there just
      // means "nothing new", which should feel like plain bill printing, not surface irrelevant
      // KOT chatter. A genuine manual KOT click (silent=false) still tells the user so.
      if (!silent) toast({ title: 'Nothing new to print', description: 'No new items added since last KOT' });
    } else if (outcome === 'hardware') {
      // data.message carries a partial-failure note when one routed printer failed
      // but at least one other printer (direct or dispatched) still got the ticket —
      // "printed: true" is accurate for the ones that succeeded, but staff still need
      // to know a specific printer needs attention, not silence.
      toast(data.message
        ? { title: 'KOT sent to printer!', description: data.message, variant: 'destructive' }
        : { title: 'KOT sent to printer!' });
    } else if (outcome === 'browser') {
      toast({
        title: data.reason === 'non_escpos_printer' ? 'Use KOT preview to print' : 'KOT ready',
        description:
          data.message ??
          (data.reason === 'non_escpos_printer'
            ? 'Office printers cannot print thermal tickets. Use Print in the preview window or add a thermal printer.'
            : 'Use Print in the preview panel.'),
      });
      if (order) showKOTPreview(order, data?.kotNumber);
    } else if (outcome === 'dispatched') {
      toast({ title: 'Sent to kitchen printer!' });
    } else if (outcome === 'noop' && data.printJob) {
      toast({
        title: 'Print job ready',
        description: 'Use the Electron app for thermal printing.',
        variant: 'destructive',
      });
      if (order) showKOTPreview(order, data?.kotNumber);
    }
    // Refetch the order so existingOrder.lastKotSnapshot reflects what was just
    // printed — nothing previously refetched this AFTER a print (only before, via
    // updateOrderMutation's own onSuccess). Without this, the per-item cancel-after-
    // KOT dialog (POS.tsx's requestRemoveFromCart) could miss a same-session
    // "add item → KOT it → remove it" sequence until something else happened to
    // refetch. The server-side guard in PUT /api/orders/:id/items still catches it
    // correctly either way — this is purely so the UI prompts for a reason when it
    // should, rather than the save failing with a confusing error.
    queryClient.invalidateQueries({ queryKey: ["/api/orders", String(orderId)] });
  };

  const handleBillResult = async (data: any, orderId: number, order: any, markBilled?: 'always' | 'on_send') => {
    // The server ran the silent KOT catch-up inside the same request (kitchen-first safety net —
    // anything added since the last KOT reaches the kitchen before the bill prints). Its result
    // is handled exactly as a quiet KOT click used to be: silent on "nothing new", a normal toast
    // on a genuine send, a failure toast + preview on error.
    if (data.kotCatchUp) {
      if (data.kotCatchUp.error) {
        toast({ title: 'KOT print failed', description: data.kotCatchUp.error, variant: 'destructive' });
        if (order) showKOTPreview(order);
      } else {
        await handleKotResult(data.kotCatchUp, orderId, order, true);
      }
    }
    const { handlePrintResponse } = await import('@/lib/printGateway');
    const outcome = await timePrintStage('handle_bill', () =>
      handlePrintResponse(data, {
        orderId,
        ackType: 'bill',
        pendingAck: data.pendingAck,
        onBrowserBill: async () => {
          // apiJson() checks res.ok before parsing — a hand-rolled fetch(...).then(r =>
          // r.json()) here used to let a non-2xx response's error body flow straight into
          // printOrderBill as if it were real order/settings data instead of throwing
          // (which the caller's catch already handles via showBillPreview).
          const [freshOrder, freshSettings] = await Promise.all([
            apiJson<any>(`/api/orders/${orderId}`),
            apiJson<any>('/api/settings'),
          ]);
          const printed = await printOrderBill(freshOrder, freshOrder.items || [], freshSettings);
          // Popup + iframe both blocked (rare) — show the in-page preview so the user isn't stuck.
          if (!printed) showBillPreview(freshOrder ?? order);
        },
      }),
    );
    if (outcome === 'hardware' || outcome === 'browser' || outcome === 'dispatched') {
      toast({ title: 'Bill sent to printer!' });
    } else if (outcome === 'noop' && data.printJob) {
      toast({
        title: 'Print job ready',
        description: 'Use the Electron app for thermal printing.',
        variant: 'destructive',
      });
      if (order) showBillPreview(order);
    }
    // The server flipped the table to "billed" inside the print request — refresh the table list.
    if (markBilled) queryClient.invalidateQueries({ queryKey: ['/api/tables'] });
  };

  const triggerKOTPrint = async (orderId: number, order?: any) => {
    try {
      const res = await timePrintStage('kot_http', () =>
        fetch(apiUrl('/api/print/kot'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
          credentials: 'include',
        }),
      );
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'KOT print failed',
          description: data?.message ?? 'Printer error — showing preview instead.',
          variant: 'destructive',
        });
        if (order) showKOTPreview(order, data?.kotNumber);
        return;
      }
      await handleKotResult(data, orderId, order, false);
    } catch {
      if (order) showKOTPreview(order);
    }
  };

  // ONE request: the server runs the KOT catch-up and (when markBilled is set) the table →
  // "billed" flip inside /api/print/bill, instead of this client chaining /api/print/kot,
  // /api/print/bill and /api/orders/:id/bill-requested.
  const triggerBillPrint = async (orderId: number, order?: any, markBilled?: 'always' | 'on_send') => {
    try {
      const res = await timePrintStage('bill_http', () =>
        fetch(apiUrl('/api/print/bill'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, withKotCatchUp: true, ...(markBilled ? { markBilled } : {}) }),
          credentials: 'include',
        }),
      );
      const data = await res.json();
      if (!res.ok) {
        if (order) showBillPreview(order);
        return;
      }
      await handleBillResult(data, orderId, order, markBilled);
    } catch {
      if (order) showBillPreview(order);
    }
  };
```

c) In `createOrderMutation.onSuccess`, replace the `bill-print` branch's two statements

```ts
        triggerBillPrint(order.id, order).finally(() => setIsPrinting(false));
        apiRequest("POST", `/api/orders/${order.id}/bill-requested`, {})
          .then(() => queryClient.invalidateQueries({ queryKey: ["/api/tables"] }))
          .catch(() => {
            // non-critical — bill is printed even if status update fails
          });
```

with:

```ts
        triggerBillPrint(order.id, order, "always").finally(() => { setIsPrinting(false); endPrintTap(); });
```

d) In `updateOrderMutation.onSuccess`, replace the `bill-print` branch's

```ts
        triggerBillPrint(vars.orderId, order).finally(() => setIsPrinting(false));
        apiRequest("POST", `/api/orders/${vars.orderId}/bill-requested`, {})
          .then(() => queryClient.invalidateQueries({ queryKey: ["/api/tables"] }))
          .catch(() => {
            // non-critical — bill is printed even if status update fails
          });
```

with:

```ts
        triggerBillPrint(vars.orderId, order, "always").finally(() => { setIsPrinting(false); endPrintTap(); });
```

e) Tap marks: change the three print handlers so each begins the tap and the other print call sites end it.

- `handleKOT`: replace its body with `cancelPendingAutoKot(); capturePreKOTItems(); startPrintTap("kot"); submitModeRef.current = "kot-print"; setIsPrinting(true); triggerSubmit();`
- `handleBillPrint`: after `cancelPendingAutoKot(); capturePreKOTItems();` insert `startPrintTap("bill");`
- `handleSaveAndPrint`: replace its body with `cancelPendingAutoKot(); startPrintTap("save-print"); submitModeRef.current = "save-print"; setIsPrinting(true); triggerSubmit();`
- In both mutations' `onSuccess`, change the remaining `.finally(() => setIsPrinting(false))` on `triggerKOTPrint(...)` (kot-print) and `triggerBillPrint(...)` (save-print) calls to `.finally(() => { setIsPrinting(false); endPrintTap(); })`. There are 4 such calls in total (create kot-print, create save-print, update kot-print, update save-print).
- Wrap each mutation's request in a stage mark: in `createOrderMutation` change `const res = await apiRequest("POST", "/api/orders", data);` to `const res = await timePrintStage("save_http", () => apiRequest("POST", "/api/orders", data));` and in `updateOrderMutation` change `const res = await apiRequest("PUT", `/api/orders/${data.orderId}/items`, data);` to `const res = await timePrintStage("save_http", () => apiRequest("PUT", `/api/orders/${data.orderId}/items`, data));`.

- [ ] **Step 5: Type-check and test**

Run: `npm run check`
Expected: exits 0.

Run: `npm run test:pure 2>&1 | tail -3`
Expected: `RESULT: PASS ✅`.

- [ ] **Step 6: Manual check in the running app (no printer needed)**

Follow the **Manual app checks — safety rules** at the top of this plan first (private `PUSHER_CHANNEL`, throwaway order, `dev-quiet-print-jobs.ts`, Cancel Order). Then, with DevTools → Network open, on the throwaway table: tap **KOT**, then **Bill**, running `npx tsx scripts/dev-quiet-print-jobs.ts <orderId>` after each.
Expected for **Bill**: exactly **one** `print/bill` request (no `print/kot` request, no `bill-requested` request) after the save, plus a console line `[print-perf] tap:bill save_http=… bill_http=… handle_bill=… total=…`. For **KOT**: one `print/kot` request after the save.

- [ ] **Step 7: Commit** (only if the user has asked)

```bash
git add client/src/lib/printPerfClient.ts client/src/lib/printGateway.ts client/src/pages/Tables.tsx client/src/pages/POS.tsx
git commit -m "feat(pos): Bill is one print request (server runs KOT catch-up and bill-requested)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Phase 1 bench

**Files:**
- Modify: `scripts/bench-print-latency.ts` (legacy-chain scenario)
- Modify: `docs/superpowers/specs/2026-10-02-print-queue-latency-design.md` (`## After Phase 1`)

- [ ] **Step 1: Add the legacy-chain scenario for a fair comparison**

In `scripts/bench-print-latency.ts`, after the `scenarios` array, add a second loop-driven scenario that replays the OLD client chain (KOT call, then bill call, sequentially) against a fresh order so the single-call `bill+catchup` can be compared with what a tap used to cost. Insert, inside the `try` block right after the `for (const sc of scenarios) { … }` loop closes:

```ts
    // Old client behaviour, replayed: /api/print/kot then /api/print/bill, one after the other.
    {
      s.printSettings.kot.categoryPrinterOverrides = {};
      const samples = new Map<string, number[]>();
      for (let i = 0; i < iterations + 2; i++) {
        const orderId = await createBenchOrder(runId, createdIds.length, lines);
        createdIds.push(orderId);
        const t0 = performance.now();
        const k = await timedPost(base, "/api/print/kot", { orderId });
        const b = await timedPost(base, "/api/print/bill", { orderId });
        const wall = performance.now() - t0;
        await pool.query(
          "UPDATE print_jobs SET status = 'printed', printed_at = now() WHERE order_id = $1 AND status = 'pending'",
          [orderId],
        );
        if (k.status !== 200 || b.status !== 200) {
          problems++;
          console.error(`✗ legacy chain #${i}: kot=${k.status} bill=${b.status}`);
        }
        if (i < 2) continue;
        samples.set("wall(2 calls)", [...(samples.get("wall(2 calls)") ?? []), wall]);
      }
      report(`${label} · legacy-chain (kot then bill, 2 requests)`, samples);
    }
```

- [ ] **Step 2: Run the after-Phase-1 bench**

Run: `npx tsx scripts/bench-print-latency.ts --iterations 20 --label after-phase1`
Expected: `RESULT: PASS ✅`; tables for `kot-1-printer`, `kot-2-printers`, `bill`, `bill+catchup`, `legacy-chain`.

- [ ] **Step 3: Record and compare**

Add an `## After Phase 1` section to the spec with the p50/p95 for: `bill+catchup` `wall(client)` vs `legacy-chain` `wall(2 calls)` (the single-call win), and each KOT scenario vs its Task 7 baseline. State whether the user's agreed target (Task 7 Step 3) is met for the **server** half of the tap.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add scripts/bench-print-latency.ts docs/superpowers/specs/2026-10-02-print-queue-latency-design.md
git commit -m "docs(print): phase 1 bench results and legacy-chain comparison" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

# PART C — Phase 2: the save carries the print

### Task 14: Server — `print` on the save routes

**Files:**
- Modify: `server/services/printDispatch.ts` (add `runPrintStep`, `order` param)
- Modify: `server/routes.ts` (imports, `POST /api/orders`, `PUT /api/orders/:id/items`)

- [ ] **Step 1: Let the service accept a preloaded order row**

In `server/services/printDispatch.ts`:

a) Add to the imports: `import { executePrintStep, type PrintMode } from "@shared/printRequest";` (extend the existing `@shared/printRequest` import to include `executePrintStep` and `type PrintMode` rather than adding a second import line).

b) In `runKotPrint`'s parameter object add `order?: OrderRow;` (the `OrderRow` type is declared above `runBillPrint` — move the line `type OrderRow = typeof orders.$inferSelect;` up to just under the `PrintResult` type so both functions see it). In its body, replace the first element of the `Promise.all` array

```ts
    timer.time("db_order", () => db.select().from(orders).where(eq(orders.id, orderId))),
```

with:

```ts
    p.order
      ? Promise.resolve([p.order])
      : timer.time("db_order", () => db.select().from(orders).where(eq(orders.id, orderId))),
```

c) In `runBillPrint`'s parameter object add `order?: OrderRow;` and replace

```ts
  const orderRead = timer.time("db_order", () =>
    db.select().from(orders).where(eq(orders.id, orderId)),
  );
```

with:

```ts
  // A preloaded row (from the save that precedes this print) is only trusted when the KOT
  // catch-up did not change the order — a catch-up that sent something bumped kotPrintCount.
  const orderRead =
    p.order && !kotCatchUp
      ? Promise.resolve([p.order])
      : timer.time("db_order", () => db.select().from(orders).where(eq(orders.id, orderId)));
```

d) Append `runPrintStep` to the end of the file:

```ts
/**
 * The print half of a save-with-print (Phase 2). Never rejects — a failure comes back as
 * `{ error }` so it rides on the save response and can never turn a COMMITTED save into a 5xx.
 */
export async function runPrintStep(p: {
  req: Request;
  orderId: number;
  order: OrderRow;
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
    (err) => console.error(`[Print/${p.mode}] print step failed after the save committed:`, err),
  );
}
```

- [ ] **Step 2: Imports in `routes.ts`**

In `server/routes.ts`, directly after the line `import { registerPrintRoutes } from "./printRoutes";` add:

```ts
import { runPrintStep, instrumentJson } from "./services/printDispatch";
import { parseSavePrintRequest } from "@shared/printRequest";
import { createStageTimer } from "@shared/printPerf";
```

- [ ] **Step 3: `POST /api/orders`**

a) Replace the first lines of the handler

```ts
    try {
      const { items, ...orderInfo } = req.body;
      const lineItems = Array.isArray(items) ? items : [];

      // Recompute all money server-side from DB prices — never trust client totals.
      // This is the ONLY genuine "invalid order data" case (unknown item / bad qty);
```

with:

```ts
    try {
      // `print`/`auto`/`markBilled` are print directives for the step AFTER the save — they must
      // never reach createOrderWithItems as order columns.
      const { items, print: _print, auto: _auto, markBilled: _markBilled, ...orderInfo } = req.body;
      const lineItems = Array.isArray(items) ? items : [];
      const printReq = parseSavePrintRequest(req.body);
      const timer = createStageTimer();
      if (printReq.mode) instrumentJson(res, timer, `save+${printReq.mode} (new order)`);

      // Recompute all money server-side from DB prices — never trust client totals.
      // This is the ONLY genuine "invalid order data" case (unknown item / bad qty);
```

b) At the end of the handler replace

```ts
      res.json(order);
    } catch (error) {
      console.error("Create order error:", error);
```

with:

```ts
      // One request per tap: when the client asked for a print, run it NOW — after the save has
      // committed — and return its result on the same response. A print failure is reported in
      // `print.error`; the order above is already committed and must stay a 200.
      if (printReq.mode) {
        timer.add("save", timer.totalMs());
        const print = await runPrintStep({
          req,
          orderId: order.id,
          order,
          mode: printReq.mode,
          auto: printReq.auto,
          markBilled: printReq.markBilled,
          timer,
        });
        return res.json({ ...order, print });
      }
      res.json(order);
    } catch (error) {
      console.error("Create order error:", error);
```

- [ ] **Step 4: `PUT /api/orders/:id/items`**

a) Replace

```ts
    try {
      const id = parseInt(req.params.id);
      const { items, discountAmount, containerCharge, customerName, customerPhone } = req.body;
      const lineItems = Array.isArray(items) ? items : [];
```

with:

```ts
    try {
      const id = parseInt(req.params.id);
      const { items, discountAmount, containerCharge, customerName, customerPhone } = req.body;
      const lineItems = Array.isArray(items) ? items : [];
      const printReq = parseSavePrintRequest(req.body);
      const timer = createStageTimer();
      if (printReq.mode) instrumentJson(res, timer, `save+${printReq.mode} order=${id}`);
```

b) Replace the tail

```ts
      broadcast({ type: "ORDER_UPDATE", order });
      res.json(order);
    } catch (error) {
      console.error("Update order items error:", error);
```

with:

```ts
      broadcast({ type: "ORDER_UPDATE", order });
      // One request per tap — see the identical block in POST /api/orders. Runs after the delta
      // KOT ticket above exists, so the printed kotNumber is the one this save just created.
      if (printReq.mode) {
        timer.add("save", timer.totalMs());
        const print = await runPrintStep({
          req,
          orderId: id,
          order,
          mode: printReq.mode,
          auto: printReq.auto,
          markBilled: printReq.markBilled,
          timer,
        });
        return res.json({ ...order, print });
      }
      res.json(order);
    } catch (error) {
      console.error("Update order items error:", error);
```

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: exits 0.

Run: `npm run test:pure 2>&1 | tail -3`
Expected: `RESULT: PASS ✅`.

Run: `npx tsx scripts/bench-print-latency.ts --iterations 5 --label t14`
Expected: `RESULT: PASS ✅` — the standalone endpoints still behave identically after the `order` param was added (they pass no preloaded order).

The save-route wiring itself cannot be exercised by the bench (a real `PUT`/`POST` would consume KOT/bill counters or deduct inventory — see the spec's Verification caveat). It is covered by: the pure `executePrintStep` tests (Task 8), `tsc`, and the manual app check in Task 15 Step 5.

- [ ] **Step 6: Commit** (only if the user has asked)

```bash
git add server/services/printDispatch.ts server/routes.ts
git commit -m "feat(print): order save routes accept print:kot|bill and print in the same request" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Client — exactly one request per tap

**Files:**
- Modify: `client/src/pages/POS.tsx`

- [ ] **Step 1: Import the pure mapping**

In `client/src/pages/POS.tsx` add: `import { printFieldsForSubmitMode } from "@shared/printRequest";`

- [ ] **Step 2: Add `print` fields to both save payloads**

In `onSubmit`, in the `updateOrderMutation.mutate({ … })` object add, after `cancelledKotItems: buildCancelledKotItemsPayload(),`:

```ts
        // One request per tap: ask the server to run the KOT/Bill print right after this save.
        ...printFieldsForSubmitMode(submitModeRef.current),
```

and in the `createOrderMutation.mutate({ … })` object add, after `items: itemsPayload,`:

```ts
        // One request per tap — see the update branch above.
        ...printFieldsForSubmitMode(submitModeRef.current),
```

- [ ] **Step 3: Add `handleSavedPrint`**

Directly after the `triggerBillPrint` function (the one rewritten in Task 12) add:

```ts
  // Handles the print result that rode back on the SAVE response (one request per tap). A missing
  // or `{ error }` result gets today's failure treatment: a toast and the in-page preview.
  const handleSavedPrint = async (mode: 'kot' | 'bill', orderId: number, order: any, print: any, markBilled?: 'always' | 'on_send') => {
    try {
      if (!print || print.error) {
        toast({
          title: mode === 'kot' ? 'KOT print failed' : 'Bill print failed',
          description: print?.error ?? 'Printer error — showing preview instead.',
          variant: 'destructive',
        });
        if (order) { if (mode === 'kot') showKOTPreview(order); else showBillPreview(order); }
        return;
      }
      if (mode === 'kot') await handleKotResult(print, orderId, order, false);
      else await handleBillResult(print, orderId, order, markBilled);
    } catch {
      if (order) { if (mode === 'kot') showKOTPreview(order); else showBillPreview(order); }
    } finally {
      setIsPrinting(false);
      endPrintTap();
    }
  };
```

- [ ] **Step 4: Replace the per-mode `trigger*Print` calls in both `onSuccess` handlers**

In `createOrderMutation.onSuccess`:
- `kot-print`: replace `triggerKOTPrint(order.id, order).finally(() => { setIsPrinting(false); endPrintTap(); });` with `void handleSavedPrint("kot", order.id, order, order.print);`
- `save-print`: replace `triggerBillPrint(order.id, order).finally(() => { setIsPrinting(false); endPrintTap(); });` with `void handleSavedPrint("bill", order.id, order, order.print);`
- `bill-print`: replace `triggerBillPrint(order.id, order, "always").finally(() => { setIsPrinting(false); endPrintTap(); });` with `void handleSavedPrint("bill", order.id, order, order.print, "always");`

In `updateOrderMutation.onSuccess`:
- `kot-print`: replace `triggerKOTPrint(vars.orderId, order).finally(() => { setIsPrinting(false); endPrintTap(); });` with `void handleSavedPrint("kot", vars.orderId, order, order.print);`
- `save-print`: replace `triggerBillPrint(vars.orderId, order).finally(() => { setIsPrinting(false); endPrintTap(); });` with `void handleSavedPrint("bill", vars.orderId, order, order.print);`
- `bill-print`: replace `triggerBillPrint(vars.orderId, order, "always").finally(() => { setIsPrinting(false); endPrintTap(); });` with `void handleSavedPrint("bill", vars.orderId, order, order.print, "always");`

Both mutations' `onError` handlers already call `setIsPrinting(false)`; also add `endPrintTap();` as the last statement of each `onError` so a failed save never leaves a tap open.

- [ ] **Step 5: Rewrite the Auto-KOT timer as ONE request**

In the Auto-KOT effect, replace everything from `const syncRes = await fetch(apiUrl(\`/api/orders/${activeOrderId}/items\`), {` down to and including

```ts
        const { handlePrintResponse } = await import('@/lib/printGateway');
        const outcome = await handlePrintResponse(data, {
          orderId: activeOrderId,
          ackType: 'kot',
          pendingAck: data.pendingAck,
        });
        if (outcome === 'hardware') {
          toast({ title: 'KOT sent!', description: 'Kitchen notified automatically' });
        }
```

with:

```ts
        // ONE request: the PUT saves the cart AND (print:"kot", auto:true) runs the KOT delta
        // print server-side. This used to be a PUT followed by a separate POST /api/print/kot.
        const res = await fetch(apiUrl(`/api/orders/${activeOrderId}/items`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: activeOrderId,
            items: buildItemsPayload(cartItems),
            discountAmount: discountAmt.toFixed(2),
            // Must be re-sent on every sync, same as discountAmount — the server only
            // preserves what's explicitly re-sent, so omitting this would silently
            // reset an already-entered manual container charge back to 0.
            containerCharge: containerCharge.toFixed(2),
            // Same "must be resent every save" rule — a reason given at removal time
            // (requestRemoveFromCart) is stashed in pendingKotCancellationsRef until a
            // save actually carries it through; this Auto-KOT sync is one of the saves.
            cancelledKotItems: buildCancelledKotItemsPayload(),
            print: 'kot',
            auto: true,
          }),
          credentials: 'include',
        });
        if (!res.ok) return;
        const saved = await res.json();
        const print = saved?.print;
        if (!print || print.error) return;
        const { handlePrintResponse } = await import('@/lib/printGateway');
        const outcome = await handlePrintResponse(print, {
          orderId: activeOrderId,
          ackType: 'kot',
          pendingAck: print.pendingAck,
        });
        if (outcome === 'hardware') {
          toast({ title: 'KOT sent!', description: 'Kitchen notified automatically' });
        }
```

(Keep the surrounding `try { … } catch { … }` and the explanatory comment above the old sync call as they are; the comment about syncing before printing remains accurate — the sync and the print are now simply one request.)

- [ ] **Step 6: Remove what is now dead**

`triggerKOTPrint` and `triggerBillPrint` have no callers left in `POS.tsx`. Confirm: run `grep -n "triggerKOTPrint\|triggerBillPrint" client/src/pages/POS.tsx` — the only hits must be the two function definitions. Delete both definitions (their logic lives on in `handleKotResult` / `handleBillResult` / `handleSavedPrint`). Keep `handleKotResult`, `handleBillResult` and `handleSavedPrint`.

Also remove `timePrintStage('kot_http'…)`/`'bill_http'` usages that went with them (they disappear with the deleted functions) and keep `timePrintStage("save_http", …)` in both mutations — the single request is now `save_http`.

- [ ] **Step 7: Verify**

Run: `npm run check`
Expected: exits 0.

Run: `npm run test:pure 2>&1 | tail -3`
Expected: `RESULT: PASS ✅`.

Run: `npm run build`
Expected: exits 0 (client + server bundle).

- [ ] **Step 8: Manual check in the running app**

Follow the **Manual app checks — safety rules** at the top of this plan first (restart `npm run dev` with the private `PUSHER_CHANNEL`; run `scripts/dev-quiet-print-jobs.ts <orderId>` after each tap; Cancel Order at the end). On the throwaway table with DevTools → Network open:
1. **KOT on a new cart:** expect ONE request — `POST /api/orders` — whose response JSON contains a `print` object; no `print/kot` request. Console shows `[print-perf] tap:kot save_http=… total=…`.
2. **KOT after adding an item to that order:** ONE `PUT …/items` with a `print` object in the response; no `print/kot`.
3. **Bill:** ONE `PUT …/items` (or `POST /orders`) response containing `print` (and `print.kotCatchUp` when something unsent was added); no `print/bill`, no `print/kot`, no `bill-requested`; the table card flips to "Bill printed".
4. **Auto-KOT** (if enabled in Print Settings): after the debounce, ONE `PUT …/items`; no `print/kot`.
5. **Failure path:** do NOT change the real Print Settings (shared DB). The failure branch is covered by the pure `executePrintStep` tests.

- [ ] **Step 9: Commit** (only if the user has asked)

```bash
git add client/src/pages/POS.tsx
git commit -m "feat(pos): one request per print tap — save carries the print" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Defer non-essential invalidations until the print is handled

**Files:**
- Modify: `client/src/pages/POS.tsx`

The seven invalidations in each mutation's `onSuccess` refetch dashboard/KOT/live-status data that nothing on the POS screen needs while a print is in flight; they compete with it for the same server. Keep `/api/orders`, `/api/orders/:id` and `/api/tables` immediate (the order/cart and table state must be fresh), defer the other four until the print result has been handled.

- [ ] **Step 1: Add the helper**

Directly above `createOrderMutation`, add:

```ts
  // Dashboard / kitchen / live-status refetches nothing on the POS screen needs while a print is
  // in flight — run them after the print result is handled so they don't compete with it.
  const refreshSecondaryQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/kot"] });
    queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/kot/running"] });
  };
```

- [ ] **Step 2: Use it in both `onSuccess` handlers**

In **both** `createOrderMutation.onSuccess` and `updateOrderMutation.onSuccess`:
- delete the four lines invalidating `["/api/dashboard/stats"]`, `["/api/kot"]`, `["/api/live-status"]`, `["/api/kot/running"]` (keep `["/api/orders"]`, the per-order key in the update handler, and `["/api/tables"]`);
- add, as the first statement after `const mode = submitModeRef.current;`:

```ts
      const printing = mode === "kot-print" || mode === "save-print" || mode === "bill-print";
      if (!printing) refreshSecondaryQueries();
```

In `handleSavedPrint`'s `finally` block (Task 15 Step 3) add `refreshSecondaryQueries();` as the first statement, so a print tap refreshes them once the result has been handled.

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: exits 0.

Manual (follow the **Manual app checks — safety rules** at the top): on the throwaway table, tap **KOT**; in DevTools → Network, the `dashboard/stats`, `kot`, `kot/running`, `live-status` requests start **after** the save response (they previously fired in parallel with the print). A plain **Save** still refreshes them immediately.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add client/src/pages/POS.tsx
git commit -m "perf(pos): defer secondary query refetches until the print result is handled" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Docs and final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-02-print-queue-latency-design.md`

- [ ] **Step 1: Document the contract in CLAUDE.md**

In `CLAUDE.md`, in the "Printing (KOT/Bill)" section, immediately before the paragraph that begins `**Phone (Vercel) → desktop thermal printer bridge.**`, insert:

```md
**One print tap = one HTTP request (do not re-introduce chains).** A print used to be a chain of dependent calls (save → silent KOT check → bill → `bill-requested`), which was both slow and the source of the DB-vs-cart-gap / lost-status-flip bugs documented below. The pipeline now lives in `server/services/printDispatch.ts` (`runKotPrint`, `runBillPrint`, `runPrintStep`) and is reached two ways, both ONE request:
- **From a save:** `POST /api/orders` and `PUT /api/orders/:id/items` accept `print: "kot" | "bill"` (+ `auto: true` for the Auto-KOT timer, `markBilled` for Bill). After the save commits the server runs the print and returns `{ ...order, print }`. A print failure is `print: { error }` and never turns a committed save into a 5xx. POS.tsx adds these fields via `shared/printRequest.ts`'s `printFieldsForSubmitMode` and routes `order.print` through `handleSavedPrint` → `handleKotResult`/`handleBillResult`.
- **Standalone:** `/api/print/kot` and `/api/print/bill` (Tables-card print, Billing/Orders/KOT-page reprints). `/api/print/bill` accepts `withKotCatchUp` (server runs the silent KOT delta check first and returns it as `kotCatchUp`) and `markBilled: "always" | "on_send"` (server flips the table to `billed`; `"always"` = POS Bill button, `"on_send"` = Tables card, only when something was printed/dispatched). The old `POST /api/orders/:id/bill-requested` route still exists but nothing calls it.
- One tap's printer work is one multi-row `print_jobs` INSERT and one Pusher `triggerBatch` (`publishRealtimeMany`; Pusher caps a batch at 10 events). Order/items/tickets reads run concurrently.

**Measuring print latency (no physical printer needed).** Every print request returns a `Server-Timing` header and logs one `[print-perf]` line (stages: `db_order`, `db_items`, `db_tickets`, `db_cat`, `build`, `direct_send`, `insert_job`, `pusher`, `commit`, `mark_billed`, plus `kot_*` for the catch-up inside a bill, and `save` for save-with-print); the POS logs a `[print-perf] tap:…` line per tap. `scripts/bench-print-latency.ts` runs the real handlers against fake `bench-*` printers on a private `private-bagicha-bench-<rand>` Pusher channel with backdated `BENCH-*` orders (no counters consumed, in no report) and snapshot-then-deletes everything it created; `--station` adds `scripts/lib/virtualStation.ts` (claim → no-op print → ack); `--cleanup-only [--confirm]` recovers leftovers. `scripts/probe-print-stages.ts` times the Neon/Pusher building blocks (rolled-back inserts, throwaway channel). `settingsStore.__setSettingsForBench` throws unless `PRINT_BENCH=1` (the bench script sets it itself) — never set that variable in a server entry point. Manual KOT/Bill taps in the app during development must use a private `PUSHER_CHANNEL` and `scripts/dev-quiet-print-jobs.ts` so the restaurant's live host can't print a stray ticket. Run from a dev machine these give stage *ratios*; absolute Vercel numbers come from the Server-Timing header in real use. The full save-with-print route can't be benched end-to-end without consuming real KOT counters/inventory, so its wiring is covered by the pure `executePrintStep` tests + manual app checks.
```

- [ ] **Step 2: Resolve the spec's open items**

In the spec's `## Open items`, replace the first bullet (the `bill-requested` rule one) with:

```md
- **`bill-requested` rule — resolved:** both existing rules are kept, selected per request: `markBilled: "always"` (POS Bill button — flips for any request that gets past dispatch) and `markBilled: "on_send"` (Tables card — flips only when `printed`/`dispatched`). A hard failure (the print throws) no longer flips the table, unlike the old fire-and-forget POS call.
```

and, in `## Design → C. Phase 2` item 1, change "reusing the order and items it already holds (no re-select)" wording to: "passing the order row it already holds; the items are still read by the single join query, which also resolves menu names and category ids for routing".

- [ ] **Step 3: Full verification**

Run each; every one must succeed:

```bash
npm run check
npm run test:pure
npm run build
npx tsx scripts/bench-print-latency.ts --iterations 20 --station --label final
npx tsx scripts/bench-print-latency.ts --cleanup-only
```

Expected: `tsc` exit 0; `test:pure` ends `RESULT: PASS ✅` with the three new scripts included; build exit 0; bench `RESULT: PASS ✅` with `station:*` rows; cleanup prints `cleanup: no bench orders found`.

- [ ] **Step 4: Record the final numbers**

Add an `## Final` section to the spec with the `final` bench tables next to the baseline, a one-line statement per requirement (one request per tap — verified in DevTools in Task 15 Step 8; target met or not), and the follow-up candidates left unbuilt (publish after responding via `waitUntil`; skipping the delete/reinsert when items are unchanged).

- [ ] **Step 5: Commit** (only if the user has asked)

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-02-print-queue-latency-design.md
git commit -m "docs(print): one-request-per-tap contract, bench tooling and final numbers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (spec coverage)

| Spec requirement | Task |
|---|---|
| Hard requirement: one print tap = one request | 11 (bill absorbs catch-up + bill-requested), 12 (client Phase 1), 14 + 15 (save carries print, Auto-KOT included), 17 (contract documented) |
| A1 server stage timers + `Server-Timing` + `[print-perf]` | 1, 2 |
| A1 client marks | 12 (`printPerfClient.ts`, `startPrintTap`/`timePrintStage`/`endPrintTap`) |
| A2 bench harness with the 6 safety layers | 3 (seam), 5 |
| A3 stage probe | 6 |
| A4 virtual print station | 4 (+ used by 5 `--station`) |
| A5 baseline + agree target before changing prod code | 7 (hard checkpoint) |
| B1 extract the print step | 2 |
| B2 bill absorbs the silent KOT catch-up | 11, 12 |
| B3 bill absorbs `bill-requested` (rule resolved: per-request `markBilled`) | 8 (`shouldMarkBilled`), 11, 12; spec open item closed in 17 |
| B4 one multi-row INSERT + one Pusher batch | 9, 10 |
| B5 parallel independent reads | 10 |
| C1–C3 save carries print, failure semantics, ordering | 14 |
| C4 client change (`triggerSubmit` payload, `onSuccess`, Auto-KOT) | 15 |
| C5 defer refetch burst | 16 |
| Mixed outcomes per part (open item) | 11 (`kotCatchUp` on the bill body) + 12 (`handleBillResult` handles each part independently) |
| Verification caveat for the save route | 14 Step 5 + 15 Step 8 + CLAUDE.md note in 17 |
| `waitUntil` / skip-rewrite candidates | Deliberately **not** built; recorded as follow-ups in 17 Step 4 (spec: only if the baseline shows Pusher dominates) |
| Idempotency key (open item) | Not built — existing guards (`isPrinting`, commit-once-at-dispatch) are unchanged; revisit only if a double-tap duplicate is observed |
| Settings seam shape / `Server-Timing` env flag / HTTP-vs-in-process harness (open items) | Decided: seam = `__setSettingsForBench` gated on `PRINT_BENCH=1`; header always on (no PII); harness drives handlers over HTTP |

**Type/name consistency checked:** `StageTimer` (`time/add/scoped/stages/totalMs/toServerTiming/toLogLine`) is the same in Tasks 1, 2, 10, 11, 14; `MarkBilled` = `"always" | "on_send"` everywhere; `runBillPrint({ withKotCatchUp, markBilled, order })` and `runKotPrint({ order })` match their call sites in `runPrintStep`; `kotCatchUp` is added to `PrintApiResponse` (Task 11) and read as `data.kotCatchUp` in `handleBillResult` (Task 12); `printFieldsForSubmitMode` (Task 8) is the one used in Task 15; `handleKotResult`/`handleBillResult` (Task 12) are what `handleSavedPrint` (Task 15) calls.

---

## Execution notes (deviations from the plan as written)

- **`pusher-js` import:** the virtual station needed an ESM/CJS interop fix for `pusher-js` under `tsx`.
- **Hardened bench** (beyond Task 5): an activity guard (refuses to run if non-bench `print_jobs` were created in the
  last 15 min; `--force` overrides), pending AND claimed bench jobs flipped to `printed` after every call and on
  SIGINT/SIGTERM, single-flight signal-safe cleanup, a `bench-%` `print_jobs` sweep, strict argument parsing, a failed
  cleanup reported as FAIL, in-run RTT sampling (`rtt(SELECT 1)` + RTT units), an emulated per-request auth lookup (what
  `passport.deserializeUser` costs on every real request) and a functional failure-path check (bill fails after its
  catch-up → 500 carries `kotCatchUp`).
- **Publisher per-event fallback:** `publishMany` chunks at Pusher's 10-event `triggerBatch` limit and, if a batch call
  fails, retries those events one by one.
- **`kotCatchUp` attached to errors:** `runBillPrint` attaches the possibly-committed catch-up to the thrown error;
  `/api/print/bill` returns `{ message, kotCatchUp }` in its 500 body and `executePrintStep` returns
  `print: { error, kotCatchUp }`.
- **Bill reads overlap the catch-up** (made during Task 13): `runBillPrint` runs the bill's reads concurrently with the
  KOT catch-up (5 concurrent connections for that tap; pool max 10). Consequently Task 14's `p.order && !kotCatchUp` rule
  became "use the preloaded order". Safe only while the bill does not print `kotPrintCount` (comment in
  `shared/print/generators.ts`).
- **`handleKotCatchUpPart` never throws**, so a catch-up problem can't block handling of the bill result.
- **ES5 rule:** `tsconfig.json` has no `target`; no `for…of`/spread over a `Map`/`Set` in `client/`, `shared/`,
  `server/` — use `Array.from`.
- **Manual app checks not performed:** the manual checks in Tasks 12, 15 and 16 (incl. the DevTools one-request check,
  Task 15 Step 8) were NOT performed by the agents; they remain for a human, following the safety rules at the top.
- **Task 17:** CLAUDE.md documentation added (left unstaged, alongside an unrelated uncommitted edit by someone else);
  the final bench ran at baseline-like RTT (~30 ms); results and the per-clause verdict are in the spec's `## Final`
  (target not demonstrated overall on the dev machine; Vercel `Server-Timing` readings needed). No commits were made.
- **Post-review follow-ups (three small code fixes after the plan was executed):**
  - **PUT guard:** `PUT /api/orders/:id/items` returns `400 { error: "items must be an array" }` for a missing/non-array
    `items` before any write (it used to wipe the order's items, commit, then 500 at `items.filter`); an intentional
    clear still sends `items: []`; the post-commit delta-KOT step uses `lineItems`.
  - **Folded bill read (`db_bill`):** the bill's order row + items are one left-joined query when no order row is
    preloaded (stage `db_bill`); with a preloaded order only the items are read (stage `db_items`). A
    Bill-with-catch-up tap peaks at 4 concurrent DB connections, not 5 (pool max 10). Items are ordered by
    `order_items.id` in both paths. This supersedes the "5 concurrent connections" note above.
  - **Client legacy fallback (release-order skew):** when a save response has no `print` key (new client, old server),
    POS.tsx's `handleSavedPrint` falls back to the legacy chained calls (`/api/print/kot`; Bill: silent
    `/api/print/kot` catch-up, `/api/print/bill`, then best-effort `POST /api/orders/:id/bill-requested` if
    `markBilled` was requested), and the Auto-KOT path falls back to `POST /api/print/kot { orderId, auto: true }`.
    Deploy the server first anyway; delete the fallback once every client and server is updated.
