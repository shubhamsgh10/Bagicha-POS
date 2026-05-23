import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./server/db";
import { registerRoutes } from "./server/routes";
import { applyCors } from "./server/cors";
import { initSettings } from "./server/settingsStore";

const PgSession = connectPgSimple(session);
const app = express();

app.set("trust proxy", 1);

applyCors(app);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

const isProduction = process.env.NODE_ENV === "production";
const crossOriginClients =
  !!process.env.VERCEL || !!process.env.ALLOWED_ORIGINS?.trim();

app.use(
  session({
    secret: process.env.SESSION_SECRET || "bagicha-secret-key-2024",
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
  }),
);

app.use(passport.initialize());
app.use(passport.session());

const ready = (async () => {
  await initSettings();
  await registerRoutes(app);

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
