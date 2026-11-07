import { apiUrl, setStallBreaker, type StallResetInfo } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { msSinceLastApiResponse } from "@/lib/connectionKeepAlive";
import { loggablePath } from "@shared/requestTiming";
import { createRollingBudget } from "@shared/rollingBudget";

/**
 * Turns on the stall breaker (packages/api-client/stallBreaker.ts) in the desktop app — only where
 * the desktop shell can close connections (window.electronAPI.resetConnections; browsers and older
 * desktop builds lack it and keep today's behaviour). Admin → Settings → "Fast reconnect"
 * (settings.desktopFastReconnect, default on) is the kill switch, read per request from the cached
 * /api/settings query.
 *
 * Each reset is reported as `perf.stall_reset` (POST /api/perf/stall-reset; scripts/report-latency.ts)
 * — at most 60 per hour. Resets while the window is hidden (minimised: the once-a-minute keep-alive
 * ping often finds a dead connection) are not reported one by one; their count rides on the next
 * visible report as `hiddenResets`.
 */
const budget = createRollingBudget(60, 60 * 60 * 1000);
let hiddenResets = 0;
/** Quiet time on the connection when the reset fired; minus detectMs ≈ quiet time before the request. */
let quietAtResetMs: number | null = null;

export function installStallBreaker(): void {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  const resetConnections = api?.resetConnections;
  if (!resetConnections) return;
  setStallBreaker({
    enabled: () => queryClient.getQueryData<{ desktopFastReconnect?: boolean }>(["/api/settings"])?.desktopFastReconnect !== false,
    reset: async () => {
      quietAtResetMs = msSinceLastApiResponse();
      await resetConnections();
    },
    onReset: report,
  });
}

function report(info: StallResetInfo): void {
  try {
    if (document.visibilityState === "hidden") {
      hiddenResets++;
      return;
    }
    if (!budget.tryTake(Date.now())) return;
    const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
    const idleMs = quietAtResetMs == null ? null : Math.max(0, quietAtResetMs - info.detectMs);
    void fetch(apiUrl("/api/perf/stall-reset"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        method: info.method,
        path: loggablePath(info.url),
        keyed: info.keyed,
        detectMs: info.detectMs,
        retryOutcome: info.retryOutcome,
        retryStatus: info.retryStatus,
        retryMs: info.retryMs,
        idleMs,
        hiddenResets,
        connection: c ? `${c.effectiveType ?? "?"} rtt=${c.rtt ?? "?"} down=${c.downlink ?? "?"}` : null,
      }),
    }).catch(() => {});
    hiddenResets = 0;
  } catch {
    /* diagnostics only */
  }
}
