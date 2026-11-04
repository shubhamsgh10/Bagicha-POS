/**
 * Explains a slow Settle from the browser's own resource timings (pure — no DOM, no network).
 *
 * Pressing Settle on a saved order is two serial requests (PUT /items, then POST /payment); on a
 * never-saved cart it is POST /api/orders then the payment. A slow settle can come from very
 * different places, and the only way to tell them apart is the SHAPE of the timeline:
 *   - startLagMs large, legs fast   → nothing left the browser for a while after the click
 *                                     (a mutation parked while the browser reported offline).
 *   - one leg's durationMs large, serverMs small, inst age small → the request waited on a cold
 *                                     serverless instance booting (network + start-up, not our code).
 *   - one leg's durationMs large, serverMs large → slow handler / database.
 * `Server-Timing` (server/serverTiming.ts) supplies serverMs and the instance's age.
 */

export interface ResourceEntryLike {
  name: string;
  startTime: number;
  duration: number;
  requestStart?: number;
  responseStart?: number;
  serverTiming?: ReadonlyArray<{ name: string; duration: number; description: string }>;
}

export interface SettleLeg {
  leg: "save" | "orders" | "payment";
  /** ms after the click that this request started. */
  startMs: number;
  durationMs: number;
  /** requestStart → responseStart: time waiting on the server, incl. any cold start. */
  ttfbMs: number | null;
  /** The server's own handler time (Server-Timing app;dur). */
  serverMs: number | null;
  /** e.g. "age=2s req=1" — a tiny age/req means this request hit a freshly started instance. */
  instance: string | null;
  /** Server-Timing cold;dur — time this request waited for the instance to boot (cold start). */
  coldMs?: number | null;
}

export interface SettleTimeline {
  totalMs: number;
  legs: SettleLeg[];
  /** Click → first request leaving the browser. */
  startLagMs: number | null;
  /** End of the first leg → start of the payment. */
  betweenLegsMs: number | null;
  slowestLeg: SettleLeg["leg"] | null;
}

export const SLOW_SETTLE_MS = 4000;
export const isSlowSettle = (totalMs: number, thresholdMs = SLOW_SETTLE_MS) => totalMs >= thresholdMs;

function pathnameOf(url: string): string | null {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
}

function classify(path: string, orderId: number): SettleLeg["leg"] | null {
  if (path === `/api/orders/${orderId}/items`) return "save";
  if (path === `/api/orders/${orderId}/payment`) return "payment";
  if (path === "/api/orders") return "orders";
  return null;
}

export function summarizeSettleTimeline(
  entries: ReadonlyArray<ResourceEntryLike>,
  clickedAt: number,
  finishedAt: number,
  orderId: number,
): SettleTimeline {
  const legs: SettleLeg[] = [];
  for (const e of entries) {
    if (e.startTime < clickedAt - 5) continue; // belongs to something before this click
    if (e.startTime > finishedAt) continue;     // started after the settle finished (a later poll)
    const path = pathnameOf(e.name);
    const leg = path ? classify(path, orderId) : null;
    if (!leg) continue;
    const app = e.serverTiming?.find((s) => s.name === "app");
    const inst = e.serverTiming?.find((s) => s.name === "inst");
    const cold = e.serverTiming?.find((s) => s.name === "cold");
    legs.push({
      leg,
      startMs: Math.round(e.startTime - clickedAt),
      durationMs: Math.round(e.duration),
      ttfbMs: e.requestStart && e.responseStart ? Math.round(e.responseStart - e.requestStart) : null,
      serverMs: app ? Math.round(app.duration) : null,
      instance: inst?.description || null,
      coldMs: cold ? Math.round(cold.duration) : null,
    });
  }
  legs.sort((a, b) => a.startMs - b.startMs);
  // "/api/orders" is the settle's leg only as the CREATE of a never-saved cart: the first one, before
  // the payment, with no save leg. Any other hit on that path is a background list refresh
  // (realtime invalidation, the Live orders poll) that used to be counted as part of the settle.
  {
    const paymentAt = legs.find((l) => l.leg === "payment")?.startMs ?? Infinity;
    const hasSave = legs.some((l) => l.leg === "save");
    let kept = false;
    for (let i = 0; i < legs.length; i++) {
      if (legs[i].leg !== "orders") continue;
      if (!hasSave && !kept && legs[i].startMs < paymentAt) { kept = true; continue; }
      legs.splice(i, 1); i--;
    }
  }

  const first = legs[0];
  const payment = legs.find((l) => l.leg === "payment");
  const beforePayment = legs.find((l) => l.leg !== "payment");
  const slowest = legs.reduce<SettleLeg | null>((m, l) => (!m || l.durationMs > m.durationMs ? l : m), null);

  return {
    totalMs: Math.round(finishedAt - clickedAt),
    legs,
    startLagMs: first ? first.startMs : null,
    betweenLegsMs: payment && beforePayment ? payment.startMs - (beforePayment.startMs + beforePayment.durationMs) : null,
    slowestLeg: slowest ? slowest.leg : null,
  };
}
