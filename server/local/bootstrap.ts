// Wires local mode into server/index.ts. Imported lazily (await import) and only when
// BAGICHA_LOCAL_MODE=1, so the cloud bundle's behaviour is untouched.
//
// Phase 4 (offline writes): reads come from PGlite, the replay-list writes run locally through the
// normal routes and are queued in the outbox, sign-in / PIN checks use the synced verifiers, number
// leases supply ids / bill / KOT numbers, and a background replayer re-sends the outbox to the cloud.
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { readLocalModeConfig, type LocalModeConfig } from "./localMode";
import { ensureLocalSchema } from "./localSchema";
import { createSyncWorker, type SyncWorker } from "./syncWorker";
import { createCloudProxy, createCloudCaller } from "./cloudProxy";
import { classifyWrite, isCloudFirstGet, isCloudOnlyGet, isLocalOnly } from "./localReadGate";
import { getCursor } from "./applyChanges";
import { createLeaseManager, type LeaseManager } from "./localNumbers";
import { createReplayer, type Replayer } from "./replayWorker";
import { createOutboxCapture } from "./outboxCapture";
import { createLocalAuth } from "./localAuth";
import { listProblems, retryProblem, discardProblem, getProblem, recordLocalAudit } from "./outbox";

export interface LocalRuntime {
  cfg: LocalModeConfig;
  worker: SyncWorker;
  leases: LeaseManager;
  replayer: Replayer;
  schemaBlocked: boolean;
}

const ONLINE_ONLY_BODY = { message: "Needs internet", error: "Needs internet", code: "ONLINE_ONLY" };

