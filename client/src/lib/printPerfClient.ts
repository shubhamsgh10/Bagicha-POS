import { createStageTimer, SLOW_PRINT_TAP_MS, type StageTimer } from "@shared/printPerf";
import { parseServerTimingStages } from "@shared/requestTiming";
import { timedFetch, stallResetCount, REPLAYED_HEADER } from "@/lib/api";
import { msSinceLastApiResponse } from "@/lib/connectionKeepAlive";

/**
 * POS tap → printed-response marks. One tap at a time (a POS has one cart). Logs a single
 * `[print-perf]` console line per tap so real-use numbers (Vercel, Electron host) can be read
 * from DevTools without any test data, and reports a tap that took >= SLOW_PRINT_TAP_MS to the
 * audit trail (`perf.slow_print`) with enough to tell WHERE the time went: the request's own time
 * vs the server's (Server-Timing), how long the connection had been quiet before the tap, how many
 * times the stall breaker reset the connection during it, and whether the answer was a replay.
 * Never throws, never affects the print flow.
 */
let current: {
  kind: string;
  timer: StageTimer;
  idleMs: number | null;
  online: boolean;
  serverTiming: string | null;
  resetsAtStart: number;
  replayed: boolean;
} | null = null;

export function startPrintTap(kind: string): void {
  current = {
    kind,
    timer: createStageTimer(),
    idleMs: msSinceLastApiResponse(),
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    serverTiming: null,
    resetsAtStart: stallResetCount(),
    replayed: false,
  };
}

export function timePrintStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return current ? current.timer.time(name, fn) : fn();
}

/** Keeps the save response's Server-Timing (the server's own stage breakdown) and replay flag for the report. */
export function notePrintResponse(res: Response): void {
  try {
    if (current) {
      current.serverTiming = res.headers.get("Server-Timing");
      current.replayed = res.headers.get(REPLAYED_HEADER) === "true";
    }
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
    const server = parseServerTimingStages(tap.serverTiming);
    const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
    // timedFetch like every API call (lib/slowRequest.ts never reports /api/perf/*, so no loop).
    void timedFetch("/api/perf/slow-print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
        hidden: typeof document !== "undefined" ? document.visibilityState === "hidden" : null,
        electron: typeof window !== "undefined" ? !!window.electronAPI?.isElectron : null,
        resets: stallResetCount() - tap.resetsAtStart,
        replayed: tap.replayed,
      }),
    }).catch(() => {});
  } catch {
    /* diagnostics only */
  }
}
