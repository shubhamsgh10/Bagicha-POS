/**
 * Crash / error report sent by a client (browser, phone or the desktop app) to POST /api/client-errors,
 * and the same shape the desktop app writes to its log file (%APPDATA%\Bagicha POS\logs\main.log).
 *
 * Why it exists: on 17 Nov 2026 the shop PC's desktop app showed "Something went wrong" and stayed that
 * way through every reload, and nothing anywhere recorded WHAT threw (no Sentry DSN, the packaged app
 * logs only updater lines, DevTools is off). Every report carries the error, where it happened and the
 * last API requests / query errors before it, so the next failure can be diagnosed from the record.
 *
 * Pure (no I/O): the server clamps every field with sanitizeClientErrorReport before logging/storing it,
 * so a client can never write an unbounded or oddly-typed row. scripts/verify-client-error-report.ts.
 */

export const CLIENT_ERROR_KINDS = ["render", "uncaught", "rejection", "renderer-gone"] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

/** One recent API request (packages/api-client recentRequestTimings), compacted. */
export interface ClientErrorRequest {
  m: string;            // method
  p: string;            // path, no query string
  s: number | null;     // status (null = no response)
  ms: number;           // time to response headers
  ago: number;          // seconds before the error
  to?: boolean;         // timed out
  f?: boolean;          // network failure
}

/** One recent React Query failure. */
export interface ClientErrorQueryError {
  key: string;
  msg: string;
  ago: number;          // seconds before the error
}

export interface ClientErrorReport {
  errorId: string;
  kind: ClientErrorKind;
  name: string | null;
  message: string;
  stack: string | null;
  componentStack: string | null;
  /** In-app route (hash route on the desktop app), no query string values beyond 200 chars. */
  route: string | null;
  appVersion: string | null;
  electron: boolean | null;
  online: boolean | null;
  hidden: boolean | null;
  /** Seconds since this page loaded. */
  uptimeS: number | null;
  /** Signed in according to the client's cached /api/auth/me. */
  signedIn: boolean | null;
  /** Desktop app: screens are restored from the saved copy (IndexedDB). */
  persisted: boolean | null;
  /** Same error already reported this many times in this page session (deduped). */
  repeats: number | null;
  /** Report was queued offline / after a crash and sent on a later start. */
  delayed: boolean | null;
  userAgent: string | null;
  requests: ClientErrorRequest[];
  queryErrors: ClientErrorQueryError[];
}

export const CLIENT_ERROR_LIMITS = {
  message: 500,
  name: 80,
  stack: 4000,
  componentStack: 2000,
  route: 200,
  appVersion: 40,
  userAgent: 200,
  requests: 20,
  queryErrors: 10,
} as const;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Server-side gate: null when the body is not a usable report; otherwise every field clamped. */
export function sanitizeClientErrorReport(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const kind = (CLIENT_ERROR_KINDS as readonly string[]).includes(b.kind as string) ? (b.kind as ClientErrorKind) : null;
  const message = str(b.message, CLIENT_ERROR_LIMITS.message);
  if (!kind || !message) return null;
  const errorId = typeof b.errorId === "string" && /^[A-Za-z0-9-]{4,40}$/.test(b.errorId) ? b.errorId : "unknown";

  const requests: ClientErrorRequest[] = Array.isArray(b.requests)
    ? b.requests.slice(-CLIENT_ERROR_LIMITS.requests).flatMap((r: any) => {
        const p = str(r?.p, 120);
        if (!p) return [];
        const out: ClientErrorRequest = { m: str(r?.m, 8) ?? "?", p: p.split("?")[0], s: num(r?.s), ms: num(r?.ms) ?? 0, ago: num(r?.ago) ?? 0 };
        if (r?.to === true) out.to = true;
        if (r?.f === true) out.f = true;
        return [out];
      })
    : [];
  const queryErrors: ClientErrorQueryError[] = Array.isArray(b.queryErrors)
    ? b.queryErrors.slice(-CLIENT_ERROR_LIMITS.queryErrors).flatMap((q: any) => {
        const key = str(q?.key, 120);
        if (!key) return [];
        return [{ key, msg: str(q?.msg, 200) ?? "", ago: num(q?.ago) ?? 0 }];
      })
    : [];

  return {
    errorId,
    kind,
    name: str(b.name, CLIENT_ERROR_LIMITS.name),
    message,
    stack: str(b.stack, CLIENT_ERROR_LIMITS.stack),
    componentStack: str(b.componentStack, CLIENT_ERROR_LIMITS.componentStack),
    route: str(b.route, CLIENT_ERROR_LIMITS.route),
    appVersion: str(b.appVersion, CLIENT_ERROR_LIMITS.appVersion),
    electron: bool(b.electron),
    online: bool(b.online),
    hidden: bool(b.hidden),
    uptimeS: num(b.uptimeS),
    signedIn: bool(b.signedIn),
    persisted: bool(b.persisted),
    repeats: num(b.repeats),
    delayed: bool(b.delayed),
    userAgent: str(b.userAgent, CLIENT_ERROR_LIMITS.userAgent),
    requests,
    queryErrors,
  };
}

/** First "at ..." frame of a stack, for one-line summaries. */
export function topStackFrame(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const line = stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at "));
  return line ? line.slice(0, 160) : null;
}

/** One searchable line for the server log (Vercel) and the desktop log file. */
export function clientErrorLogLine(r: ClientErrorReport, actor?: string): string {
  const where = r.electron ? `desktop ${r.appVersion ?? "?"}` : "browser";
  const frame = topStackFrame(r.stack);
  const failed = r.requests.filter((q) => q.s === null || q.s >= 400).slice(-3)
    .map((q) => `${q.m} ${q.p} ${q.s ?? (q.to ? "timeout" : "no-response")}`);
  return [
    `[client-error] ${r.errorId} ${r.kind} ${r.name ?? "Error"}: ${r.message}`,
    `route=${r.route ?? "?"}`,
    where,
    actor ? `actor=${actor}` : null,
    r.signedIn === false ? "signed-out" : null,
    r.repeats ? `repeats=${r.repeats}` : null,
    frame ? `at=${frame.replace(/^at /, "")}` : null,
    failed.length ? `recentFailed=[${failed.join(", ")}]` : null,
  ].filter(Boolean).join(" | ");
}

/** Same error twice = same kind + message + top frame (dedupe key on the client). */
export function clientErrorSignature(kind: string, message: string, stack: string | null | undefined): string {
  return `${kind}|${message.slice(0, 200)}|${topStackFrame(stack) ?? ""}`;
}
