import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import MemoryStore from "memorystore";
import { registerRoutes } from "./server/routes";

const MemoryStoreSession = MemoryStore(session);
const app = express();

// Trust Vercel's reverse proxy so secure cookies work correctly
app.set("trust proxy", 1);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "bagicha-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    store: new MemoryStoreSession({ checkPeriod: 86400000 }),
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Register all API routes
const ready = (async () => {
  await registerRoutes(app);

  // Global error handler
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
