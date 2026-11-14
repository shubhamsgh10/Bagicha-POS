// Pure rules for replayed requests (local-first phase 4): header parsing, lease ranges, the base
// (optimistic-concurrency) check, the X-Replay-At bounds and which requests may be replayed at all.
// No imports, so scripts/verify-replay.ts can lock them without a DB.

export const REPLAY_HEADER = "x-bagicha-replay";
export const REPLAY_ACTOR_HEADER = "x-replay-actor";
export const REPLAY_APPROVER_HEADER = "x-replay-approver";
export const REPLAY_BASE_HEADER = "x-replay-base";
export const REPLAY_AT_HEADER = "x-replay-at";

export interface PrincipalRef { kind: "u" | "sm"; id: number }

/** "u:<id>" / "sm:<id>" only; nothing else a client could use to smuggle a principal shape. */
export function parsePrincipalRef(v: unknown): PrincipalRef | null {
  if (typeof v !== "string") return null;
  const m = /^(u|sm):([1-9]\d{0,8})$/.exec(v.trim());
  return m ? { kind: m[1] as "u" | "sm", id: Number(m[2]) } : null;
}

export function replayFlagSet(v: unknown): boolean {
  return v === "1";
}

// ── X-Replay-At ────────────────────────────────────────────────────────────
export const REPLAY_AT_FUTURE_SKEW_MS = 2 * 60_000;
export const REPLAY_AT_MAX_AGE_MS = 48 * 3600_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** The PC-side action time, or null (use "now") when absent, malformed, in the future (+2 min) or older than 48 h. */
export function parseReplayAt(v: unknown, now: number = Date.now()): Date | null {
  if (typeof v !== "string" || !ISO_RE.test(v.trim())) return null;
  const t = Date.parse(v.trim());
  if (!Number.isFinite(t)) return null;
  if (t > now + REPLAY_AT_FUTURE_SKEW_MS) return null;
  if (t < now - REPLAY_AT_MAX_AGE_MS) return null;
  return new Date(t);
}

// ── Base check ─────────────────────────────────────────────────────────────
const TS_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z)?$/;

/** Normalises a timestamp string to "YYYY-MM-DDTHH:MM:SS.ffffff" (6 fraction digits), or null. */
export function normalizeTimestamp(s: string): string | null {
  const m = TS_RE.exec(s.trim());
  if (!m) return null;
  const frac = (m[3] ?? "").slice(0, 6).padEnd(6, "0");
  return `${m[1]}T${m[2]}.${frac}`;
}

/**
 * Does the order's current updated_at equal the base the device edited from? `dbUpdatedAt` is the
 * column rendered by Postgres with microseconds. A base with at most millisecond precision (a JS
 * Date round trip) is compared at milliseconds.
 */
export function baseMatches(dbUpdatedAt: string | null | undefined, base: string): boolean {
  if (!dbUpdatedAt) return false;
  const a = normalizeTimestamp(dbUpdatedAt);
  const b = normalizeTimestamp(base);
  if (!a || !b) return false;
  const baseFrac = (TS_RE.exec(base.trim())?.[3] ?? "").length;
  const cut = baseFrac > 0 && baseFrac <= 3 ? 23 : 26; // "YYYY-MM-DDTHH:MM:SS." is 20 chars
  return a.slice(0, cut) === b.slice(0, cut);
}

// ── Which requests may be replayed ────────────────────────────────────────
/** The replay list (docs/superpowers/plans/2026-11-14-local-first-phase4-offline-writes.md). */
export function isReplayable(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const p = path.split("?")[0].replace(/\/+$/, "");
  if (m === "POST") {
    return p === "/api/orders" || p === "/api/print/kot" || p === "/api/print/bill"
      || /^\/api\/orders\/\d+\/(payment|bill-requested|settle-due|payment-method)$/.test(p)
      || /^\/api\/tables\/\d+\/shift$/.test(p);
  }
  if (m === "PUT") {
    return /^\/api\/orders\/\d+(\/(items|cancel|hold|recall|move-table))?$/.test(p) || /^\/api\/kot\/\d+$/.test(p);
  }
  return false;
}

/**
 * Routes that mount the requestKeys middleware (server/requestKeys.ts). Every replay-list route does
 * (scripts/verify-keyed-routes.ts locks it), so this is the replay list itself.
 */
export function isKeyedReplayRoute(method: string, path: string): boolean {
  return isReplayable(method, path);
}

export type BaseTarget =
  | { kind: "order"; id: number }
  | { kind: "table"; id: number }
  | { kind: "kot"; id: number }
  | { kind: "body_order" };

/** Where the order a replayed request touches is found. null = creation / nothing to check. */
export function baseTargetFor(method: string, path: string): BaseTarget | null {
  const p = path.split("?")[0].replace(/\/+$/, "");
  let m = /^\/api\/orders\/(\d+)(\/|$)/.exec(p);
  if (m) return { kind: "order", id: Number(m[1]) };
  m = /^\/api\/tables\/(\d+)\/shift$/.exec(p);
  if (m) return { kind: "table", id: Number(m[1]) };
  m = /^\/api\/kot\/(\d+)$/.exec(p);
  if (m) return { kind: "kot", id: Number(m[1]) };
  if (method.toUpperCase() === "POST" && (p === "/api/print/kot" || p === "/api/print/bill")) return { kind: "body_order" };
  return null;
}

// ── Leases ─────────────────────────────────────────────────────────────────
export interface LeaseRange { startValue: number; endValue: number }

export function inAnyLease(value: number, leases: readonly LeaseRange[]): boolean {
  if (!Number.isSafeInteger(value) || value < 1) return false;
  return leases.some((l) => value >= l.startValue && value <= l.endValue);
}

/** "ORD0123" gives 123. Only the canonical spelling (padStart 4) is accepted, so one number has one string. */
export function parseClientOrderNumber(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^ORD(\d{4,9})$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return `ORD${String(n).padStart(4, "0")}` === s && n >= 1 ? n : null;
}

/** "007" gives 7 (canonical padStart 3). */
export function parseClientKotNumber(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{3,9})$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return String(n).padStart(3, "0") === s && n >= 1 ? n : null;
}

export function parseClientId(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 2_000_000_000 ? v : null;
}

// ── Print decision ─────────────────────────────────────────────────────────
/**
 * Only server/sync/replay.ts sets `req.replay` (after validating a device token). A request that has
 * it must commit print STATE but never dispatch: no print_jobs row, no direct send, no PRINT_JOB.
 */
export function shouldDispatchPrint(req: unknown): boolean {
  return !(req as { replay?: unknown } | null | undefined)?.replay;
}
