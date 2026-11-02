import { isSlowSettle, summarizeSettleTimeline, type ResourceEntryLike } from "@shared/settleTiming";
import { parseServerTiming, loggablePath } from "@shared/requestTiming";
import { apiUrl, recentRequestTimings } from "./api";

/**
 * The browser hides Server-Timing (and TTFB) from Resource Timing on the shop device — every slow-settle
 * report before this said "server ?". timedFetch reads the header off the response itself; match each
 * resource entry to that capture (same path, started within 300ms) and fill in what the browser hid.
 */
function withCapturedServerTiming(entries: PerformanceResourceTiming[]): ResourceEntryLike[] {
  const captured = recentRequestTimings();
  return entries.map((e) => {
    if (e.serverTiming && e.serverTiming.length > 0) return e;
    const path = loggablePath(e.name);
    let best: (typeof captured)[number] | null = null;
    for (const c of captured) {
      if (!c.serverTiming || loggablePath(c.url) !== path) continue;
      const d = Math.abs(c.startedAt - e.startTime);
      if (d <= 300 && (!best || d < Math.abs(best.startedAt - e.startTime))) best = c;
    }
    if (!best) return e;
    const st = parseServerTiming(best.serverTiming);
    const serverTiming: Array<{ name: string; duration: number; description: string }> = [];
    if (st.appMs != null) serverTiming.push({ name: "app", duration: st.appMs, description: "" });
    if (st.coldMs != null) serverTiming.push({ name: "cold", duration: st.coldMs, description: "" });
    if (st.instAgeS != null) serverTiming.push({ name: "inst", duration: 0, description: `age=${st.instAgeS}s req=${st.instReq ?? "?"}` });
    return { name: e.name, startTime: e.startTime, duration: e.duration, requestStart: e.requestStart, responseStart: e.responseStart, serverTiming };
  });
}

/**
 * Settle diagnostics (see shared/settleTiming.ts). Call markSettleClick() when Settle is pressed
 * and reportSlowSettle() when it finishes; a settle that took >= 4s posts its timeline to the audit
 * trail so a slow one can be explained afterwards. Everything here is best-effort and must never
 * affect, delay or fail a settlement.
 */
export interface SettleClick {
  at: number;
  online: boolean;
}

export function markSettleClick(): SettleClick {
  try {
    // A tab that has been polling for hours can fill the browser's resource-timing buffer (250
    // entries by default), after which new entries — including this settle's own — are dropped.
    // Only entries from this click onward matter, so start from an empty buffer.
    performance.clearResourceTimings();
  } catch {
    /* not supported — the report will just have fewer legs */
  }
  return { at: performance.now(), online: typeof navigator !== "undefined" ? navigator.onLine : true };
}

export function reportSlowSettle(args: { orderId: number; click: SettleClick; outcome: "ok" | "error" }): void {
  try {
    const finishedAt = performance.now();
    if (!isSlowSettle(finishedAt - args.click.at)) return;
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const timeline = summarizeSettleTimeline(withCapturedServerTiming(entries), args.click.at, finishedAt, args.orderId);
    const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
    void fetch(apiUrl("/api/perf/slow-settle"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true, // survives the navigate("/tables") that follows a successful settle
      body: JSON.stringify({
        orderId: args.orderId,
        outcome: args.outcome,
        ...timeline,
        onlineAtClick: args.click.online,
        connection: c ? `${c.effectiveType ?? "?"} rtt=${c.rtt ?? "?"} down=${c.downlink ?? "?"}` : null,
      }),
    }).catch(() => {});
  } catch {
    /* diagnostics only */
  }
}
