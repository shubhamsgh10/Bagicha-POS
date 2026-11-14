// Forwards every /api request the shop PC does not answer locally to the cloud API, unchanged.
//
// The browser never sees the cloud's cookies: they are held server-side in the local session
// (req.session.cloudCookies) and sent as the Cookie header. A successful cloud login also signs the
// user in locally (from the synced users / staff_members rows) so local reads are authorised.
// After any forwarded write the proxy waits briefly for a pull, so the next local read already
// shows it (read-your-writes).
import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface CloudProxyOptions {
  cloudUrl: string;
  worker: { pullNow(timeoutMs: number): Promise<void> };
  /** The local principal for a freshly authenticated cloud user, or null if that row isn't synced (yet). */
  loadPrincipal: (kind: "user" | "staff", id: number) => Promise<any | null>;
  fetchImpl?: typeof fetch;
  /** Vercel Deployment Protection bypass secret (sent as x-vercel-protection-bypass; never to the browser, never logged). */
  bypassSecret?: string;
  /** Abort for the cloud round trip. Default 60 s (reports and prints can be slow). */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

const FORWARD_REQUEST_HEADERS = ["content-type", "idempotency-key", "x-requested-with", "accept"];
/** Response headers that pass back. Never set-cookie; never the transport framing (fetch already decoded the body). */
const PASS_RESPONSE_HEADERS = [
  "content-type", "cache-control", "retry-after", "idempotent-replayed", "etag", "content-disposition", "server-timing",
];
const LOGIN_PATHS = new Set(["/api/auth/login", "/api/auth/card-login", "/api/auth/staff-pin-login", "/api/auth/2fa/complete"]);
const LOGOUT_PATH = "/api/auth/logout";
const FALLBACK_TIMEOUT_MS = 4_000;

type CookieJar = Record<string, string>;

/** Folds a response's Set-Cookie headers into the jar (a cleared / expired cookie is removed). */
export function mergeSetCookies(jar: CookieJar | undefined, setCookies: string[]): CookieJar {
  const next: CookieJar = { ...(jar ?? {}) };
  for (const raw of setCookies) {
    const parts = raw.split(";").map((p) => p.trim());
    const eq = parts[0].indexOf("=");
    if (eq <= 0) continue;
    const name = parts[0].slice(0, eq);
    const value = parts[0].slice(eq + 1);
    let expired = value === "";
    for (const attr of parts.slice(1)) {
      const i = attr.indexOf("=");
      const k = (i >= 0 ? attr.slice(0, i) : attr).toLowerCase();
      const v = i >= 0 ? attr.slice(i + 1) : "";
      if (k === "max-age" && Number(v) <= 0) expired = true;
      if (k === "expires") { const t = Date.parse(v); if (Number.isFinite(t) && t <= Date.now()) expired = true; }
    }
    if (expired) delete next[name];
    else next[name] = value;
  }
  return next;
}

export function cookieHeader(jar: CookieJar | undefined): string | undefined {
  const entries = Object.entries(jar ?? {});
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join("; ") : undefined;
}

function readRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The request body to send: re-serialised if a body parser already consumed it, else the raw stream. */
async function requestBody(req: Request): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const parsed = (req as any)._body === true;
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (parsed) {
    if (type === "application/json") return Buffer.from(JSON.stringify(req.body ?? {}));
    if (type === "application/x-www-form-urlencoded") {
      return Buffer.from(new URLSearchParams(req.body as Record<string, string>).toString());
    }
  }
  const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
  return hasBody ? readRawBody(req) : undefined;
}

function logout(req: Request): Promise<void> {
  return new Promise((resolve) => {
    if (typeof (req as any).logout !== "function") return resolve();
    (req as any).logout(() => resolve()); // passport 0.7 regenerates the session: cloud cookies go with it
  });
}

function login(req: Request, principal: any): Promise<void> {
  return new Promise((resolve, reject) => (req as any).login(principal, (err: any) => (err ? reject(err) : resolve())));
}

