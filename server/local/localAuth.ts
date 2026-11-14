// Sign-in and PIN checks on the shop PC. They verify against local_auth (scrypt "salt:hash" blobs the
// cloud sends in users / staff_members `_auth`), never plaintext, using the SAME routine and the SAME
// rules as server/routes.ts (card eligibility, admin never a card, inactive/hidden staff refused,
// ROLE_LEVEL for PIN acceptance) and the SAME rate limits. The principal shapes are exactly the ones
// passport.deserializeUser builds. Online, sign-in still goes through the cloud first (cloud decides,
// stale local data can never let a removed user in); the local check only runs when the cloud is
// unreachable or the PC already knows it is offline.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import type { PGlite } from "@electric-sql/pglite";
import { verifyPassword } from "../passwordHash";
import { ROLE_LEVEL, grantElevation } from "../elevation";
import { sanitizeUser } from "../selfScope";

export interface LocalAuthDeps {
  client: PGlite;
  storage: {
    getUser(id: number): Promise<any | undefined>;
    getUsers(): Promise<any[]>;
    getUserByUsername(name: string): Promise<any | undefined>;
    getStaffMember(id: number): Promise<any | undefined>;
  };
  isOnline(): boolean;
  /** Best-effort call to the cloud as this person (their cloud cookies). */
  cloudCall(req: Request, method: string, path: string, body: unknown): Promise<unknown>;
  /** The cloud-first handler for a path (the proxy), given the offline fallback. */
  viaCloud: RequestHandler;
}

async function authBlob(client: PGlite, kind: "user" | "staff", id: number): Promise<{ pw: string | null; pin: string | null }> {
  const r = await client.query<{ pw: string | null; pin: string | null }>(`SELECT pw, pin FROM local_auth WHERE kind = $1 AND id = $2`, [kind, id]);
  return r.rows[0] ?? { pw: null, pin: null };
}

function logIn(req: Request, principal: any): Promise<void> {
  return new Promise((resolve, reject) => (req as any).logIn(principal, (err: any) => (err ? reject(err) : resolve())));
}

const onlineOnly2fa = { message: "Two-factor sign-in needs internet", error: "Needs internet", code: "ONLINE_ONLY" };

