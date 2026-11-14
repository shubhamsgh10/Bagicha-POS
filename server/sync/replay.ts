// Replay middleware (local-first phase 4): lets the shop PC re-send an action it already ran offline
// "as" the user who did it. SECURITY-SENSITIVE: it makes a device act as a user, so:
//  - Everything hinges on a valid, non-revoked device token (authenticateDevice: sha256 lookup,
//    constant-time re-compare). Without one, X-Bagicha-Replay and every X-Replay-* header are IGNORED
//    completely: the request is an ordinary one (no identity, no elevation, `req.replay` never set).
//  - A device may only replay the actions on the replay list (isReplayable); anything else 403s even
//    with a valid token, so a stolen token cannot read data or run admin routes as a user.
//  - The actor must exist (users / staff_members row by its u: / sm: prefix) or 401. The principal is
//    built from the DB row the way passport.deserializeUser builds it; nothing is taken from the client.
//  - The approver (the manager/admin who typed a PIN on the PC) must exist and have a manager/admin
//    role, else 403. Elevation is per request (`req.replay.approver`, read by server/elevation.ts);
//    no session is created or written and no cookie is set.
//  - The base check (X-Replay-Base) refuses an edit made on top of a cloud order that has moved since.
// Mounted in BOTH server/index.ts and server-fn.ts right after passport.session() (so it overrides
// req.user) and before settingsGuard / the routes. CSRF: replay requests carry no Origin header and
// already pass applyCsrfGuard (which runs earlier); a request WITH a foreign Origin still needs the
// device token, which a browser page does not have.
import type { NextFunction, Request, Response } from "express";
import {
  REPLAY_HEADER, REPLAY_ACTOR_HEADER, REPLAY_APPROVER_HEADER, REPLAY_BASE_HEADER, REPLAY_AT_HEADER,
  replayFlagSet, parsePrincipalRef, parseReplayAt, isReplayable, baseTargetFor, baseMatches,
  normalizeTimestamp, isKeyedReplayRoute, type PrincipalRef,
} from "../../shared/replayRules";
import crypto from "crypto";
import { ROLE_LEVEL, type PinApprover } from "../elevation";
import { bodyHashInput, keyPath, isValidIdempotencyKey, type KeyFingerprint } from "../../shared/requestKeys";
import { authenticateDevice, DeviceAuthUnavailable, type SyncDevice } from "./deviceAuth";

export interface ReplayApprover extends PinApprover { level: number }
export interface ReplayContext {
  deviceId: number;
  /** "u:<id>" / "sm:<id>" of the acting user. */
  actor: string;
  /** The cloud updatedAt the PC's edit was based on (text as sent), or null. */
  base: string | null;
  /** When the action ran on the PC (validated, see parseReplayAt), or null = use "now". */
  at: Date | null;
  approver: ReplayApprover | null;
}

/** "Now" for business-date rules and paid_at stamps: the PC's action time on a replay, else the real clock. */
export function replayNow(req: any): Date {
  const at = req?.replay?.at;
  return at instanceof Date ? at : new Date();
}

export interface ReplayDeps {
  authenticate(authorization: string | undefined): Promise<SyncDevice | null>;
  loadUser(id: number): Promise<any | undefined>;
  loadStaff(id: number): Promise<any | undefined>;
  /** updated_at of an order as microsecond text, or null when it does not exist. */
  orderUpdatedAt(orderId: number): Promise<string | null>;
  orderIdOfTable(tableId: number): Promise<number | null>;
  orderIdOfKot(kotId: number): Promise<number | null>;
  /**
   * Is there a request_keys row for this key whose actor + method + path + body hash equal this
   * request's? Only then is it a true retry of an already-applied request (see the base check below).
   */
  requestKeyMatches(key: string, fp: KeyFingerprint): Promise<boolean>;
  now?(): number;
}

async function loadPrincipal(deps: ReplayDeps, ref: PrincipalRef): Promise<{ principal: any; role: string; name: string } | null> {
  if (ref.kind === "sm") {
    const sm = await deps.loadStaff(ref.id);
    if (!sm) return null;
    // Same shape as passport.deserializeUser (server/routes.ts).
    return {
      principal: { id: sm.id, username: sm.name, role: "staff", designation: sm.designation ?? null, _isStaffMember: true },
      role: "staff",
      name: sm.name,
    };
  }
  const u = await deps.loadUser(ref.id);
  if (!u) return null;
  return { principal: u, role: u.role, name: u.username };
}

