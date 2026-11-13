// Pure helpers for the thin client's "local mode" (shop PC runs the bundled server against its own
// PGlite copy and forwards writes to the cloud — see server/local/*). No Electron, no I/O, so
// scripts/verify-local-mode-config.ts can exercise every rule without a GUI.
import { randomBytes, timingSafeEqual } from "crypto";

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

/**
 * Resolves the `local:enable` request. The renderer supplies ONLY the device token: any `cloudUrl`
 * it sends is ignored. The cloud URL is the one a human already put in host-config.json (e.g. a Vercel
 * preview test), else the build-baked API base. Returns an error (and the caller writes nothing)
 * when neither source is a valid URL.
 */
export function resolveEnableConfig(input: unknown, existingConfig: unknown, apiBaseEnv: string): EnableResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request" };
  const { deviceToken } = input as { deviceToken?: unknown };
  if (!isValidDeviceToken(deviceToken)) {
    return { ok: false, error: "The device token must be 64 hex characters (copy it again from the Admin page)" };
  }
  const file = existingConfig && typeof existingConfig === "object" ? (existingConfig as Record<string, unknown>) : {};
  const hand = typeof file.cloudUrl === "string" && file.cloudUrl.trim() ? file.cloudUrl : "";
  const url = normalizeCloudUrl(hand || apiBaseEnv);
  if (!url) {
    return { ok: false, error: "No valid cloud URL is configured for this app (https://... required; http:// only for localhost)" };
  }
  return { ok: true, cloudUrl: url, deviceToken: deviceToken.toLowerCase() };
}

/**
 * Local settings out of a parsed host-config.json. `cloudUrl` comes from the file when a human set one,
 * else `apiBaseEnv` (build-baked). `enabled` is false for any incomplete/invalid trio.
 */
export function parseLocalHostSettings(file: unknown, apiBaseEnv = ""): { enabled: boolean; settings: LocalHostSettings | null; problem?: string } {
  const f = file && typeof file === "object" ? (file as Record<string, unknown>) : {};
  if (f.localMode !== true) return { enabled: false, settings: null };
  const raw = typeof f.cloudUrl === "string" && f.cloudUrl.trim() ? f.cloudUrl : apiBaseEnv;
  const cloudUrl = normalizeCloudUrl(raw);
  if (!cloudUrl) return { enabled: false, settings: null, problem: "host-config.json: localMode is on but the cloud URL is missing or invalid" };
  if (!isValidDeviceToken(f.deviceToken)) {
    return { enabled: false, settings: null, problem: "host-config.json: localMode is on but deviceToken is missing or invalid" };
  }
  return { enabled: true, settings: { localMode: true, cloudUrl, deviceToken: f.deviceToken.toLowerCase() } };
}

/** Fresh per-launch secret the local server echoes from /api/local/status so a stray listener cannot pass the probe. */
export function newLocalNonce(): string {
  return randomBytes(16).toString("hex");
}

/** Constant-time nonce comparison; false for anything that is not a non-empty string equal to `expected`. */
export function nonceMatches(expected: string, got: unknown): boolean {
  if (typeof got !== "string" || !expected) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Readiness rule for a /api/local/status body: localMode true AND the launch nonce echoed back. */
export function isReadyStatusBody(body: unknown, nonce: string): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as { localMode?: unknown; nonce?: unknown };
  return b.localMode === true && nonceMatches(nonce, b.nonce);
}

/** Env keys the local server must never inherit (compared case-insensitively, as Windows does). */
const STRIPPED_KEYS = [
  "DATABASE_URL", "DATABASE_CA_CERT", "BACKGROUND_JOBS", "SESSION_SECRET", "HOST",
  "BAGICHA_EMBEDDED", "PRINT_BENCH", "VITE_DEV_SERVER_URL", "BAGICHA_LOCAL_NONCE",
];

export interface LocalChildEnvInput {
  cloudUrl: string;
  deviceToken: string;
  pgliteDir: string;
  dataDir: string;
  port: string | number;
  sessionSecret: string;
  /** Per-launch readiness nonce (never logged). */
  nonce: string;
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
    BAGICHA_LOCAL_NONCE: o.nonce,
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
