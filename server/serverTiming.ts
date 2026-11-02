import type { Request, Response, NextFunction } from "express";
import { SLOW_HANDLER_MS, loggablePath } from "@shared/requestTiming";
import { logAudit } from "./services/auditService";

/**
 * `Server-Timing` for every /api response: how long the handler took (`app;dur`) and how old this
 * server instance is (`inst;desc="age=12s req=34"`). A tiny age / req=1 on a slow request is the
 * signature of a request that landed on a freshly started serverless instance — a cold start —
 * which no handler log can show, because the time is spent before our code runs.
 * `Timing-Allow-Origin` lets a cross-origin client (the Electron app talking to Vercel) read it
 * back through PerformanceResourceTiming; see shared/settleTiming.ts for how it is interpreted.
 * (The shop device's browser hides it there anyway, so the client also reads the header straight off
 * the response — packages/api-client timedFetch, exposed cross-origin by server/cors.ts.)
 *
 * `cold;dur` is added when the request had to wait for this instance to start (req.coldMs, set only
 * by the Vercel entry server-fn.ts: process uptime when init finished, for a request that arrived
 * while init was still running). The persistent server never sets it.
 *
 * Handlers that take >= SLOW_HANDLER_MS also leave a durable `perf.slow_handler` audit row — the
 * server-side half of the diagnostics (Vercel keeps only ~1h of logs).
 */
const BOOT_AT = Date.now();
let seq = 0;

export function serverTiming(req: Request, res: Response, next: NextFunction): void {
  const t0 = process.hrtime.bigint();
  const n = ++seq;
  const coldMs = Math.round(Number((req as any).coldMs ?? 0)) || 0;
  const handlerMs = () => Number(process.hrtime.bigint() - t0) / 1e6;
  const writeHead = res.writeHead;
  // Headers must be set just before they are flushed, when the handler duration is known.
  (res as any).writeHead = function (this: Response, ...args: unknown[]) {
    if (!res.headersSent) {
      const ms = handlerMs();
      res.setHeader(
        "Server-Timing",
        `app;dur=${ms.toFixed(0)}, ${coldMs ? `cold;dur=${coldMs}, ` : ""}inst;desc="age=${Math.round((Date.now() - BOOT_AT) / 1000)}s req=${n}"`,
      );
      res.setHeader("Timing-Allow-Origin", "*");
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  };
  res.on("finish", () => {
    const ms = handlerMs();
    const path = loggablePath(req.originalUrl || req.url);
    if (ms < SLOW_HANDLER_MS || path.startsWith("/api/perf/")) return;
    console.warn(`[slow-handler] ${req.method} ${path} ${Math.round(ms)}ms status=${res.statusCode} req=${n}${coldMs ? ` cold=${coldMs}ms` : ""}`);
    void logAudit(req, "perf.slow_handler", "request", null, {
      method: req.method, path, status: res.statusCode, appMs: Math.round(ms), coldMs: coldMs || null,
      instAgeS: Math.round((Date.now() - BOOT_AT) / 1000), instReq: n,
    });
  });
  next();
}
