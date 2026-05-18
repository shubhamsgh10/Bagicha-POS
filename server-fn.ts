import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import MemoryStore from "memorystore";
import { registerRoutes } from "./server/routes";
import path from "path";
import { fileURLToPath } from "url";

const MemoryStoreSession = MemoryStore(session);
const app = express();

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
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Serve built static files from dist/public
const __dirnameHere = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirnameHere, "..", "dist", "public");
app.use(express.static(staticDir));

// Register all API routes, then add SPA fallback
const ready = (async () => {
  await registerRoutes(app);

  // SPA fallback — serve index.html for any non-API route
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl.startsWith("/api")) return next();
    res.sendFile(path.resolve(staticDir, "index.html"));
  });

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
