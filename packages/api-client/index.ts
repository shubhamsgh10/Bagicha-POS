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
// stalled connection otherwise waits as long as the network does. Writes are never retried here:
// replaying a create/print could duplicate it.

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

export async function timedFetch(path: string, init?: RequestInit, opts?: { timeoutMs?: number }): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? GET_TIMEOUT_MS;
  const url = apiUrl(path);
  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = (method === "GET" || method === "HEAD") && !init?.signal;
  const startedAt = now();
  const maxAttempts = retryable ? 2 : 1;

  for (let attempt = 1; ; attempt++) {
    const t0 = now();
    const controller = retryable ? new AbortController() : null;
    let timedOut = false;
    const timer = controller
      ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
      : null;
    try {
      const res = await fetch(url, {
        ...init,
        credentials: init?.credentials ?? "include",
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (timer) clearTimeout(timer); // the timeout covers waiting for headers, not the body download
      notify({
        method, url, startedAt, clientMs: Math.round(now() - t0), status: res.status,
        serverTiming: res.headers.get("server-timing"), attempt, timedOut: false, failed: false,
      });
      return res;
    } catch (err) {
      if (timer) clearTimeout(timer);
      const last = attempt >= maxAttempts;
      if (last) {
        notify({
          method, url, startedAt, clientMs: Math.round(now() - t0), status: null,
          serverTiming: null, attempt, timedOut, failed: !timedOut,
        });
        if (timedOut) throw new Error("Request timed out — check the internet connection and try again.");
        throw err;
      }
      // Retry once (read-only only): a fresh request after a stall or a dropped connection.
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
