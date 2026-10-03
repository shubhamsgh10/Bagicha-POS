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
 * Measurement notes:
 *  - The stub auth middleware EMULATES passport.deserializeUser's per-request DB lookup (the real
 *    server runs `storage.getUser(id)` — one round trip — on EVERY request; server/routes.ts), so a
 *    removed request shows its true cost. It is a read-only `SELECT * FROM users WHERE id = $1` on
 *    one existing user id read at startup; the session itself stays stubbed (admin, id 0).
 *  - Every scenario samples the Neon round-trip floor (`SELECT 1` through the pool, 20x) at its
 *    start and again at its end, reports it as an `rtt(SELECT 1)` row, and prints the headline
 *    p50s in RTT units (p50 / rtt p50) — comparable across runs on different networks.
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

const RTT_SAMPLES = 20;
/** Neon round-trip floor right now: `SELECT 1` through the same pool the server code uses. */
async function sampleRtt(): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < RTT_SAMPLES; i++) {
    const t0 = performance.now();
    await pool.query("SELECT 1");
    out.push(performance.now() - t0);
  }
  return out;
}
const median = (vals: number[]) => pct([...vals].sort((a, b) => a - b), 50);
/** report() plus an `rtt(SELECT 1)` row and a one-line summary of the headline p50s in RTT units. */
function reportWithRtt(title: string, samples: Map<string, number[]>, rtt: number[]) {
  samples.set("rtt(SELECT 1)", rtt);
  report(title, samples);
  const r50 = median(rtt);
  const parts = Array.from(samples.keys())
    .filter((k) => k === "total" || k.startsWith("wall("))
    .map((k) => `${k} ${(median(samples.get(k)!) / r50).toFixed(2)}`);
  console.log(`RTT units [${title}] (p50 / rtt p50 ${r50.toFixed(1)} ms): ${parts.join(" · ")}`);
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
  // A non-JSON body (e.g. Express's HTML 500 page when the emulated auth lookup hits a network
  // error) becomes a counted problem via the shape checks instead of crashing the run.
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { nonJsonBody: text.slice(0, 200) };
  }
  return {
    t0,
    wallMs: performance.now() - t0,
    status: res.status,
    json,
    stages: parseServerTiming(res.headers.get("server-timing") ?? ""),
  };
}

