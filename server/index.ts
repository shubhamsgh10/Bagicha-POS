import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import MemoryStore from "memorystore";
import * as Sentry from "@sentry/node";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startAutomationScheduler } from "./services/customerAutomationService";
import { startSegmentationScheduler } from "./services/crm/segmentationService";
import { seedDefaultRules } from "./services/crm/automationRuleEngine";
import { startDailyScheduler } from "./services/dailyScheduler";

const MemoryStoreSession = MemoryStore(session);

const app = express();

// Sentry — init before any middleware so it can instrument everything.
// SENTRY_DSN is optional; if absent, Sentry is a no-op.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.2,
  });
  log("Sentry initialised");
}
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || "bagicha-secret-key-2024",
  resave: false,
  saveUninitialized: false,
  store: new MemoryStoreSession({
    checkPeriod: 86400000, // prune expired entries every 24h
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: false,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Sentry v8+ error handler must be registered after routes
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  // Global error handler — Sentry captures before we respond
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (status >= 500 && process.env.SENTRY_DSN) {
      Sentry.captureException(err, { extra: { url: req.url, method: req.method } });
    }
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log(`Port ${port} is already in use. Run: npx kill-port ${port}`);
      process.exit(1);
    }
    throw err;
  });

  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
    // Start the customer automation background scheduler
    startAutomationScheduler();
    // Start CRM segmentation scheduler (every 1h)
    startSegmentationScheduler(1);
    // Seed default automation rules if none exist
    seedDefaultRules().catch(e => console.warn("[CRM] seed rules failed:", e));
    // Start daily scheduler (feedback dispatch, birthday, AI digest)
    startDailyScheduler();
  });
})();
