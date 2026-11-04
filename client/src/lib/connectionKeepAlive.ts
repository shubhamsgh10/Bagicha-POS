import { apiUrl, timedFetch } from "@/lib/api";
import {
  KEEPALIVE_TICK_MS,
  isApiResourceUrl,
  shouldPing,
  type KeepAliveState,
} from "@shared/connectionKeepAlive";

/**
 * Keeps this device's connection to the API warm with GET /api/ping whenever it has carried no
 * response for ~15 s, so the first tap after a quiet spell (KOT, Bill, Settle) doesn't land on a
 * connection the network dropped silently and wait out Chromium's 10 s ping timeout. Why, and the
 * timings: shared/connectionKeepAlive.ts. Never throws; a failed ping is simply ignored.
 */

// performance.now() clock.
const state: KeepAliveState = { lastResponseAt: null, lastPingAt: null };
let observer: PerformanceObserver | null = null;

/** ms since the last API response finished on this page — null if none seen yet. */
export function msSinceLastApiResponse(): number | null {
  return state.lastResponseAt == null ? null : Math.round(performance.now() - state.lastResponseAt);
}

// Any API response counts, not just the ping: it kept the same connection busy, so a page that is
// already polling (Tables, Live View) sends no extra pings at all.
function observeApiResponses(): void {
  if (observer || typeof PerformanceObserver === "undefined") return;
  try {
    const origin = new URL(apiUrl("/api/ping"), window.location.href).origin;
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!isApiResourceUrl(e.name, origin)) continue;
        const end = (e as PerformanceResourceTiming).responseEnd || e.startTime + e.duration;
        if (state.lastResponseAt == null || end > state.lastResponseAt) state.lastResponseAt = end;
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    observer = null; // no Resource Timing: every tick just pings
  }
}

function ping(): void {
  state.lastPingAt = performance.now();
  // credentials "include", like every API call (timedFetch's default): Chromium keeps credentialed
  // and uncredentialed requests on DIFFERENT connections, so an uncredentialed ping would keep the
  // wrong one warm. Through timedFetch on purpose: once the keep-warm works, a dead connection's
  // ~10 s stall lands on THIS request instead of a staff tap — so the ping must be timed and, when
  // slow, reported (perf.slow_request, path /api/ping) or scripts/report-latency.ts could not tell
  // whether the stalls stopped or merely moved here. A stalled ping is aborted at 8 s and retried.
  void timedFetch("/api/ping", { cache: "no-store" }).catch(() => {});
}

/** Starts the keep-warm loop; returns the stop function. */
export function startConnectionKeepAlive(opts: { keepWhileHidden: boolean }): () => void {
  observeApiResponses();
  const active = () => opts.keepWhileHidden || document.visibilityState === "visible";
  const check = (reason: "tick" | "wake") => {
    if (shouldPing(state, performance.now(), reason, active())) ping();
  };
  const onTick = () => check("tick");
  const onWake = () => check("wake");
  const id = setInterval(onTick, KEEPALIVE_TICK_MS);
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  onWake();
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
  };
}
