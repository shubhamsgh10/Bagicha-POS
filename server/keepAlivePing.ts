import type { Express } from "express";

/**
 * GET /api/ping — the client's connection keep-warm request (client/src/lib/connectionKeepAlive.ts),
 * sent every ~15 s by every open, signed-in screen so the device's HTTP/2 connection to the API never
 * sits idle long enough to die silently (see shared/connectionKeepAlive.ts for the evidence).
 *
 * Registered in both entries BEFORE the session middleware, on purpose: at that rate it must not read
 * the session store, the user or the settings — no database round trip at all. It does sit after
 * applyCors, because the Electron thin client calls it cross-origin with credentials.
 */
export function registerKeepAlivePing(app: Express): void {
  app.get("/api/ping", (_req, res) => {
    res.status(204).end();
  });
}