export function makeReplayMiddleware(deps: ReplayDeps) {
  return async function replayMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Cheap exit for every ordinary request: the flag header must be exactly "1".
    if (!replayFlagSet(req.headers[REPLAY_HEADER])) return next();
    const url = (req.originalUrl || req.url || "").split("?")[0];
    if (!url.startsWith("/api/")) return next();

    let device: SyncDevice | null;
    try {
      device = await deps.authenticate(req.headers.authorization);
    } catch (err) {
      if (err instanceof DeviceAuthUnavailable) { res.status(503).json({ message: "Sync unavailable" }); return; }
      res.status(503).json({ message: "Sync unavailable" });
      return;
    }
    // No valid token: the replay headers mean nothing. A normal request.
    if (!device) return next();

    if (!isReplayable(req.method, url)) {
      res.status(403).json({ message: "This request cannot be replayed", code: "replay_not_allowed" });
      return;
    }

    const actorRef = parsePrincipalRef(req.headers[REPLAY_ACTOR_HEADER]);
    if (!actorRef) { res.status(401).json({ message: "Replay actor required", code: "replay_actor" }); return; }
    let actor: Awaited<ReturnType<typeof loadPrincipal>>;
    try { actor = await loadPrincipal(deps, actorRef); } catch { res.status(503).json({ message: "Sync unavailable" }); return; }
    if (!actor) { res.status(401).json({ message: "Replay actor not found", code: "replay_actor" }); return; }

    let approver: ReplayApprover | null = null;
    const rawApprover = req.headers[REPLAY_APPROVER_HEADER];
    if (rawApprover !== undefined) {
      const ref = parsePrincipalRef(rawApprover);
      let found: Awaited<ReturnType<typeof loadPrincipal>> = null;
      if (ref) {
        try { found = await loadPrincipal(deps, ref); } catch { res.status(503).json({ message: "Sync unavailable" }); return; }
      }
      const level = found ? (ROLE_LEVEL[found.role] ?? 0) : 0;
      if (!ref || !found || level < (ROLE_LEVEL.manager ?? 1)) {
        res.status(403).json({ message: "Replay approver must be an existing manager or admin", code: "invalid_approver" });
        return;
      }
      approver = { id: `${ref.kind}:${ref.id}`, name: found.name, role: found.role, level };
    }

    const base = typeof req.headers[REPLAY_BASE_HEADER] === "string" ? (req.headers[REPLAY_BASE_HEADER] as string).trim() : null;
    if (base !== null && base !== "" && !normalizeTimestamp(base)) {
      res.status(400).json({ message: "Bad X-Replay-Base", code: "bad_base" });
      return;
    }
    const nowMs = deps.now ? deps.now() : Date.now();
    const at = parseReplayAt(req.headers[REPLAY_AT_HEADER], nowMs);

    const ctx: ReplayContext = { deviceId: device.id, actor: `${actorRef.kind}:${actorRef.id}`, base: base || null, at, approver };
    const r = req as any;
    r.replay = ctx;
    r.user = actor.principal;
    r.isAuthenticated = () => true;

    // Base check: only for edits of an existing order, and not for a retry of a request that already ran.
    if (ctx.base) {
      try {
        const target = baseTargetFor(req.method, url);
        if (target) {
          let orderId: number | null = null;
          if (target.kind === "order") orderId = target.id;
          else if (target.kind === "table") orderId = await deps.orderIdOfTable(target.id);
          else if (target.kind === "kot") orderId = await deps.orderIdOfKot(target.id);
          else orderId = Number.isInteger(Number((req.body as any)?.orderId)) ? Number((req.body as any).orderId) : null;
          if (orderId !== null) {
            // The base check is skipped ONLY for a genuine retry: the route mounts requestKeys (so the key
            // is really enforced) AND the stored key row is for exactly this actor + method + path + body.
            // A key reused on another path/body (or on a route that ignores keys) never skips the check.
            const key = req.headers["idempotency-key"];
            let seen = false;
            if (typeof key === "string" && isValidIdempotencyKey(key) && isKeyedReplayRoute(req.method, url)) {
              seen = await deps.requestKeyMatches(key, {
                actorId: ctx.actor,
                method: req.method,
                path: keyPath(req.originalUrl || req.url || ""),
                bodyHash: crypto.createHash("sha256").update(bodyHashInput(req.body)).digest("hex"),
              });
            }
            if (!seen) {
              const current = await deps.orderUpdatedAt(orderId);
              if (current !== null && !baseMatches(current, ctx.base)) {
                res.status(409).json({
                  error: "This order was changed in the cloud after the edit was made on the shop PC.",
                  code: "conflict",
                });
                return;
              }
            }
          }
        }
      } catch (err) {
        console.error("[replay] base check failed:", err);
        res.status(503).json({ message: "Sync unavailable" });
        return;
      }
    }
    next();
  };
}

/** Production wiring (cloud only: pg pool + storage). Loaded lazily by the entries via replayMiddleware. */
let singleton: ReturnType<typeof makeReplayMiddleware> | null = null;
export async function replayMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Ordinary requests never touch the DB or even load the wiring below.
  if (!replayFlagSet(req.headers[REPLAY_HEADER])) return next();
  if (!singleton) {
    const { pool } = await import("../db");
    const { storage } = await import("../storage");
    const q = async (sql: string, params: unknown[]) => {
      if (!pool) throw new Error("no pool");
      return (await pool.query(sql, params)).rows;
    };
    singleton = makeReplayMiddleware({
      authenticate: authenticateDevice,
      loadUser: (id) => storage.getUser(id),
      loadStaff: (id) => storage.getStaffMember(id),
      orderUpdatedAt: async (id) => (await q(`SELECT to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS u FROM orders WHERE id = $1`, [id]))[0]?.u ?? null,
      orderIdOfTable: async (id) => (await q(`SELECT current_order_id AS o FROM tables WHERE id = $1`, [id]))[0]?.o ?? null,
      orderIdOfKot: async (id) => (await q(`SELECT order_id AS o FROM kot_tickets WHERE id = $1`, [id]))[0]?.o ?? null,
      requestKeyMatches: async (key, fp) => {
        try {
          return (await q(
            `SELECT 1 FROM request_keys WHERE key = $1 AND actor_id = $2 AND method = $3 AND path = $4 AND body_hash = $5`,
            [key, fp.actorId, fp.method, fp.path, fp.bodyHash],
          )).length > 0;
        } catch { return false; }
      },
    });
  }
  return singleton(req, res, next);
}
