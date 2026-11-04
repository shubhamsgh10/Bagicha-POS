import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import helmet from "helmet";
import connectPgSimple from "connect-pg-simple";
import * as Sentry from "@sentry/node";
import { pool } from "./server/db";
import { registerRoutes } from "./server/routes";
import { applyCors } from "./server/cors";
import { applyCsrfGuard } from "./server/csrf";
import { initSettings, settingsGuard } from "./server/settingsStore";
import { resolveSessionSecret } from "./server/sessionSecret";
import { serverTiming } from "./server/serverTiming";
import { registerKeepAlivePing } from "./server/keepAlivePing";

// Log-and-survive guards, same as server/index.ts — a warm serverless instance is
// still a live Node process between invocations, so an unhandled rejection here was
// previously just as invisible as it was in the persistent-process entry before that
// one got these.
process.on("unhandledRejection", (reason: any) => {
  console.error("[unhandledRejection]", reason);
  if (process.env.SENTRY_DSN) Sentry.captureException(reason);
});
process.on("uncaughtException", (err: any) => {
  console.error("[uncaughtException]", err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
});

const PgSession = connectPgSimple(session);
const app = express();

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));

// See server/index.ts for why: API GETs carry no explicit Cache-Control
// (Express only sets ETag) and Electron's session persists its disk HTTP
// cache across app restarts, which can silently serve a stale JSON body for
// a resource just written elsewhere in the same session.
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", serverTiming);

applyCors(app);
// Before any body parsing or session work: a forged cross-site write is refused for free. This entry
// matters most — its cookie is SameSite=None (see server/csrf.ts).
applyCsrfGuard(app);
// Before the session middleware: the keep-warm ping must cost no DB round trip (see the file).
registerKeepAlivePing(app);

// Sentry — init before any middleware so it can instrument everything. SENTRY_DSN is
// optional; absent means Sentry stays a no-op, same as server/index.ts.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.2,
  });
}

app.use(express.json({
  limit: "10mb",
  // Webhook signatures (Meta X-Hub-Signature-256) must be verified against the exact
  // bytes received — re-serializing req.body does not round-trip. This was missing
  // here (present only in server/index.ts), so whatsappRoutes.ts's POST
  // /api/whatsapp/webhook handler's `if (!rawBody) return res.sendStatus(401)` fired
  // unconditionally for every Meta webhook request on Vercel — the HMAC check was
  // never even reached. See CLAUDE.md's Deployment modes section.
  verify: (req, _res, buf) => {
    if (req.url?.startsWith("/api/whatsapp/webhook")) {
      (req as any).rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: false }));

const isProduction = process.env.NODE_ENV === "production";
const crossOriginClients =
  !!process.env.VERCEL || !!process.env.ALLOWED_ORIGINS?.trim();

const sessionMiddleware = session({
  secret: resolveSessionSecret(),
  resave: false,
  saveUninitialized: false,
  store: new PgSession({
    pool,
    tableName: "sessions",
    createTableIfMissing: true,
    // No `UPDATE sessions SET expire = …` on every request. With rolling:false (the default) the
    // browser cookie is only re-issued when the session is modified — and a modification already
    // saves the row with the new expiry — so touching an unmodified session only extended a
    // server-side expiry that the cookie itself never outlives. It was one write per API call.
    disableTouch: true,
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProduction,
    sameSite: crossOriginClients && isProduction ? "none" : "lax",
  },
});
app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

const ready = (async () => {
  await initSettings();
  // Refuse (503) rather than serve from built-in defaults if this instance never managed to
  // read the real settings — a cold instance on defaults priced orders at 18% and found "no
  // printer". Must precede every route. See server/settingsCache.ts.
  app.use("/api", settingsGuard);
  await registerRoutes(app, sessionMiddleware);

  // Sentry v8+ error handler must be registered after routes (same as server/index.ts).
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  // Global error handler — always logged (previously this entry neither logged nor
  // reported to Sentry, so a 500 here was invisible everywhere, unlike server/index.ts).
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`[error] ${req.method} ${req.url} -> ${status}:`, err.stack || err);
    if (status >= 500 && process.env.SENTRY_DSN) {
      Sentry.captureException(err, { extra: { url: req.url, method: req.method } });
    }
    res.status(status).json({ message });
  });
})();

export default async function handler(req: any, res: any) {
  // A request that arrived while this instance was still initialising (settings + routes) is
  // reported with Server-Timing cold;dur = how long IT waited for that (server/serverTiming.ts),
  // so a cold start shows up in the slow-request diagnostics. A request reaching an
  // already-initialised instance gets none. It used to report the process uptime when init
  // finished — which includes the time a pre-warmed instance sat frozen before its first request:
  // production showed cold;dur=40453 on requests that took 480 ms end to end, so
  // classifySlowRequest blamed "cold start" for time that never happened.
  const t0 = Date.now();
  await ready;
  const waited = Date.now() - t0;
  if (waited >= 5) req.coldMs = waited;
  app(req, res);
}
