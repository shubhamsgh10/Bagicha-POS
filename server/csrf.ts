import type { Express, Request, Response, NextFunction } from "express";
import { parseAllowedOrigins } from "./cors";

/**
 * Cross-site request forgery guard for every state-changing /api request.
 *
 * Why it is needed: on Vercel the session cookie is `SameSite=None` (the Electron thin client calls
 * the API cross-origin), so a browser attaches it to a POST that ANY website submits — a plain
 * `<form method=POST>` or a `fetch(..., { mode: "no-cors", credentials: "include" })`. CORS does not
 * stop that: it only hides the response, the request itself still runs. Without this guard a page a
 * logged-in staff phone opens could mark dues paid (`/api/dues/settle-customer`), settle an order,
 * or send WhatsApp messages from the restaurant's number.
 *
 * The rule (decideCsrf below, unit-tested in scripts/verify-csrf.ts):
 *  - Safe methods (GET/HEAD/OPTIONS) always pass.
 *  - No `Origin` header → pass. Browsers send Origin on every cross-origin POST/PUT/PATCH/DELETE,
 *    so a request without one is not a cross-site browser request: it is a server-to-server caller
 *    (webhooks, the Electron main process) or — measured with this repo's Electron 33 — the thin
 *    client, whose `file://` renderer sends NO Origin header (and bypasses CORS) on its API calls.
 *  - Origin equal to this server's own host, or listed in ALLOWED_ORIGINS → pass.
 *  - Any other Origin (a foreign site, or `null` from a sandboxed iframe) passes ONLY for a request
 *    a cross-site page cannot forge: `Content-Type: application/json` or an `X-Requested-With`
 *    header. Both make the browser send a CORS preflight first, and the preflight fails for an
 *    origin this server doesn't allow, so the real request is never sent.
 *  - Everything else → 403.
 */

export interface CsrfInput {
  method: string;
  origin: string | undefined;
  /** Host header(s) this request reached us under (Host and, behind a proxy, X-Forwarded-Host). */
  hosts: string[];
  contentType: string | undefined;
  xRequestedWith: string | undefined;
  allowedOrigins: string[];
}

export type CsrfDecision =
  | { ok: true; reason: "safe_method" | "no_origin" | "same_origin" | "allowed_origin" | "not_forgeable" }
  | { ok: false; reason: "cross_site" };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originHost(origin: string): string | null {
  try {
    const u = new URL(origin);
    return u.host ? u.host.toLowerCase() : null;
  } catch {
    return null; // "null" (opaque origin) and junk
  }
}

function isJson(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.split(";")[0].trim().toLowerCase() === "application/json";
}

export function decideCsrf(i: CsrfInput): CsrfDecision {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return { ok: true, reason: "safe_method" };
  const origin = i.origin?.trim();
  if (!origin) return { ok: true, reason: "no_origin" };

  const host = originHost(origin);
  if (host && i.hosts.some((h) => h.trim().toLowerCase() === host)) return { ok: true, reason: "same_origin" };
  if (i.allowedOrigins.includes(origin) || i.allowedOrigins.includes("*")) return { ok: true, reason: "allowed_origin" };

  if (isJson(i.contentType) || (i.xRequestedWith ?? "").trim() !== "") return { ok: true, reason: "not_forgeable" };
  return { ok: false, reason: "cross_site" };
}

function headerList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
}

/** Registered right after applyCors in both entries (server/index.ts, server-fn.ts), before any body parsing. */
export function applyCsrfGuard(app: Express): void {
  const allowedOrigins = parseAllowedOrigins();
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const decision = decideCsrf({
      method: req.method,
      origin: req.headers.origin as string | undefined,
      hosts: [...headerList(req.headers.host), ...headerList(req.headers["x-forwarded-host"] as string | string[] | undefined)],
      contentType: req.headers["content-type"] as string | undefined,
      xRequestedWith: req.headers["x-requested-with"] as string | undefined,
      allowedOrigins,
    });
    if (decision.ok) return next();
    console.warn(`[csrf] blocked ${req.method} ${req.originalUrl.split("?")[0]} from Origin ${String(req.headers.origin)}`);
    res.status(403).json({ error: "Cross-site request blocked" });
  });
}