export function createCloudProxy(opts: CloudProxyOptions): RequestHandler {
  const doFetch = opts.fetchImpl ?? fetch;
  const LOGOUT_CLOUD_TIMEOUT_MS = 5_000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const log = opts.log ?? ((m: string) => console.log(`[local-proxy] ${m}`));

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = req.originalUrl.split("?")[0];
      const search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      const jar = (req.session as any)?.cloudCookies as CookieJar | undefined;

      // Logout signs out LOCALLY first (this drops the cloud cookie jar with the session), then tells the
      // cloud best-effort with the old cookies. A down cloud must never leave the person signed in.
      if (req.method === "POST" && path === LOGOUT_PATH) {
        const oldCookie = cookieHeader(jar);
        await logout(req);
        let cloudBody: Buffer | null = null;
        let cloudType: string | null = null;
        if (oldCookie) {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), LOGOUT_CLOUD_TIMEOUT_MS);
          try {
            const h: Record<string, string> = { cookie: oldCookie, "content-type": "application/json" };
            if (opts.bypassSecret) h["x-vercel-protection-bypass"] = opts.bypassSecret;
            const up = await doFetch(`${opts.cloudUrl}${path}`, { method: "POST", headers: h, body: "{}", redirect: "manual", signal: ac.signal });
            if (up.status >= 200 && up.status < 300) {
              cloudBody = Buffer.from(await up.arrayBuffer());
              cloudType = up.headers.get("content-type");
            } else {
              log(`logout at the cloud answered ${up.status} (signed out locally anyway)`);
            }
          } catch (err: any) {
            log(`logout: cloud unreachable (${err?.name === "AbortError" ? "timeout" : err?.message ?? err}); signed out locally anyway`);
          } finally {
            clearTimeout(timer);
          }
        }
        if (cloudBody) {
          if (cloudType) res.setHeader("content-type", cloudType);
          return res.status(200).end(cloudBody);
        }
        return res.status(200).json({ success: true });
      }

      const headers: Record<string, string> = {};
      for (const h of FORWARD_REQUEST_HEADERS) {
        const v = req.headers[h];
        if (typeof v === "string") headers[h] = v;
      }
      const cookie = cookieHeader(jar);
      if (cookie) headers.cookie = cookie;
      if (opts.bypassSecret) headers["x-vercel-protection-bypass"] = opts.bypassSecret;
      const body = await requestBody(req);
      if (body) headers["content-length"] = String(body.length);

      const ac = new AbortController();
      // A request with an offline fallback (sign-in) must not hang for a minute on a dead connection.
      const timer = setTimeout(() => ac.abort(), (req as any).localFallback ? FALLBACK_TIMEOUT_MS : timeoutMs);
      let upstream: globalThis.Response;
      let buf: Buffer;
      try {
        upstream = await doFetch(`${opts.cloudUrl}${path}${search}`, {
          method: req.method,
          headers,
          body: body as any,
          redirect: "manual",
          signal: ac.signal,
        });
        buf = Buffer.from(await upstream.arrayBuffer());
      } catch (err: any) {
        log(`${req.method} ${path} -> cloud unreachable (${err?.name === "AbortError" ? "timeout" : err?.message ?? err})`);
        // A request the local server can answer on its own (offline sign-in) takes over...
        const fallback = (req as any).localFallback as RequestHandler | undefined;
        if (fallback) return fallback(req, res, next);
        // ...everything else is simply not possible without the internet.
        return res.status(503).json({ message: "Needs internet", error: "Needs internet", code: "ONLINE_ONLY" });
      } finally {
        clearTimeout(timer);
      }
      const up = upstream;
      const status = up.status;
      const ok = status >= 200 && status < 300;

      // Cloud cookies stay on the server.
      const setCookies = typeof (up.headers as any).getSetCookie === "function" ? (up.headers as any).getSetCookie() as string[] : [];
      const nextJar = setCookies.length ? mergeSetCookies(jar, setCookies) : jar;

      const sendUpstream = async () => {
        for (const h of PASS_RESPONSE_HEADERS) {
          const v = up.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        res.status(status).end(buf);
      };

      if (req.method === "POST" && LOGIN_PATHS.has(path) && ok) {
        let parsed: any = null;
        try { parsed = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
        if (parsed && parsed.requires2FA) {
          // Mid-login: the cloud holds the pending-2FA state in ITS session; keep the cookie.
          if (nextJar && nextJar !== jar) (req.session as any).cloudCookies = nextJar;
          return sendUpstream();
        }
        const id = Number(parsed?.id);
        const kind: "user" | "staff" =
          path === "/api/auth/staff-pin-login" ? "staff"
          : path === "/api/auth/card-login" ? ((req.body as any)?.kind === "user" ? "user" : "staff")
          : "user";
        let principal = Number.isInteger(id) ? await opts.loadPrincipal(kind, id) : null;
        if (!principal && Number.isInteger(id)) {
          await opts.worker.pullNow(3000); // the row may have been created moments ago
          principal = await opts.loadPrincipal(kind, id);
        }
        if (!principal) {
          log(`login ok at the cloud but ${kind} ${id} is not in the local copy yet`);
          return res.status(503).json({ message: "This shop PC is still syncing — try again in a moment", code: "LOCAL_NOT_SYNCED" });
        }
        await login(req, principal); // regenerates the session...
        if (nextJar) (req.session as any).cloudCookies = nextJar; // ...so the cloud cookies go in after
        return sendUpstream();
      }

      if (nextJar !== jar && req.session) (req.session as any).cloudCookies = nextJar;

      // The cloud no longer knows this person (its session expired or it restarted) but the local
      // session is still signed in: sign out locally too, or the app would sit on a screen where
      // every write fails.
      if (status === 401 && typeof req.isAuthenticated === "function" && req.isAuthenticated()) {
        // A session that signed in OFFLINE has no cloud login at all: that is not "the cloud forgot
        // you", so keep the local sign-in and tell the person what is needed.
        if (!jar || Object.keys(jar).length === 0) {
          return res.status(401).json({
            message: "Sign out and sign in again while online to use this",
            code: "CLOUD_SESSION_NEEDED",
          });
        }
        await logout(req);
        return sendUpstream();
      }

      if (ok && req.method !== "GET" && req.method !== "HEAD") {
        await opts.worker.pullNow(1500); // read-your-writes; never rejects
      }
      return sendUpstream();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * A one-off call to the cloud AS the signed-in person (their cloud cookies), used for best-effort
 * side calls such as granting the cloud session a PIN elevation. Never throws; null = unreachable/no cloud login.
 */
export function createCloudCaller(opts: { cloudUrl: string; bypassSecret?: string; fetchImpl?: typeof fetch }) {
  const doFetch = opts.fetchImpl ?? fetch;
  return async (req: Request, method: string, path: string, body: unknown, timeoutMs = 3000): Promise<{ status: number; json: any } | null> => {
    const cookie = cookieHeader((req.session as any)?.cloudCookies);
    if (!cookie) return null;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { cookie, "content-type": "application/json" };
      if (opts.bypassSecret) headers["x-vercel-protection-bypass"] = opts.bypassSecret;
      const res = await doFetch(`${opts.cloudUrl}${path}`, { method, headers, body: JSON.stringify(body ?? {}), redirect: "manual", signal: ac.signal });
      let json: any = null;
      try { json = await res.json(); } catch { /* ignore */ }
      return { status: res.status, json };
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };
}