const jobIdsOf = (json: any): number[] => {
  const own = (json.printJobs ?? (json.printJob ? [json.printJob] : [])).map((j: any) => j.jobId);
  const catchUp = json.kotCatchUp && !json.kotCatchUp.error
    ? (json.kotCatchUp.printJobs ?? (json.kotCatchUp.printJob ? [json.kotCatchUp.printJob] : [])).map((j: any) => j.jobId)
    : [];
  return [...catchUp, ...own].filter((x: any) => typeof x === "number");
};

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

  // In-process server with a stubbed session that still PAYS the real per-request auth cost:
  // passport.deserializeUser does one users lookup per request (server/routes.ts), emulated here
  // with a read-only SELECT on one existing user id, so a removed request shows its true cost.
  const authUser = await pool.query("SELECT id FROM users LIMIT 1");
  if (authUser.rows.length === 0) throw new Error("need at least one users row to emulate the per-request auth lookup");
  const authUserId = authUser.rows[0].id;
  const app = express();
  app.use(express.json());
  app.use(async (req: any, _res, next) => {
    try {
      await pool.query("SELECT * FROM users WHERE id = $1", [authUserId]);
    } catch (err) {
      return next(err);
    }
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

  const scenarios: Array<{
    name: string;
    overrides: Record<string, string | null>;
    route: string;
    expectJobs: number;
    body?: Record<string, unknown>;
  }> = [
    { name: "kot-1-printer", overrides: {}, route: "/api/print/kot", expectJobs: 1 },
    { name: "kot-2-printers", overrides: { [String(catB)]: "bench-usb-2" }, route: "/api/print/kot", expectJobs: 2 },
    { name: "bill", overrides: {}, route: "/api/print/bill", expectJobs: 1 },
    { name: "bill+catchup", overrides: {}, route: "/api/print/bill", expectJobs: 2, body: { withKotCatchUp: true } },
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
      checkAbort();
      const rtt = await sampleRtt(); // start-of-scenario RTT floor

      for (let i = 0; i < ids.length; i++) {
        checkAbort();
        const orderId = ids[i];
        const r = await timedPost(base, sc.route, { orderId, ...(sc.body ?? {}) });
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
      checkAbort();
      rtt.push(...(await sampleRtt())); // end-of-scenario RTT floor
      reportWithRtt(`${label} · ${sc.name}`, samples, rtt);
    }

    // ── Chain scenarios: fresh order per iteration, optional UNTIMED KOT setup, then timed step(s) ──
    // `legacy-chain` replays the OLD client behaviour (POST /api/print/kot, then POST /api/print/bill,
    // sequentially) so the single-call `bill+catchup` can be compared with what a tap used to cost.
    // The "(KOT already printed)" variants model real service, where the KOT usually went out before
    // Bill is tapped: an untimed KOT call first (its jobs flipped like every other call), so the
    // catch-up / the old KOT call finds nothing new. The setup call is never counted in any table.
    {
      s.printSettings.kot.categoryPrinterOverrides = {};
      /** Station wait (if any) + flip this order's pending/claimed jobs — the same rule as every call. */
      const settle = async (orderId: number, jobIds: number[], tag: string) => {
        if (station && jobIds.length > 0 && !(await station.waitForJobs(jobIds, 8000))) {
          problems++;
          console.error(`✗ ${tag}: virtual station did not ack every job within 8s`, jobIds);
        }
        await pool.query(
          "UPDATE print_jobs SET status = 'printed', printed_at = now() WHERE order_id = $1 AND status IN ('pending','claimed')",
          [orderId],
        );
      };
      const fail = (tag: string, r: { status: number; json: any }) => {
        problems++;
        console.error(`✗ ${tag}: unexpected response`, r.status, JSON.stringify(r.json).slice(0, 200));
      };
      const kotDispatched = (r: { status: number; json: any }, n: number) =>
        r.status === 200 && jobIdsOf(r.json).length === n && r.json.dispatched === true && r.json.pendingAck === true;
      const kotNoDelta = (r: { status: number; json: any }) =>
        r.status === 200 && r.json.printed === false && r.json.reason === "no_delta" && jobIdsOf(r.json).length === 0;
      const billOnly = (r: { status: number; json: any }) =>
        r.status === 200 && jobIdsOf(r.json).length === 1 && r.json.dispatched === true && r.json.kotCatchUp === undefined;

      const chains: Array<{ name: string; kotFirst: boolean; legacy: boolean }> = [
        { name: "bill+catchup (KOT already printed)", kotFirst: true, legacy: false },
        { name: "legacy-chain", kotFirst: false, legacy: true },
        { name: "legacy-chain (KOT already printed)", kotFirst: true, legacy: true },
      ];
      for (const ch of chains) {
        const samples = new Map<string, number[]>();
        const push = (k: string, v: number) => {
          if (!samples.has(k)) samples.set(k, []);
          samples.get(k)!.push(v);
        };
        checkAbort();
        const rtt = await sampleRtt(); // start-of-scenario RTT floor
        for (let i = 0; i < iterations + 2; i++) {
          checkAbort();
          const tag = `${ch.name} #${i}`;
          const orderId = await createBenchOrder(runId, createdIds.length, lines, createdIds);

          if (ch.kotFirst) {
            checkAbort();
            const setup = await timedPost(base, "/api/print/kot", { orderId }); // untimed setup
            if (!kotDispatched(setup, 1)) fail(`${tag} (setup KOT)`, setup);
            await settle(orderId, jobIdsOf(setup.json), `${tag} (setup KOT)`);
          }

          checkAbort();
          if (!ch.legacy) {
            const r = await timedPost(base, "/api/print/bill", { orderId, withKotCatchUp: true });
            if (!billOnly(r)) fail(tag, r);
            await settle(orderId, jobIdsOf(r.json), tag);
            if (i < 2) continue; // warm-up
            push("wall(client)", r.wallMs);
            for (const [k, v] of Object.entries(r.stages)) push(k, v);
          } else {
            const t0 = performance.now();
            const k = await timedPost(base, "/api/print/kot", { orderId });
            const b = await timedPost(base, "/api/print/bill", { orderId });
            const wall = performance.now() - t0;
            const kOk = ch.kotFirst ? kotNoDelta(k) : kotDispatched(k, 1);
            if (!kOk) fail(`${tag} (kot call)`, k);
            if (!billOnly(b)) fail(`${tag} (bill call)`, b);
            await settle(orderId, [...jobIdsOf(k.json), ...jobIdsOf(b.json)], tag);
            if (i < 2) continue; // warm-up
            push("wall(2 calls)", wall);
            push("wall(kot call)", k.wallMs);
            push("wall(bill call)", b.wallMs);
          }
        }
        checkAbort();
        rtt.push(...(await sampleRtt())); // end-of-scenario RTT floor
        reportWithRtt(`${label} · ${ch.name}${ch.legacy ? " (kot then bill, 2 requests)" : ""}`, samples, rtt);
      }
    }

    // ── Functional check (not timed): the bill half fails AFTER the KOT catch-up committed ──
    // A fake NETWORK bill printer on a closed local port makes sendToPrinter throw (ECONNREFUSED)
    // after the catch-up has already dispatched + committed its KOT. The 500 must still carry
    // `kotCatchUp`, or those items would silently never reach the kitchen.
    checkAbort();
    {
      const prevPrinters = s.printSettings.printers;
      const prevBillPrinterId = s.printSettings.bill.billPrinterId;
      s.printSettings.kot.categoryPrinterOverrides = {};
      s.printSettings.printers = [
        ...prevPrinters,
        { id: "bench-net-1", name: "Bench Thermal Net", type: "network", ip: "127.0.0.1", port: 9, width: 48 },
      ];
      s.printSettings.bill.billPrinterId = "bench-net-1";
      try {
        const orderId = await createBenchOrder(runId, createdIds.length, lines, createdIds);
        checkAbort();
        const r = await timedPost(base, "/api/print/bill", { orderId, withKotCatchUp: true });
        const cu = r.json?.kotCatchUp;
        const catchUpJobIds = cu && !cu.error
          ? (cu.printJobs ?? (cu.printJob ? [cu.printJob] : [])).map((j: any) => j.jobId).filter((x: any) => typeof x === "number")
          : [];
        const ok = r.status === 500 && typeof r.json?.message === "string" && catchUpJobIds.length > 0;
        if (ok) {
          console.log(`PASS  bill fails after catch-up → 500 carries kotCatchUp (${catchUpJobIds.length} KOT job(s); message: ${r.json.message})`);
        } else {
          problems++;
          console.error(
            "FAIL  bill fails after catch-up → expected HTTP 500 with `message` and `kotCatchUp` KOT job(s), got",
            r.status,
            JSON.stringify(r.json).slice(0, 300),
          );
        }
        if (station && catchUpJobIds.length > 0 && !(await station.waitForJobs(catchUpJobIds, 8000))) {
          problems++;
          console.error("✗ failure-path check: virtual station did not ack the catch-up KOT job within 8s", catchUpJobIds);
        }
        // Same rule as every other call: no bench job may stay claimable by a real print station.
        await pool.query(
          "UPDATE print_jobs SET status = 'printed', printed_at = now() WHERE order_id = $1 AND status IN ('pending','claimed')",
          [orderId],
        );
      } finally {
        s.printSettings.printers = prevPrinters;
        s.printSettings.bill.billPrinterId = prevBillPrinterId;
      }
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
