/**
 * Verifies shared/settleTiming.ts — the diagnostic that explains a slow Settle: how long the click
 * waited before ANY request left the browser (a parked mutation / offline limbo), how long each leg
 * took, and how old the serving instance was (a cold start). It only summarises browser resource
 * timings, so it needs no DB and no browser.
 * Run: npx tsx scripts/verify-settle-timing.ts
 */
import { isSlowSettle, summarizeSettleTimeline, type ResourceEntryLike } from "../shared/settleTiming";

const checks: Array<[string, boolean]> = [];
const ORIGIN = "https://bagicha-pos.vercel.app";
const entry = (path: string, startTime: number, duration: number, extra: Partial<ResourceEntryLike> = {}): ResourceEntryLike => ({
  name: ORIGIN + path, startTime, duration, requestStart: startTime + 5, responseStart: startTime + duration - 5, ...extra,
});

// A healthy settle: click at 1000ms, save then payment back to back.
{
  const t = summarizeSettleTimeline(
    [entry("/api/orders/42/items", 1040, 650), entry("/api/orders/42/payment", 1700, 240)],
    1000, 1950, 42,
  );
  checks.push(["healthy: two legs in click order, save then payment", t.legs.map((l) => l.leg).join() === "save,payment"]);
  checks.push(["healthy: startLag is the small gap before the first request", t.startLagMs === 40]);
  checks.push(["healthy: betweenLegs is the gap from save's end to payment's start", t.betweenLegsMs === 10]);
  checks.push(["healthy: totalMs passed through", t.totalMs === 950]);
  checks.push(["healthy: ttfb is requestStart→responseStart", t.legs[0].ttfbMs === 640]);
}

// The "parked" signature: nothing left the browser for 9s after the click.
{
  const t = summarizeSettleTimeline(
    [entry("/api/orders/42/items", 10000, 600), entry("/api/orders/42/payment", 10620, 200)],
    1000, 10900, 42,
  );
  checks.push(["parked: startLag exposes the 9s of silence before the first request", t.startLagMs === 9000]);
  checks.push(["parked: the legs themselves were fast, so the slowest leg is small", (t.legs.find((l) => l.leg === t.slowestLeg)?.durationMs ?? 0) <= 600]);
}

// A slow-server / cold-start signature: instance age + server time come from Server-Timing.
{
  const t = summarizeSettleTimeline(
    [entry("/api/orders/42/items", 1030, 31000, {
      serverTiming: [{ name: "app", duration: 420, description: "" }, { name: "inst", duration: 0, description: "age=2s req=1" }],
    })],
    1000, 32100, 42,
  );
  checks.push(["cold start: serverMs read from Server-Timing app;dur", t.legs[0].serverMs === 420]);
  checks.push(["cold start: instance age/req read from Server-Timing inst;desc", t.legs[0].instance === "age=2s req=1"]);
  checks.push(["cold start: slowest leg is the 31s save (network+boot, not server work)", t.slowestLeg === "save" && t.legs[0].durationMs === 31000]);
}

// Noise must not leak in.
{
  const t = summarizeSettleTimeline(
    [
      entry("/api/tables", 1100, 90),                     // concurrent poll
      entry("/api/orders/99/items", 1100, 500),           // another order
      entry("/api/orders/42/items", 500, 400),            // before the click
      entry("/api/orders/42/payment", 1700, 240),
    ],
    1000, 1950, 42,
  );
  checks.push(["noise: only this order's legs after the click are kept", t.legs.length === 1 && t.legs[0].leg === "payment"]);
}

// A never-saved cart is created by POST /api/orders (path has no id) before the payment.
{
  const t = summarizeSettleTimeline([entry("/api/orders", 1050, 700), entry("/api/orders/7/payment", 1780, 220)], 1000, 2050, 7);
  checks.push(["create path: '/api/orders' counts as the first leg", t.legs.map((l) => l.leg).join() === "orders,payment"]);
}

// Degenerate input.
{
  const t = summarizeSettleTimeline([], 1000, 9000, 42);
  checks.push(["no entries: empty legs, null lags, still reports totalMs", t.legs.length === 0 && t.startLagMs === null && t.betweenLegsMs === null && t.slowestLeg === null && t.totalMs === 8000]);
  checks.push(["malformed url is ignored, not thrown", summarizeSettleTimeline([{ name: "::::", startTime: 1100, duration: 5 }], 1000, 1200, 42).legs.length === 0]);
}

checks.push(["isSlowSettle: 4s threshold by default", !isSlowSettle(3999) && isSlowSettle(4000) && isSlowSettle(60000)]);
checks.push(["isSlowSettle: custom threshold", isSlowSettle(1500, 1000) && !isSlowSettle(500, 1000)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
