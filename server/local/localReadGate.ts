// Pure: which requests the shop PC's local server answers from its own database. Everything else
// (writes, login, reports, printing, auth/context, pusher auth, any GET not listed) is forwarded to
// the cloud unchanged.

const LOCAL_PATHS = new Set([
  "/api/auth/me",
  "/api/menu",
  "/api/categories",
  "/api/tables",
  "/api/settings",
  "/api/live-status",
  "/api/kot",
  "/api/orders/customers",
  "/api/orders/hold",
]);

function hasValue(query: Record<string, unknown>, key: string): boolean {
  const v = query[key];
  if (Array.isArray(v)) return v.some((x) => String(x).length > 0);
  return v !== undefined && v !== null && String(v).length > 0 && String(v) !== "false";
}

function firstString(v: unknown): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.length > 0 ? x : null;
}

/**
 * `path` is the full request path (no query string), e.g. "/api/orders/42".
 *
 * `coverageStart`: the local copy only holds orders created after (snapshot time - the snapshot
 * window), so a date-ranged order list that starts before that would silently come back short —
 * those requests proxy. `undefined` = don't check (pure tests). `null` = unknown, treat the dated
 * lists as not covered.
 */
export function isLocalRead(
  method: string,
  path: string,
  query: Record<string, unknown> = {},
  coverageStart?: Date | null,
): boolean {
  if (method.toUpperCase() !== "GET") return false;
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (LOCAL_PATHS.has(p)) return true;
  if (p === "/api/orders") {
    // Open / unpaid / due sets and "changed since" deltas are complete locally (every open order is
    // in the snapshot and every later change is pulled).
    if (hasValue(query, "open") || hasValue(query, "unpaid") || hasValue(query, "due") || hasValue(query, "updatedSince")) return true;
    const start = firstString(query.startDate);
    if (!start) return false; // endDate alone / nothing = whole history
    if (coverageStart === undefined) return true;
    const t = new Date(start).getTime();
    return coverageStart !== null && Number.isFinite(t) && t >= coverageStart.getTime();
  }
  return /^\/api\/orders\/\d+$/.test(p);
}

/** The local server's own endpoints (never proxied). */
export function isLocalOnly(path: string): boolean {
  return path === "/api/local" || path.startsWith("/api/local/");
}
