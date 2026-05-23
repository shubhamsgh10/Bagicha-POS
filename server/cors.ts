import type { Express } from "express";

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = [
    "http://localhost:5173",
    "http://localhost:5000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5000",
  ];
  return Array.from(new Set([...defaults, ...fromEnv]));
}

export function applyCors(app: Express): void {
  const allowed = parseAllowedOrigins();

  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (origin && (allowed.includes(origin) || allowed.includes("*"))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    } else if (allowed.includes("*")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });
}
