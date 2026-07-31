import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import helmet from "helmet";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./server/db";
import { registerRoutes } from "./server/routes";
import { applyCors } from "./server/cors";
import { initSettings } from "./server/settingsStore";
import { resolveSessionSecret } from "./server/sessionSecret";

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

applyCors(app);

app.use(express.json({ limit: "10mb" }));
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
  await registerRoutes(app, sessionMiddleware);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  });
})();

export default async function handler(req: any, res: any) {
  await ready;
  app(req, res);
}
