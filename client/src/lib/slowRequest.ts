import { setRequestObserver, apiUrl, type RequestTiming } from "./api";
import { SLOW_REQUEST_MS, parseServerTiming, classifySlowRequest, loggablePath } from "@shared/requestTiming";

/**
 * Reports every API request that took >= 4s to response headers (or timed out) to
 * POST /api/perf/slow-request, which writes a `perf.slow_request` audit row. Each report carries the
 * browser's time AND the server's own time (Server-Timing), so the row says where the time went:
 * network, cold start, our handler, or a timeout. Read it with `npx tsx -r dotenv/config
 * scripts/report-latency.ts`. Best-effort only — never affects or delays the request itself.
 */
const MIN_GAP_MS = 5_000;   // at most one report every 5s (a bad network can make everything slow at once)
const MAX_PER_SESSION = 200;
let lastSentAt = 0;
let sent = 0;

function connectionInfo(): string | null {
  const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
  return c ? `${c.effectiveType ?? "?"} rtt=${c.rtt ?? "?"} down=${c.downlink ?? "?"}` : null;
}

function report(t: RequestTiming): void {
  const slow = t.timedOut || t.clientMs >= SLOW_REQUEST_MS || (t.attempt > 1);
  if (!slow) return;
  const path = loggablePath(t.url);
  if (path.startsWith("/api/perf/")) return; // never report the reporter
  const nowMs = Date.now();
  if (nowMs - lastSentAt < MIN_GAP_MS || sent >= MAX_PER_SESSION) return;
  lastSentAt = nowMs;
  sent++;

  const st = parseServerTiming(t.serverTiming);
  const cause = classifySlowRequest({ clientMs: t.clientMs, timedOut: t.timedOut, ...st });
  void fetch(apiUrl("/api/perf/slow-request"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify({
      method: t.method,
      path,
      status: t.status,
      clientMs: t.clientMs,
      ...st,
      attempt: t.attempt,
      timedOut: t.timedOut,
      failed: t.failed,
      cause,
      online: typeof navigator !== "undefined" ? navigator.onLine : null,
      hidden: typeof document !== "undefined" ? document.visibilityState === "hidden" : null,
      connection: connectionInfo(),
    }),
  }).catch(() => {});
}

export function installSlowRequestReporter(): void {
  setRequestObserver(report);
}
