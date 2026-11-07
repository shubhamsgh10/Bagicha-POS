/**
 * One-time request keys ("Idempotency-Key") — the pure rules used by the server middleware
 * (server/requestKeys.ts) and locked by scripts/verify-request-keys.ts.
 *
 * A request carrying a key runs at most once per (key, user). A repeat — the desktop stall breaker
 * retrying a stuck KOT/Bill/Settle on a fresh connection, or Chromium quietly resending — gets the
 * first run's stored answer instead of running the route again. Requests WITHOUT a key behave
 * exactly as before. Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 *
 * The client package keeps its own copy of the two header names
 * (packages/api-client/stallBreaker.ts — that package has no @shared alias); keep them equal.
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotent-Replayed";

/** A repeat that finds the first run still going waits up to this long, re-reading every REPLAY_POLL_MS. */
export const REPLAY_WAIT_MS = 8_000;
export const REPLAY_POLL_MS = 250;
/** Answers bigger than this (as JSON text) are not stored; a repeat then gets `replay_unavailable`. */
export const MAX_STORED_BODY_CHARS = 1_000_000;
/** Keys are kept this long, then pruned — at most once per PRUNE_EVERY_MS per server instance. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const PRUNE_EVERY_MS = 10 * 60 * 1000;

export const IN_PROGRESS_MESSAGE = "This request is still being processed — refresh before trying again.";
export const REPLAY_UNAVAILABLE_MESSAGE = "This request already ran, but its answer is not available — refresh to see the result.";
export const MISMATCH_MESSAGE = "This request key was already used for a different request.";

const KEY_RE = /^[A-Za-z0-9-]{8,100}$/;

export function isValidIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && KEY_RE.test(v);
}

/** What makes two requests "the same": who sent it, where, and exactly what body. */
export interface KeyFingerprint {
  actorId: string;
  method: string;
  path: string;
  bodyHash: string;
}

/** A request_keys row, as far as the decision needs it. */
export interface StoredKey extends KeyFingerprint {
  /** "processing" | "done" */
  state: string;
  responseStatus: number | null;
  responseBody: unknown;
}

export type RepeatDecision =
  | { kind: "mismatch" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "replay_unavailable" }
  | { kind: "wait" };

/** A request arrived with a key that already has a row: what to do with it. */
export function decideRepeat(stored: StoredKey, incoming: KeyFingerprint): RepeatDecision {
  if (
    stored.actorId !== incoming.actorId ||
    stored.method !== incoming.method ||
    stored.path !== incoming.path ||
    stored.bodyHash !== incoming.bodyHash
  ) {
    return { kind: "mismatch" };
  }
  if (stored.state !== "done") return { kind: "wait" };
  if (stored.responseStatus == null || stored.responseBody == null) return { kind: "replay_unavailable" };
  return { kind: "replay", status: stored.responseStatus, body: stored.responseBody };
}

/** The text hashed into `bodyHash` (the server hashes it with sha256). */
export function bodyHashInput(body: unknown): string {
  return JSON.stringify(body ?? null);
}

/** `req.originalUrl` without its query string. */
export function keyPath(originalUrl: string): string {
  const q = originalUrl.indexOf("?");
  return q === -1 ? originalUrl : originalUrl.slice(0, q);
}

/** The answer body to store, or null when it is too big to keep. */
export function storableBody(body: unknown): unknown | null {
  const text = JSON.stringify(body ?? null);
  return text.length > MAX_STORED_BODY_CHARS ? null : body ?? null;
}

/** True for Postgres "relation does not exist" — the migration has not been run yet. */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}
