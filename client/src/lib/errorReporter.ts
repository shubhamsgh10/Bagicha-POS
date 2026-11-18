/**
 * Crash / error reporting (shared/clientErrorReport.ts has the why). Every render crash, uncaught
 * error and unhandled promise rejection becomes one report that:
 *   1. goes to POST /api/client-errors -> a "[client-error] ..." line in the server log (Vercel) and a
 *      `client.error` audit row (read with scripts/report-client-errors.ts, or Admin -> Audit Log);
 *   2. on the desktop app, is also written to %APPDATA%\Bagicha POS\logs\main.log via IPC, so it
 *      survives even with no internet;
 *   3. if it could not be sent, is queued in localStorage and sent on the next start.
 * Best-effort only: never throws, never blocks the app.
 */
import { apiUrl, recentRequestTimings } from "./api";
import {
  clientErrorSignature,
  type ClientErrorKind,
  type ClientErrorReport,
  type ClientErrorQueryError,
} from "@shared/clientErrorReport";
import { createRollingBudget } from "@shared/rollingBudget";
import { loggablePath } from "@shared/requestTiming";

const PENDING_KEY = "bagicha.pendingErrorReports";
const PENDING_MAX = 5;
const DEDUPE_MS = 60_000;

const budget = createRollingBudget(20, 60 * 60 * 1000);
const seen = new Map<string, { at: number; repeats: number }>();
const queryErrors: { key: string; msg: string; at: number }[] = [];
let appVersion: string | null = null;
let signedInProbe: () => boolean | null = () => null;
let persistedFlag: boolean | null = null;

const electronAPI = () => (window as any).electronAPI as
  | { isElectron?: boolean; getVersion?: () => Promise<string>; logRendererError?: (r: ClientErrorReport) => Promise<void> }
  | undefined;

function newErrorId(): string {
  const t = Date.now().toString(36).slice(-5);
  const r = Math.random().toString(36).slice(2, 6);
  return `${t}-${r}`.toUpperCase();
}

function currentRoute(): string | null {
  try {
    const { pathname, hash, search } = window.location;
    // Desktop uses hash routing (#/tables); the browser uses the path.
    return (hash && hash.startsWith("#/") ? hash.slice(1) : pathname + search).slice(0, 200);
  } catch {
    return null;
  }
}

function errorParts(error: unknown): { name: string | null; message: string; stack: string | null } {
  if (error instanceof Error) {
    return { name: error.name || null, message: error.message || String(error), stack: error.stack ?? null };
  }
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    let message: string;
    try { message = typeof e.message === "string" ? e.message : JSON.stringify(error).slice(0, 500); }
    catch { message = String(error); }
    return { name: typeof e.name === "string" ? e.name : null, message, stack: typeof e.stack === "string" ? e.stack : null };
  }
  return { name: null, message: String(error), stack: null };
}

/** Noise that is not an app failure. */
function isIgnorable(message: string): boolean {
  return /ResizeObserver loop|Script error\.?$|AbortError|The user aborted a request|signal is aborted/i.test(message);
}

function readJson<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full / blocked */ }
}

async function send(report: ClientErrorReport): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/api/client-errors"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true, // still delivered if the page reloads right after a crash
      body: JSON.stringify(report),
    });
    // 4xx (bad report / rate-limited) will never succeed on retry; only a network failure or 5xx is queued.
    return res.ok || (res.status >= 400 && res.status < 500);
  } catch {
    return false;
  }
}

function queue(report: ClientErrorReport): void {
  const pending = readJson<ClientErrorReport[]>(PENDING_KEY) ?? [];
  pending.push({ ...report, delayed: true });
  writeJson(PENDING_KEY, pending.slice(-PENDING_MAX));
}

/** Record a React Query failure as a breadcrumb for the next report (called from queryCache.onError). */
export function recordQueryError(queryKey: readonly unknown[], error: unknown): void {
  try {
    const key = queryKey.map((k) => (typeof k === "string" ? k : JSON.stringify(k))).join(" ").slice(0, 120);
    queryErrors.push({ key, msg: errorParts(error).message.slice(0, 200), at: Date.now() });
    if (queryErrors.length > 10) queryErrors.shift();
  } catch { /* never */ }
}