export async function bootLocalMode(): Promise<LocalRuntime> {
  const cfg = readLocalModeConfig();
  // The shared production DB must be unreachable from a shop-PC process: no pg Pool may exist.
  delete process.env.DATABASE_URL;
  const { pool, localClient } = await import("../db");
  if (pool !== null) throw new Error("local mode must never open a cloud database pool");
  if (!localClient) throw new Error("local mode needs BAGICHA_DB=pglite");

  const schema = await ensureLocalSchema(localClient);
  if (schema.recreated) console.log("[local] local database schema (re)built");
  if (schema.blocked) console.error("[local] SCHEMA BLOCKED: unsynced actions are waiting; serving the existing local database as is.");

  const settings = await import("../settingsStore");
  const storageMod = await import("../storage");
  const { forgetAllPrincipals } = await import("../principalCache");
  const { forgetTableSections } = await import("../tableSections");
  const { publishRealtime } = await import("../realtime/publisher");
  let settingsReady = false;

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${cfg.deviceToken}`,
    "Content-Type": "application/json",
    ...(cfg.cloudBypass ? { "x-vercel-protection-bypass": cfg.cloudBypass } : {}),
  });

  // Number leases: bill / KOT numbers and order ids come from blocks the cloud promised this PC.
  let workerRef: SyncWorker | null = null;
  const leases = createLeaseManager({
    client: localClient,
    isOnline: () => workerRef?.status().online ?? false,
    onCounter: (field, value) => settings.noteCounterAdvanced(field, value),
    requestLease: async (kind) => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10_000);
      try {
        const res = await fetch(`${cfg.cloudUrl}/api/sync/lease`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ kind }), signal: ac.signal });
        if (!res.ok) throw new Error(`cloud answered ${res.status}`);
        return (await res.json()) as { start: number; end: number };
      } finally {
        clearTimeout(t);
      }
    },
  });
  await leases.init();
  settings.setLocalCounterIssuer((field) => leases.take(field === "billCounter" ? "bill_counter" : "kot_counter"));
  storageMod.setLocalOrderIdIssuer(() => leases.take("order_id"));

  const replayer = createReplayer({
    client: localClient,
    cloudUrl: cfg.cloudUrl,
    deviceToken: cfg.deviceToken,
    bypassSecret: cfg.cloudBypass,
    onOrderRefreshed: () => { void publishRealtime({ type: "ORDER_UPDATE" }); void publishRealtime({ type: "TABLE_UPDATE" }); },
  });

  const worker = createSyncWorker({
    client: localClient,
    cloudUrl: cfg.cloudUrl,
    deviceToken: cfg.deviceToken,
    bypassSecret: cfg.cloudBypass,
    beforePull: () => replayer.drain(),
    afterCycle: () => leases.refillIfLow(),
    schemaBlocked: () => !!schema.blocked,
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
  workerRef = worker;

  const hadSnapshot = (await getCursor(localClient)) !== null;
  if (hadSnapshot) {
    // Already have a copy: serve it at once, catch up (and replay anything waiting) in the background.
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
  return { cfg, worker, leases, replayer, schemaBlocked: !!schema.blocked };
}

/** Mounts the local gate (+ /api/local/*) on /api. Call after session + passport, before settingsGuard and the routes. */
export async function installLocalGate(app: Express, rt: LocalRuntime, requireAuth: RequestHandler): Promise<void> {
  const { db, localClient } = await import("../db");
  const client = localClient!;
  const { storage } = await import("../storage");
  const { requireManagerOrAdmin } = await import("../routes");
  const { requireFreshPin, freshPinApprover } = await import("../elevation");
  const { requestKeys } = await import("../requestKeys");
  const { sql } = await import("drizzle-orm");

  const online = () => rt.worker.status().online;

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
  const cloudCall = createCloudCaller({ cloudUrl: rt.cfg.cloudUrl, bypassSecret: rt.cfg.cloudBypass });
  const auth = createLocalAuth({ client, storage: storage as any, isOnline: online, cloudCall, viaCloud: proxy });
  const capture = createOutboxCapture({ client, wake: () => rt.worker.requestPull() });

  // ── the local server's own endpoints ──
  app.get("/api/local/status", async (_req, res) => {
    // nonce: the desktop supervisor only trusts a server that echoes its per-launch secret.
    res.json({ localMode: true, nonce: process.env.BAGICHA_LOCAL_NONCE, ...(await rt.worker.fullStatus()) });
  });
  app.post("/api/local/sync-now", requireAuth, async (_req, res) => {
    await rt.worker.pullNow(1500);
    res.status(204).end();
  });
  app.get("/api/local/problems", requireAuth, async (_req, res) => {
    res.json(await listProblems(client));
  });
  // Retry and Discard are decisions about money: manager/admin AND a PIN typed just now. A retry
  // re-sends the entry with its ORIGINAL replay base, so an old edit can never slip past the cloud's
  // version check. A conflict (the cloud moved on) only goes again as an explicit override
  // ({override:true}): it takes the order's CURRENT cloud version as its base (so a further change in
  // between still refuses it), is written to this PC's local_audit, and replays with X-Replay-Override
  // so the cloud's audit row carries overrideOf.
  app.post("/api/local/problems/:seq/retry", requireAuth, requireManagerOrAdmin, requireFreshPin("manager"), async (req, res) => {
    const seq = Number(req.params.seq);
    const row = await getProblem(client, seq);
    if (!row) return res.status(404).json({ message: "Nothing to retry" });
    const actor = (req.user as any)?._isStaffMember ? `sm:${(req.user as any).id}` : `u:${(req.user as any)?.id}`;
    const approver = freshPinApprover(req)?.id ?? null;
    let override: { freshBase: string } | undefined;
    if (row.lastCode === "conflict") {
      if (req.body?.override !== true) {
        return res.status(409).json({
          message: `The cloud has a newer version of order #${row.orderId}. Retrying replaces the cloud's changes with this action - confirm the override to continue.`,
          code: "override_required",
        });
      }
      if (row.orderId === null || !online()) return res.status(503).json(ONLINE_ONLY_BODY);
      let freshBase: string | null;
      try { freshBase = await rt.replayer.currentCloudBase(row.orderId); } catch { return res.status(503).json(ONLINE_ONLY_BODY); }
      if (!freshBase) return res.status(409).json({ message: `Order #${row.orderId} no longer exists in the cloud`, code: "gone" });
      override = { freshBase };
    }
    const n = await retryProblem(client, seq, override);
    if (override) await recordLocalAudit(client, { actor, approver, action: "sync.conflict_override", seq, orderId: row.orderId, detail: { path: row.path, method: row.method, base: override.freshBase } });
    else await recordLocalAudit(client, { actor, approver, action: "sync.retry", seq, orderId: row.orderId, detail: { path: row.path, method: row.method } });
    rt.worker.requestPull();
    res.json({ requeued: n, override: !!override });
  });
  // Giving up on a refused action is a money decision: manager/admin AND a PIN typed just now.
  app.post("/api/local/problems/:seq/discard", requireAuth, requireManagerOrAdmin, requireFreshPin("manager"), async (req, res) => {
    const seq = Number(req.params.seq);
    const row = (await listProblems(client)).find((p) => p.seq === seq);
    const n = await discardProblem(client, seq);
    if (!n) return res.status(404).json({ message: "Nothing to discard" });
    await recordLocalAudit(client, {
      actor: (req.user as any)?._isStaffMember ? `sm:${(req.user as any).id}` : `u:${(req.user as any)?.id}`,
      approver: freshPinApprover(req)?.id ?? null, action: "sync.discard", seq, orderId: row?.orderId ?? null,
      detail: { path: row?.path, method: row?.method, error: row?.lastError },
    });
    if (row?.orderId != null && online()) await rt.replayer.refreshOrder(row.orderId, true).catch(() => {});
    res.json({ discarded: n });
  });

  app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = req.originalUrl.split("?")[0];
      if (req.method === "OPTIONS" || isLocalOnly(path)) return next();

      // ── reads ──
      if (req.method === "GET" || req.method === "HEAD") {
        if (isCloudFirstGet(path)) return online() ? proxy(req, res, next) : next();
        if (isCloudOnlyGet(path)) return online() ? proxy(req, res, next) : res.status(503).json(ONLINE_ONLY_BODY);
        if (!rt.worker.status().hasSnapshot) {
          if (path === "/api/auth/me") return res.json(null); // nobody can be signed in on an empty copy
          return res.status(503).json({
            message: "This shop PC is still downloading its first copy of the data — try again in a moment",
            code: "LOCAL_NOT_SYNCED",
          });
        }
        // A single order missing locally (created moments ago on a phone): the cloud has it, if reachable.
        const m = /^\/api\/orders\/(\d+)$/.exec(path);
        if (m && online()) {
          const r: any = await db.execute(sql`SELECT 1 AS x FROM orders WHERE id = ${Number(m[1])} LIMIT 1`);
          if (!(r.rows ?? r).length) return proxy(req, res, next);
        }
        return next();
      }

      // ── writes ──
      switch (classifyWrite(req.method, path)) {
        case "login": {
          const handlers = path === "/api/auth/login" ? auth.login : path === "/api/auth/card-login" ? auth.cardLogin : auth.staffPinLogin;
          return runChain(handlers, req, res, next);
        }
        case "verify-pin":
          // Same order as the cloud route: auth, one-time key, limiter, handler.
          return runChain([requireAuth, requestKeys as RequestHandler, ...auth.verifyPin], req, res, next);
        case "logout":
          return proxy(req, res, next);
        case "replay":
          if (!rt.worker.status().hasSnapshot) {
            return res.status(503).json({ message: "This shop PC is still downloading its first copy of the data", code: "LOCAL_NOT_SYNCED" });
          }
          return capture(req, res, next);
        case "local":
          return next();
        case "quiet":
          return online() ? proxy(req, res, next) : res.status(204).end();
        default:
          return online() ? proxy(req, res, next) : res.status(503).json(ONLINE_ONLY_BODY);
      }
    } catch (err) {
      next(err);
    }
  });
}

/** Runs express handlers in order; the last one answers (a handler calling next() moves on, an error aborts). */
function runChain(handlers: RequestHandler[], req: Request, res: Response, done: NextFunction): void {
  let i = 0;
  const step = (err?: unknown) => {
    if (err) return done(err);
    const h = handlers[i++];
    if (!h) return done();
    try { Promise.resolve(h(req, res, step)).catch(step); } catch (e) { step(e); }
  };
  step();
}
