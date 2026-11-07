/**
 * Desktop stall breaker — the pure rules (no DOM, no timers), driven by a fake clock in
 * scripts/verify-stall-breaker.ts. timedFetch (./index.ts) applies them to every API request once
 * the desktop app installs a breaker (client/src/lib/stallReset.ts); in a browser nothing changes.
 *
 * Why: when the shop PC's connection to the API dies silently, Chromium waits 10 s (longer if the
 * connection was used moments before) before trying a new one. The breaker notices after
 * checkAfterMs, confirms with a tiny check request on the same connection, closes all connections
 * (Electron session.closeAllConnections — open WebSockets such as Pusher survive it, measured) and
 * retries once on a fresh one. Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 */
export interface StallTimings {
  /** No response headers after this long → send the check. */
  checkAfterMs: number;
  /** The check must answer within this long, else the connection is dead. */
  checkTimeoutMs: number;
  /** At most one reset per this long — a just-renewed connection is left alone. */
  resetMinGapMs: number;
}

export const DEFAULT_STALL_TIMINGS: StallTimings = { checkAfterMs: 1500, checkTimeoutMs: 1500, resetMinGapMs: 10_000 };

/** Kept equal to shared/requestKeys.ts (this package has no @shared alias) — verify-stall-breaker checks it. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotent-Replayed";

export const CONNECTION_DROPPED_MESSAGE =
  "The connection dropped while saving — check whether it was saved, then try again.";

export type CheckOutcome = "answered" | "silent";

/** A request still has no response headers and the check finished: reset the connections or keep waiting? */
export function decideAfterCheck(
  check: CheckOutcome,
  now: number,
  lastResetAt: number | null,
  t: StallTimings,
): "keep_waiting" | "reset" {
  if (check === "answered") return "keep_waiting";
  if (lastResetAt !== null && now - lastResetAt < t.resetMinGapMs) return "keep_waiting";
  return "reset";
}

/** Why the first attempt failed. "reset_by_this_request" = this request's own watchdog reset the connections. */
export type FailureKind = "reset_by_this_request" | "network" | "timeout" | "caller_aborted";

/** The first attempt failed: send it once more? Writes only with a one-time key (server replays a repeat). */
export function shouldRetry(r: {
  method: string;
  keyed: boolean;
  hasCallerSignal: boolean;
  breakerActive: boolean;
  failure: FailureKind;
}): boolean {
  if (r.failure === "caller_aborted") return false;
  const m = r.method.toUpperCase();
  if (m === "GET" || m === "HEAD") return !r.hasCallerSignal || r.failure === "reset_by_this_request";
  return r.keyed && r.breakerActive && (r.failure === "reset_by_this_request" || r.failure === "network");
}

export function hasIdempotencyKey(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  try {
    return new Headers(headers).has(IDEMPOTENCY_HEADER);
  } catch {
    return false;
  }
}

/** A fresh one-time key (UUID; a random fallback where crypto.randomUUID is missing). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const r = () => Math.random().toString(36).slice(2, 12);
  return `k-${Date.now().toString(36)}-${r()}${r()}`;
}
