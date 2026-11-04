/**
 * Request-latency diagnostics shared by the client (packages/api-client timedFetch, lib/slowRequest.ts),
 * the server (server/serverTiming.ts) and the readout (scripts/report-latency.ts). Pure.
 *
 * Every /api response carries `Server-Timing`:
 *   app;dur=<handler ms>                 time spent inside Express for this request
 *   cold;dur=<ms>                        only on a request that waited for the instance to boot
 *   inst;desc="age=<s>s req=<n>"          instance age and request sequence number
 * The client measures its own time to response headers. Comparing the two says WHERE a slow request
 * spent its time — which the browser's Resource Timing could not tell us (it hid TTFB/Server-Timing
 * on the shop device, so every slow-settle report said "server ?").
 */

/** A request at or above this (client-measured, to response headers) is reported. */
export const SLOW_REQUEST_MS = 4_000;
/** A handler at or above this (server-measured) is logged server-side. */
export const SLOW_HANDLER_MS = 1_500;
/** Read-only requests with no response headers by then are aborted and retried once. */
export const GET_TIMEOUT_MS = 8_000;

export interface ServerTimingInfo {
  appMs: number | null;
  coldMs: number | null;
  instAgeS: number | null;
  instReq: number | null;
}

/**
 * THE Server-Timing parser — every reader goes through this one (the slow-request / slow-settle
 * reports via parseServerTiming below, the slow-print report directly). Parses
 * `save;dur=180.2, insert_job;dur=9, app;dur=212, inst;desc="age=60s req=9"` into each entry's
 * duration plus the instance description. Junk entries are skipped, never thrown on.
 */
export function parseServerTimingStages(header: string | null | undefined): { dur: Record<string, number>; inst: string | null } {
  const dur: Record<string, number> = {};
  let inst: string | null = null;
  if (!header) return { dur, inst };
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName?.trim();
    if (!name) continue;
    for (const p of params) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim();
      if (k === "dur" && v !== "" && Number.isFinite(Number(v))) dur[name] = Number(v);
      if (k === "desc" && name === "inst") inst = v.replace(/^"|"$/g, "");
    }
  }
  return { dur, inst };
}

/** The summary the latency reports need: our handler's time, a cold start, the instance age/sequence. */
export function parseServerTiming(header: string | null | undefined): ServerTimingInfo {
  const { dur, inst } = parseServerTimingStages(header);
  const out: ServerTimingInfo = {
    appMs: dur.app !== undefined ? Math.round(dur.app) : null,
    coldMs: dur.cold !== undefined ? Math.round(dur.cold) : null,
    instAgeS: null,
    instReq: null,
  };
  if (inst) {
    const age = /age=(\d+)s/.exec(inst);
    const req = /req=(\d+)/.exec(inst);
    if (age) out.instAgeS = Number(age[1]);
    if (req) out.instReq = Number(req[1]);
  }
  return out;
}

export type SlowRequestCause = "timeout" | "network" | "cold_start" | "server" | "unknown";

/**
 * Where a slow request's time went. `clientMs` = browser time to response headers.
 *  - timeout:    no response at all within GET_TIMEOUT_MS (nothing came back to measure)
 *  - unknown:    a response without Server-Timing (old server, or a proxy error page)
 *  - server:     our handler took at least half the time
 *  - cold_start: the instance was booting for at least half the time
 *  - network:    everything else — the request/response was in transit (or queued before Vercel
 *                handed it to us), i.e. the time was spent between the device and our code
 */
export function classifySlowRequest(t: { clientMs: number; timedOut?: boolean } & Partial<ServerTimingInfo>): SlowRequestCause {
  if (t.timedOut) return "timeout";
  if (t.appMs == null) return "unknown";
  const half = t.clientMs / 2;
  if (t.appMs >= half) return "server";
  if ((t.coldMs ?? 0) >= half) return "cold_start";
  return "network";
}

/** Path for logging: no query string (it can carry dates/names), ids kept (they identify the order). */
export function loggablePath(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname.slice(0, 120);
  } catch {
    return String(url).split("?")[0].slice(0, 120);
  }
}
