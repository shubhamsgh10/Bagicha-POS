import type { Express } from "express";
import { logAudit } from "./services/auditService";
import { sanitizeClientErrorReport, clientErrorLogLine } from "@shared/clientErrorReport";

/** Reports per IP per window. A crash loop on one device is deduped client-side; this bounds abuse. */
export const CLIENT_ERROR_RATE = { max: 30, windowMs: 10 * 60_000 } as const;

/**
 * POST /api/client-errors — crash / error reports from any client (shared/clientErrorReport.ts,
 * client/src/lib/errorReporter.ts).
 *
 * NOT requireAuth on purpose: the crash this was built for (17 Nov 2026) happened exactly when the
 * session had run out, so an authenticated-only endpoint would have dropped the one report that
 * mattered. Abuse is bounded instead: every field clamped (~16 KB worst case), 30 per IP per 10 min.
 *
 * Each report becomes one searchable "[client-error] ..." line in the server log (Vercel runtime
 * logs) and a `client.error` audit row (durable — Vercel keeps ~1 h of logs). Read the rows with
 * `npx tsx -r dotenv/config scripts/report-client-errors.ts`, or Admin → Audit Log ("App Error").
 */
export function registerClientErrorRoutes(app: Express): void {
  const hits = new Map<string, number[]>();
  app.post("/api/client-errors", async (req, res) => {
    const report = sanitizeClientErrorReport(req.body);
    if (!report) return res.status(400).json({ error: "invalid report" });
    const ip = String(req.headers["x-forwarded-for"] ?? req.ip ?? "?").split(",")[0].trim();
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < CLIENT_ERROR_RATE.windowMs);
    if (recent.length >= CLIENT_ERROR_RATE.max) return res.status(429).end();
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 500) hits.clear(); // bounded memory; a reset only loosens the limit briefly
    const user = (req as any).user;
    const actor = user ? `${user._isStaffMember ? "sm" : "u"}:${user.id}:${user.username ?? user.name ?? "?"}` : "anonymous";
    console.error(clientErrorLogLine(report, actor));
    await logAudit(req, "client.error", "client", report.errorId, report as unknown as Record<string, unknown>);
    res.status(204).end();
  });
}
