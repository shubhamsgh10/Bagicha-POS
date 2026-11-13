// Wires local mode into server/index.ts. Imported lazily (await import) and only when
// BAGICHA_LOCAL_MODE=1, so the cloud bundle's behaviour is untouched.
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { readLocalModeConfig, type LocalModeConfig } from "./localMode";
import { ensureLocalSchema } from "./localSchema";
import { createSyncWorker, type SyncWorker } from "./syncWorker";
import { createCloudProxy } from "./cloudProxy";
import { isLocalOnly, isLocalRead } from "./localReadGate";
import { getCursor } from "./applyChanges";

export interface LocalRuntime {
  cfg: LocalModeConfig;
  worker: SyncWorker;
}

export async function bootLocalMode(): Promise<LocalRuntime> {
  const cfg = readLocalModeConfig();
  // The shared production DB must be unreachable from a shop-PC process: no pg Pool may exist.
  delete process.env.DATABASE_URL;
  const { pool, localClient } = await import("../db");
  if (pool !== null) throw new Error("local mode must never open a cloud database pool");
  if (!localClient) throw new Error("local mode needs BAGICHA_DB=pglite");

  const { recreated } = await ensureLocalSchema(localClient);
  if (recreated) console.log("[local] local database schema (re)built");

  const settings = await import("../settingsStore");
  const { forgetAllPrincipals } = await import("../principalCache");
  const { forgetTableSections } = await import("../tableSections");
  let settingsReady = false;

  const worker = createSyncWorker({
    client: localClient,
    cloudUrl: cfg.cloudUrl,
    deviceToken: cfg.deviceToken,
    bypassSecret: cfg.cloudBypass,
    onApplied: async (tables) => {
      if (tables.includes("users") || tables.includes("staff_members")) forgetAllPrincipals();
      if (tables.includes("tables")) forgetTableSections();
      if (!settingsReady) {
        await settings.initSettings();
        settingsReady = true;
      } else if (tables.includes("restaurant_settings")) {
        await settings.getSettingsFresh().catch(() => {});
      }
    },
  });

  const hadSnapshot = (await getCursor(localClient)) !== null;
  if (hadSnapshot) {
    // Already have a copy: serve it at once, catch up in the background.
    await settings.initSettings();
    settingsReady = true;
    void worker.start();
  } else {
    console.log("[local] no local copy yet — downloading the first snapshot from the cloud…");
    await worker.start(); // bounded by the worker's own timeouts
    if (!worker.status().hasSnapshot) {
      console.warn(`[local] first snapshot failed (${worker.status().lastError}); retrying in the background. Local reads answer 503 until it lands.`);
    }
  }
  return { cfg, worker };
}

/** Mounts the local gate (+ /api/local/*) on /api. Call after session + passport, before settingsGuard and the routes. */
export async function installLocalGate(app: Express, rt: LocalRuntime, requireAuth: RequestHandler): Promise<void> {
  const { db } = await import("../db");
  const { storage } = await import("../storage");
  const { sql } = await import("drizzle-orm");

  const proxy = createCloudProxy({
    cloudUrl: rt.cfg.cloudUrl,
    bypassSecret: rt.cfg.cloudBypass,
    worker: rt.worker,
    loadPrincipal: async (kind, id) => {
      if (kind === "user") return (await storage.getUser(id)) ?? null;
      const sm = await storage.getStaffMember(id);
      return sm
        ? { id: sm.id, username: sm.name, role: "staff", designation: sm.designation ?? null, _isStaffMember: true }
        : null;
    },
  });

  app.get("/api/local/status", (_req, res) => {
    // nonce: the desktop supervisor only trusts a server that echoes its per-launch secret.
    res.json({ localMode: true, nonce: process.env.BAGICHA_LOCAL_NONCE, ...rt.worker.status() });
  });
  app.post("/api/local/sync-now", requireAuth, async (_req, res) => {
    await rt.worker.pullNow(1500);
    res.status(204).end();
  });

  app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = req.originalUrl.split("?")[0];
      if (req.method === "OPTIONS" || isLocalOnly(path)) return next();
      if (isLocalRead(req.method, path, req.query as Record<string, unknown>, rt.worker.coverageStart())) {
        if (!rt.worker.status().hasSnapshot) {
          if (path === "/api/auth/me") return res.json(null); // nobody can be signed in on an empty copy
          return res.status(503).json({
            message: "This shop PC is still downloading its first copy of the data — try again in a moment",
            code: "LOCAL_NOT_SYNCED",
          });
        }
        // A single order that is not in the local copy (older than the snapshot window) lives in the cloud.
        const m = /^\/api\/orders\/(\d+)$/.exec(path);
        if (m) {
          const r: any = await db.execute(sql`SELECT 1 AS x FROM orders WHERE id = ${Number(m[1])} LIMIT 1`);
          const rows = r.rows ?? r;
          if (!rows.length) return proxy(req, res, next);
        }
        return next();
      }
      return proxy(req, res, next);
    } catch (err) {
      next(err);
    }
  });
}
