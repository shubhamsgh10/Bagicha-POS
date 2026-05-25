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

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: init?.credentials ?? "include",
  });
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
