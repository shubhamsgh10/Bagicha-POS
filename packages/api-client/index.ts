import {
  DEFAULT_STALL_TIMINGS,
  CONNECTION_DROPPED_MESSAGE,
  IDEMPOTENCY_HEADER,
  decideAfterCheck,
  shouldRetry,
  hasIdempotencyKey,
  newIdempotencyKey,
  type StallTimings,
  type CheckOutcome,
  type FailureKind,
} from "./stallBreaker";

export {
  DEFAULT_STALL_TIMINGS,
  CONNECTION_DROPPED_MESSAGE,
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  newIdempotencyKey,
  type StallTimings,
} from "./stallBreaker";

/**
 * Central API URL resolution for browser, Electron renderer, and Vite dev proxy.
 * Set VITE_API_BASE_URL (e.g. https://your-app.vercel.app) when the UI is not served from the API host.
 *
 * Inlined at build time via vite.config `define` (import.meta.env is unreliable in aliased packages).
 */
declare const __BAGICHA_API_BASE_URL__: string | undefined;

function isLocalDevOrigin(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

function readBaseFromEnv(): string {
  // UI on localhost:5000 / :5173 must use same-origin — ignore stale Vite define from an old .env.
  if (isLocalDevOrigin()) {
    return "";
  }

  if (typeof __BAGICHA_API_BASE_URL__ === "string" && __BAGICHA_API_BASE_URL__.trim()) {
    return __BAGICHA_API_BASE_URL__.trim();
  }
  const fromVite = import.meta.env.VITE_API_BASE_URL;
  if (fromVite && String(fromVite).trim()) {
    return String(fromVite).trim();
  }
  if (typeof process !== "undefined" && process.env?.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL.trim();
  }
  return "";
}

let runtimeOverride: string | undefined;

/** Override API base at runtime (e.g. Electron settings screen). Pass "" for same-origin. */
export function setApiBaseUrl(url: string): void {
  runtimeOverride = url.replace(/\/$/, "");
}

export function resetApiBaseUrl(): void {
  runtimeOverride = undefined;
}

export function getApiBaseUrl(): string {
  const base = runtimeOverride !== undefined ? runtimeOverride : readBaseFromEnv();
  return base.replace(/\/$/, "");
}

/** Resolve an API path to a full URL or same-origin relative path. */
export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalized}` : normalized;
}

/** Normalize React Query keys that start with /api/... */
export function apiQueryKey(key: readonly unknown[]): readonly unknown[] {
  if (typeof key[0] === "string" && key[0].startsWith("/api")) {
    return [apiUrl(key[0]), ...key.slice(1)] as readonly unknown[];
  }
  return key;
}

async function throwIfResNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// ── Timed fetch ──────────────────────────────────────────────────────────────────────────
// Every API call goes through timedFetch: it measures the time to response headers, reads the server's
// `Server-Timing` header (see shared/requestTiming.ts) and hands both to an observer, so a slow request
// can say whether the time went to our handler, a cold start, or the network. Read-only requests
// (GET/HEAD) that get no response headers within GET_TIMEOUT_MS are aborted and retried once — a
// stalled connection otherwise waits as long as the network does. Writes are retried only when they
// carry a one-time key (Idempotency-Key, server/requestKeys.ts replays a repeat) AND the desktop stall
// breaker is active (see ./stallBreaker.ts and the StallBreaker section below).

/** Kept in sync with shared/requestTiming.ts (this package is client-only and has no @shared alias). */
export const GET_TIMEOUT_MS = 8_000;

export interface RequestTiming {
  method: string;
  url: string;
  /** performance.now() when the first attempt started. */
  startedAt: number;
  /** Time to response headers for the attempt that answered (or to the abort). */
  clientMs: number;
  status: number | null;
  serverTiming: string | null;
  /** 1 = first try; 2 = after a timeout/network retry. */
  attempt: number;
  /** No response within GET_TIMEOUT_MS (on the final attempt). */
  timedOut: boolean;
  /** A network error with no response (DNS, offline, connection reset). */
  failed: boolean;
}

type RequestObserver = (t: RequestTiming) => void;
let observer: RequestObserver | null = null;
/** Install the (single) observer — client/src/lib/slowRequest.ts. */
export function setRequestObserver(fn: RequestObserver | null): void {
  observer = fn;
}

const RECENT_MAX = 60;
const recent: RequestTiming[] = [];
/** The last ~60 request timings, oldest first (used to explain a slow Settle). */
export function recentRequestTimings(): readonly RequestTiming[] {
  return recent;
}

function notify(t: RequestTiming): void {
  recent.push(t);
  if (recent.length > RECENT_MAX) recent.shift();
  try {
    observer?.(t);
  } catch {
    /* diagnostics only */
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ── Stall breaker (desktop app only) ─────────────────────────────────────────────────────
// Installed by client/src/lib/stallReset.ts when window.electronAPI.resetConnections exists. While
// installed and enabled, every timedFetch attempt is watched: no response headers after checkAfterMs →
// GET /api/ping on the same connection; ping silent too → reset all connections (Electron
// closeAllConnections — open WebSockets survive), abort, retry once. Spec:
// docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md

export interface StallResetInfo {
  method: string;
  url: string;
  keyed: boolean;
  /** Request start → the moment this request's watchdog reset the connections. */
  detectMs: number;
  /** ok = the retry got response headers; failed = the retry failed too; not_retried = an unkeyed write. */
  retryOutcome: "ok" | "failed" | "not_retried";
  retryStatus: number | null;
  /** Retry start → its response headers (or failure); null when not retried. */
  retryMs: number | null;
}

export interface StallBreaker {
  /** Read per request: false = timedFetch behaves exactly as before (kill switch off). */
  enabled(): boolean;
  /** Close every connection of this app (desktop: session.closeAllConnections via IPC). */
  reset(): Promise<void>;
  /** Diagnostics, called after the retry finished (or was refused). Must not throw. */
  onReset?(info: StallResetInfo): void;
  /** Tests only — production uses DEFAULT_STALL_TIMINGS. */
  timings?: Partial<StallTimings>;
}

let breaker: StallBreaker | null = null;
let lastResetAt: number | null = null;
let resetsSoFar = 0;

/** Installed once by the desktop app (client/src/lib/stallReset.ts); null removes it. */
export function setStallBreaker(b: StallBreaker | null): void {
  breaker = b;
  lastResetAt = null;
}

/** Connection resets so far in this page session (printPerfClient diffs it per tap). */
export function stallResetCount(): number {
  return resetsSoFar;
}

/** Adds a fresh one-time key unless the request already carries one. */
export function withIdempotencyKey(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has(IDEMPOTENCY_HEADER)) headers.set(IDEMPOTENCY_HEADER, newIdempotencyKey());
  return { ...init, headers };
}

/** Is the connection alive? A tiny GET on the same connection pool (credentials: include). */
async function checkConnection(timeoutMs: number): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(apiUrl("/api/ping"), { cache: "no-store", credentials: "include", signal: controller.signal });
    return "answered";
  } catch {
    return "silent";
  } finally {
    clearTimeout(timer);
  }
}

/** Watches one attempt; returns a stop function (call it as soon as the attempt settles). */
function watchAttempt(b: StallBreaker, t: StallTimings, onReset: () => void, abort: () => void): () => void {
  let stopped = false;
  const timer = setTimeout(async () => {
    if (stopped) return;
    const check = await checkConnection(t.checkTimeoutMs);
    if (stopped || decideAfterCheck(check, now(), lastResetAt, t) === "keep_waiting") return;
    lastResetAt = now();
    resetsSoFar++;
    onReset();
    try {
      await b.reset();
    } catch {
      /* the abort below still frees this request */
    }
    abort(); // HTTP/2 requests already failed with the reset; this also covers HTTP/1.1
  }, t.checkAfterMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function reportReset(b: StallBreaker | null, info: StallResetInfo): void {
  try {
    b?.onReset?.(info);
  } catch {
    /* diagnostics only */
  }
}

export async function timedFetch(path: string, init?: RequestInit, opts?: { timeoutMs?: number }): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? GET_TIMEOUT_MS;
  const url = apiUrl(path);
  const method = (init?.method ?? "GET").toUpperCase();
  const readOnly = method === "GET" || method === "HEAD";
  const callerSignal = init?.signal ?? null;
  const readTimeout = readOnly && !callerSignal; // the 8 s read timeout — unchanged
  const keyed = hasIdempotencyKey(init?.headers);
  const b = breaker && breaker.enabled() ? breaker : null;
  const timings: StallTimings = { ...DEFAULT_STALL_TIMINGS, ...(b?.timings ?? {}) };
  const startedAt = now();
  // An object, not a `let`: it is written from the watchdog callback, which TS flow analysis can't see.
  const reset = { at: null as number | null };

  for (let attempt = 1; ; attempt++) {
    const t0 = now();
    const controller = readTimeout || b ? new AbortController() : null;
    let timedOut = false;
    const timer = readTimeout && controller
      ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
      : null;
    // Only the first attempt is watched: a retry that stalls on a brand-new connection is a real outage.
    const stopWatch = b && controller && attempt === 1
      ? watchAttempt(b, timings, () => { reset.at = now(); }, () => controller.abort())
      : null;
    const signal = controller
      ? (callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal)
      : undefined;
    try {
      const res = await fetch(url, {
        ...init,
        credentials: init?.credentials ?? "include",
        ...(signal ? { signal } : {}),
      });
      if (timer) clearTimeout(timer); // the timeout covers waiting for headers, not the body download
      stopWatch?.();
      notify({
        method, url, startedAt, clientMs: Math.round(now() - t0), status: res.status,
        serverTiming: res.headers.get("server-timing"), attempt, timedOut: false, failed: false,
      });
      if (reset.at !== null && attempt > 1) {
        reportReset(b, {
          method, url, keyed, detectMs: Math.round(reset.at - startedAt),
          retryOutcome: "ok", retryStatus: res.status, retryMs: Math.round(now() - t0),
        });
      }
      return res;
    } catch (err) {
      if (timer) clearTimeout(timer);
      stopWatch?.();
      const failure: FailureKind = callerSignal?.aborted
        ? "caller_aborted"
        : attempt === 1 && reset.at !== null
          ? "reset_by_this_request"
          : timedOut
            ? "timeout"
            : "network";
      if (attempt === 1 && shouldRetry({ method, keyed, hasCallerSignal: !!callerSignal, breakerActive: !!b, failure })) {
        continue; // once, on a fresh connection (same headers → same one-time key)
      }
      notify({
        method, url, startedAt, clientMs: Math.round(now() - t0), status: null,
        serverTiming: null, attempt, timedOut, failed: !timedOut,
      });
      if (reset.at !== null) {
        reportReset(b, {
          method, url, keyed, detectMs: Math.round(reset.at - startedAt),
          retryOutcome: attempt > 1 ? "failed" : "not_retried", retryStatus: null,
          retryMs: attempt > 1 ? Math.round(now() - t0) : null,
        });
        if (attempt === 1) throw new Error(CONNECTION_DROPPED_MESSAGE); // an unkeyed write: never resent
      }
      if (timedOut) throw new Error("Request timed out — check the internet connection and try again.");
      throw err;
    }
  }
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await timedFetch(path, init);
  await throwIfResNotOk(res);
  return res;
}

export async function apiRequest(
  method: string,
  path: string,
  data?: unknown,
): Promise<Response> {
  return apiFetch(path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  return res.json() as Promise<T>;
}
