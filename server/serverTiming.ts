import type { Request, Response, NextFunction } from "express";

/**
 * `Server-Timing` for every /api response: how long the handler took (`app;dur`) and how old this
 * server instance is (`inst;desc="age=12s req=34"`). A tiny age / req=1 on a slow request is the
 * signature of a request that landed on a freshly started serverless instance — a cold start —
 * which no handler log can show, because the time is spent before our code runs.
 * `Timing-Allow-Origin` lets a cross-origin client (the Electron app talking to Vercel) read it
 * back through PerformanceResourceTiming; see shared/settleTiming.ts for how it is interpreted.
 */
const BOOT_AT = Date.now();
let seq = 0;

export function serverTiming(_req: Request, res: Response, next: NextFunction): void {
  const t0 = process.hrtime.bigint();
  const n = ++seq;
  const writeHead = res.writeHead;
  // Headers must be set just before they are flushed, when the handler duration is known.
  (res as any).writeHead = function (this: Response, ...args: unknown[]) {
    if (!res.headersSent) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      res.setHeader("Server-Timing", `app;dur=${ms.toFixed(0)}, inst;desc="age=${Math.round((Date.now() - BOOT_AT) / 1000)}s req=${n}"`);
      res.setHeader("Timing-Allow-Origin", "*");
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  };
  next();
}
