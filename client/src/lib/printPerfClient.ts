import { createStageTimer, parseServerTiming, SLOW_PRINT_TAP_MS, type StageTimer } from "@shared/printPerf";
import { apiUrl } from "@/lib/api";
import { msSinceLastApiResponse } from "@/lib/connectionKeepAlive";

/**
 * POS tap → printed-response marks. One tap at a time (a POS has one cart). Logs a single
 * `[print-perf]` console line per tap so real-use numbers (Vercel, Electron host) can be read
 * from DevTools without any test data, and reports a tap that took >= SLOW_PRINT_TAP_MS to the
 * audit trail (`perf.slow_print`) with enough to tell WHERE the time went: the request's own time
 * vs the server's (Server-Timing), and how long the connection had been quiet before the tap.
 * Never throws, never affects the print flow.
 */
let current: {
  kind: string;
  timer: StageTimer;
  idleMs: number | null;
  online: boolean;
  serverTiming: string | null;
} | null = null;

export function startPrintTap(kind: string): void {
  current = {
    kind,
    timer: createStageTimer(),
    idleMs: msSinceLastApiResponse(),
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    serverTiming: null,
  };
}

export function timePrintStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return current ? current.timer.time(name, fn) : fn();
}

/** Keeps the save response's Server-Timing (the server's own stage breakdown) for the report. */
export function notePrintResponse(res: Response): void {
  try {
    if (current) current.serverTiming = res.headers.get("Server-Timing");
  } catch {
    /* diagnostics only */
  }
}

export function endPrintTap(orderId?: number): void {
  if (!current) return;
  const tap = current;
  current = null;
  try {
    console.log(tap.timer.toLogLine(`tap:${tap.kind}`));
    const totalMs = tap.timer.totalMs();
    if (totalMs < SLOW_PRINT_TAP_MS) return;
    const server = parseServerTiming(tap.serverTiming);
    const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
    void fetch(apiUrl("/api/perf/slow-print"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true, // survives the navigate("/tables") that follows Save & Print
      body: JSON.stringify({
        orderId: orderId ?? null,
        kind: tap.kind,
        totalMs,
        stages: tap.timer.stages(),
        server: server.dur,
        instance: server.inst,
        idleMs: tap.idleMs,
        onlineAtClick: tap.online,
        connection: c ? `${c.effectiveType ?? "?"} rtt=${c.rtt ?? "?"} down=${c.downlink ?? "?"}` : null,
      }),
    }).catch(() => {});
  } catch {
    /* diagnostics only */
  }
}