/** Report one error. Returns the report (with its id) or null when it was ignored / rate-limited. */
export function reportClientError(
  kind: ClientErrorKind,
  error: unknown,
  extra?: { componentStack?: string | null },
): ClientErrorReport | null {
  try {
    const { name, message, stack } = errorParts(error);
    if (kind !== "render" && isIgnorable(message)) return null;
    const now = Date.now();
    const sig = clientErrorSignature(kind, message, stack);
    const prev = seen.get(sig);
    if (prev && now - prev.at < DEDUPE_MS) { prev.repeats++; return null; }
    const repeats = prev?.repeats ?? 0;
    seen.set(sig, { at: now, repeats: 0 });
    if (seen.size > 100) seen.clear();

    const nowPerf = performance.now();
    const report: ClientErrorReport = {
      errorId: newErrorId(),
      kind,
      name,
      message: message.slice(0, 500),
      stack: stack ? stack.slice(0, 4000) : null,
      componentStack: extra?.componentStack ? extra.componentStack.slice(0, 2000) : null,
      route: currentRoute(),
      appVersion,
      electron: !!electronAPI()?.isElectron,
      online: typeof navigator !== "undefined" ? navigator.onLine : null,
      hidden: typeof document !== "undefined" ? document.visibilityState === "hidden" : null,
      uptimeS: Math.round(nowPerf / 1000),
      signedIn: signedInProbe(),
      persisted: persistedFlag,
      repeats: repeats || null,
      delayed: null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
      requests: recentRequestTimings().slice(-20).map((t) => ({
        m: t.method,
        p: loggablePath(t.url),
        s: t.status,
        ms: Math.round(t.clientMs),
        ago: Math.max(0, Math.round((nowPerf - t.startedAt - t.clientMs) / 1000)),
        ...(t.timedOut ? { to: true } : {}),
        ...(t.failed ? { f: true } : {}),
      })),
      queryErrors: queryErrors.map<ClientErrorQueryError>((q) => ({ key: q.key, msg: q.msg, ago: Math.round((now - q.at) / 1000) })),
    };

    console.error(`[client-error] ${report.errorId} ${kind}: ${message}`);
    // Desktop: the log file gets EVERY report (not budgeted) — it is local and survives no internet.
    try { void electronAPI()?.logRendererError?.(report)?.catch?.(() => {}); } catch { /* old desktop build */ }
    if (!budget.tryTake(now)) return report;
    void send(report).then((ok) => { if (!ok) queue(report); });
    return report;
  } catch {
    return null;
  }
}

/** Send reports queued by an earlier page load (offline, or the page reloaded before the POST finished). */
async function flushPending(): Promise<void> {
  const pending = readJson<ClientErrorReport[]>(PENDING_KEY);
  if (!pending?.length) return;
  writeJson(PENDING_KEY, []);
  const failed: ClientErrorReport[] = [];
  for (const r of pending) if (!(await send(r))) failed.push(r);
  if (failed.length) writeJson(PENDING_KEY, [...failed, ...(readJson<ClientErrorReport[]>(PENDING_KEY) ?? [])].slice(-PENDING_MAX));
}

/**
 * Wire the global handlers (main.tsx, once). `isSignedIn` reads the cached /api/auth/me so a report
 * says whether the session was still valid when it broke.
 */
export function installErrorReporter(opts: { isSignedIn: () => boolean | null; persisted: boolean }): void {
  signedInProbe = () => { try { return opts.isSignedIn(); } catch { return null; } };
  persistedFlag = opts.persisted;
  try {
    void electronAPI()?.getVersion?.().then((v) => { appVersion = v; }, () => {});
  } catch { /* not electron */ }
  window.addEventListener("error", (event) => {
    reportClientError("uncaught", event.error ?? new Error(String(event.message)));
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError("rejection", event.reason);
  });
  window.addEventListener("online", () => { void flushPending(); });
  setTimeout(() => { void flushPending(); }, 5_000);
}
