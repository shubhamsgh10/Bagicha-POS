// Pure helpers for the thin client's "local mode" (shop PC runs the bundled server against its own
// PGlite copy and forwards writes to the cloud — see server/local/*). No Electron, no I/O, so
// scripts/verify-local-mode-config.ts can exercise every rule without a GUI.

/** What userData/host-config.json carries for local mode (other fields of that file are untouched). */
export interface LocalHostSettings {
  localMode: boolean;
  /** Origin only, no trailing slash. */
  cloudUrl: string;
  deviceToken: string;
}

export const LOCAL_READY_TIMEOUT_MS = 45_000;
export const LOCAL_CRASH_LIMIT = 3;
export const LOCAL_CRASH_WINDOW_MS = 5 * 60_000;

const TOKEN_RE = /^[0-9a-f]{64}$/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isValidDeviceToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/**
 * Cloud URL rule: https:// anywhere, plain http:// only for a loopback host (dev / stub cloud).
 * Credentials, path, query and hash are rejected so the value can only ever be an origin.
 * Returns the normalised origin, or null.
 */
export function normalizeCloudUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return u.origin;
  return null;
}

export type EnableResult =
  | { ok: true; cloudUrl: string; deviceToken: string }
  | { ok: false; error: string };

/** Validates the renderer's `local:enable` request. `fallbackCloudUrl` fills in an empty cloudUrl. */
export function validateEnableRequest(input: unknown, fallbackCloudUrl = ""): EnableResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request" };
  const { cloudUrl, deviceToken } = input as { cloudUrl?: unknown; deviceToken?: unknown };
  if (!isValidDeviceToken(deviceToken)) {
    return { ok: false, error: "The device token must be 64 hex characters (copy it again from the Admin page)" };
  }
  const url = normalizeCloudUrl(typeof cloudUrl === "string" && cloudUrl.trim() ? cloudUrl : fallbackCloudUrl);
  if (!url) {
    return { ok: false, error: "The cloud URL must be https://... (http:// is allowed only for localhost)" };
  }
  return { ok: true, cloudUrl: url, deviceToken: deviceToken.toLowerCase() };
}

/** Local settings out of a parsed host-config.json. `enabled` is false for any incomplete/invalid trio. */
export function parseLocalHostSettings(file: unknown): { enabled: boolean; settings: LocalHostSettings | null; problem?: string } {
  const f = file && typeof file === "object" ? (file as Record<string, unknown>) : {};
  if (f.localMode !== true) return { enabled: false, settings: null };
  const cloudUrl = normalizeCloudUrl(f.cloudUrl);
  if (!cloudUrl) return { enabled: false, settings: null, problem: "host-config.json: localMode is on but cloudUrl is missing or invalid" };
  if (!isValidDeviceToken(f.deviceToken)) {
    return { enabled: false, settings: null, problem: "host-config.json: localMode is on but deviceToken is missing or invalid" };
  }
  return { enabled: true, settings: { localMode: true, cloudUrl, deviceToken: f.deviceToken.toLowerCase() } };
}

/** Env keys the local server must never inherit (compared case-insensitively, as Windows does). */
const STRIPPED_KEYS = [
  "DATABASE_URL", "DATABASE_CA_CERT", "BACKGROUND_JOBS", "SESSION_SECRET", "HOST",
  "BAGICHA_EMBEDDED", "PRINT_BENCH", "VITE_DEV_SERVER_URL",
];

export interface LocalChildEnvInput {
  cloudUrl: string;
  deviceToken: string;
  pgliteDir: string;
  dataDir: string;
  port: string | number;
  sessionSecret: string;
}

/**
 * Environment for the spawned local server. Starts from the parent's env but drops everything that
 * could point it at the production database or switch on background jobs, then sets the local-mode
 * contract (server/local/localMode.ts). DATABASE_URL is never present in the result.
 */
export function buildLocalChildEnv(parent: NodeJS.ProcessEnv, o: LocalChildEnvInput): NodeJS.ProcessEnv {
  const strip = new Set(STRIPPED_KEYS.map((k) => k.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(parent)) {
    if (strip.has(key.toUpperCase())) continue;
    env[key] = parent[key];
  }
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    BAGICHA_LOCAL_MODE: "1",
    BAGICHA_DB: "pglite",
    BAGICHA_PGLITE_DIR: o.pgliteDir,
    BAGICHA_CLOUD_URL: o.cloudUrl,
    BAGICHA_DEVICE_TOKEN: o.deviceToken,
    BAGICHA_DATA_DIR: o.dataDir,
    PORT: String(o.port),
    HOST: "127.0.0.1",
    SESSION_SECRET: o.sessionSecret,
  };
}

export type ExitDecision =
  | { action: "restart"; delayMs: number; crashes: number }
  | { action: "fallback"; reason: string; crashes: number };

/**
 * Crash-loop rule: more than LOCAL_CRASH_LIMIT unexpected exits inside LOCAL_CRASH_WINDOW_MS means
 * the shop gets the normal cloud client for this run. Otherwise restart with 1 s, 2 s, 4 s ... backoff.
 * `crashTimes` already includes the exit being decided on.
 */
export function decideAfterExit(
  crashTimes: number[],
  now: number,
  limit = LOCAL_CRASH_LIMIT,
  windowMs = LOCAL_CRASH_WINDOW_MS,
): ExitDecision {
  const recent = crashTimes.filter((t) => now - t <= windowMs);
  if (recent.length > limit) {
    return { action: "fallback", reason: `local server crashed ${recent.length} times in ${Math.round(windowMs / 60_000)} min`, crashes: recent.length };
  }
  return { action: "restart", delayMs: Math.min(30_000, 1000 * 2 ** (recent.length - 1)), crashes: recent.length };
}

/** Not-ready rule: the first start may download a snapshot, but the shop never waits longer than this. */
export function readyTimedOut(startedAt: number, now: number, timeoutMs = LOCAL_READY_TIMEOUT_MS): boolean {
  return now - startedAt >= timeoutMs;
}

export interface LocalStatus {
  /** The window is currently served by the local server. */
  active: boolean;
  /** host-config.json asks for local mode (valid trio) on this PC. */
  configured: boolean;
  /** Why local mode is not active although configured / why it was dropped. */
  reason?: string;
}