export function createLocalAuth(deps: LocalAuthDeps) {
  const { client, storage } = deps;

  // Same numbers as routes.ts' limiters.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { message: "Too many login attempts. Try again in 15 minutes." },
  });
  const staffPinLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { message: "Too many PIN attempts. Try again in 5 minutes." },
  });
  const pinLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, max: 5, skipSuccessfulRequests: true,
    requestWasSuccessful: (_req: any, res: any) => res.locals?.pinOk === true,
    keyGenerator: (req: any) => (req.sessionID ? `s:${req.sessionID}` : `ip:${req.ip}`),
    validate: { keyGeneratorIpFallback: false },
    standardHeaders: true, legacyHeaders: false,
    message: { valid: false, message: "Too many PIN attempts. Try again in 5 minutes." },
  });

  // ── local checks ──
  const localLogin: RequestHandler = async (req, res, next) => {
    try {
      const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
      if (typeof username !== "string" || typeof password !== "string") return res.status(401).json({ message: "Invalid credentials" });
      const user = await storage.getUserByUsername(username);
      const blob = user ? await authBlob(client, "user", user.id) : { pw: null, pin: null };
      const ok = !!user && !!blob.pw && (await verifyPassword(password, blob.pw));
      if (!ok) return res.status(401).json({ message: "Invalid username or password" });
      if ((user as any).totpEnabled) return res.status(503).json(onlineOnly2fa);
      await logIn(req, user);
      res.json(sanitizeUser(user as any));
    } catch (e) { next(e); }
  };

  const localCardLogin: RequestHandler = async (req, res, next) => {
    try {
      const { kind, id, pin } = (req.body ?? {}) as { kind?: string; id?: number; pin?: string };
      if (!id || !pin) return res.status(400).json({ message: "id and pin required" });
      if (kind === "user") {
        const user = await storage.getUser(Number(id));
        if (!user || !user.showOnMobile || user.role === "admin") return res.status(401).json({ message: "Card login not available" });
        const b = await authBlob(client, "user", user.id);
        if (!b.pin) return res.status(401).json({ message: "No PIN set for this account" });
        if (!(await verifyPassword(String(pin), b.pin))) return res.status(401).json({ message: "Wrong PIN" });
        await logIn(req, user);
        return res.json(sanitizeUser(user as any));
      }
      const sm = await storage.getStaffMember(Number(id));
      if (!sm || !sm.isActive || !sm.showOnMobile) return res.status(401).json({ message: "Card login not available" });
      const b = await authBlob(client, "staff", sm.id);
      if (!b.pin) return res.status(401).json({ message: "No PIN set for this staff member" });
      if (!(await verifyPassword(String(pin), b.pin))) return res.status(401).json({ message: "Wrong PIN" });
      await logIn(req, { id: sm.id, username: sm.name, role: "staff", designation: sm.designation ?? null, _isStaffMember: true });
      res.json({ id: sm.id, username: sm.name, role: "staff" });
    } catch (e) { next(e); }
  };

  const localStaffPinLogin: RequestHandler = async (req, res, next) => {
    try {
      const { staffId, pin } = (req.body ?? {}) as { staffId?: number; pin?: string };
      if (!staffId || !pin) return res.status(400).json({ message: "staffId and pin required" });
      const sm = await storage.getStaffMember(Number(staffId));
      if (!sm || !sm.isActive || !sm.showOnMobile) return res.status(401).json({ message: "Staff member not found" });
      const b = await authBlob(client, "staff", sm.id);
      if (!b.pin) return res.status(401).json({ message: "No PIN set. Ask manager to set one in Settings → Staff Selector." });
      if (!(await verifyPassword(String(pin), b.pin))) return res.status(401).json({ message: "Wrong PIN" });
      await logIn(req, { id: sm.id, username: sm.name, role: "staff", _isStaffMember: true });
      res.json({ id: sm.id, username: sm.name, role: "staff" });
    } catch (e) { next(e); }
  };

  /**
   * POST /api/auth/verify-pin, always answered HERE (the local routes' elevation checks read the local
   * session). Same rule as the cloud: any user whose role level is at least the required one and whose
   * PIN matches. The grant records WHO typed the PIN; replay carries it as X-Replay-Approver.
   */
  const localVerifyPin: RequestHandler = async (req, res) => {
    try {
      const { pin, requiredRole } = (req.body ?? {}) as { pin?: unknown; requiredRole?: string };
      if (!pin) return res.status(400).json({ valid: false });
      const targetLevel = ROLE_LEVEL[requiredRole as string] ?? 1;
      let match: any = null;
      for (const u of await storage.getUsers()) {
        if ((ROLE_LEVEL[u.role] ?? 0) < targetLevel) continue;
        const b = await authBlob(client, "user", u.id);
        if (b.pin && (await verifyPassword(String(pin), b.pin))) { match = u; break; }
      }
      if (match) {
        grantElevation(req, ROLE_LEVEL[match.role] ?? targetLevel, Date.now(), { id: `u:${match.id}`, name: match.username, role: match.role });
        // Online-only routes (merge, coupons…) are checked by the cloud against ITS session: give it the same grant.
        if (deps.isOnline()) await deps.cloudCall(req, "POST", "/api/auth/verify-pin", { pin, requiredRole });
      }
      res.locals.pinOk = !!match;
      res.json({ valid: !!match });
    } catch (e) {
      console.error("[local-auth] verify-pin failed:", e);
      res.status(500).json({ valid: false });
    }
  };

  /** Cloud first while online (the cloud decides; its cookies are kept for proxied calls); local when it cannot be reached. */
  const cloudThen = (local: RequestHandler): RequestHandler => (req: Request, res: Response, next: NextFunction) => {
    if (!deps.isOnline()) return local(req, res, next);
    (req as any).localFallback = local;
    return deps.viaCloud(req, res, next);
  };

  return {
    login: [loginLimiter, cloudThen(localLogin)] as RequestHandler[],
    cardLogin: [staffPinLimiter, cloudThen(localCardLogin)] as RequestHandler[],
    staffPinLogin: [staffPinLimiter, cloudThen(localStaffPinLogin)] as RequestHandler[],
    /** Mounted after requireAuth + requestKeys by the gate. */
    verifyPin: [pinLimiter, localVerifyPin] as RequestHandler[],
  };
}
