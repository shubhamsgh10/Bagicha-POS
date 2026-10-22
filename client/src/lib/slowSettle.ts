import { isSlowSettle, summarizeSettleTimeline } from "@shared/settleTiming";
import { apiUrl } from "./api";

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
    const timeline = summarizeSettleTimeline(entries, args.click.at, finishedAt, args.orderId);
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
