import type { Express } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { WebSocketServer, WebSocket } from "ws";
import { storage, OrderNotEditableError } from "./storage";
import { z } from "zod";
import { insertOrderItemSchema, insertKotTicketSchema, insertCategorySchema, insertInventorySchema, insertInventoryCategorySchema } from "@shared/schema";
import { orderUpdateAllowlist, ORDER_CREATE_FORCED_DEFAULTS, planStatusChange } from "@shared/orderMutation";
import { mergeBlock } from "@shared/orderStatusChange";
import { weekStringOf } from "@shared/weekMath";
import { personPageKey, resolveStaffAllowedPages } from "@shared/pageAccess";
import { businessDayRange, todayBusinessDate, businessDateOf, shiftBusinessDate, istCalendarDate } from "@shared/businessDay";
import { resolveSettlement, SETTLE_TOLERANCE, type SettlementMode } from "@shared/settlement";
import { summarizeCollected, collectedBusinessDate } from "@shared/paymentSplit";
import { planPaymentEdit } from "@shared/paymentEdit";
import { planDueSettlement } from "@shared/dueSettlement";
import { diffOrderLines, type AuditLine } from "@shared/orderAudit";
import { computeDelta, type SnapshotItem } from "@shared/kotDelta";
import { findMissingKotCancelReasons, type CancelledKotItemInput } from "@shared/kotItemCancel";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import crypto from "crypto";
import { getSettings, getLiveSettings, getSettingsFresh, saveSettings, incrementBillCounter, incrementKotCounter } from "./settingsStore";
import { timingSafeEqual } from "crypto";
import { getLogBuffer } from "./logBuffer";
import {
  getAutomationConfig,
  saveAutomationConfig,
  loadLogs,
  clearLogs,
  getAutomationStats,
  setCustomerPref,
  loadCustomerPrefs,
} from "./services/automationStore";
import {
  runCustomerAutomation,
  restartScheduler,
} from "./services/customerAutomationService";

// ── CRM Services (Phase 2–9 additions) ────────────────────────────────────────
import {
  resolveCustomerId,
  getCustomerMaster,
  getCustomerProfile,
  upsertCustomerProfile,
  syncLocalStorageExtras,
  dbProfileToExtra,
  backfillOrderPhone,
} from "./services/crm/customerIdService";
import {
  getCustomerEvents,
  logOrderPlaced,
} from "./services/crm/eventService";
import {
  runSegmentationForCustomer,
  runSegmentationForAll,
  getCustomerSegment,
} from "./services/crm/segmentationService";
import { getRecommendations } from "./services/crm/recommendationService";
import { sendMessage, getCustomerMessages } from "./services/crm/messagingService";
import { runAutomationServerSide, triggerSettlementMessage, triggerDueBillMessage, sendConsolidatedEbill } from "./services/crm/automationRuleEngine";
import { db } from "./db";
import { registerPrintRoutes } from "./printRoutes";
import { requestKeys } from "./requestKeys";
import { tableSectionFor, forgetTableSections } from "./tableSections";
import { runPrintStep, runKotPrint, instrumentJson, savedOrderSnapshot, markTableBilled } from "./services/printDispatch";
import { normalizeWaPhone, isValidWaPhone } from "./services/whatsapp/types";
import { buildEbillText } from "@shared/ebillText";
import { parseSavePrintRequest } from "@shared/printRequest";
import { createStageTimer } from "@shared/printPerf";
import { automationRules, automationJobs, customerMessages, categories, menuItems, inventory, stockMovements, customersMaster, customerProfiles, customerSegments, users, orders, orderItems, kotTickets, tables, paymentTransactions, feedback, couponRedemptions } from "@shared/schema";
import {
  createRealtimePublisher,
  publishRealtime,
  setRealtimePublisher,
  authorizePusherChannel,
} from "./realtime/publisher";
import { eq, desc, or, ilike, isNotNull, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import multer from "multer";
import { registerPublicGrowthRoutes, registerGrowthRoutes } from "./growthRoutes";
import { registerWhatsAppRoutes, registerPublicWhatsAppRoutes } from "./whatsappRoutes";
import { registerStaffRoutes } from "./staffRoutes";
import { priceOrderWithMenu, computeTotalsFromLines, type PricedOrder } from "./services/orderPricing";
import { computeLineCosts } from "@shared/menuCost";
import { menuPriceError, menuSizesError } from "@shared/menuValidation";
import { deriveBillTotals } from "@shared/orderPricing";
import { orderEditBlock, isNoopItemsSave, kitchenTicketLines, discountNeedsApproval } from "@shared/orderItemsSave";
import { buildSpecialInstructions } from "@shared/orderItemText";
import { ROLE_LEVEL, grantElevation, hasElevation, requireElevation, requireFreshPin, freshPinApprover } from "./elevation";
import { requireUserAccount, sanitizeUser } from "./selfScope";
import { cachedPrincipal, forgetPrincipal, userPrincipalKey, staffPrincipalKey } from "./principalCache";
import { sendWithDbEtag, tableFingerprint, queryFingerprint } from "./dbEtag";
import { earnPointsForOrder } from "./services/loyaltyService";
import { scheduleFeedbackForOrder } from "./services/feedbackService";
import { logAudit, getAuditLogs, getKotBillActivitySummary } from "./services/auditService";
import { ingestDevicePunches, recomputeShiftSessions } from "./services/deviceAttendanceService";
import { runBackup, listBackups, isConfigured as backupConfigured } from "./services/backupService";
import { generateSecret, generateQRDataURL, verifyToken } from "./services/totpService";

// Cap upload size and restrict to spreadsheet/CSV types before the buffer ever
// reaches XLSX.read (SheetJS has a history of prototype-pollution / ReDoS on
// crafted workbooks; an unbounded in-memory parse is also a DoS vector).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname) ||
      /spreadsheet|excel|csv|ms-excel/i.test(file.mimetype);
    if (ok) return cb(null, true);
    cb(new Error("Only .xlsx/.xls/.csv files are allowed"));
  },
});

// Password hashing helpers using Node's built-in crypto
function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(`${salt}:${derived.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(":");
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(key === derived.toString("hex"));
    });
  });
}

// Passport local strategy
passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await storage.getUserByUsername(username);
    if (!user) return done(null, false, { message: "Invalid username or password" });
    const valid = await verifyPassword(password, user.password);
    if (!valid) return done(null, false, { message: "Invalid username or password" });
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user: any, done) => {
  done(null, user._isStaffMember ? `sm:${user.id}` : user.id);
});

// Runs on every authenticated request — served from a 10s per-process cache (server/principalCache.ts)
// so a poll doesn't re-read the same users/staff_members row each time.
passport.deserializeUser(async (key: any, done) => {
  try {
    if (typeof key === "string" && key.startsWith("sm:")) {
      const id = Number(key.slice(3));
      const sm = await cachedPrincipal(staffPrincipalKey(id), () => storage.getStaffMember(id));
      done(null, sm ? { id: sm.id, username: sm.name, role: "staff", designation: sm.designation ?? null, _isStaffMember: true } : false);
    } else {
      const id = Number(key);
      const user = await cachedPrincipal(userPrincipalKey(id), () => storage.getUser(id));
      done(null, user || false);
    }
  } catch (err) {
    done(err);
  }
});

// Middleware to require authentication
export function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

/**
 * Auth for the biometric-device feed. Accepts EITHER a valid device token
 * (the Electron agent on the LAN, independent of any login) OR an authenticated
 * admin (owner) session — for testing. Managers and staff are rejected, so only
 * the owner or the device itself can write attendance/payroll punches.
 */
export function requireDeviceAuth(req: any, res: any, next: any) {
  const token = getSettings().attendanceDevice?.token;
  const provided = req.headers["x-device-token"] as string | undefined;
  if (token && provided && safeEqual(provided, token)) return next();
  if (req.isAuthenticated?.() && req.user?.role === "admin") return next();
  return res.status(401).json({ message: "Device authentication required" });
}

// Middleware to require admin role
export function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

// Manager OR admin — gates staff/payroll data so staff-tier (PIN) sessions can't read salaries/roster.
export function requireManagerOrAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin" && req.user?.role !== "manager") return res.status(403).json({ message: "Manager access required" });
  next();
}

// Privileged-action elevation helpers live in ./elevation (pure, unit-tested).
// Re-exported so existing importers of these names via ./routes keep working.
export { ROLE_LEVEL, grantElevation, hasElevation, requireElevation };

export async function registerRoutes(
  app: Express,
  sessionMiddleware?: import("express").RequestHandler,
): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server for real-time updates.
  // Use noServer mode + manual upgrade routing so the ws library does NOT destroy
  // upgrade requests for other paths (e.g. Vite HMR /?token=...).
  const wss = new WebSocketServer({ noServer: true });

  // Authenticate the WS handshake against the express-session cookie. Without
  // this, any client on the network could open /ws and passively receive live
  // orders, customer phone numbers, and WhatsApp message bodies with no creds.
  const authorizeUpgrade = (request: any, done: (ok: boolean) => void) => {
    if (!sessionMiddleware) return done(true); // no middleware wired → skip (dev/test only)
    const fakeRes: any = {
      setHeader() {}, getHeader() {}, writeHead() {}, end() {},
      on() {}, once() {}, emit() {}, removeListener() {},
    };
    try {
      sessionMiddleware(request, fakeRes, () => {
        const userId = request.session?.passport?.user;
        done(userId != null);
      });
    } catch {
      done(false);
    }
  };

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url?.split('?')[0] ?? '';
    if (pathname === '/ws') {
      authorizeUpgrade(request, (ok) => {
        if (!ok) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      });
    }
    // All other upgrade paths (Vite HMR, etc.) fall through untouched.
  });

  const wsBroadcast = (data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  };

  const realtimePublisher = await createRealtimePublisher(wsBroadcast);
  setRealtimePublisher(realtimePublisher);

  const broadcast = (data: any) => {
    void publishRealtime(data);
  };

  // Unauthenticated liveness/diagnostic probes — nothing like this existed before, so an
  // uptime monitor (or a human debugging "is the deployment even up") had no endpoint to
  // hit without a session. Deliberately minimal: no business data, no auth state.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });
  app.get("/api/version", (_req, res) => {
    res.json({
      version: process.env.npm_package_version || "unknown",
      env: process.env.NODE_ENV || "development",
    });
  });

  // Diagnostic only: the POS reports the timeline of any Settle that took >= 4s (shared/settleTiming.ts)
  // so "why was that one slow?" has an answer — a parked request, a cold instance, or a slow handler
  // look completely different here and invisible everywhere else (Vercel keeps 1h of logs, no durations).
  // Written to the audit trail, which is the durable forensic record on this project. Never affects a settle.
  app.post("/api/perf/slow-settle", requireAuth, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
    const s = (v: unknown, max = 60) => (typeof v === "string" ? v.slice(0, max) : null);
    const legs = Array.isArray(b.legs)
      ? b.legs.slice(0, 6).map((l: any) => ({
          leg: s(l?.leg, 10), startMs: n(l?.startMs), durationMs: n(l?.durationMs),
          ttfbMs: n(l?.ttfbMs), serverMs: n(l?.serverMs), instance: s(l?.instance, 40), coldMs: n(l?.coldMs),
        }))
      : [];
    const orderId = Number(b.orderId);
    await logAudit(req, "perf.slow_settle", "order", Number.isFinite(orderId) && orderId > 0 ? orderId : null, {
      outcome: s(b.outcome, 10),
      totalMs: n(b.totalMs),
      startLagMs: n(b.startLagMs),
      betweenLegsMs: n(b.betweenLegsMs),
      slowestLeg: s(b.slowestLeg, 10),
      legs,
      idleMs: n(b.idleMs),
      onlineAtClick: typeof b.onlineAtClick === "boolean" ? b.onlineAtClick : null,
      connection: s(b.connection, 60),
    });
    res.status(204).end();
  });

  // Same idea for a POS KOT/Bill tap that took >= 3s (client/src/lib/printPerfClient.ts): the tap's own
  // stage times, the server's Server-Timing stages for that request, and how long the connection had
  // been quiet before the tap — so "network stall" vs "slow server" can be told apart afterwards.
  app.post("/api/perf/slow-print", requireAuth, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
    const s = (v: unknown, max = 60) => (typeof v === "string" ? v.slice(0, max) : null);
    const durations = (v: unknown) => {
      const out: Record<string, number> = {};
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
          const ms = n(val);
          if (ms !== null && /^[A-Za-z0-9_-]{1,40}$/.test(k)) out[k] = ms;
        }
      }
      return out;
    };
    const orderId = Number(b.orderId);
    await logAudit(req, "perf.slow_print", "order", Number.isFinite(orderId) && orderId > 0 ? orderId : null, {
      kind: s(b.kind, 20),
      totalMs: n(b.totalMs),
      stages: durations(b.stages),
      server: durations(b.server),
      instance: s(b.instance, 40),
      idleMs: n(b.idleMs),
      onlineAtClick: typeof b.onlineAtClick === "boolean" ? b.onlineAtClick : null,
      connection: s(b.connection, 60),
      // Stall-breaker era (Nov 2026): window state, desktop vs browser, connection resets during the
      // tap, and whether the save's answer was replayed from server/requestKeys.ts's store.
      hidden: typeof b.hidden === "boolean" ? b.hidden : null,
      electron: typeof b.electron === "boolean" ? b.electron : null,
      resets: n(b.resets),
      replayed: typeof b.replayed === "boolean" ? b.replayed : null,
    });
    res.status(204).end();
  });

  // Diagnostic only: any API request that took >= 4s to response headers (or timed out) on a client,
  // with the client's time, the server's own Server-Timing for it and the resulting cause
  // (client/src/lib/slowRequest.ts, shared/requestTiming.ts). Read with scripts/report-latency.ts.
  app.post("/api/perf/slow-request", requireAuth, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
    const s = (v: unknown, max = 60) => (typeof v === "string" ? v.slice(0, max) : null);
    const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
    await logAudit(req, "perf.slow_request", "request", null, {
      method: s(b.method, 8),
      path: s(b.path, 120),
      status: n(b.status),
      clientMs: n(b.clientMs),
      appMs: n(b.appMs),
      coldMs: n(b.coldMs),
      instAgeS: n(b.instAgeS),
      instReq: n(b.instReq),
      attempt: n(b.attempt),
      timedOut: bool(b.timedOut),
      failed: bool(b.failed),
      cause: s(b.cause, 12),
      online: bool(b.online),
      hidden: bool(b.hidden),
      connection: s(b.connection, 60),
    });
    res.status(204).end();
  });

  // Diagnostic only: the desktop stall breaker (packages/api-client/stallBreaker.ts) found a dead
  // connection, reset all connections and retried (client/src/lib/stallReset.ts). Read with
  // scripts/report-latency.ts. idleMs ≈ how long the connection had been quiet before the request.
  app.post("/api/perf/stall-reset", requireAuth, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
    const s = (v: unknown, max = 60) => (typeof v === "string" ? v.slice(0, max) : null);
    const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
    await logAudit(req, "perf.stall_reset", "request", null, {
      method: s(b.method, 8),
      path: s(b.path, 120),
      keyed: bool(b.keyed),
      detectMs: n(b.detectMs),
      retryOutcome: s(b.retryOutcome, 12),
      retryStatus: n(b.retryStatus),
      retryMs: n(b.retryMs),
      idleMs: n(b.idleMs),
      hiddenResets: n(b.hiddenResets),
      connection: s(b.connection, 60),
    });
    res.status(204).end();
  });

  // Pusher private-channel auth — only an authenticated session may subscribe to
  // the realtime channel (which carries orders, customer phones, WhatsApp bodies).
  app.post("/api/pusher/auth", requireAuth, (req, res) => {
    const socketId = req.body?.socket_id;
    const channel = req.body?.channel_name;
    if (!socketId || !channel) return res.status(400).json({ message: "socket_id and channel_name required" });
    const auth = authorizePusherChannel(String(socketId), String(channel));
    if (!auth) return res.status(503).json({ message: "Realtime auth unavailable" });
    res.json(auth);
  });

  // Bootstrap an admin ONLY on an empty install (no accounts at all). This used to run on every
  // boot/cold start whenever no account was literally named "admin" — so renaming or deleting the
  // real admin silently recreated admin/admin123 on production. In production the password must
  // come from BOOTSTRAP_ADMIN_PASSWORD; the well-known default is only used outside production.
  try {
    const existingUsers = await storage.getUsers();
    if (existingUsers.length === 0) {
      const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD
        || (process.env.NODE_ENV === "production" ? null : "admin123");
      if (bootstrapPassword) {
        const hashed = await hashPassword(bootstrapPassword);
        await storage.createUser({ username: "admin", password: hashed, role: "admin" });
        console.log("Created bootstrap admin user (username: admin) — change its password now.");
      } else {
        console.error("[auth] No user accounts exist. Set BOOTSTRAP_ADMIN_PASSWORD to create the first admin.");
      }
    }
  } catch (err: any) {
    if (err.code === 'ENOTFOUND') {
      console.error("\n❌ DATABASE CONNECTION FAILED");
      console.error("   Cannot reach host:", err.hostname);
      console.error("   The Supabase project may be deleted or paused.");
      console.error("   → Create a new project at supabase.com or neon.tech");
      console.error("   → Update DATABASE_URL in your .env file");
      console.error("   → Run: npm run db:push\n");
    } else {
      console.error("Failed to ensure admin user:", err.message || err);
    }
  }

  // ── Rate Limiters ────────────────────────────────────────────────────────────

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many login attempts. Try again in 15 minutes." },
  });

  // Per SESSION, failures only. Keyed by IP it was shared by every device in the restaurant (one
  // public CGNAT address) and counted correct PINs too, so five ordinary manager approvals across
  // the floor in 5 minutes locked everyone out of every PIN prompt. A brute force still gets only
  // 5 wrong guesses per session per 5 minutes (and needs a logged-in session for verify-pin).
  const pinLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,    // 5 minutes
    max: 5,
    skipSuccessfulRequests: true,
    // A wrong PIN answers 200 {valid:false}, so "successful" is set explicitly by the handlers.
    requestWasSuccessful: (_req: any, res: any) => res.locals?.pinOk === true,
    keyGenerator: (req: any) => (req.sessionID ? `s:${req.sessionID}` : `ip:${req.ip}`),
    validate: { keyGeneratorIpFallback: false },
    standardHeaders: true,
    legacyHeaders: false,
    message: { valid: false, message: "Too many PIN attempts. Try again in 5 minutes." },
  });

  const staffPinLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many PIN attempts. Try again in 5 minutes." },
  });

  const razorpayVerifyLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many payment verification requests." },
  });

  // ── Auth Routes ──────────────────────────────────────────────────────────────

  app.post("/api/auth/login", loginLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });

      // If 2FA is enabled, hold login in a pending session state
      if (user.totpEnabled && user.totpSecret) {
        (req.session as any).pending2faUserId = user.id;
        return res.json({ requires2FA: true });
      }

      req.logIn(user, (err) => {
        if (err) return next(err);
        const { password, pin, totpSecret, ...safeUser } = user;
        res.json(safeUser);
      });
    })(req, res, next);
  });

  // ── 2FA: complete login after TOTP verified ───────────────────────────────────
  app.post("/api/auth/2fa/complete", pinLimiter, async (req, res, next) => {
    try {
      const pendingId = (req.session as any).pending2faUserId;
      if (!pendingId) return res.status(400).json({ message: "No pending 2FA session" });

      const { token } = req.body;
      if (!token) return res.status(400).json({ message: "token required" });

      const [user] = await db.select().from(users).where(eq(users.id, pendingId));
      if (!user || !user.totpSecret) return res.status(400).json({ message: "Invalid session" });

      if (!verifyToken(String(token), user.totpSecret)) {
        return res.status(401).json({ message: "Invalid authenticator code" });
      }

      delete (req.session as any).pending2faUserId;
      res.locals.pinOk = true;

      req.logIn(user, (err) => {
        if (err) return next(err);
        const { password, pin, totpSecret, ...safeUser } = user;
        res.json(safeUser);
      });
    } catch (err) {
      next(err);
    }
  });

  // ── 2FA setup: generate secret + QR (admin, already logged in) ───────────────
  // requireUserAccount on setup/verify-setup/disable: same users/staff_members id-collision IDOR
  // as PUT /api/auth/profile (server/selfScope.ts).
  app.post("/api/auth/2fa/setup", requireAuth, requireUserAccount, async (req, res) => {
    try {
      const actor = req.user as any;
      const secret = generateSecret();
      const qrDataURL = await generateQRDataURL(actor.username, secret);
      // Store temp secret in session (not DB yet — only saved after verification)
      (req.session as any).pending2faSecret = secret;
      res.json({ secret, qrDataURL });
    } catch (err) {
      console.error("[2FA setup error]", err);
      res.status(500).json({ message: "Failed to generate 2FA setup", detail: String(err) });
    }
  });

  // ── 2FA setup: verify first code, then persist secret ────────────────────────
  app.post("/api/auth/2fa/verify-setup", requireAuth, requireUserAccount, async (req, res) => {
    try {
      const actor = req.user as any;
      const { token } = req.body;
      const secret = (req.session as any).pending2faSecret;
      if (!secret) return res.status(400).json({ message: "No pending setup — call /setup first" });
      if (!verifyToken(String(token), secret)) {
        return res.status(401).json({ message: "Invalid code — try again" });
      }
      await db.update(users)
        .set({ totpSecret: secret, totpEnabled: true })
        .where(eq(users.id, actor.id));
      forgetPrincipal(userPrincipalKey(actor.id));
      delete (req.session as any).pending2faSecret;
      logAudit(req, "user.2fa_enabled", "user", actor.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to enable 2FA" });
    }
  });

  // ── 2FA disable ───────────────────────────────────────────────────────────────
  app.post("/api/auth/2fa/disable", requireAuth, requireUserAccount, async (req, res) => {
    try {
      const actor = req.user as any;
      const { token } = req.body;
      const [user] = await db.select().from(users).where(eq(users.id, actor.id));
      if (!user?.totpSecret) return res.status(400).json({ message: "2FA is not enabled" });
      if (!verifyToken(String(token), user.totpSecret)) {
        return res.status(401).json({ message: "Invalid code" });
      }
      await db.update(users)
        .set({ totpSecret: null, totpEnabled: false })
        .where(eq(users.id, actor.id));
      forgetPrincipal(userPrincipalKey(actor.id));
      logAudit(req, "user.2fa_disabled", "user", actor.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to disable 2FA" });
    }
  });

  // ── 2FA status ────────────────────────────────────────────────────────────────
  app.get("/api/auth/2fa/status", requireAuth, async (req, res) => {
    try {
      const actor = req.user as any;
      // A staff-member (PIN card) session has no users row of its own — its id belongs to
      // staff_members, and reading users by it returned (and setup/disable WROTE) whichever
      // account shares the number. 2FA is for user accounts only.
      if (actor?._isStaffMember) return res.json({ totpEnabled: false, available: false });
      const [user] = await db.select().from(users).where(eq(users.id, actor.id));
      res.json({ totpEnabled: !!user?.totpEnabled });
    } catch {
      res.status(500).json({ message: "Failed to fetch 2FA status" });
    }
  });

  app.post("/api/auth/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ success: true });
    });
  });

  // ── Device context — tells client if request is from local network + mobile ──
  app.get("/api/auth/context", (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket.remoteAddress
      || "";
    const isLocalNetwork =
      ip === "::1" ||
      ip === "127.0.0.1" ||
      /^::ffff:127\./.test(ip) ||
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

    const ua = req.headers["user-agent"] ?? "";
    const isMobile = /Mobile|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);

    res.json({ isLocalNetwork, isMobile });
  });

  // ── Staff PIN login — uses staffMembers table (not system users) ────────────
  app.post("/api/auth/staff-pin-login", staffPinLimiter, async (req, res, next) => {
    try {
      const { staffId, pin } = req.body;
      if (!staffId || !pin) return res.status(400).json({ message: "staffId and pin required" });

      const sm = await storage.getStaffMember(Number(staffId));
      // Same rule as card-login: turning a person's Mobile Card off must also stop this login.
      if (!sm || !sm.isActive || !sm.showOnMobile) return res.status(401).json({ message: "Staff member not found" });
      if (!sm.pin) return res.status(401).json({ message: "No PIN set. Ask manager to set one in Settings → Staff Selector." });
      if (sm.pin !== String(pin)) return res.status(401).json({ message: "Wrong PIN" });

      const staffUser = { id: sm.id, username: sm.name, role: "staff", _isStaffMember: true };
      req.logIn(staffUser as any, (err) => {
        if (err) return next(err);
        res.json({ id: sm.id, username: sm.name, role: "staff" });
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Unified mobile name-card PIN login — staff members OR non-admin accounts ──
  // Body { kind:"staff"|"user", id, pin }. An account logs in as its real role; admin is never card-eligible.
  app.post("/api/auth/card-login", staffPinLimiter, async (req, res, next) => {
    try {
      const { kind, id, pin } = req.body as { kind?: string; id?: number; pin?: string };
      if (!id || !pin) return res.status(400).json({ message: "id and pin required" });

      if (kind === "user") {
        const user = await storage.getUser(Number(id));
        if (!user || !user.showOnMobile || user.role === "admin") return res.status(401).json({ message: "Card login not available" });
        if (!user.pin) return res.status(401).json({ message: "No PIN set for this account" });
        if (user.pin !== String(pin)) return res.status(401).json({ message: "Wrong PIN" });
        return req.logIn(user as any, (err) => {
          if (err) return next(err);
          res.json(sanitizeUser(user as any));
        });
      }

      // default: staff member
      const sm = await storage.getStaffMember(Number(id));
      if (!sm || !sm.isActive || !sm.showOnMobile) return res.status(401).json({ message: "Card login not available" });
      if (!sm.pin) return res.status(401).json({ message: "No PIN set for this staff member" });
      if (sm.pin !== String(pin)) return res.status(401).json({ message: "Wrong PIN" });
      const staffUser = { id: sm.id, username: sm.name, role: "staff", designation: sm.designation ?? null, _isStaffMember: true };
      req.logIn(staffUser as any, (err) => {
        if (err) return next(err);
        res.json({ id: sm.id, username: sm.name, role: "staff" });
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(200).json(null);
    res.json(sanitizeUser(req.user as any));
  });

  // requireUserAccount: a staff-member session (`{id: staffMembers.id, _isStaffMember:true}`)
  // must never reach these — `users` and `staffMembers` share an integer id space, so an
  // unguarded lookup by `currentUser.id` here is a cross-table IDOR (see CLAUDE.md).
  app.put("/api/auth/profile", requireAuth, requireUserAccount, async (req, res) => {
    try {
      const { username } = req.body;
      if (!username || typeof username !== "string" || username.trim().length === 0) {
        return res.status(400).json({ message: "Username is required" });
      }
      const currentUser = req.user as any;
      const existing = await storage.getUserByUsername(username.trim());
      if (existing && existing.id !== currentUser.id) {
        return res.status(409).json({ message: "Username already taken" });
      }
      const updated = await storage.updateUser(Number(currentUser.id), { username: username.trim() });
      res.json(sanitizeUser(updated));
    } catch (err) {
      console.error("Profile update error:", err);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.put("/api/auth/password", requireAuth, requireUserAccount, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }
      const currentUser = req.user as any;
      const user = await storage.getUser(Number(currentUser.id));
      if (!user) return res.status(404).json({ message: "User not found" });
      const valid = await verifyPassword(currentPassword, user.password);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });
      const hashed = await hashPassword(newPassword);
      await storage.updateUser(Number(currentUser.id), { password: hashed });
      res.json({ success: true });
    } catch (err) {
      console.error("Password change error:", err);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // ── PIN verification ──────────────────────────────────────────────────────────

  // Returns all existing roles + which of those have a PIN configured
  app.get("/api/auth/switchable-roles", requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      const roles = Array.from(new Set(allUsers.map((u) => u.role)));
      const rolesWithPin = Array.from(new Set(allUsers.filter((u) => u.pin).map((u) => u.role)));
      res.json({ roles, rolesWithPin });
    } catch (err) {
      res.status(500).json({ roles: [], rolesWithPin: [] });
    }
  });

  app.post("/api/auth/verify-pin", requireAuth, pinLimiter, async (req, res) => {
    try {
      const { pin, requiredRole } = req.body;
      if (!pin) return res.status(400).json({ valid: false });
      const allUsers = await storage.getUsers();

      // Role hierarchy for PIN acceptance:
      // Switching to "admin"   → only admin PIN accepted
      // Switching to "manager" → manager OR admin PIN accepted
      // Any other role         → that role's PIN OR any higher role's PIN accepted
      const targetLevel = ROLE_LEVEL[requiredRole] ?? 1;
      const match = allUsers.find(
        (u) => (ROLE_LEVEL[u.role] ?? 0) >= targetLevel && u.pin === String(pin)
      );
      // Back the client PIN dialog with a short-lived server-side elevation grant. The grant also
      // remembers WHOSE PIN opened it, so an audit row can say who approved a settle/correction
      // (the session's own user is just whoever happened to be logged in at the till).
      if (match) {
        grantElevation(req, ROLE_LEVEL[match.role] ?? targetLevel, Date.now(), {
          id: `u:${match.id}`, name: match.username, role: match.role,
        });
      }
      res.locals.pinOk = !!match;
      res.json({ valid: !!match });
    } catch (err) {
      console.error("Verify PIN error:", err);
      res.status(500).json({ valid: false });
    }
  });

  // Reset all PINs (admin only)
  app.post("/api/users/reset-all-pins", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      await Promise.all(allUsers.map((u) => storage.updateUser(u.id, { pin: null })));
      logAudit(req, "user.pin_reset_all", "user", null, { count: allUsers.length });
      res.json({ success: true });
    } catch (err) {
      console.error("Reset all PINs error:", err);
      res.status(500).json({ message: "Failed to reset PINs" });
    }
  });


  // Update PIN for a user (admin sets PIN for managers)
  app.put("/api/users/:id/pin", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { pin } = req.body;
      if (pin && !/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ message: "PIN must be 4-6 digits" });
      }
      const updated = await storage.updateUser(id, { pin: pin ? String(pin) : null });
      logAudit(req, "user.pin_update", "user", id, { cleared: !pin });
      res.json(sanitizeUser(updated));
    } catch (err) {
      console.error("Update PIN error:", err);
      res.status(500).json({ message: "Failed to update PIN" });
    }
  });

  // ── Staff Members — public selector list (no auth) ───────────────────────────
  // Public mobile-login cards: staff members + NON-ADMIN accounts that have `showOnMobile` ON and a PIN.
  // Each card carries `kind` so the PIN login (/api/auth/card-login) routes to the right path.
  app.get("/api/staff-members", async (_req, res) => {
    try {
      const members = await storage.getStaffMembers();
      const allUsers = await storage.getUsers();
      const cards = [
        ...members.filter(s => s.isActive && s.pin && s.showOnMobile)
          .map(s => ({ kind: "staff" as const, id: s.id, name: s.name, designation: s.designation ?? null })),
        ...allUsers.filter(u => u.pin && u.showOnMobile && u.role !== "admin")
          .map(u => ({ kind: "user" as const, id: u.id, name: u.username, designation: u.role })),
      ];
      res.json(cards);
    } catch {
      res.status(500).json({ message: "Failed to fetch login cards" });
    }
  });

  // ── Staff Members CRUD (admin only) — the unified employee record ─────────────
  // Shapes a staff member for the admin UI (includes HR fields; hides raw PIN).
  const shapeStaffMember = (sm: any) => ({
    id: sm.id, name: sm.name, hasPin: !!sm.pin, designation: sm.designation ?? null,
    biometricId: sm.biometricId ?? null, monthlySalary: sm.monthlySalary ?? "0",
    excludeFromPayroll: !!sm.excludeFromPayroll, showOnMobile: !!sm.showOnMobile,
    isActive: sm.isActive, createdAt: sm.createdAt,
  });

  app.get("/api/staff-members/all", requireAdmin, async (_req, res) => {
    try {
      const all = await storage.getStaffMembers();
      res.json(all.map(shapeStaffMember));
    } catch {
      res.status(500).json({ message: "Failed to fetch staff members" });
    }
  });

  app.post("/api/staff-members", requireAdmin, async (req, res) => {
    try {
      const { name, pin, designation, biometricId, monthlySalary, excludeFromPayroll, showOnMobile } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      if (pin && !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ message: "PIN must be 4–6 digits" });
      const sm = await storage.createStaffMember({
        name: name.trim(),
        pin: pin ? String(pin) : null,
        designation: designation?.trim() || null,
        biometricId: biometricId != null && String(biometricId).trim() !== "" ? String(biometricId).trim() : null,
        monthlySalary: monthlySalary != null && String(monthlySalary) !== "" ? String(monthlySalary) : "0",
        excludeFromPayroll: !!excludeFromPayroll,
        showOnMobile: showOnMobile === undefined ? true : !!showOnMobile,
        isActive: true,
      });
      res.json(shapeStaffMember(sm));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/staff-members/:id", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { name, pin, isActive, designation, biometricId, monthlySalary, excludeFromPayroll, showOnMobile } = req.body;
      if (pin !== undefined && pin !== null && pin !== "" && !/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ message: "PIN must be 4–6 digits" });
      }
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (pin !== undefined) updates.pin = pin === "" ? null : String(pin);
      if (isActive !== undefined) updates.isActive = isActive;
      if (designation !== undefined) updates.designation = designation?.trim() || null;
      if (biometricId !== undefined) updates.biometricId = String(biometricId).trim() || null;
      if (monthlySalary !== undefined) updates.monthlySalary = String(monthlySalary) === "" ? "0" : String(monthlySalary);
      if (excludeFromPayroll !== undefined) updates.excludeFromPayroll = !!excludeFromPayroll;
      if (showOnMobile !== undefined) updates.showOnMobile = !!showOnMobile;
      const sm = await storage.updateStaffMember(id, updates);
      res.json(shapeStaffMember(sm));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/staff-members/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteStaffMember(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Manager page access settings ──────────────────────────────────────────────
  app.get("/api/settings/manager-pages", requireAuth, (_req, res) => {
    const s = getSettings();
    res.json({ managerAllowedPages: s.managerAllowedPages });
  });

  app.post("/api/settings/manager-pages", requireAdmin, async (req, res) => {
    const { managerAllowedPages } = req.body;
    const updated = await saveSettings({ managerAllowedPages: managerAllowedPages ?? null });
    res.json({ managerAllowedPages: updated.managerAllowedPages });
  });

  // ── Staff page access settings ────────────────────────────────────────────────
  // GET: Retrieve current staff page restrictions
  app.get("/api/settings/staff-pages", requireAuth, (_req, res) => {
    const s = getSettings();
    res.json({ staffAllowedPages: s.staffAllowedPages });
  });

  // POST: Update staff page restrictions (admin only)
  app.post("/api/settings/staff-pages", requireAdmin, async (req, res) => {
    const { staffAllowedPages } = req.body;
    const updated = await saveSettings({ staffAllowedPages: staffAllowedPages ?? null });
    res.json({ staffAllowedPages: updated.staffAllowedPages });
  });

  // ── Per-person page access (staff tier) ───────────────────────────────────────
  // Roster of staff-tier people for the picker: every staff member + staff-role accounts.
  async function staffPageRoster(): Promise<{ key: string; name: string; role: string | null }[]> {
    const members = await storage.getStaffMembers();
    const allUsers = await storage.getUsers();
    return [
      ...members.map(m => ({ key: personPageKey("staff", m.id), name: m.name, role: m.designation ?? null })),
      ...allUsers.filter(u => u.role === "staff").map(u => ({ key: personPageKey("user", u.id), name: u.username, role: "staff" })),
    ];
  }

  app.get("/api/settings/staff-page-access", requireAdmin, async (_req, res) => {
    try {
      res.json({ staffPageAccess: getSettings().staffPageAccess ?? {}, roster: await staffPageRoster() });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Set one person's allowed pages.
  app.post("/api/settings/staff-page-access", requireAdmin, async (req, res) => {
    try {
      const { key, pages } = req.body as { key: string; pages: string[] };
      if (!key) return res.status(400).json({ message: "key required" });
      const map = { ...(getSettings().staffPageAccess ?? {}) };
      map[key] = Array.isArray(pages) ? pages : [];
      const updated = await saveSettings({ staffPageAccess: map });
      res.json({ staffPageAccess: updated.staffPageAccess });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Copy the source person's resolved pages to everyone who shares their role.
  app.post("/api/settings/staff-page-access/apply-role", requireAdmin, async (req, res) => {
    try {
      const { sourceKey } = req.body as { sourceKey: string };
      const roster = await staffPageRoster();
      const source = roster.find(r => r.key === sourceKey);
      if (!source) return res.status(404).json({ message: "Person not found" });
      const map = { ...(getSettings().staffPageAccess ?? {}) };
      const sourcePages = resolveStaffAllowedPages(sourceKey, source.role, map);
      const role = (source.role ?? "").toLowerCase();
      let appliedTo = 0;
      for (const r of roster) {
        if ((r.role ?? "").toLowerCase() === role) { map[r.key] = [...sourcePages]; appliedTo++; }
      }
      const updated = await saveSettings({ staffPageAccess: map });
      res.json({ staffPageAccess: updated.staffPageAccess, appliedTo });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── User Management (Admin only) ──────────────────────────────────────────────

  app.get("/api/users", requireAuth, async (_req, res) => {
    try {
      const allUsers = await storage.getUsers();
      // totpSecret too: it used to go to every session (staff PIN cards included).
      const safeUsers = allUsers.map(({ password, pin, totpSecret, ...u }) => ({ ...u, pin: !!pin }));
      res.json(safeUsers);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role, pin } = req.body;
      if (!username || !password) return res.status(400).json({ message: "Username and password are required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      if (pin && !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ message: "PIN must be 4 or 6 digits" });
      const existing = await storage.getUserByUsername(username.trim());
      if (existing) return res.status(409).json({ message: "Username already taken" });
      const hashed = await hashPassword(password);
      const user = await storage.createUser({
        username: username.trim(),
        password: hashed,
        role: role || "staff",
        pin: pin ? String(pin) : null,
      });
      const { password: _, pin: userPin, ...safeUser } = user;
      logAudit(req, "user.create", "user", user.id, { username: user.username, role: user.role });
      res.json({ ...safeUser, pin: !!userPin });
    } catch (err) {
      console.error("Create user error:", err);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.put("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const currentUser = req.user as any;
      const { role, username, password, pin, showOnMobile } = req.body;
      const updateData: any = {};
      if (role) updateData.role = role;
      if (pin !== undefined) {
        if (pin && !/^\d{4,6}$/.test(String(pin))) {
          return res.status(400).json({ message: "PIN must be 4-6 digits" });
        }
        updateData.pin = pin ? String(pin) : null;
      }
      // Admin/owner accounts may never appear as a mobile card (password-only).
      if (showOnMobile !== undefined) updateData.showOnMobile = !!showOnMobile && (updateData.role ?? (await storage.getUser(id))?.role) !== "admin";
      if (username) {
        const existing = await storage.getUserByUsername(username.trim());
        if (existing && existing.id !== id) return res.status(409).json({ message: "Username already taken" });
        updateData.username = username.trim();
      }
      if (password) {
        if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
        updateData.password = await hashPassword(password);
      }
      const updated = await storage.updateUser(id, updateData);
      const { password: _, pin: updatedPin, ...safeUser } = updated;
      logAudit(req, "user.update", "user", id, { fields: Object.keys(updateData) });
      res.json({ ...safeUser, pin: !!updatedPin });
    } catch (err) {
      console.error("Update user error:", err);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const currentUser = req.user as any;
      if (id === currentUser.id) return res.status(400).json({ message: "Cannot delete your own account" });
      await storage.deleteUser(id);
      logAudit(req, "user.delete", "user", id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // ── Database migration ────────────────────────────────────────────────────────

  // Disabled: this ran `drizzle-kit push --force`, which auto-approves destructive statements.
  // The live DB holds tables/columns the schema doesn't declare (the connect-pg-simple sessions
  // table; columns added by scripts/migrate-*.mjs), so one tap could DROP them. Schema changes go
  // through reviewed scripts/migrate-*.mjs files instead (CLAUDE.md, Database).
  app.post("/api/admin/migrate", requireAdmin, (_req, res) => {
    res.status(410).json({ message: "Schema sync from the app is disabled — run the reviewed migration script instead." });
  });

  // ── Server logs ───────────────────────────────────────────────────────────────

  app.get("/api/admin/logs", requireAdmin, (_req, res) => {
    res.json(getLogBuffer());
  });

  app.post("/api/admin/cache-clear", requireAdmin, (_req, res) => {
    const clientCount = wss.clients.size;
    broadcast({ type: "CACHE_BUST" });
    res.json({ ok: true, clients: clientCount });
  });

  app.post("/api/admin/reset-bill-number", requireAdmin, async (req, res) => {
    try {
      // order_number is UNIQUE: restarting at ORD0001 while old orders exist made every new order
      // collide (500 "Failed to create order") until the counter caught up. Only allowed once no
      // order would collide — i.e. after Clear All Orders.
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(orders);
      if (n > 0) {
        return res.status(409).json({
          message: `Bill numbers can't restart while ${n} past orders exist — every new order would reuse an existing number. Clear all orders first.`,
        });
      }
      await saveSettings({ billCounter: 0 } as any, { allowCounters: true });
      await logAudit(req, "settings.bill_number_reset", "settings", null, {});
      res.json({ success: true, message: "Bill number reset. Next order will be ORD0001." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Reset failed" });
    }
  });

  // Wipes every order, ticket and payment: a fresh admin PIN, not just an admin session.
  app.delete("/api/admin/clear-orders", requireAdmin, requireFreshPin("admin"), async (req, res) => {
    try {
      // 1. Delete all order-related data
      await db.delete(paymentTransactions);
      await db.delete(feedback);
      await db.delete(couponRedemptions);
      await db.delete(orderItems);
      await db.delete(kotTickets);
      await db.delete(orders);

      // 2. Reset table status and order associations
      await db.update(tables).set({
        status: "free",
        currentOrderId: null,
      });

      // Reset KOT counter back to 0
      await saveSettings({ kotCounter: 0 } as any, { allowCounters: true });

      // 3. Log audit event
      await logAudit(req, "orders.clear_all", "system", null, {
        message: "All orders, KOT records, payment transactions, feedback, and table occupancy states cleared.",
      });

      // 4. Broadcast websocket updates so client views refresh immediately
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });
      broadcast({ type: "KOT_UPDATE", action: "cleared" });

      res.json({ success: true, message: "All orders, KOT records, and table occupancy states removed." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Clear failed" });
    }
  });

  app.get("/api/admin/audit-logs", requireAdmin, async (req, res) => {
    try {
      const limit  = Math.min(parseInt(String(req.query.limit  ?? 50)), 200);
      const offset = parseInt(String(req.query.offset ?? 0));
      const action     = req.query.action     ? String(req.query.action)     : undefined;
      const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
      const rows = await getAuditLogs({ limit, offset, action, entityType });
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  // ── DB Backup endpoints ────────────────────────────────────────────────────
  app.get("/api/admin/backups", requireAdmin, async (_req, res) => {
    try {
      const backups = await listBackups();
      res.json({ configured: backupConfigured(), backups });
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to list backups" });
    }
  });

  app.post("/api/admin/backups", requireAdmin, async (req, res) => {
    try {
      if (!backupConfigured()) {
        return res.status(400).json({ message: "Backup storage not configured. Set R2_* or AWS_* env vars." });
      }
      const result = await runBackup();
      logAudit(req, "backup.manual", "system", undefined, { key: result.key, sizeBytes: result.sizeBytes });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Backup failed" });
    }
  });

  // ── Data import ───────────────────────────────────────────────────────────────

  app.post("/api/admin/import/menu", requireAdmin, async (req, res) => {
    const rows: { name: string; category: string; price: string; description?: string }[] = req.body.rows ?? [];
    if (!rows.length) return res.status(400).json({ message: "No rows provided" });

    const imported: number[] = [];
    const errors: string[] = [];

    // Build category name→id cache (case-insensitive)
    const existingCats = await db.select().from(categories);
    const catCache = new Map<string, number>(existingCats.map(c => [c.name.toLowerCase(), c.id]));

    for (const row of rows) {
      try {
        const catName = row.category?.trim() || "Uncategorised";
        let catId = catCache.get(catName.toLowerCase());
        if (!catId) {
          const [newCat] = await db.insert(categories).values({ name: catName, isActive: true, displayOrder: 0 }).returning();
          catId = newCat.id;
          catCache.set(catName.toLowerCase(), catId);
        }
        const price = parseFloat(row.price);
        if (isNaN(price) || price < 0) throw new Error(`Invalid price "${row.price}"`);
        const [item] = await db.insert(menuItems).values({
          name: row.name.trim(),
          description: row.description?.trim() || null,
          price: price.toFixed(2),
          categoryId: catId,
          isAvailable: true,
          preparationTime: 15,
        }).returning();
        imported.push(item.id);
      } catch (err: any) {
        errors.push(`"${row.name}": ${err.message}`);
      }
    }

    res.json({ imported: imported.length, errors });
  });

  app.post("/api/admin/import/inventory", requireAdmin, async (req, res) => {
    const rows: { itemName: string; currentStock: string; minStock: string; unit: string }[] = req.body.rows ?? [];
    if (!rows.length) return res.status(400).json({ message: "No rows provided" });

    const imported: number[] = [];
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const current = parseFloat(row.currentStock);
        const min     = parseFloat(row.minStock);
        if (isNaN(current) || isNaN(min)) throw new Error("Invalid stock value");
        const [item] = await db.insert(inventory).values({
          itemName:     row.itemName.trim(),
          currentStock: current.toFixed(2),
          minStock:     min.toFixed(2),
          unit:         row.unit?.trim() || "pcs",
        }).returning();
        // Row already carries its opening balance from the INSERT above (unlike
        // recordStockMovement, which UPDATEs an existing row) — ledger it directly
        // so the import is still traceable in stock_movements.
        const importActor = actorRefFromReq(req);
        await db.insert(stockMovements).values({
          inventoryId: item.id,
          type: "import",
          quantityDelta: current.toFixed(2),
          stockAfter: current.toFixed(2),
          actorUserId: importActor.userId ?? null,
          actorStaffMemberId: importActor.staffMemberId ?? null,
        });
        imported.push(item.id);
      } catch (err: any) {
        errors.push(`"${row.itemName}": ${err.message}`);
      }
    }

    res.json({ imported: imported.length, errors });
  });

  app.post("/api/admin/import/customers", requireAdmin, async (req, res) => {
    const rows: {
      name: string; phone?: string; email?: string; address?: string;
      locality?: string; dob?: string; anniversary?: string; tags?: string; remark?: string;
    }[] = req.body.rows ?? [];
    if (!rows.length) return res.status(400).json({ message: "No rows provided" });

    const imported: string[] = [];
    const errors: string[] = [];

    // Build key + phone caches to skip duplicates. A person can already exist
    // under a different key (e.g. created by name, imported by phone), so we
    // also dedupe on the last 10 phone digits to avoid stale duplicate rows.
    const existingCustomers = await db
      .select({ id: customersMaster.id, key: customersMaster.key, phone: customersMaster.phone })
      .from(customersMaster);
    const existingKeys = new Set(existingCustomers.map(c => c.key.toLowerCase()));
    const last10 = (p?: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
    const existingPhones = new Set(
      existingCustomers.map(c => last10(c.phone)).filter(p => p.length === 10),
    );

    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) { errors.push("Row skipped: Name is required"); continue; }

      const phone = row.phone?.trim().replace(/\D/g, "") || undefined;
      const key   = phone || name;
      const phone10 = last10(phone);

      if (existingKeys.has(key.toLowerCase()) || (phone10.length === 10 && existingPhones.has(phone10))) {
        errors.push(`"${name}": already exists (skipped)`);
        continue;
      }

      try {
        const [master] = await db.insert(customersMaster).values({ key, name, phone: phone || null }).returning();

        const tags = row.tags
          ? row.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean)
          : [];

        await db.insert(customerProfiles).values({
          customerId:          master.id,
          email:               row.email?.trim()       || null,
          address:             row.address?.trim()     || null,
          locality:            row.locality?.trim()    || null,
          dob:                 row.dob?.trim()         || null,
          anniversary:         row.anniversary?.trim() || null,
          tags:                tags.length ? tags : null,
          remark:              row.remark?.trim()      || null,
          isFavorite:          false,
          notificationEnabled: true,
          doNotSendUpdate:     false,
        });

        existingKeys.add(key.toLowerCase());
        if (phone10.length === 10) existingPhones.add(phone10);
        imported.push(master.id);
      } catch (err: any) {
        errors.push(`"${name}": ${err.message}`);
      }
    }

    res.json({ imported: imported.length, errors });
  });

  // ── Print routes ──────────────────────────────────────────────────────────────
  registerPrintRoutes(app);

  // ── Phase 1 growth routes (Razorpay, Coupons, Loyalty, Feedback, Digest) ─────
  // registerGrowthRoutes must come first: its specific /api/feedback/stats route
  // must be registered before registerPublicGrowthRoutes' /api/feedback/:token
  // wildcard, otherwise Express matches "stats" as a :token and returns 404.
  registerGrowthRoutes(app, broadcast);
  registerPublicGrowthRoutes(app);

  // ── WhatsApp driver control + agent inbox + Meta webhook ──────────────────
  registerWhatsAppRoutes(app);
  registerPublicWhatsAppRoutes(app);

  // ── Staff management + attendance routes ──────────────────────────────────
  registerStaffRoutes(app);

  // ── Settings ──────────────────────────────────────────────────────────────────

  app.get("/api/settings", requireAuth, async (req, res) => {
    try {
      const s = await getSettingsFresh();
      const role = (req.user as any)?.role;
      // Only the owner (admin) may see the device token (defense in depth).
      if (role !== "admin") {
        res.json({ ...s, attendanceDevice: { ...s.attendanceDevice, token: "" } });
      } else {
        res.json(s);
      }
    } catch (err) {
      // SettingsUnavailableError (503) means "never held real settings" — say so instead of 500.
      const status = typeof (err as any)?.status === "number" ? (err as any).status : 500;
      res.status(status).json({ message: status === 503 ? (err as Error).message : "Failed to fetch settings" });
    }
  });

  app.get("/api/realtime/config", requireAuth, (_req, res) => {
    const key = process.env.PUSHER_KEY;
    if (!key) {
      return res.json({
        driver: process.env.NODE_ENV !== "production" ? "local-ws" : "polling",
        enabled: false,
      });
    }
    res.json({
      driver: "pusher",
      enabled: true,
      key,
      cluster: process.env.PUSHER_CLUSTER || "ap2",
      channel: process.env.PUSHER_CHANNEL || "private-bagicha-pos",
    });
  });

  app.put("/api/settings", requireAdmin, async (req, res) => {
    try {
      const updated = await saveSettings(req.body);
      logAudit(req, "settings.update", "settings", null, { fields: Object.keys(req.body) });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  // ── Dashboard Stats ───────────────────────────────────────────────────────────

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // startDate/endDate query params are business-day date strings (YYYY-MM-DD, IST
  // calendar) — storage.getSalesChart resolves them via businessDayRange(). Sliced to
  // 10 chars defensively in case a full ISO timestamp is ever passed instead.
  app.get("/api/dashboard/sales-chart", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? (startDate as string).slice(0, 10) : undefined;
      const end   = endDate   ? (endDate   as string).slice(0, 10) : undefined;
      const data = await storage.getSalesChart(start, end);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales chart" });
    }
  });

  app.get("/api/dashboard/category-sales", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? (startDate as string).slice(0, 10) : undefined;
      const end   = endDate   ? (endDate   as string).slice(0, 10) : undefined;
      const data = await storage.getCategorySales(start, end);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch category sales" });
    }
  });

  app.get("/api/dashboard/top-items", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? (startDate as string).slice(0, 10) : undefined;
      const end   = endDate   ? (endDate   as string).slice(0, 10) : undefined;
      const data = await storage.getDashboardTopItems(8, start, end);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch top items" });
    }
  });

  // ── Categories ────────────────────────────────────────────────────────────────

  app.get("/api/categories", requireAuth, async (req, res) => {
    try {
      // ETag from a DB-side hash: an unchanged list costs 32 bytes, not every row (server/dbEtag.ts).
      await sendWithDbEtag(req, res, "categories", tableFingerprint("categories"), () => storage.getCategories());
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", requireManagerOrAdmin, async (req, res) => {
    try {
      const categoryData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(categoryData);
      broadcast({ type: "MENU_UPDATE" });
      res.json(category);
    } catch (error) {
      res.status(400).json({ error: "Invalid category data" });
    }
  });

  // Registered before /:id — Express matches routes in registration order, so a literal path
  // (like /reorder) registered AFTER a param path (/:id) is unreachable; it was previously being
  // swallowed by /:id (parseInt("reorder") -> NaN), silently breaking drag-to-reorder.
  app.put("/api/categories/reorder", requireManagerOrAdmin, async (req, res) => {
    try {
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds must be an array" });
      await storage.reorderCategories(orderedIds.map(Number));
      // An already-open POS/Menu session has no other trigger to refetch categories —
      // no polling on this query, refetchOnWindowFocus is off, and staleTime is 30s
      // with nothing to re-check it once elapsed. See MENU_UPDATE handling below.
      broadcast({ type: "MENU_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reorder categories" });
    }
  });

  app.put("/api/categories/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const updated = await storage.updateCategory(id, { name, description });
      broadcast({ type: "MENU_UPDATE" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update category" });
    }
  });

  app.delete("/api/categories/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCategory(id);
      broadcast({ type: "MENU_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  // ── Live Status ──────────────────────────────────────────────────────────────

  app.get("/api/live-status", requireAuth, async (req, res) => {
    try {
      const allTables = await storage.getTables();
      const runningTables = allTables.filter(t => t.status === "running").length;
      const freeTables    = allTables.filter(t => t.status === "free").length;

      // Business day (5am IST cutoff), matching Orders.tsx/Billing.tsx — a naive
      // local-midnight boundary disagreed with those pages for any order placed between
      // midnight and 5am IST, even on an IST-hosted server.
      const { start: dayStart, end: dayEnd } = businessDayRange(todayBusinessDate());

      // Polled by every open Tables screen (and refreshed on each order event), so nothing here may
      // read the whole order history: today's paid orders come back filtered in SQL with only their
      // payment columns, and the two all-time figures (active count, outstanding dues) come back as
      // one aggregated row. This route used to
      // SELECT every order on each poll, which alone was most of the database's egress.
      //
      // Counted on the day the money was RECEIVED (paid_at), not the day the order was billed: a
      // due from last week that a customer paid this morning is in today's drawer, and last week's
      // closed figures no longer change after the fact. Rows with no paid_at (older orders, Razorpay)
      // fall back to the billed day — identical to how they were always counted (collectedAt).
      const [paidToday, { activeOrders, dueAmount }] = await Promise.all([
        storage.getCollectedPaymentsBetween(dayStart, dayEnd), // only the payment columns
        storage.getOpenOrderStats(),
      ]);
      // Sales nets out any written-off shortfall so it equals what was actually collected,
      // i.e. exactly cashSales + upiSales (same rule as the Reports revenue figures).
      const todaySales = paidToday.reduce(
        (sum, o: any) => sum + parseFloat(o.totalAmount as string) - parseFloat(o.shortfallAmount ?? "0"), 0);

      // Per-method split from the entered legs (shared/paymentSplit.ts — the same rule
      // Reports → Payments uses, so the two can never disagree again). A Part (cash + UPI)
      // settle counts toward both; cash change handed back is removed from cash. Anything
      // that isn't UPI (a stray legacy method) stays in the cash figure, as it always has,
      // so Cash + UPI still adds up to everything collected.
      const collectedToday = summarizeCollected(paidToday as any[]);
      const upiSales = collectedToday.breakdown.upi?.amount ?? 0;
      const cashSales = collectedToday.totalPaid - upiSales;

      // dueAmount = every order settled in Due mode and not yet paid (served + pending),
      // regardless of day — a due is owed until collected, same set as the Pay-Later tab /
      // storage.getOpenTabsByCustomer. NOT part of todaySales (those are collected-only), so
      // the Tables pill shows it as its own segment, only when > 0.
      res.json({ runningTables, freeTables, activeOrders, todaySales, cashSales, upiSales, dueAmount });
    } catch (error) {
      console.error("GET /api/live-status error:", error);
      res.status(500).json({ error: "Failed to fetch live status" });
    }
  });

  // ── Tables ───────────────────────────────────────────────────────────────────

  app.get("/api/tables", requireAuth, async (req, res) => {
    try {
      const allTables = await storage.getTables();
      res.json(allTables);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tables" });
    }
  });

  app.post("/api/tables", requireManagerOrAdmin, async (req, res) => {
    try {
      const { name, capacity, section } = req.body;
      if (!name) return res.status(400).json({ error: "Table name is required" });
      const table = await storage.createTable({
        name: String(name).trim(),
        capacity: Number(capacity) || 4,
        section: String(section || "inner"),
      });
      forgetTableSections();
      res.json(table);
    } catch (error) {
      res.status(500).json({ error: "Failed to create table" });
    }
  });

  app.put("/api/tables/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, capacity, section } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = String(name).trim();
      if (capacity !== undefined) data.capacity = Number(capacity);
      if (section !== undefined) data.section = String(section);
      const table = await storage.updateTable(id, data);
      forgetTableSections();
      res.json(table);
    } catch (error) {
      res.status(500).json({ error: "Failed to update table" });
    }
  });

  app.delete("/api/tables/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // Server-side, not just the Tables page's cached check: a table holding an order can't go
      // (the order would lose its table and the Tables page its running card).
      const table = await storage.getTableById(id);
      if (!table) return res.status(404).json({ error: "Table not found" });
      if (table.currentOrderId || (table.status && table.status !== "free")) {
        return res.status(409).json({ error: "This table has an active order — settle or move it first.", code: "table_busy" });
      }
      await storage.deleteTable(id);
      forgetTableSections();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete table" });
    }
  });

  // Same effect as PUT /api/orders/:id/move-table (relocates an active order to another
  // table) — gated the same way.
  app.post("/api/tables/:id/shift", requireAuth, requireElevation("manager"), async (req, res) => {
    try {
      const fromTableId = parseInt(req.params.id);
      const { toTableId } = req.body;
      if (!toTableId) return res.status(400).json({ error: "toTableId is required" });
      const fromTable = await storage.getTableById(fromTableId);
      if (!fromTable || !fromTable.currentOrderId) return res.status(400).json({ error: "No active order on this table" });
      const toTable = await storage.getTableById(Number(toTableId));
      if (!toTable) return res.status(400).json({ error: "Target table not found" });
      if (toTable.status !== "free") return res.status(400).json({ error: "Target table is not free" });
      // Needed only for the audit-log metadata below — the shift itself never reads the
      // order row (only tables), which is exactly how this route ended up with no
      // logAudit call at all despite having "the same effect" as
      // PUT /api/orders/:id/move-table (which does log one) — see CLAUDE.md.
      const shiftedOrder = await storage.getOrderById(fromTable.currentOrderId);
      // Move order to new table. This is the authoritative write — order.tableId is
      // what other reads (order detail, bill routing) key off. The two table-status
      // flips below are best-effort display bookkeeping on top of it: previously
      // unguarded, so a failure on EITHER (a transient DB blip) reported
      // "Failed to shift table" even though the order had already genuinely moved,
      // and — since they ran sequentially with no try/catch — a failure on the first
      // update also silently skipped the second, potentially leaving BOTH tables
      // showing the wrong status (new table still "free", old table still "running").
      await storage.updateOrder(fromTable.currentOrderId, { tableId: Number(toTableId), tableNumber: toTable.name } as any);
      try {
        await storage.updateTableStatus(Number(toTableId), "running", fromTable.currentOrderId);
      } catch (tableErr) {
        console.error("[table] shift: destination table status update error (non-fatal):", tableErr);
      }
      try {
        await storage.freeTableIfHeldBy(Number(fromTableId), fromTable.currentOrderId);
      } catch (tableErr) {
        console.error("[table] shift: source table status update error (non-fatal):", tableErr);
      }
      // Reuses PUT /api/orders/:id/move-table's exact action string ("order.move_table")
      // and metadata shape — deliberate, so both routes' shifts count together under one
      // "Shifted" metric on Reports.tsx's KOT & Bill Activity tab, entityId is the
      // ORDER id (matching that route's convention), not the table id.
      await logAudit(req, "order.move_table", "order", fromTable.currentOrderId, {
        orderNumber: (shiftedOrder as any)?.orderNumber,
        fromTable: fromTable.name,
        toTable: toTable.name,
      });
      broadcast({ type: 'TABLE_UPDATE' });
      res.json({ success: true });
    } catch (error) {
      console.error("Shift table error:", error);
      res.status(500).json({ error: "Failed to shift table" });
    }
  });

  // Strips malformed rows rather than trusting the client shape — an inventoryId that
  // isn't a positive integer or a quantity that isn't a finite positive number would
  // otherwise corrupt downstream deduction math (see reconcileOrderInventory).
  function sanitizeInventoryLinks(raw: unknown): Array<{ inventoryId: number; quantity: number }> {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((l: any) => ({ inventoryId: Number(l?.inventoryId), quantity: Number(l?.quantity) }))
      .filter((l) => Number.isInteger(l.inventoryId) && l.inventoryId > 0 && Number.isFinite(l.quantity) && l.quantity > 0);
  }

  // users and staffMembers share the integer id space (see CLAUDE.md id-collision gotcha) —
  // resolve req.user into the correct column for stock-movement/audit attribution.
  function actorRefFromReq(req: any): { userId?: number; staffMemberId?: number } {
    const actor = req.user as any;
    if (!actor) return {};
    return actor._isStaffMember ? { staffMemberId: actor.id } : { userId: actor.id };
  }

  // ── Menu Items ────────────────────────────────────────────────────────────────

  app.get("/api/menu", requireAuth, async (req, res) => {
    try {
      // Fetched on every POS mount — ETag from a DB-side hash, so an unchanged menu is a 304
      // and its rows never leave the database (server/dbEtag.ts).
      const all = req.query.all === "true";
      await sendWithDbEtag(req, res, all ? "menu-all" : "menu", tableFingerprint("menu_items"),
        () => all ? storage.getAllMenuItems() : storage.getMenuItems());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch menu items" });
    }
  });

  app.get("/api/menu/sold-today", requireAuth, async (req, res) => {
    try {
      const soldToday = await storage.getSoldToday();
      console.log("[sold-today] result:", JSON.stringify(soldToday));
      res.json(soldToday);
    } catch (error) {
      console.error("[sold-today] error:", error);
      res.status(500).json({ error: "Failed to fetch sold today stats" });
    }
  });

  app.get("/api/menu/category/:categoryId", requireAuth, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const menuItems = await storage.getMenuItemsByCategory(categoryId);
      res.json(menuItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch menu items" });
    }
  });

  app.post("/api/menu", requireManagerOrAdmin, async (req, res) => {
    try {
      const b = req.body;
      if (!b.name || !b.categoryId) {
        return res.status(400).json({ error: "Name and category are required" });
      }
      const priceErr = menuPriceError(b.price ?? "0") ?? menuSizesError(Array.isArray(b.sizes) ? b.sizes : null);
      if (priceErr) return res.status(400).json({ error: priceErr });
      const addonsEnabled = b.addonsEnabled === true;
      const menuItem = await storage.createMenuItem({
        name: String(b.name).trim(),
        shortCode: b.shortCode ? String(b.shortCode).trim().toUpperCase() : null,
        description: b.description ? String(b.description).trim() : null,
        price: String(b.price ?? "0"),
        categoryId: Number(b.categoryId),
        isAvailable: b.isAvailable !== false,
        preparationTime: Number(b.preparationTime) || 15,
        sizes: Array.isArray(b.sizes) ? b.sizes : null,
        addonsEnabled,
        addons: addonsEnabled && Array.isArray(b.addons) ? b.addons : [],
        inventoryLinks: sanitizeInventoryLinks(b.inventoryLinks),
      } as any);
      broadcast({ type: "MENU_UPDATE" });
      res.json(menuItem);
    } catch (error) {
      console.error("Create menu item error:", error);
      res.status(500).json({ error: "Failed to create menu item" });
    }
  });

  app.put("/api/menu/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const b = req.body;
      const priceErr = (b.price !== undefined ? menuPriceError(b.price) : null) ?? (b.sizes !== undefined ? menuSizesError(b.sizes) : null);
      if (priceErr) return res.status(400).json({ error: priceErr });
      const updatePayload: any = {};
      if (b.name !== undefined)            updatePayload.name = String(b.name).trim();
      if (b.shortCode !== undefined)       updatePayload.shortCode = b.shortCode ? String(b.shortCode).trim().toUpperCase() : null;
      if (b.description !== undefined)     updatePayload.description = b.description ? String(b.description).trim() : null;
      if (b.price !== undefined)           updatePayload.price = String(b.price);
      if (b.categoryId !== undefined)      updatePayload.categoryId = Number(b.categoryId);
      if (b.isAvailable !== undefined)     updatePayload.isAvailable = b.isAvailable !== false;
      if (b.preparationTime !== undefined) updatePayload.preparationTime = Number(b.preparationTime) || 15;
      // Only what was sent: an edit that doesn't mention sizes/add-ons (a description fix) used to
      // null the sizes and clear the add-ons of the item.
      if (b.sizes !== undefined)           updatePayload.sizes = Array.isArray(b.sizes) ? b.sizes : null;
      if (b.addonsEnabled !== undefined)   updatePayload.addonsEnabled = b.addonsEnabled === true;
      if (b.addonsEnabled !== undefined || b.addons !== undefined) {
        updatePayload.addons = b.addonsEnabled === true && Array.isArray(b.addons) ? b.addons : [];
      }
      if (b.inventoryLinks !== undefined) updatePayload.inventoryLinks = sanitizeInventoryLinks(b.inventoryLinks);
      const menuItem = await storage.updateMenuItem(id, updatePayload);
      broadcast({ type: "MENU_UPDATE" });
      res.json(menuItem);
    } catch (error) {
      console.error("Update menu item error:", error);
      res.status(500).json({ error: "Failed to update menu item" });
    }
  });

  app.delete("/api/menu/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteMenuItem(id);
      broadcast({ type: "MENU_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete menu item" });
    }
  });

  // Bulk update menu items
  app.post("/api/menu/bulk-update", requireManagerOrAdmin, async (req, res) => {
    try {
      const { ids, updates } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids required" });
      const allowed: any = {};
      if (updates.isAvailable !== undefined) allowed.isAvailable = Boolean(updates.isAvailable);
      if (updates.categoryId !== undefined) allowed.categoryId = Number(updates.categoryId);
      if (updates.price !== undefined) {
        const e = menuPriceError(updates.price);
        if (e) return res.status(400).json({ error: e });
        allowed.price = String(updates.price);
      }
      if (Array.isArray(updates.sizes)) {
        const e = menuSizesError(updates.sizes);
        if (e) return res.status(400).json({ error: e });
      }
      // A size-priced item's actual sale price comes from sizes[].price, never the base
      // `price` column (see shared/orderPricing.ts's floor logic) — bulk price updates
      // used to only ever send `price`, so they silently no-op for every sized item
      // while still reporting success. Menu.tsx now sends adjusted sizes for those.
      if (Array.isArray(updates.sizes)) {
        allowed.sizes = updates.sizes
          .filter((s: any) => s && typeof s.size === "string" && s.size.trim() && !isNaN(Number(s.price)))
          .map((s: any) => ({ size: String(s.size).trim(), price: Number(s.price), stockMultiplier: s.stockMultiplier != null ? Number(s.stockMultiplier) : undefined }));
      }
      if (updates.addonsEnabled !== undefined) allowed.addonsEnabled = Boolean(updates.addonsEnabled);
      if (Array.isArray(updates.addons)) {
        allowed.addons = updates.addons
          .filter((a: any) => a && typeof a.name === "string" && a.name.trim() && !isNaN(Number(a.price)))
          .map((a: any) => ({ name: String(a.name).trim(), price: Number(a.price) }));
      }
      await storage.bulkUpdateMenuItems(ids.map(Number), allowed);
      broadcast({ type: "MENU_UPDATE" });
      res.json({ success: true, updated: ids.length });
    } catch (error) {
      console.error("Bulk update error:", error);
      res.status(500).json({ error: "Failed to bulk update menu items" });
    }
  });

  // Bulk delete menu items
  app.post("/api/menu/bulk-delete", requireManagerOrAdmin, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids required" });
      await storage.bulkDeleteMenuItems(ids.map(Number));
      broadcast({ type: "MENU_UPDATE" });
      res.json({ success: true, deleted: ids.length });
    } catch (error) {
      console.error("Bulk delete error:", error);
      res.status(500).json({ error: "Failed to bulk delete menu items" });
    }
  });

  // ── Inventory ─────────────────────────────────────────────────────────────────

  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      const inventory = await storage.getInventory();
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch inventory" });
    }
  });

  app.get("/api/inventory/low-stock", requireAuth, async (req, res) => {
    try {
      const lowStockItems = await storage.getLowStockItems();
      res.json(lowStockItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch low stock items" });
    }
  });

  // Distinct from low-stock: a negative balance means the count is already known-wrong
  // (an oversold order was allowed rather than blocked — see reconcileOrderInventory)
  // and needs a physical recount, not just a reorder.
  app.get("/api/inventory/negative-stock", requireAuth, async (req, res) => {
    try {
      const negativeStockItems = await storage.getNegativeStockItems();
      res.json(negativeStockItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch negative stock items" });
    }
  });

  app.post("/api/inventory", requireManagerOrAdmin, async (req, res) => {
    try {
      const inventoryData = insertInventorySchema.parse(req.body);
      const inventory = await storage.createInventoryItem(inventoryData);
      res.json(inventory);
    } catch (error) {
      res.status(400).json({ error: "Invalid inventory data" });
    }
  });

  app.put("/api/inventory/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const inventoryData = insertInventorySchema.partial().parse(req.body);
      const inventory = await storage.updateInventoryItem(id, inventoryData, actorRefFromReq(req));
      res.json(inventory);
    } catch (error) {
      res.status(400).json({ error: "Invalid inventory data" });
    }
  });

  app.delete("/api/inventory/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteInventoryItem(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete inventory item" });
    }
  });

  // ── Inventory Categories ─────────────────────────────────────────────────────

  app.get("/api/inventory-categories", requireAuth, async (req, res) => {
    try {
      const inventoryCategories = await storage.getInventoryCategories();
      res.json(inventoryCategories);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch inventory categories" });
    }
  });

  app.post("/api/inventory-categories", requireManagerOrAdmin, async (req, res) => {
    try {
      const categoryData = insertInventoryCategorySchema.parse(req.body);
      const category = await storage.createInventoryCategory(categoryData);
      res.json(category);
    } catch (error) {
      res.status(400).json({ error: "Invalid category data" });
    }
  });

  // Registered before /:id — a literal path after a param path is unreachable in Express (see the
  // /api/categories/reorder bug fixed below in this same file).
  app.put("/api/inventory-categories/reorder", requireManagerOrAdmin, async (req, res) => {
    try {
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds must be an array" });
      await storage.reorderInventoryCategories(orderedIds.map(Number));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reorder inventory categories" });
    }
  });

  app.put("/api/inventory-categories/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const updated = await storage.updateInventoryCategory(id, { name, description });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update inventory category" });
    }
  });

  app.delete("/api/inventory-categories/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteInventoryCategory(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete inventory category" });
    }
  });

  // ── Orders ────────────────────────────────────────────────────────────────────

  app.get("/api/orders", requireAuth, async (req, res) => {
    try {
      // All filters combine and are applied in SQL (storage.findOrders). Either date bound alone
      // is valid (endDate only = "everything before X"). open=true = not served/cancelled;
      // unpaid=true = payment_status <> 'paid'; updatedSince = rows changed at/after that instant
      // (incremental sync of an already-loaded list, see client/src/lib/orderHistorySync.ts). With no
      // filter at all this returns the whole order history — keep that for explicit "All Dates"
      // loads only, never for a poll.
      //
      // ETag = md5 of exactly these rows, computed in Postgres (server/dbEtag.ts): a poll of an
      // unchanged list (the Orders day view, Live View, even an old client re-asking for the whole
      // history) is a 304 and the rows never leave the database. Browsers/Electron send
      // If-None-Match on their own.
      const { status, startDate, endDate, open, unpaid, updatedSince } = req.query;
      const query = storage.findOrdersQuery({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        status: status ? String(status) : undefined,
        open: open === "true",
        unpaid: unpaid === "true",
        updatedSince: updatedSince ? new Date(updatedSince as string) : undefined,
      });
      await sendWithDbEtag(req, res, "orders", queryFingerprint(query), () => query);
    } catch (error) {
      // This swallowed the real exception with no server-side trace — a genuine schema
      // drift (orders.subtotal_amount/container_charge existing in shared/schema.ts but
      // missing from the live DB until its migration was actually run) surfaced as an
      // opaque "Failed to fetch orders" with nothing in the logs to diagnose it from.
      console.error("GET /api/orders error:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Distinct past customers ({ name, phone }) for the POS customer autocomplete (must come
  // before /:id). The POS used to download every order just to build this list.
  app.get("/api/orders/customers", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getCustomerDirectory());
    } catch (error) {
      console.error("GET /api/orders/customers error:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  // Slim rows for every order that names a customer — the Customers page builds its profiles from
  // these (must come before /:id). It used to download every column of every order.
  app.get("/api/orders/customer-history", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getCustomerOrderHistory());
    } catch (error) {
      console.error("GET /api/orders/customer-history error:", error);
      res.status(500).json({ error: "Failed to fetch customer history" });
    }
  });

  // Get held orders (must come before /:id route)
  app.get("/api/orders/hold", requireAuth, async (req, res) => {
    try {
      const orders = await storage.getOrdersByStatus("hold");
      const withItems = await Promise.all(
        orders.map(async (o) => {
          const items = await storage.getOrderItems(o.id);
          return { ...o, items };
        })
      );
      res.json(withItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch held orders" });
    }
  });

  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      const rawItems = await storage.getOrderItems(id);
      // Names for lines without a stored one: ONE query for just id+name (it was one full-row
      // SELECT per menu item, on every POS reopen and after every KOT print).
      const menuRows = await storage.getMenuRowsForOrder(rawItems.map((i: any) => i.menuItemId));
      const menuNameMap: Record<number, string> = {};
      for (const m of menuRows) menuNameMap[m.id] = m.name;
      const items = rawItems.map((item: any) => ({
        ...item,
        name: item.name || menuNameMap[item.menuItemId] || "Deleted Item",
      }));
      res.json({ ...order, items });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  app.post("/api/orders", requireAuth, requestKeys, async (req, res) => {
    // Inventory reconciliation runs ALONGSIDE the print (see below); every exit after it has
    // started waits for it, so nothing is left running once the response is sent.
    let inventoryDone: Promise<void> = Promise.resolve();
    try {
      // `print`/`auto`/`markBilled` are print directives for the step AFTER the save — they must
      // never reach createOrderWithItems as order columns.
      const { items, print: _print, auto: _auto, markBilled: _markBilled, ...orderInfo } = req.body;
      const lineItems = Array.isArray(items) ? items : [];
      // A table holds one running order. Creating a second one (two phones opening the same free
      // table, or a stale Tables page) silently re-pointed the table at the new order and left the
      // first one open with nowhere to reach it from — billed by nobody.
      if (orderInfo.tableId) {
        const table = await storage.getTableById(Number(orderInfo.tableId));
        if (table?.currentOrderId) {
          const current = await storage.getOrderById(table.currentOrderId);
          if (current && current.status !== "cancelled" && current.paymentStatus !== "paid" && current.status !== "hold") {
            return res.status(409).json({
              error: `${table.name ?? "This table"} already has an open order (#${current.id}). Open it from the Tables page instead.`,
              code: "table_busy",
              orderId: current.id,
            });
          }
        }
      }
      // Print instrumentation exists ONLY when a print was requested — a plain save keeps its
      // exact pre-existing response (no Server-Timing header, no [print-perf] log line).
      const printReq = parseSavePrintRequest(req.body);
      const timer = printReq.mode ? createStageTimer() : null;
      if (timer) instrumentJson(res, timer, `save+${printReq.mode} (new order)`);

      // ONE read of the menu rows this order needs — pricing, the plate-cost snapshot, the stock
      // reconcile and the KOT's names/categories all use it (each used to SELECT * the same rows
      // itself) — and, alongside it, the costs of just the ingredients those items link to.
      // Junk ids never reach Postgres (getMenuRowsForOrder drops them), so a bad line is the
      // pricing step's 400 below, never a cast-error 500.
      const menuIds = lineItems.map((item: any) => Number(item.menuItemId));
      const [menuRows, ingredientCosts] = await Promise.all([
        storage.getMenuRowsForOrder(menuIds),
        storage.getIngredientCostsForMenuItems(menuIds),
      ]);

      // Recompute all money server-side from DB prices — never trust client totals.
      // This is the ONLY genuine "invalid order data" case (unknown item / bad qty);
      // it reports the real reason instead of a blanket message. Everything below is
      // a server fault and must surface as 5xx — mislabelling DB/counter failures as
      // 400 "Invalid order data" is what hid the orderNumber collision bug.
      let priced: PricedOrder;
      try {
        priced = priceOrderWithMenu(lineItems, menuRows, orderInfo.discountAmount, orderInfo.containerCharge, orderInfo.deliveryCharge);
      } catch (pricingErr) {
        // A genuinely bad line (unknown item / qty) is a 400. SettingsUnavailableError carries
        // its own status (503): that is a server condition, not a bad order — staff just retry.
        const pricingStatus = typeof (pricingErr as any)?.status === "number" ? (pricingErr as any).status : 400;
        console.warn("[order] rejected line items / pricing unavailable:", pricingErr);
        return res.status(pricingStatus).json({
          error: pricingErr instanceof Error ? pricingErr.message : "Invalid order data",
        });
      }

      // Applying a discount is a privileged action; a bare staff session may not.
      if (priced.discount > 0 && !hasElevation(req, "manager")) {
        return res.status(403).json({ error: "Manager approval required to apply a discount" });
      }

      // Order items with server-validated unit prices. unitCost is a snapshot of the
      // plate cost AT SALE TIME (shared/menuCost.ts) — null when no full recipe cost is known,
      // never a fabricated 0. Pure: computed from the reads above, no DB work.
      const menuById = new Map(menuRows.map((m) => [m.id, m]));
      const costResults = computeLineCosts(
        lineItems.map((item: any) => ({ menuItemId: Number(item.menuItemId), size: item.size || null })),
        menuById,
        ingredientCosts,
      );

      // Both numbers are only taken once the order is known to be valid. Each is one atomic
      // UPDATE of the settings row; issuing them together saves a round trip (Postgres queues the
      // second behind the first's row lock).
      const [billNo, kotNo] = await Promise.all([incrementBillCounter(), incrementKotCounter()]);
      const orderNumber = `ORD${String(billNo).padStart(4, "0")}`;
      const actor = req.user as any;
      // Staff-member sessions ({ id, _isStaffMember }) share the integer id space with
      // users, so attribute to the right column (see CLAUDE.md id-collision gotcha).
      const isStaffMemberActor = !!actor?._isStaffMember;

      const itemsToInsert = lineItems.map((item: any, idx: number) => {
        const costResult = costResults[idx];
        return {
          menuItemId: Number(item.menuItemId),
          name: item.name ?? null,
          quantity: Number(item.quantity),
          price: String(priced.lines[idx].unitPrice),
          // orderItems has no addons column — fold addon names into the same free-text
          // field the KOT/bill "showAddons" line already reads (see
          // shared/orderItemText.ts), or they're permanently lost the moment this row
          // is written; this used to only merge into the transient kotItems array below,
          // which nothing ever reads back.
          specialInstructions: buildSpecialInstructions(item.specialInstructions, item.addons),
          size: item.size || null,
          serviceMode: item.serviceMode || null,
          parcelLeftover: item.parcelLeftover ?? false,
          unitCost: costResult && !costResult.hasIncompleteCost ? costResult.cost.toFixed(2) : null,
        };
      });

      // KOT ticket lines (kotTickets.items — what the Kitchen screen lists; the printed KOT
      // re-derives from orderItems via the print pipeline).
      const kotNumber = String(kotNo).padStart(3, "0");
      const kotItems = lineItems.map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        instructions: buildSpecialInstructions(item.specialInstructions, item.addons) || undefined,
        serviceMode: item.serviceMode || undefined,
      }));

      // Order + items + KOT are created atomically (see storage.createOrderWithItems).
      // ORDER_CREATE_FORCED_DEFAULTS spread LAST: paymentStatus/paidAmount/changeAmount/
      // paymentMethod/paymentBreakdown must never come from the client body — an order used
      // to be creatable already marked "paid" by simply including that field in orderInfo.
      // Real payment state is only ever set by POST /api/orders/:id/payment (settlement).
      const created = await storage.createOrderWithItems(
        {
          ...orderInfo,
          orderNumber,
          totalAmount: priced.total.toFixed(2),
          taxAmount: priced.tax.toFixed(2),
          discountAmount: priced.discount.toFixed(2),
          subtotalAmount: priced.subtotal.toFixed(2),
          containerCharge: priced.containerCharge.toFixed(2),
          deliveryCharge: priced.deliveryCharge.toFixed(2),
          createdBy: isStaffMemberActor ? null : (actor?.id ?? null),
          createdByStaffMemberId: isStaffMemberActor ? (actor?.id ?? null) : null,
          createdByName: actor?.username ?? null,
          ...ORDER_CREATE_FORCED_DEFAULTS,
        },
        itemsToInsert,
        { kotNumber, items: kotItems as any },
      );
      const order = created.order;

      // A discount applied at order-creation time is the same class of deviation as one
      // applied later via an edit — see the identical logAudit call in
      // PUT /api/orders/:id/items. Plain order creation itself stays unlogged (it's the
      // baseline, not a post-generation edit — logging every order would swamp the trail).
      // Awaited before the response (with the stock reconcile), never left running after it:
      // on Vercel a promise still pending once the response is sent can be frozen and lost.
      const audits: Array<Promise<void>> = [];
      if (priced.discount > 0) {
        audits.push(logAudit(req, "order.discount_applied", "order", order.id, {
          discountBefore: 0,
          discountAfter: priced.discount,
        }));
      }

      // Deduct inventory based on inventoryLinks for each menu item. Non-fatal at this
      // layer (the order already committed) — reconcileOrderInventory's own transaction
      // means a failure here can't leave a half-deducted state, only a fully-skipped one.
      // Started, not awaited: stock has nothing to do with the KOT/bill, so it runs alongside
      // the print instead of in front of it. Awaited before every response.
      if (lineItems.length > 0) {
        inventoryDone = storage
          .reconcileOrderInventory(
            order.id,
            lineItems.map((i: any) => ({ menuItemId: Number(i.menuItemId), quantity: Number(i.quantity), size: i.size || null })),
            isStaffMemberActor ? { staffMemberId: actor?.id } : { userId: actor?.id },
            menuRows,
          )
          .catch((invErr) => console.error("[order] inventory reconciliation error (non-fatal):", invErr));
      }
      const settled = () => Promise.all([inventoryDone, ...audits]);

      // Update table status if dine-in. Non-fatal, same reasoning as the inventory
      // reconciliation above: the order is ALREADY committed by this point
      // (createOrderWithItems's transaction), so a failure here must not turn a
      // successful order creation into an error response — that used to make the
      // client believe the order was never created, inviting a retry that creates a
      // genuine DUPLICATE order (double KOT to the kitchen, double inventory
      // deduction) for the exact same table, on top of leaving that table's status/
      // currentOrderId stale (still showing "free" despite a real order pointing at it).
      if (orderInfo.tableId) {
        try {
          await storage.updateTableStatus(Number(orderInfo.tableId), "running", order.id);
          broadcast({ type: 'TABLE_UPDATE' });
        } catch (tableErr) {
          console.error("[order] table status update error (non-fatal):", tableErr);
        }
      }
      // The order row only — the raw client items array could push the event past Pusher's ~10 KB
      // limit (rejected = no live update anywhere), and no screen reads it.
      broadcast({ type: 'NEW_ORDER', order });

      // ── CRM: log ORDER_PLACED event + update segmentation (fire-and-forget) ──
      const crmKey = (order.customerPhone?.trim() || order.customerName?.trim());
      if (crmKey) {
        const crmName = order.customerName ?? crmKey;
        logOrderPlaced(
          crmKey, crmName, order.customerPhone,
          order.id, order.orderNumber, parseFloat(String(order.totalAmount))
        ).catch(e => console.warn("[CRM] logOrderPlaced failed:", e));

        runSegmentationForCustomer(crmKey, crmName, order.customerPhone)
          .catch(e => console.warn("[CRM] segmentation failed:", e));

        // NOTE: customer-facing messages (welcome / returning / due reminder) are
        // NOT sent here. They fire at bill SETTLEMENT — see POST /api/orders/:id/payment.
      }

      // One request per tap: when the client asked for a print, run it NOW — after the save has
      // committed — and return its result on the same response. runPrintStep never rejects: a
      // print failure comes back as `print.error`, so the committed order above stays a 200.
      // It gets the rows this save just committed, so it reads nothing back.
      if (printReq.mode && timer) {
        timer.add("save", timer.totalMs());
        const print = await runPrintStep({
          req,
          orderId: order.id,
          order,
          snapshot: savedOrderSnapshot(order, created.items, menuRows, [created.kotTicket]),
          mode: printReq.mode,
          auto: printReq.auto,
          markBilled: printReq.markBilled,
          timer,
        });
        await settled();
        return res.json({ ...order, print });
      }
      await settled();
      res.json(order);
    } catch (error) {
      console.error("Create order error:", error);
      await inventoryDone;
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  app.put("/api/orders/:id/items", requireAuth, requestKeys, async (req, res) => {
    // Same as POST /api/orders: inventory runs alongside the print and every exit waits for it.
    let inventoryDone: Promise<void> = Promise.resolve();
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid order id" });
      const { items, discountAmount, containerCharge, deliveryCharge, customerName, customerPhone } = req.body;
      // Reject BEFORE any pricing/DB work: a missing/non-array `items` must never be read as
      // "clear the order" (it used to replace the order's items with nothing, commit, then 500).
      // An intentional clear sends `items: []`, which is still allowed.
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "items must be an array" });
      }
      const lineItems = items;
      // Same as POST /api/orders: instrumentation only when a print was requested.
      const printReq = parseSavePrintRequest(req.body);
      const timer = printReq.mode ? createStageTimer() : null;
      if (timer) instrumentJson(res, timer, `save+${printReq.mode} order=${id}`);

      // Every read this save needs, at once (one round trip): the menu rows (pricing, plate cost,
      // stock, the KOT's names/categories — read once, see POST /api/orders), the linked
      // ingredients' costs, the order as it is BEFORE this save (items + row — for the
      // editability check, the no-op check, the kitchen ticket, the cancel guard and the
      // before/after audit) and, only when a print follows, the order's KOT numbers.
      const menuIds = lineItems.map((item: any) => Number(item.menuItemId));
      const [menuRows, ingredientCosts, existingItems, existingOrderRow, existingTickets] = await Promise.all([
        storage.getMenuRowsForOrder(menuIds),
        storage.getIngredientCostsForMenuItems(menuIds),
        storage.getOrderItems(id),
        storage.getOrderById(id),
        printReq.mode ? storage.getKotTicketNumbers(id) : Promise.resolve([] as Array<{ kotNumber: string }>),
      ]);

      // A missing order (deleted by a merge) or a cancelled one is never written to — saving to
      // one used to insert orphan order_items, deduct real stock for a ghost order and put a
      // ticket on the Kitchen screen. (A settled order is checked below, once we know whether
      // this save changes anything.)
      const gone = orderEditBlock(existingOrderRow, false);
      if (gone || !existingOrderRow) {
        return res.status(gone?.status ?? 404).json({ error: gone?.error ?? "Order not found", code: gone?.code ?? "not_found" });
      }

      // Recompute all money server-side from DB prices — never trust client totals.
      // Same shape as POST /api/orders: a genuine pricing rejection (unknown item /
      // bad qty / bad open-item price) is a client-data problem, not a server fault —
      // report it as 400 with the real reason instead of falling through to the
      // generic 500 below.
      let priced: PricedOrder;
      try {
        priced = priceOrderWithMenu(lineItems, menuRows, discountAmount, containerCharge, deliveryCharge);
      } catch (pricingErr) {
        // A genuinely bad line (unknown item / qty) is a 400. SettingsUnavailableError carries
        // its own status (503): that is a server condition, not a bad order — staff just retry.
        const pricingStatus = typeof (pricingErr as any)?.status === "number" ? (pricingErr as any).status : 400;
        console.warn("[order] rejected line items / pricing unavailable:", pricingErr);
        return res.status(pricingStatus).json({
          error: pricingErr instanceof Error ? pricingErr.message : "Invalid order data",
        });
      }

      // Replace all order items with server-validated unit prices. unitCost is a snapshot of the
      // plate cost AT SALE TIME (shared/menuCost.ts) — null when no full recipe cost is known,
      // never a fabricated 0. Pure: computed from the reads above.
      const menuById = new Map(menuRows.map((m) => [m.id, m]));
      const editCostResults = computeLineCosts(
        lineItems.map((item: any) => ({ menuItemId: Number(item.menuItemId), size: item.size || null })),
        menuById,
        ingredientCosts,
      );
      const itemsToInsert = lineItems.map((item: any, idx: number) => {
        const costResult = editCostResults[idx];
        return {
          menuItemId: Number(item.menuItemId),
          name: item.name ?? null,
          quantity: Number(item.quantity),
          price: String(priced.lines[idx].unitPrice),
          // Same fold as POST /api/orders — this route had NO addon awareness at all
          // (not even for the transient kotItems below), so any item added or edited
          // via a running-table edit lost its addon selection on the printed KOT/bill
          // from the very first print, not just on reprint.
          specialInstructions: buildSpecialInstructions(item.specialInstructions, item.addons),
          size: item.size || null,
          serviceMode: item.serviceMode || null,
          parcelLeftover: item.parcelLeftover ?? false,
          unitCost: costResult && !costResult.hasIncompleteCost ? costResult.cost.toFixed(2) : null,
        };
      });
      const totals = {
        totalAmount: priced.total.toFixed(2),
        taxAmount: priced.tax.toFixed(2),
        discountAmount: priced.discount.toFixed(2),
        subtotalAmount: priced.subtotal.toFixed(2),
        containerCharge: priced.containerCharge.toFixed(2),
        deliveryCharge: priced.deliveryCharge.toFixed(2),
      };

      // Unchanged cart (Settle right after a Bill, a reprint, the Auto-KOT timer re-sending what
      // is already saved): nothing to write. It used to delete and reinsert every item, re-run
      // the stock reconcile (~5 round trips) and the audit diff each time — all in front of the
      // payment on every Settle. The existing rows stay (with their original sale-time plate
      // cost); the print below still runs, from those rows.
      const noop = isNoopItemsSave({
        existingLines: existingItems as any,
        nextLines: itemsToInsert as any,
        existingOrder: existingOrderRow as any,
        nextMoney: totals,
        customerName,
        customerPhone,
      });
      // A settled order may be reprinted (the no-op above) but never changed.
      const settledBlock = orderEditBlock(existingOrderRow, !noop);
      if (settledBlock) {
        return res.status(settledBlock.status).json({ error: settledBlock.error, code: settledBlock.code });
      }

      if (noop) {
        if (!printReq.mode || !timer) return res.json(existingOrderRow);
        timer.add("save", timer.totalMs());
        const print = await runPrintStep({
          req,
          orderId: id,
          order: existingOrderRow,
          snapshot: savedOrderSnapshot(existingOrderRow, existingItems, menuRows, existingTickets),
          mode: printReq.mode,
          auto: printReq.auto,
          markBilled: printReq.markBilled,
          timer,
        });
        return res.json({ ...existingOrderRow, print });
      }

      // Applying a discount is a privileged action; a bare staff session may not. "Applying" = more
      // than the rate already approved on this order (shared/orderItemsSave.ts): the POS discount is
      // a percentage, so adding a dish to an approved-10% table raises the rupee amount without
      // anyone applying anything new — that used to 403 a staff session 90 s after the approval.
      const before = deriveBillTotals(existingOrderRow as any);
      if (
        discountNeedsApproval({
          discountAfter: priced.discount,
          subtotalAfter: priced.subtotal,
          discountBefore: before.discount,
          subtotalBefore: before.subtotal,
        }) &&
        !hasElevation(req, "manager")
      ) {
        return res.status(403).json({ error: "Manager approval required to apply a discount" });
      }

      // ── Per-item KOT-cancellation guard ──────────────────────────────────────
      // Deliberately compares against existingItems (this order's PERSISTED state
      // immediately before this save), NOT orders.lastKotSnapshot. Found live: this
      // route's own ticket-creation step below (kitchenTicketLines) creates a
      // kitchen-visible kot_tickets row for any item the FIRST time it's ever saved —
      // at order creation (storage.createOrderWithItems) or at the PUT that first adds
      // it — completely independent of whether anyone ever actually PRINTS via
      // /api/print/kot, which is the ONLY thing that writes lastKotSnapshot. A real
      // order was observed with 2 items visibly on the Kitchen KOT screen (kot_tickets
      // row existed) but lastKotSnapshot still null (no print had happened) — a
      // lastKotSnapshot-based check let the removal through with no guard at all, the
      // opposite of what this feature exists for. Since EVERY item ever persisted to
      // order_items has, by construction, already triggered a kitchen-visible ticket at
      // the moment it was first saved, "was this item in existingItems" is the strictly
      // correct signal — a superset of "was it in lastKotSnapshot," and correct even
      // when no printer is configured or Auto-KOT never fires. Reuses computeDelta
      // directly (shared/kotDelta.ts) so the exact same identity key and flip-netting
      // behavior (a pure dine-in<->parcel flip is never treated as a cancellation)
      // apply here for free — see shared/kotItemCancel.ts's own comment on why this
      // is a direct reuse, not a parallel diff (contrast with diffOrderLines below,
      // which deliberately isn't).
      const currentKotSnapshot: SnapshotItem[] = lineItems.map((item: any) => ({
        itemId: Number(item.menuItemId),
        name: item.name ?? "",
        quantity: Number(item.quantity),
        size: item.size || null,
        serviceMode: item.serviceMode || null,
      }));
      const existingKotSnapshot: SnapshotItem[] = existingItems.map((i: any) => ({
        itemId: i.menuItemId,
        name: i.name || "",
        quantity: Number(i.quantity),
        size: i.size ?? null,
        serviceMode: i.serviceMode ?? null,
      }));
      const droppedKotItems = computeDelta(currentKotSnapshot, existingKotSnapshot).cancelledItems;
      const cancelledKotItemsInput: CancelledKotItemInput[] =
        Array.isArray(req.body?.cancelledKotItems) ? req.body.cancelledKotItems : [];

      if (droppedKotItems.length > 0) {
        const missingReasons = findMissingKotCancelReasons(currentKotSnapshot, existingKotSnapshot, cancelledKotItemsInput);
        if (missingReasons.length > 0) {
          return res.status(400).json({
            error: `A cancellation reason is required for: ${missingReasons.map((m) => m.name).join(", ")}`,
            missingReasons: missingReasons.map((m) => ({ itemId: m.itemId, size: m.size, serviceMode: m.serviceMode, name: m.name })),
          });
        }
        if (!hasElevation(req, "manager")) {
          return res.status(403).json({ error: "Manager approval required to cancel an item already sent to the kitchen" });
        }
      }

      // The Kitchen-screen ticket for this save: new dishes, new sizes/modes of existing ones and
      // quantity increases (as the increment) — same rule as the printed KOT delta. It used to key
      // on menuItemId alone, so "1 → 3 naan" or "a Large next to the Regular" never reached the
      // screen (and the print then reused the previous ticket's KOT number).
      const ticketLines = kitchenTicketLines(lineItems, existingItems);
      // The KOT number is issued ALONGSIDE the replace transaction (independent rows), and the
      // ticket is inserted inside it — the counter and the ticket used to be two more round trips
      // after the commit, in front of the print. A number burnt by a failed save is a gap, the same
      // as POST /api/orders.
      const kotNumberPromise = ticketLines.length > 0
        ? incrementKotCounter().then((n) => String(n).padStart(3, "0"))
        : null;
      kotNumberPromise?.catch(() => {}); // awaited inside the transaction; never an unhandled rejection

      // Delete + reinsert + totals update (+ the ticket) in one transaction, and only while the
      // order is still editable at write time (storage.replaceOrderItems).
      let saved: Awaited<ReturnType<typeof storage.replaceOrderItems>>;
      try {
        saved = await storage.replaceOrderItems(id, itemsToInsert as any, {
          ...totals,
          ...(customerName !== undefined ? { customerName: customerName || null } : {}),
          ...(customerPhone !== undefined ? { customerPhone: customerPhone || null } : {}),
        } as any, kotNumberPromise ? { kotNumber: kotNumberPromise, items: ticketLines as any } : undefined);
      } catch (err) {
        if (!(err instanceof OrderNotEditableError)) throw err;
        // Settled / cancelled / merged away between our read and our write.
        const block = orderEditBlock(await storage.getOrderById(id), true);
        return res.status(block?.status ?? 409).json({
          error: block?.error ?? "This order changed while it was being saved — reopen it and try again.",
          code: block?.code ?? "conflict",
        });
      }
      const order = saved.order;

      // Bill-edit audit trail — the before/after half of CLAUDE.md's "immutable audit log"
      // invariant. Only reached when something changed (the no-op save returned above), so the
      // Auto-KOT timer's unchanged syncs never bury genuine edits. Awaited before the response
      // (alongside the stock reconcile): a promise still pending after the response is sent can be
      // frozen and lost on Vercel.
      const audits: Array<Promise<void>> = [];
      try {
        const beforeLines: AuditLine[] = existingItems.map((i: any) => ({
          menuItemId: i.menuItemId,
          name: i.name || "Item",
          size: i.size ?? null,
          serviceMode: i.serviceMode ?? null,
          quantity: Number(i.quantity),
          price: parseFloat(String(i.price)),
        }));
        const afterLines: AuditLine[] = itemsToInsert.map((i: any) => ({
          menuItemId: i.menuItemId,
          name: i.name || "Item",
          size: i.size ?? null,
          serviceMode: i.serviceMode ?? null,
          quantity: Number(i.quantity),
          price: parseFloat(String(i.price)),
        }));
        const diff = diffOrderLines(beforeLines, afterLines);

        const discountBefore = parseFloat(String((existingOrderRow as any)?.discountAmount ?? 0));
        // Compared at the 2 decimals the order row STORES: the unrounded priced total (690.795) vs the
        // stored 690.80 logged a spurious "Bill Modified" row on saves that changed no money.
        const r2 = (n: number) => Math.round(n * 100) / 100;
        const discountAfter = r2(priced.discount);
        const containerBefore = parseFloat(String((existingOrderRow as any)?.containerCharge ?? 0));
        const containerAfter = r2(priced.containerCharge);
        const deliveryBefore = parseFloat(String((existingOrderRow as any)?.deliveryCharge ?? 0));
        const deliveryAfter = r2(priced.deliveryCharge);
        const totalBefore = parseFloat(String((existingOrderRow as any)?.totalAmount ?? 0));
        const totalAfter = Number(priced.total.toFixed(2));
        const moneyChanged = discountBefore !== discountAfter || containerBefore !== containerAfter
          || deliveryBefore !== deliveryAfter || totalBefore !== totalAfter;

        if (!diff.isEmpty || moneyChanged) {
          audits.push(logAudit(req, "order.items_edit", "order", id, {
            added: diff.added.map((l) => ({ name: l.name, size: l.size, quantity: l.quantity })),
            removed: diff.removed.map((l) => ({ name: l.name, size: l.size, quantity: l.quantity })),
            changed: diff.changed,
            totalBefore,
            totalAfter,
            discountBefore,
            discountAfter,
            containerBefore,
            containerAfter,
            deliveryBefore,
            deliveryAfter,
          }));
        }
        // A discount is a deviation and worth its own independently-filterable row, not just
        // buried inside the item-edit payload above — same reasoning as order.write_off.
        if (discountBefore !== discountAfter) {
          audits.push(logAudit(req, "order.discount_applied", "order", id, { discountBefore, discountAfter }));
        }
      } catch (auditErr) {
        // Never let an audit-trail bug block a genuinely successful order edit.
        console.error("[order] items_edit audit error (non-fatal):", auditErr);
      }

      // One order.item_cancel row per item dropped since the last KOT — kept deliberately
      // distinct from order.cancel (whole-order cancellation, a different thing) and from
      // the aggregate order.items_edit above, so Reports.tsx's KOT & Bill Activity tab can
      // count it on its own (kotItemCancelled, not kotCancelled). Uses the server's own
      // persisted name/quantity (droppedKotItems), never the client-sent reason payload's
      // own itemId/size fields beyond the reason text itself — can't be spoofed.
      if (droppedKotItems.length > 0) {
        try {
          const reasonByKey = new Map<string, string>();
          for (const c of cancelledKotItemsInput) {
            const r = typeof c?.reason === "string" ? c.reason.trim() : "";
            if (r) reasonByKey.set(`${Number(c.itemId)}:${c.size ?? ""}:${c.serviceMode ?? ""}`, r);
          }
          for (const d of droppedKotItems) {
            audits.push(logAudit(req, "order.item_cancel", "order", id, {
              itemName: d.name,
              size: d.size,
              serviceMode: d.serviceMode,
              quantity: d.quantity,
              reason: reasonByKey.get(`${d.itemId}:${d.size ?? ""}:${d.serviceMode ?? ""}`) ?? "",
            }));
          }
        } catch (auditErr) {
          console.error("[order] item_cancel audit error (non-fatal):", auditErr);
        }
      }

      // Reconcile inventory to the new line items — this is what makes editing a running
      // table (adding/removing/re-quantifying items across rounds) actually touch stock;
      // previously this route had zero inventory code. Non-fatal: the order edit itself
      // already succeeded, so don't fail the request over a reconciliation hiccup.
      // Started, not awaited: it runs alongside the print instead of in front of it (stock has
      // nothing to do with the ticket); awaited before every response.
      inventoryDone = storage
        .reconcileOrderInventory(
          id,
          lineItems.map((i: any) => ({ menuItemId: Number(i.menuItemId), quantity: Number(i.quantity), size: i.size || null })),
          actorRefFromReq(req),
          menuRows,
        )
        .catch((invErr) => console.error("[order] inventory reconciliation error (non-fatal):", invErr));
      const settled = () => Promise.all([inventoryDone, ...audits]);

      if (saved.kotTicket) broadcast({ type: "KOT_UPDATE", action: "created" });
      broadcast({ type: "ORDER_UPDATE", order });
      // One request per tap — see the identical block in POST /api/orders. The ticket above is in
      // the snapshot, so the printed kotNumber is the one this save just created.
      if (printReq.mode && timer) {
        timer.add("save", timer.totalMs());
        const print = await runPrintStep({
          req,
          orderId: id,
          order,
          snapshot: savedOrderSnapshot(
            order,
            saved.items,
            menuRows,
            saved.kotTicket ? [...existingTickets, { kotNumber: saved.kotTicket.kotNumber }] : existingTickets,
          ),
          mode: printReq.mode,
          auto: printReq.auto,
          markBilled: printReq.markBilled,
          timer,
        });
        await settled();
        return res.json({ ...order, print });
      }
      await settled();
      res.json(order);
    } catch (error) {
      console.error("Update order items error:", error);
      await inventoryDone;
      res.status(500).json({ error: "Failed to update order items" });
    }
  });

  // Deliberately narrow: money/payment/identity fields are NOT settable here — see
  // shared/orderMutation.ts's orderUpdateAllowlist for why.
  app.put("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = orderUpdateAllowlist.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid order data" });
      const orderData = parsed.data;
      const existing = await storage.getOrderById(id);
      if (!existing) return res.status(404).json({ error: "Order not found", code: "not_found" });
      // Status is only a kitchen-progress label here — cancel, recall and settle each have their own
      // PIN-gated, audited route (shared/orderMutation.ts planStatusChange).
      if (orderData.status !== undefined) {
        const block = planStatusChange(existing as any, orderData.status as string);
        if (block) return res.status(block.status).json({ error: block.error, code: block.code });
      }
      const order = await storage.updateOrderIfState(id, orderData, {
        status: (existing as any).status,
        paymentStatus: (existing as any).paymentStatus,
      });
      if (!order) {
        return res.status(409).json({ error: "This order changed while you were editing it — refresh and try again.", code: "conflict" });
      }
      broadcast({ type: 'ORDER_UPDATE', order });
      res.json(order);
    } catch (error) {
      console.error("[order] PUT /api/orders/:id failed:", error);
      res.status(500).json({ error: "Failed to update order" });
    }
  });

  // Process payment for an order
  app.post("/api/orders/:id/payment", requireAuth, requestKeys, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const {
        paymentMethod,
        payments,
        notes,
        isDue: explicitDue,
        customerName,
        customerPhone,
        allowShortfall,
      } = req.body;

      const isDue = explicitDue || paymentMethod === "due";
      const isSplitPath = Boolean(payments && Array.isArray(payments));

      const existingOrder = await storage.getOrderById(id);
      if (!existingOrder) return res.status(404).json({ error: "Order not found" });
      // A cancelled order is never settled — that flipped it back to "served" + paid and into the
      // day's sales. (settleOrderIfUnpaid refuses it too; this gives the real reason.)
      if ((existingOrder as any).status === "cancelled") {
        return res.status(409).json({ error: "This order was cancelled — it can't be settled.", code: "cancelled" });
      }
      const orderTotal = parseFloat(String((existingOrder as any).totalAmount ?? 0));

      // A due settle on the rich payments[] path must always carry a reachable customer —
      // this is the path SettlementDialog's new Due mode uses, and an open tab with no name
      // or phone can never be chased for payment or shown as anything but "Walk-in" on the
      // Dues report. The legacy {paymentMethod:"due"} path (Billing.tsx's simpler dialog) is
      // deliberately exempt — CLAUDE.md documents that flow as relying on whatever the order
      // already has from creation, and Billing.tsx is out of scope for this change.
      if (isSplitPath && isDue) {
        const nameOk = (customerName ?? (existingOrder as any).customerName ?? "").trim().length > 0;
        const phoneOk = (customerPhone ?? (existingOrder as any).customerPhone ?? "").trim().length > 0;
        if (!nameOk || !phoneOk) {
          return res.status(400).json({ error: "Customer name and phone are required to mark an order as due" });
        }
      }

      let breakdown: Record<string, number> = {};
      let primaryMethod = "cash";

      if (isSplitPath) {
        // Rich split-payment path — amounts come from the entered breakdown. Cash and UPI only:
        // any other label was counted in Sales but in neither the Cash nor the UPI figure.
        if (payments.some((p: any) => Number(p?.amount) > 0 && p?.method !== "cash" && p?.method !== "upi")) {
          return res.status(400).json({ error: "Only Cash and UPI payments are accepted.", code: "bad_method" });
        }
        for (const p of payments) {
          if (Number(p.amount) > 0) {
            breakdown[p.method] = (breakdown[p.method] || 0) + Number(p.amount);
          }
        }
        const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
        primaryMethod = sorted[0]?.[0] ?? "cash";
      } else {
        // Legacy single-method path — a paid settle covers the full bill. No shortfall
        // concept exists here — Billing.tsx's own dialog never sends payments[], so it
        // can't reach the write-off branch below regardless.
        primaryMethod = paymentMethod || "cash";
        if (!["cash", "upi", "due", "other"].includes(primaryMethod)) {
          return res.status(400).json({ error: "Only Cash and UPI payments are accepted.", code: "bad_method" });
        }
        if (!isDue) breakdown = { [primaryMethod]: orderTotal };
      }

      // Paid amount, change, and shortfall are all derived server-side from the DB's own
      // orderTotal — never trusted from the client. See shared/settlement.ts for why this
      // is a shared function rather than a hand-rolled comparison on each side.
      const paidAmt = Object.values(breakdown).reduce((a, b) => a + b, 0);
      const changeDue = isDue ? 0 : Math.max(0, paidAmt - orderTotal);
      const gap = isDue ? 0 : Math.max(0, orderTotal - paidAmt);
      const isShort = gap > SETTLE_TOLERANCE;
      // Sub-tolerance gaps are rounding, not a write-off (shared/settlement.ts) — store 0.
      const shortfall = isShort ? gap : 0;

      if (isShort) {
        if (!isSplitPath || !allowShortfall) {
          // Same rejection as before this feature existed — a short settle is refused
          // outright unless the caller explicitly opted into writing off the gap.
          return res.status(400).json({
            error: `Amount paid (₹${paidAmt.toFixed(2)}) is less than the bill total (₹${orderTotal.toFixed(2)})`,
            paidAmt,
            orderTotal,
          });
        }
        // Writing off money is a deviation from the bill, same class of action as applying
        // a discount (routes.ts's priceOrder discount check above uses the identical guard)
        // — a bare staff session may not do this even with allowShortfall set client-side.
        if (!hasElevation(req, "manager")) {
          return res.status(403).json({ error: "Manager approval required to settle short and write off the balance" });
        }
        // A ₹0 "payment" is a comp, not a write-off — refuse it outright rather than let a
        // manager PIN silently turn into a free-meal path with no money changing hands at all.
        if (paidAmt <= 0) {
          return res.status(400).json({ error: "At least some payment must be collected to write off a shortfall" });
        }
      }

      const updateData: any = {
        paymentMethod: primaryMethod,
        paymentStatus: isDue ? "pending" : "paid",
        status: "served",
        paidAmount: String(paidAmt),
        changeAmount: String(changeDue),
        shortfallAmount: String(shortfall),
        paymentBreakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, String(v)])),
        // The day the money was received — drives the Tables card / Reports counting and the
        // "correct a payment" window. A due (isDue) collected nothing yet, so it gets no paid day.
        paidAt: isDue ? null : new Date(),
      };
      if (notes) updateData.notes = notes;
      if (customerName) updateData.customerName = customerName;
      if (customerPhone) updateData.customerPhone = customerPhone;

      // Conditional settle guards against a concurrent double-settlement: if another
      // request already flipped this order out of 'pending', this is a no-op — the
      // one-time side effects below are skipped, and (unlike before) the client is
      // told explicitly rather than getting a 200 that silently discards whatever
      // payment method THIS request tried to record. A double-tap on Settle, or a
      // retried request after a slow/timed-out first attempt, used to look like
      // success while quietly keeping the first attempt's (possibly different)
      // payment method — printing the bill would then show that stale method.
      const order = await storage.settleOrderIfUnpaid(id, updateData);
      if (!order) {
        return res.status(409).json({
          error: `Order already settled as ${(existingOrder as any).paymentMethod ?? "cash"} — this ${primaryMethod} payment was not recorded.`,
          alreadySettled: true,
          order: existingOrder,
        });
      }

      // Non-fatal: settleOrderIfUnpaid already committed the payment above — a failure
      // freeing the table must not turn a genuinely successful settlement into an error
      // response. That used to make staff believe the payment failed (risking a second
      // collection attempt from the customer) AND skip everything below this point
      // (loyalty points, CRM messages, feedback scheduling), since the thrown exception
      // propagated straight past them to the outer catch. The table just stays stuck
      // showing "running"/"billed" instead of "free" — a real but far smaller problem
      // than losing the payment record.
      const freeTable = async () => {
        if (!(order as any).tableId) return;
        try {
          await storage.freeTableIfHeldBy(Number((order as any).tableId), id);
          broadcast({ type: "TABLE_UPDATE" });
        } catch (tableErr) {
          console.error("[payment] table free error (non-fatal):", tableErr);
        }
      };

      // Non-fatal: the order is already settled above. If the kitchen KOT screen was
      // never used (or a ticket was left pending/in-progress), it would otherwise sit
      // in Active/Pending/Cooking forever even though the order is fully served.
      // Runs for BOTH full payment and Pay-Later/due, since `status` is set to
      // "served" unconditionally above — the food left the kitchen either way.
      const completeKots = async () => {
        try {
          await storage.completeKotTicketsForOrder(id);
        } catch (kotErr) {
          console.error("[payment] KOT auto-complete error (non-fatal):", kotErr);
        }
      };

      // Independent writes to different tables, each catching its own error — run them together
      // so the settle response waits one DB round trip here instead of two. The audit rows go in
      // the same batch and are AWAITED: written fire-and-forget right before res.json, a write-off
      // row could be lost when Vercel froze the function after the response — the one deviation
      // the accountability trail exists to show. logAudit never rejects.
      await Promise.all([
        freeTable(),
        completeKots(),
        logAudit(req, "order.payment", "order", id, {
          paymentMethod: primaryMethod,
          paymentStatus: isDue ? "pending" : "paid",
          paidAmount: paidAmt,
          changeAmount: changeDue,
          shortfallAmount: shortfall,
          paymentBreakdown: breakdown,
        }),
        // A separate, independently filterable audit entry for the write-off itself — the
        // whole point of a "deviation" control is that a manager can review just these, not
        // hunt for them inside every ordinary payment row.
        shortfall > 0
          ? logAudit(req, "order.write_off", "order", id, {
              orderTotal,
              paidAmount: paidAmt,
              shortfallAmount: shortfall,
            })
          : Promise.resolve(),
      ]);

      broadcast({ type: "ORDER_UPDATE", order });

      // Awaited (bounded) before the response: on Vercel work still running after res.json can be
      // frozen and lost — loyalty points, the settlement WhatsApp and the feedback request used to
      // be fire-and-forget here. Points and feedback are plain DB writes and are awaited fully;
      // the message (which may compose text with the AI) gets at most 1.5 s, then continues
      // best-effort, so Settle never waits on it for long. All never reject.
      const quiet = (label: string, p: Promise<unknown>) => p.catch((e: any) => console.warn(`[settle] ${label} failed:`, e));
      const bounded = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
      const key = (order as any).customerPhone?.trim() || (order as any).customerName?.trim();
      const after: Array<Promise<unknown>> = [];
      if (!isDue) {
        if (key) {
          after.push(quiet("loyalty earn", earnPointsForOrder(
            key,
            (order as any).customerName ?? key,
            id,
            parseFloat(String((order as any).totalAmount ?? 0)),
          )));
          // Settlement relationship message — welcome (new) / admin template (returning)
          after.push(bounded(quiet("settlement message",
            triggerSettlementMessage(key, (order as any).customerName ?? key, (order as any).customerPhone)), 1500));
        }
        after.push(quiet("feedback schedule", scheduleFeedbackForOrder(id)));
      } else if (key) {
        // Bill left unpaid → itemized due-bill reminder with the customer's order details
        after.push(bounded(quiet("due reminder",
          triggerDueBillMessage(id, (order as any).customerName ?? key, (order as any).customerPhone)), 1500));
      }
      await Promise.all(after);

      res.json(order);
    } catch (error) {
      console.error("Payment error:", error);
      res.status(500).json({ error: "Failed to process payment" });
    }
  });

  // ── Correct a settled order's payment METHOD (not its amount) ────────────────
  // Staff tap the wrong method more often than they mis-count money, and the mistake is
  // invisible until the cash book disagrees at closing. This re-labels cash ↔ upi (or fixes
  // a mistyped split) and nothing else: shared/paymentEdit.ts refuses any request whose
  // Cash + UPI doesn't equal what was already collected, so no amount can move through here.
  //
  // A manager/admin PIN must be typed EVERY time — requireFreshPin, not requireElevation. The
  // latter waves through any session whose own role is manager/admin, and the restaurant's
  // everyday login (rajbhaghel) is a manager account, so nobody using it would ever have been asked.
  // Deliberately NOT a re-settle — POST /api/orders/:id/payment fires loyalty
  // points, the customer WhatsApp message and feedback scheduling exactly once, and none of
  // that should re-fire because a label was corrected.
  app.post("/api/orders/:id/payment-method", requireAuth, requireFreshPin("manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid order id" });

      const existing = await storage.getOrderById(id);
      if (!existing) return res.status(404).json({ error: "Order not found" });

      const { cash, upi, reason } = req.body as { cash?: unknown; upi?: unknown; reason?: unknown };
      const plan = planPaymentEdit(
        existing as any,
        { cash: Number(cash), upi: Number(upi), reason: String(reason ?? "") },
        todayBusinessDate(),
      );
      if (!plan.ok) {
        return res.status(400).json({ error: plan.message, code: plan.code });
      }

      const updated = await storage.repaymentMethodIfUnchanged(
        id,
        {
          paymentMethod: plan.primaryMethod,
          paymentBreakdown: plan.breakdown,
          paidAmount: plan.paidAmount,
          changeAmount: plan.changeAmount,
        } as any,
        (existing as any).updatedAt,
      );
      if (!updated) {
        // Either someone else corrected it between our read and our write, or the row is no
        // longer paid. Re-reading is the only safe move — the plan's "before" is now stale.
        return res.status(409).json({
          error: "This order changed while you were editing it. Reopen it and try again.",
          code: "conflict",
        });
      }

      await logAudit(req, "order.payment_method_edit", "order", id, {
        orderNumber: (existing as any).orderNumber,
        beforeLabel: plan.before.label,
        afterLabel: plan.after.label,
        beforeCash: plan.before.cash,
        beforeUpi: plan.before.upi,
        afterCash: plan.after.cash,
        afterUpi: plan.after.upi,
        collectedTotal: plan.collectedTotal,
        reason: plan.reason,
        // Whose PIN approved it — distinct from the audit row's actor, who is just who was logged in.
        approvedBy: freshPinApprover(req),
      });

      broadcast({ type: "ORDER_UPDATE", order: updated });
      res.json(updated);
    } catch (error) {
      console.error("[payment-method] edit error:", error);
      res.status(500).json({ error: "Failed to update payment method" });
    }
  });

  // ── Settle a DUE (a customer paying their tab) from the Orders page ──────────
  // A due is served + unpaid (paymentStatus "pending"). Until now the only ways to clear one were
  // Reports → "Mark all paid" (whole customer, cash/UPI only, no PIN, no audit row) or re-running the
  // POS payment route. This settles ONE order by Cash / UPI / a Cash+UPI split with change and
  // settle-short handled by the same resolveSettlement the POS box uses (shared/dueSettlement.ts).
  //
  // Always PIN-gated (requireFreshPin: a logged-in admin/manager must still type a PIN) and audited
  // with WHO approved. Changes payment fields only — no table/KOT/loyalty/WhatsApp/feedback side
  // effects, which belong to a bill being paid at the table, not to an old tab being cleared.
  app.post("/api/orders/:id/settle-due", requireAuth, requireFreshPin("manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid order id" });

      const existing = await storage.getOrderById(id);
      if (!existing) return res.status(404).json({ error: "Order not found" });

      const { payments, allowShortfall } = req.body as { payments?: unknown; allowShortfall?: unknown };
      const plan = planDueSettlement(existing as any, {
        payments: Array.isArray(payments) ? (payments as any[]) : [],
        allowShortfall: allowShortfall === true,
      });
      if (!plan.ok) {
        // not_due is a state conflict (someone else already settled it), the rest are bad input.
        return res.status(plan.code === "not_due" ? 409 : 400).json({ error: plan.message, code: plan.code });
      }

      const updated = await storage.settleDueIfStillDue(
        id,
        {
          paymentMethod: plan.primaryMethod,
          paymentBreakdown: plan.breakdown,
          paidAmount: plan.paidAmount,
          changeAmount: plan.changeAmount,
          shortfallAmount: plan.shortfallAmount,
        } as any,
        (existing as any).updatedAt,
      );
      if (!updated) {
        // Settled/changed by someone else between our read and our write (or Reports' bulk "Mark all
        // paid" landed first). The plan was made against a stale row — re-reading is the only safe move.
        return res.status(409).json({
          error: "This order changed while you were settling it — it may already be paid. Reopen it and check.",
          code: "conflict",
        });
      }

      const approvedBy = freshPinApprover(req);
      await logAudit(req, "order.due_settled", "order", id, {
        orderNumber: (existing as any).orderNumber,
        customerName: (existing as any).customerName ?? null,
        orderTotal: plan.orderTotal,
        paidAmount: Number(plan.paidAmount),
        changeAmount: Number(plan.changeAmount),
        shortfallAmount: Number(plan.shortfallAmount),
        afterLabel: plan.label,
        paymentBreakdown: plan.breakdown,
        // The day it was billed — a due settled weeks later should be traceable back to its bill.
        billedAt: (existing as any).createdAt,
        approvedBy,
      });
      // Same convention as the POS payment route: any recorded shortfall gets its own, independently
      // filterable write-off row (Reports → KOT & Bill Activity counts these).
      if (Number(plan.shortfallAmount) > 0) {
        await logAudit(req, "order.write_off", "order", id, {
          orderTotal: plan.orderTotal,
          paidAmount: Number(plan.paidAmount),
          shortfallAmount: Number(plan.shortfallAmount),
          approvedBy,
        });
      }

      broadcast({ type: "ORDER_UPDATE", order: updated });
      res.json(updated);
    } catch (error) {
      console.error("[settle-due] error:", error);
      res.status(500).json({ error: "Failed to settle due" });
    }
  });

  // ── Due orders (paymentStatus = pending, status = served) ────────────────────
  app.get("/api/orders/due", requireAuth, async (req, res) => {
    try {
      res.json(await storage.findOrders({ due: true }));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch due orders" });
    }
  });

  // ── Dues / Pay-Later: open tabs grouped by customer (not date-bound) ─────────
  app.get("/api/reports/tabs", requireAuth, async (_req, res) => {
    try {
      const customers = await storage.getOpenTabsByCustomer();
      const totalOutstanding = customers.reduce((s, c) => s + c.totalDue, 0);
      const orderCount = customers.reduce((s, c) => s + c.orderCount, 0);
      res.json({ customers, totalOutstanding, customerCount: customers.length, orderCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch tabs" });
    }
  });

  // Send ONE consolidated WhatsApp e-bill for a customer's open tabs (driver auto; wa.me fallback).
  app.post("/api/dues/send-ebill", requireAuth, async (req, res) => {
    try {
      const { key } = req.body as { key?: string };
      if (!key) return res.status(400).json({ error: "key required" });
      const customers = await storage.getOpenTabsByCustomer();
      const cust = customers.find(c => c.key === key);
      if (!cust) return res.status(404).json({ error: "No open tabs for this customer" });
      if (!cust.phone) return res.status(400).json({ error: "Customer has no phone number on file" });

      const result = await sendConsolidatedEbill({
        name: cust.name, phone: cust.phone, orderIds: cust.orders.map(o => o.id), totalDue: cust.totalDue,
      });
      const digits = cust.phone.replace(/\D/g, "");
      const waPhone = digits.length === 10 ? `91${digits}` : digits;
      const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(result.message)}`;
      res.json({ ok: true, mode: result.mode, waUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to send e-bill" });
    }
  });

  // Mark ALL of a customer's open tabs paid (weekly/bulk settle).
  app.post("/api/dues/settle-customer", requireAuth, async (req, res) => {
    try {
      const { key, paymentMethod } = req.body as { key?: string; paymentMethod?: string };
      if (!key) return res.status(400).json({ error: "key required" });
      const settled = await storage.settleCustomerTabs(key, paymentMethod);
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ ok: true, settled });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to settle tabs" });
    }
  });

  // ── Payment method breakdown for a date range ────────────────────────────────
  app.get("/api/reports/payment-summary", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      // Business day (5am IST cutoff), matching Orders.tsx/Billing.tsx — the previous
      // `new Date(startDate)` here parsed a bare "YYYY-MM-DD" as UTC midnight, i.e.
      // 5:30am IST, so any order placed later that same IST day (the common case —
      // most orders happen in the afternoon/evening) fell outside the requested range's
      // upper bound and silently vanished from "today"'s report.
      const start = businessDayRange((startDate as string)?.slice(0, 10) ?? todayBusinessDate()).start;
      const end = businessDayRange((endDate as string)?.slice(0, 10) ?? todayBusinessDate()).end;
      // Two different questions, two different queries:
      //  • MONEY (Collected / Cash / UPI / write-offs): orders whose payment was RECEIVED in the range —
      //    by paid_at, falling back to the billed day for rows without one. A due billed last week and
      //    paid today is today's money, and last week's closed figures stop changing after the fact.
      //  • DUES (the "Unpaid / Due Orders" list): orders BILLED in the range that are still unpaid.
      const paid: any[] = await storage.getOrdersCollectedBetween(start, end);
      const billedInRange: any[] = await storage.getOrdersByDateRange(start, end);
      const due  = billedInRange.filter((o: any) => o.paymentStatus === "pending" && o.status === "served");

      // This is the cash-drawer view — it must show what was actually collected, not the
      // billed total: change handed back and a short-settled order's write-off are excluded
      // (the write-off is reported separately as totalShortfall).
      //
      // Split by the entered payment LEGS, not by `orders.paymentMethod`. That column is only
      // the largest leg's label, so bucketing by it credited the whole of a Part (cash + UPI)
      // bill to one method — e.g. a ₹63 bill paid ₹53 cash + ₹10 UPI landed entirely under
      // Cash. See shared/paymentSplit.ts; the Tables-page Sales card uses the same function.
      const { breakdown, totalPaid, partCount } = summarizeCollected(paid);

      const dueTotal = due.reduce((s: number, o: any) => s + parseFloat(o.totalAmount || "0"), 0);
      const totalShortfall = paid.reduce((s: number, o: any) => s + parseFloat(o.shortfallAmount ?? "0"), 0);

      res.json({
        breakdown,                        // { cash: {count, amount}, upi: {...}, ... } — a part order counts under both
        totalPaid,
        partCount,                        // orders settled with more than one method
        totalShortfall,
        totalDue: dueTotal,
        dueCount: due.length,
        dueOrders: due,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate payment summary" });
    }
  });

  // ── Bill requested — set table to "billed" when staff prints customer bill ───
  app.post("/api/orders/:id/bill-requested", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if ((order as any).tableId) {
        // Set table status to "billed" — keeps currentOrderId unchanged
        await storage.updateTableStatus(Number((order as any).tableId), "billed");
        broadcast({ type: "TABLE_UPDATE" });
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update table status" });
    }
  });

  // ── WhatsApp e-bill (the POS cart's E-Bill button) ───────────────────────────
  // Builds the customer's bill text from the SAVED order — persisted numbers only, never anything the client
  // computed — and returns a wa.me link for staff to open and press Send. It sends nothing itself: no driver, no
  // outbound queue, no automation_jobs row, so staff can re-send after adding an item and the same-day
  // duplicate guard never gets involved. Deliberately not a print: billPrintCount (the paper "DUPLICATE"
  // watermark) is untouched; no loyalty, no audit row (it is not a deviation).
  app.post("/api/orders/:id/ebill", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.status === "cancelled") return res.status(409).json({ error: "This order was cancelled", code: "cancelled" });
      const rawPhone = String(order.customerPhone ?? "");
      if (!isValidWaPhone(rawPhone)) {
        return res.status(400).json({ error: "Enter a valid customer WhatsApp number", code: "bad_phone" });
      }
      // A bill is a money document: real settings or a 503, never the built-in defaults (see settingsCache).
      const settings = getLiveSettings();
      const [items, tableSection] = await Promise.all([
        db
          .select({
            name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
            quantity: orderItems.quantity,
            price: orderItems.price,
          })
          .from(orderItems)
          .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
          .where(eq(orderItems.orderId, id))
          .orderBy(orderItems.id),
        tableSectionFor(order.tableId),
      ]);
      const text = buildEbillText(
        { ...order, tableSection },
        items,
        { restaurantName: settings.restaurantName, address: settings.address, footerNote: settings.footerNote },
      );
      const phone = normalizeWaPhone(rawPhone);
      // The same non-fatal "billed" flip the Bill button does: a table whose bill went out on WhatsApp reads
      // as billed on the Tables page (only a running order still holding its table flips).
      await markTableBilled(order);
      res.json({ text, phone, waUrl: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` });
    } catch (error: any) {
      res.status(error?.status ?? 500).json({ error: error?.message || "Failed to build e-bill" });
    }
  });

  // ── Table Action: Hold Order ──────────────────────────────────────────────────
  app.put("/api/orders/:id/hold", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      const tableId = (order as any).tableId;
      // Mark order as held FIRST — this is the actual point of the endpoint. Doing the
      // table free first (the old order) meant a failure there left the order neither
      // held nor freed: still attached to a table that already forgot about it, showing
      // up on neither the table card nor the Hold/Recall list. Freeing the table is now
      // non-fatal and best-effort — if it fails, the order is still correctly held
      // (the state that matters), just with a table card that needs a manual refresh/fix.
      await storage.updateOrder(id, { status: "hold", tableId: null, tableNumber: null } as any);
      if (tableId) {
        try {
          await storage.freeTableIfHeldBy(Number(tableId), id);
        } catch (tableErr) {
          console.error("[order] table free error on hold (non-fatal):", tableErr);
        }
      }
      await logAudit(req, "order.hold", "order", id, {
        orderNumber: (order as any).orderNumber,
        tableNumber: (order as any).tableNumber,
      });
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to hold order" });
    }
  });

  // ── Table Action: Recall Held Order ─────────────────────────────────────────
  app.put("/api/orders/:id/recall", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if ((order as any).status !== "hold") return res.json({ success: true }); // already active
      await storage.updateOrder(id, { status: "pending" } as any);
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to recall order" });
    }
  });

  // ── Table Action: Cancel Order ────────────────────────────────────────────────
  app.put("/api/orders/:id/cancel", requireAuth, requireElevation("manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // A reason is required — this is the whole point of the box: an accountable
      // record of WHY an order was voided, surfaced later in Order History/Reports.
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) return res.status(400).json({ error: "A cancellation reason is required" });
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if ((order as any).status === "cancelled") {
        return res.status(409).json({ error: "This order is already cancelled.", code: "cancelled" });
      }
      // A paid order's money is already in the day's takings; cancelling it would drop the sale
      // while the cash stays in the drawer. (A due may be cancelled — that forgives the tab.)
      if ((order as any).paymentStatus === "paid") {
        return res.status(409).json({ error: "This order is already paid — it can't be cancelled.", code: "settled" });
      }
      // Conditional: a settle landing between the read above and this write wins (409), instead of
      // the cancel silently wiping a payment that was just recorded.
      const cancelled = await storage.updateOrderIfState(id, { status: "cancelled", cancelReason: reason } as any, {
        status: (order as any).status,
        paymentStatus: (order as any).paymentStatus,
      });
      if (!cancelled) {
        return res.status(409).json({ error: "This order changed while it was being cancelled — refresh and try again.", code: "conflict" });
      }
      // Non-fatal — the order is already marked cancelled above; a failure here must not
      // report "Failed to cancel order" for an order that genuinely IS cancelled now
      // (same reasoning as the settlement/creation table-status fixes elsewhere in this
      // file). Worst case the table is left showing "running" and needs a manual fix.
      if ((order as any).tableId) {
        try {
          await storage.freeTableIfHeldBy(Number((order as any).tableId), id);
        } catch (tableErr) {
          console.error("[order] table free error on cancel (non-fatal):", tableErr);
        }
      }
      // Reverse whatever this order net-consumed — an empty target means "restore
      // everything." Previously a cancelled order permanently kept its stock deducted.
      try {
        await storage.reconcileOrderInventory(id, [], actorRefFromReq(req));
      } catch (invErr) {
        console.error("[order] inventory reconciliation error (non-fatal):", invErr);
      }
      // Non-fatal: the order is already marked cancelled above. Same reasoning as
      // settlement above — a cancelled order's printed-but-unstarted KOT ticket
      // would otherwise sit in Active forever with no way to resolve it, since the
      // order it belongs to no longer needs cooking.
      try {
        await storage.completeKotTicketsForOrder(id);
      } catch (kotErr) {
        console.error("[order] KOT auto-complete error on cancel (non-fatal):", kotErr);
      }
      await logAudit(req, "order.cancel", "order", id, {
        orderNumber: (order as any).orderNumber,
        tableNumber: (order as any).tableNumber,
        totalAmount: (order as any).totalAmount,
        reason,
      });
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  // ── Table Action: Move Table ──────────────────────────────────────────────────
  app.put("/api/orders/:id/move-table", requireAuth, requireElevation("manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { newTableName } = req.body;
      const newTableId = Number(req.body?.newTableId);
      if (!Number.isInteger(newTableId) || newTableId <= 0) return res.status(400).json({ error: "newTableId required" });
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if ((order as any).paymentStatus === "paid" || ["cancelled", "hold"].includes((order as any).status)) {
        return res.status(409).json({ error: "Only an open order can be moved.", code: "not_open" });
      }
      const oldTableId = (order as any).tableId;
      // Claim the target first, conditionally: it must still be free.
      if (!(await storage.claimFreeTable(newTableId, id))) {
        return res.status(409).json({ error: "That table is no longer free — pick another.", code: "table_busy" });
      }
      // Update order with new table FIRST — this is the authoritative write (same
      // reasoning as /api/tables/:id/shift above: order.tableId is what other reads key
      // off). The two table-status flips are best-effort display bookkeeping on top of
      // it — previously unguarded and ran BEFORE this write, so a failure freeing the
      // old table skipped the move entirely, and a failure on the new-table flip
      // reported "Failed to move order" even though the order had already genuinely
      // moved, leaving the new table stuck showing "free" with an order attached.
      await storage.updateOrder(id, { tableId: newTableId, tableNumber: newTableName || String(newTableId) } as any);
      if (oldTableId) {
        try {
          await storage.freeTableIfHeldBy(Number(oldTableId), id);
        } catch (tableErr) {
          console.error("[table] move: old table status update error (non-fatal):", tableErr);
        }
      }
      await logAudit(req, "order.move_table", "order", id, {
        orderNumber: (order as any).orderNumber,
        fromTable: (order as any).tableNumber,
        toTable: newTableName || String(newTableId),
      });
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });

      // KOT after a table move (setting) goes through the normal print pipeline — live settings,
      // category routing, the print_jobs bridge to the desktop host — as a full reprint showing the
      // new table, and finishes BEFORE the response. It used to be built from the fallback
      // settings and sent straight to the printer after res.json: on Vercel it could neither reach
      // a LAN/USB printer nor survive the function being frozen. A print failure never fails the move.
      if (getSettings().printSettings.kot.printOnTableMove) {
        try {
          await runKotPrint({ req, orderId: id, reprint: true });
        } catch (e) {
          console.warn("[Print/TableMove]", e);
        }
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to move table" });
    }
  });

  // ── Table Action: Merge Tables ────────────────────────────────────────────────
  // Merges sourceOrderId items INTO targetOrderId, frees source table
  app.post("/api/orders/merge", requireAuth, requireElevation("manager"), async (req, res) => {
    try {
      const { targetOrderId, sourceOrderId } = req.body;
      if (!targetOrderId || !sourceOrderId) return res.status(400).json({ error: "targetOrderId and sourceOrderId required" });
      const targetOrder = await storage.getOrderById(targetOrderId);
      const sourceOrder = await storage.getOrderById(sourceOrderId);
      if (!targetOrder || !sourceOrder) return res.status(404).json({ error: "Order not found" });
      const mergeErr = mergeBlock(targetOrder as any, sourceOrder as any);
      if (mergeErr) return res.status(mergeErr.status).json({ error: mergeErr.error, code: mergeErr.code });

      const sourceItems = await storage.getOrderItems(sourceOrderId);
      const targetExistingItems = await storage.getOrderItems(targetOrderId);
      const allItems = [...targetExistingItems, ...sourceItems];

      // Container charge is a manually-entered flat amount per order (not computed
      // from item quantities/serviceMode) — a merge simply combines whatever the two
      // orders already had, so the combined charge isn't silently dropped.
      const containerCharge = (Number((targetOrder as any).containerCharge) || 0)
        + (Number((sourceOrder as any).containerCharge) || 0);
      // Delivery charge: same rule — the merged order carries both orders' charges.
      const deliveryCharge = (Number((targetOrder as any).deliveryCharge) || 0)
        + (Number((sourceOrder as any).deliveryCharge) || 0);
      // Discount: the merged bill keeps BOTH orders' discounts (aggregate-neutral, like the
      // charges). It used to keep only the target's, so merging a discounted table into another
      // charged the customer more than the two bills it replaced.
      const discount = (Number((targetOrder as any).discountAmount) || 0)
        + (Number((sourceOrder as any).discountAmount) || 0);
      const merged = computeTotalsFromLines(
        allItems.map((i) => parseFloat(i.price as any) * i.quantity),
        discount,
        containerCharge,
        deliveryCharge,
      );

      // Copy ALL item fields, not just {menuItemId, quantity, price, specialInstructions,
      // size} — dropping name/serviceMode/parcelLeftover/unitCost broke open items (no
      // stored name to fall back to), lost the container-charge basis, and blanked the
      // COGS snapshot. Atomic: item copy + target totals + free source table + delete
      // source order/items all happen in one transaction (storage.mergeOrders) — a
      // failure partway through used to be able to duplicate items across both orders or
      // delete the source order while its items still existed elsewhere.
      const updatedTarget = await storage.mergeOrders({
        targetOrderId,
        sourceOrderId,
        sourceTableId: (sourceOrder as any).tableId ?? null,
        newItems: sourceItems.map((item) => ({
          menuItemId: item.menuItemId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          specialInstructions: item.specialInstructions,
          size: item.size,
          serviceMode: item.serviceMode,
          parcelLeftover: item.parcelLeftover,
          unitCost: item.unitCost,
        } as any)),
        targetTotals: {
          totalAmount: merged.total.toFixed(2),
          taxAmount: merged.tax.toFixed(2),
          discountAmount: merged.discount.toFixed(2),
          subtotalAmount: merged.subtotal.toFixed(2),
          containerCharge: merged.containerCharge.toFixed(2),
          deliveryCharge: merged.deliveryCharge.toFixed(2),
        } as any,
      });
      if (!updatedTarget) {
        return res.status(409).json({ error: "One of these orders changed while merging — refresh and try again.", code: "conflict" });
      }

      await logAudit(req, "order.merge", "order", targetOrderId, {
        targetOrderNumber: (targetOrder as any).orderNumber,
        sourceOrderNumber: (sourceOrder as any).orderNumber,
        sourceOrderId,
        totalBefore: (targetOrder as any).totalAmount,
        totalAfter: merged.total.toFixed(2),
      });
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE", order: updatedTarget });
      res.json({ success: true });
    } catch (error) {
      console.error("Merge error:", error);
      res.status(500).json({ error: "Failed to merge orders" });
    }
  });

  // ── Table Action: Split Bill ──────────────────────────────────────────────────
  // Splits selected item IDs from an order into a new standalone order
  app.post("/api/orders/:id/split", requireAuth, requireElevation("manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { itemIds } = req.body; // array of orderItem IDs to split out
      if (!itemIds || itemIds.length === 0) return res.status(400).json({ error: "itemIds required" });
      const sourceOrder = await storage.getOrderById(id);
      if (!sourceOrder) return res.status(404).json({ error: "Order not found" });
      if ((sourceOrder as any).paymentStatus === "paid" || ["cancelled", "hold", "served", "delivered"].includes((sourceOrder as any).status)) {
        return res.status(409).json({ error: "Only an open, unpaid order can be split.", code: "not_open" });
      }
      const allItems = await storage.getOrderItems(id);
      const splitItems = allItems.filter((i) => itemIds.includes(i.id));
      if (splitItems.length === 0) return res.status(400).json({ error: "No matching items" });
      const remainingItems = allItems.filter((i) => !itemIds.includes(i.id));

      // The source order's existing discount is left entirely on the source (see
      // CLAUDE.md — this is aggregate-neutral by design, not a bug), UNLESS it now
      // exceeds what remains after the split-out items leave — computeTotals' clamp
      // would otherwise silently drop the excess with nothing collecting it anywhere,
      // a real net overcharge across the two resulting bills. Refuse rather than guess
      // how to reallocate it; the manager can reduce the discount first and retry.
      const remainingSubtotal = remainingItems.reduce((s, i) => s + parseFloat(i.price as any) * i.quantity, 0);
      const existingDiscount = parseFloat((sourceOrder as any).discountAmount ?? "0") || 0;
      if (existingDiscount > remainingSubtotal + 0.01) {
        return res.status(400).json({
          error: `This order's ₹${existingDiscount.toFixed(2)} discount exceeds the ₹${remainingSubtotal.toFixed(2)} that will remain after this split. Reduce the discount before splitting.`,
        });
      }

      // Container charge is now a manually-entered flat amount per order, not computed
      // from item quantities — same treatment as the existing discount above: it stays
      // entirely on the source/remaining order (aggregate-neutral), and the new
      // split-out order starts at 0 (staff can enter one manually for that order if
      // it needs its own container).
      const newContainerCharge = 0;
      // Delivery charge gets the same treatment: stays on the source, new order starts at 0.
      const newDeliveryCharge = 0;
      const splitTotals = computeTotalsFromLines(
        splitItems.map((i) => parseFloat(i.price as any) * i.quantity),
        "0",
        newContainerCharge,
        newDeliveryCharge,
      );

      const srcContainerCharge = Number((sourceOrder as any).containerCharge) || 0;
      const srcDeliveryCharge = Number((sourceOrder as any).deliveryCharge) || 0;
      const srcTotals = computeTotalsFromLines(
        remainingItems.map((i) => parseFloat(i.price as any) * i.quantity),
        (sourceOrder as any).discountAmount,
        srcContainerCharge,
        srcDeliveryCharge,
      );

      // Still dine-in — a split bill is two checks for people still sitting at the same
      // table, not a takeaway order; it just doesn't carry its own tableId (this order
      // is a bill-only record, the table's own order is what stays "running").
      const newOrderNumber = `ORD${String(await incrementBillCounter()).padStart(4, "0")}`;

      // Copy ALL item fields (name/serviceMode/parcelLeftover/unitCost, not just
      // {menuItemId, quantity, price, specialInstructions, size}) — atomic: new order +
      // its items + removing them from source + source's recomputed totals all happen
      // in one transaction (storage.splitOrder), for the same reason as merge above.
      const { newOrder } = await storage.splitOrder({
        sourceOrderId: id,
        splitItemIds: splitItems.map((item) => item.id),
        newOrder: {
          orderNumber: newOrderNumber,
          orderType: "dine-in",
          status: "pending",
          totalAmount: splitTotals.total.toFixed(2),
          taxAmount: splitTotals.tax.toFixed(2),
          subtotalAmount: splitTotals.subtotal.toFixed(2),
          containerCharge: splitTotals.containerCharge.toFixed(2),
          deliveryCharge: splitTotals.deliveryCharge.toFixed(2),
          discountAmount: "0",
          paymentStatus: "pending",
          customerName: (sourceOrder as any).customerName || null,
          customerPhone: (sourceOrder as any).customerPhone || null,
          notes: `Split from ${(sourceOrder as any).orderNumber}`,
        } as any,
        newOrderItems: splitItems.map((item) => ({
          menuItemId: item.menuItemId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          specialInstructions: item.specialInstructions,
          size: item.size,
          serviceMode: item.serviceMode,
          parcelLeftover: item.parcelLeftover,
          unitCost: item.unitCost,
        } as any)),
        sourceTotals: {
          totalAmount: srcTotals.total.toFixed(2),
          taxAmount: srcTotals.tax.toFixed(2),
          subtotalAmount: srcTotals.subtotal.toFixed(2),
          containerCharge: srcTotals.containerCharge.toFixed(2),
          deliveryCharge: srcTotals.deliveryCharge.toFixed(2),
        } as any,
      });

      // Move the split-out items' stock with them: the new order deducts them, the source's next
      // reconcile would otherwise have RESTORED them (its ledger still held their 'sale' rows while
      // its items no longer did). Net zero, and each order's ledger now matches its own items.
      // Non-fatal, like every other post-commit reconcile.
      try {
        await storage.reconcileOrderInventory(newOrder.id, splitItems.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, size: i.size })), actorRefFromReq(req));
        const remaining = await storage.getOrderItems(id);
        await storage.reconcileOrderInventory(id, remaining.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, size: i.size })), actorRefFromReq(req));
      } catch (invErr) {
        console.error("[order] split inventory reconcile error (non-fatal):", invErr);
      }

      await logAudit(req, "order.split", "order", id, {
        sourceOrderNumber: (sourceOrder as any).orderNumber,
        newOrderNumber,
        newOrderId: newOrder.id,
        itemCount: splitItems.length,
        splitTotal: splitTotals.total.toFixed(2),
      });
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true, newOrderId: newOrder.id });
    } catch (error) {
      console.error("Split error:", error);
      res.status(500).json({ error: "Failed to split order" });
    }
  });

  // ── KOT Tickets ───────────────────────────────────────────────────────────────

  app.get("/api/kot", requireAuth, async (req, res) => {
    try {
      // since=<ISO> (the Kitchen page sends today's business-day start): active tickets of any age plus
      // everything printed since then — not the full KOT history. Without it, every ticket (legacy).
      // ETag'd like GET /api/orders, so an unchanged poll is a 304.
      const { status, since } = req.query;
      const query = storage.kotTicketsQuery({
        status: status ? String(status) : undefined,
        since: since ? new Date(String(since)) : undefined,
      });
      await sendWithDbEtag(req, res, "kot", queryFingerprint(query), () => query);
    } catch (error) {
      console.error("GET /api/kot error:", error);
      res.status(500).json({ error: "Failed to fetch KOT tickets" });
    }
  });

  app.put("/api/kot/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (!["pending", "in-progress", "completed"].includes(status)) {
        return res.status(400).json({ error: "Invalid KOT status" });
      }
      const updateData: any = { status };
      if (status === 'completed') updateData.completedAt = new Date();
      const ticket = await storage.updateKotTicket(id, updateData);
      if (!ticket) return res.status(404).json({ error: "KOT not found" });

      // Starting a ticket moves its order to "preparing", completing it to "ready" — but only while
      // the order is still on the floor. A stale tap on an old ticket used to flip a cancelled or
      // settled order back to ready/preparing, putting it back into sales and onto the Tables page.
      // Same rule as PUT /api/orders/:id (planStatusChange), conditional write, never fatal.
      const nextOrderStatus = status === 'completed' ? "ready" : status === 'in-progress' ? "preparing" : null;
      if (nextOrderStatus && ticket?.orderId) {
        try {
          const ord = await storage.getOrderById(ticket.orderId);
          if (ord && !planStatusChange(ord as any, nextOrderStatus) && (ord as any).status !== nextOrderStatus) {
            await storage.updateOrderIfState(ticket.orderId, { status: nextOrderStatus } as any, {
              status: (ord as any).status,
              paymentStatus: (ord as any).paymentStatus,
            });
          }
        } catch (e) {
          console.error("[kot] order status follow-up failed (non-fatal):", e);
        }
      }

      broadcast({ type: 'KOT_UPDATE', ticket });
      res.json(ticket);
    } catch (error) {
      res.status(400).json({ error: "Invalid KOT data" });
    }
  });

  // ── KOT Running Count ─────────────────────────────────────────────────────────

  app.get("/api/kot/running", requireAuth, async (req, res) => {
    try {
      const pending = await storage.getKotTicketsByStatus("pending");
      const inProgress = await storage.getKotTicketsByStatus("in-progress");
      res.json({ count: pending.length + inProgress.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch KOT count" });
    }
  });

  // ── Delivery Platform Integration ─────────────────────────────────────────────

  const DELIVERY_PLATFORMS = new Set(["zomato", "swiggy", "ubereats", "magicpin", "test"]);

  app.post("/api/delivery/webhook/:platform", async (req, res) => {
    try {
      const platform = req.params.platform;

      // Fail closed: a shared secret must be configured AND presented, and the
      // platform must be known. Without this, anyone could POST forged "paid"
      // orders that pollute sales/reports and drive KOT/printers.
      const secret = process.env.DELIVERY_WEBHOOK_SECRET;
      const provided = req.headers["x-webhook-secret"] as string | undefined;
      if (!secret || !provided || !safeEqual(provided, secret)) {
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
      if (!DELIVERY_PLATFORMS.has(platform)) {
        return res.status(400).json({ error: "Unknown delivery platform" });
      }

      const webhookData = req.body;
      console.log(`Received webhook from ${platform}:`, webhookData);

      if (webhookData.event === 'order_created') {
        const orderData = {
          orderNumber: webhookData.order_id,
          customerName: webhookData.customer_name,
          customerPhone: webhookData.customer_phone,
          orderType: 'delivery',
          source: platform,
          sourceOrderId: webhookData.order_id,
          totalAmount: webhookData.total_amount,
          taxAmount: webhookData.tax_amount,
          status: 'pending',
          paymentStatus: 'paid',
          paymentMethod: 'online',
        };
        const order = await storage.createOrder(orderData);
        broadcast({ type: 'NEW_DELIVERY_ORDER', order, platform });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Webhook processing failed" });
    }
  });

  // ── Reports ───────────────────────────────────────────────────────────────────

  app.get("/api/reports/weekly", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      // Business-day date strings (YYYY-MM-DD, IST calendar) — see getSalesChart's
      // comment in storage.ts. Both branches here used to re-normalize via LOCAL
      // setHours()/UTC toISOString(), which disagreed with Orders.tsx/Billing.tsx for
      // any order between midnight and 5am IST.
      const startKey = startDate ? (startDate as string).slice(0, 10) : shiftBusinessDate(todayBusinessDate(), -6);
      const endKey = endDate ? (endDate as string).slice(0, 10) : todayBusinessDate();
      const start = businessDayRange(startKey).start;
      const end = businessDayRange(endKey).end;

      const allOrders = await storage.getOrdersByDateRange(start, end);

      // Build one entry per business day in the selected range
      const days: { name: string; date: string; sales: number; orders: number }[] = [];
      let cursorKey = startKey;
      while (cursorKey <= endKey) {
        const labelDate = businessDayRange(cursorKey).start;
        days.push({
          name: labelDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }),
          date: cursorKey,
          sales: 0,
          orders: 0,
        });
        cursorKey = shiftBusinessDate(cursorKey, 1);
      }

      for (const order of allOrders) {
        const orderDate = businessDateOf(new Date(order.createdAt!));
        const day = days.find(d => d.date === orderDate);
        if (day) {
          day.sales  += parseFloat(order.totalAmount);
          day.orders += 1;
        }
      }

      res.json(days);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate weekly report" });
    }
  });

  // Petpooja-style channel-stacked sales chart — same day-bucketing as /api/reports/weekly
  // above, but split by orders.orderType (dine-in/takeaway/delivery) for Reports.tsx's
  // Sales tab. Replaces that tab's old single-series consumption of /api/reports/weekly
  // (left in place, untouched, for any other/future caller) — this endpoint's totals
  // reconcile with /api/reports/sales' "Total Sales" figure (cancelled orders excluded,
  // shortfallAmount netted out), which the old weekly endpoint does not do.
  app.get("/api/reports/sales-by-type", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? (startDate as string).slice(0, 10) : undefined;
      const end = endDate ? (endDate as string).slice(0, 10) : undefined;
      const days = await storage.getSalesChartByOrderType(start, end);
      res.json(days);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate sales-by-type report" });
    }
  });

  // Petpooja's "Leakage Alert" — KOTs Cancelled/Modified/Shifted, Bills
  // Modified/Re-printed/Waived-off, built on the auditLogs trail. requireManagerOrAdmin
  // (stricter than every other /api/reports/* endpoint above, all requireAuth-only) —
  // this is the one report tab that reveals who cancelled/modified/waived off money, so
  // it gets the same access tier as payroll/salary data elsewhere in this file. Note:
  // /reports itself is currently hardcoded admin-only at the client route-permission
  // layer (client/src/lib/routePermissions.ts), so today only an admin session can reach
  // this in practice — this gate is forward-compatible defense-in-depth for if that ever
  // opens to managers, not a live gap being closed.
  app.get("/api/reports/kot-bill-activity", requireAuth, requireManagerOrAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = businessDayRange((startDate as string)?.slice(0, 10) ?? todayBusinessDate()).start;
      const end = businessDayRange((endDate as string)?.slice(0, 10) ?? todayBusinessDate()).end;
      const summary = await getKotBillActivitySummary(start, end);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate KOT/bill activity report" });
    }
  });

  app.get("/api/reports/staff-tables", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      // Business day (5am IST cutoff), not UTC midnight — this used to explicitly pin
      // UTC, which is a real timezone but not the restaurant's, so it disagreed with
      // Orders.tsx/Billing.tsx the same way the local-midnight sites elsewhere did.
      const start = businessDayRange((startDate as string)?.slice(0, 10) ?? todayBusinessDate()).start;
      const end = businessDayRange((endDate as string)?.slice(0, 10) ?? todayBusinessDate()).end;
      const report = await storage.getStaffTableReport(start, end);
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: "Failed to get staff-table report" });
    }
  });

  app.get("/api/reports/top-items", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      // Business day (5am IST cutoff) when a bound is given — see payment-summary's
      // comment above for why raw `new Date("YYYY-MM-DD")` silently dropped today's
      // later orders. Genuinely open-ended (no date at all) stays undefined, matching
      // storage.getTopSellingItems' own "all time" behavior for a missing bound.
      const start = startDate ? businessDayRange((startDate as string).slice(0, 10)).start : undefined;
      const end   = endDate   ? businessDayRange((endDate as string).slice(0, 10)).end     : undefined;
      const topItems = await storage.getTopSellingItems(10, start, end);
      res.json(topItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to get top items" });
    }
  });

  app.get("/api/reports/sales", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      // Business day (5am IST cutoff), matching Orders.tsx/Billing.tsx — a bare
      // "YYYY-MM-DD" parsed as raw UTC midnight (the previous `new Date(startDate)`)
      // is 5:30am IST, so any order placed later that same IST day silently fell
      // outside the range and vanished from "today"'s report.
      const start = businessDayRange((startDate as string)?.slice(0, 10) ?? todayBusinessDate()).start;
      const end = businessDayRange((endDate as string)?.slice(0, 10) ?? todayBusinessDate()).end;
      const allOrders = await storage.getOrdersByDateRange(start, end);
      // A cancelled order isn't a sale — it used to count toward Total Sales/Total
      // Orders/Avg Order Value here (getOrdersByDateRange has no status filter), which
      // inflated every one of those figures by however much got cancelled in the range.
      // See the dedicated Cancelled Orders report for cancelled-specific figures.
      const orders = allOrders.filter((o: any) => o.status !== "cancelled");

      // Revenue nets out any deliberately-written-off shortfall (a short settle recorded
      // via the settlement box's "Yes, write off" confirm — see shared/settlement.ts).
      // billedTotal is what the bills actually added up to; totalSales is what was really
      // collected. A normal order has shortfallAmount=0, so this is byte-identical to the
      // old totalSales for every order that never went through a short settle.
      const billedTotal = orders.reduce((sum, order) => sum + parseFloat(order.totalAmount), 0);
      const totalShortfall = orders.reduce((sum, order) => sum + parseFloat((order as any).shortfallAmount ?? "0"), 0);
      const totalSales = billedTotal - totalShortfall;
      res.json({
        totalOrders: orders.length,
        totalSales,
        totalShortfall,
        billedTotal,
        avgOrderValue: orders.length > 0 ? totalSales / orders.length : 0,
        orders,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate sales report" });
    }
  });

  // ── Reports: Cancelled Orders ─────────────────────────────────────────────────
  // Separate from /api/reports/sales (which now excludes cancelled orders entirely)
  // — this is the dedicated view for reviewing what got cancelled and why, filterable
  // by mode (dine-in/pickup/delivery) client-side same as the Sales tab's own filters.
  app.get("/api/reports/cancelled", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      // Business day (5am IST cutoff) — see /api/reports/sales' identical comment for
      // why a raw `new Date("YYYY-MM-DD")` here silently excluded today's later orders.
      const start = businessDayRange((startDate as string)?.slice(0, 10) ?? todayBusinessDate()).start;
      const end = businessDayRange((endDate as string)?.slice(0, 10) ?? todayBusinessDate()).end;
      const allOrders = await storage.getOrdersByDateRange(start, end);
      const orders = allOrders.filter((o: any) => o.status === "cancelled");
      const wouldBeTotal = orders.reduce((sum: number, o: any) => sum + parseFloat(o.totalAmount), 0);
      res.json({ totalCancelled: orders.length, wouldBeTotal, orders });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate cancelled orders report" });
    }
  });

  // ── Automation API ────────────────────────────────────────────────────────────

  /** GET /api/automation/config — get current automation config */
  app.get("/api/automation/config", requireAdmin, (_req, res) => {
    const config = getAutomationConfig();
    // Never expose secrets in full — mask them
    res.json({
      ...config,
      anthropicApiKey:        config.anthropicApiKey        ? "***configured***" : "",
      watiApiKey:             config.watiApiKey             ? "***configured***" : "",
      metaAccessToken:        config.metaAccessToken        ? "***configured***" : "",
      metaAppSecret:          config.metaAppSecret          ? "***configured***" : "",
      metaWebhookVerifyToken: config.metaWebhookVerifyToken ? "***configured***" : "",
      razorpayKeySecret:      config.razorpayKeySecret      ? "***configured***" : "",
      razorpayWebhookSecret:  config.razorpayWebhookSecret  ? "***configured***" : "",
    });
  });

  /** POST /api/automation/config — update automation config */
  app.post("/api/automation/config", requireAdmin, (req, res) => {
    try {
      const patch = req.body as Record<string, unknown>;
      // Don't overwrite secrets with the masked placeholder
      if (patch.anthropicApiKey       === "***configured***") delete patch.anthropicApiKey;
      if (patch.watiApiKey            === "***configured***") delete patch.watiApiKey;
      if (patch.metaAccessToken       === "***configured***") delete patch.metaAccessToken;
      if (patch.metaAppSecret         === "***configured***") delete patch.metaAppSecret;
      if (patch.metaWebhookVerifyToken === "***configured***") delete patch.metaWebhookVerifyToken;
      if (patch.razorpayKeySecret     === "***configured***") delete patch.razorpayKeySecret;
      if (patch.razorpayWebhookSecret === "***configured***") delete patch.razorpayWebhookSecret;

      const updated = saveAutomationConfig(patch);
      restartScheduler();   // pick up new interval setting immediately
      res.json({ ok: true, enabled: updated.enabled });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to save config" });
    }
  });

  /** GET /api/automation/logs — get automation logs, newest first */
  app.get("/api/automation/logs", requireManagerOrAdmin, (req, res) => {
    const limit  = parseInt(String(req.query.limit  ?? "200"), 10);
    const offset = parseInt(String(req.query.offset ?? "0"),   10);
    const logs   = loadLogs().slice().reverse(); // newest first
    res.json({
      total: logs.length,
      logs:  logs.slice(offset, offset + limit),
    });
  });

  /** DELETE /api/automation/logs — clear all logs */
  app.delete("/api/automation/logs", requireAdmin, (_req, res) => {
    clearLogs();
    res.json({ ok: true });
  });

  /** GET /api/automation/stats — campaign performance summary */
  app.get("/api/automation/stats", requireManagerOrAdmin, (_req, res) => {
    res.json(getAutomationStats());
  });

  /** POST /api/automation/run — manually trigger one run now (force-bypasses enabled flag) */
  app.post("/api/automation/run", requireAdmin, async (_req, res) => {
    try {
      const result = await runCustomerAutomation({ force: true });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Automation run failed" });
    }
  });

  /** POST /api/automation/prefs/:customerId — update customer opt-out pref */
  app.post("/api/automation/prefs/:customerId", requireManagerOrAdmin, (req, res) => {
    const { customerId } = req.params;
    const { doNotSend, mutedUntil } = req.body as { doNotSend?: boolean; mutedUntil?: string };
    setCustomerPref(decodeURIComponent(customerId), { doNotSend, mutedUntil });
    res.json({ ok: true });
  });

  /** GET /api/automation/prefs — all customer preferences */
  app.get("/api/automation/prefs", requireManagerOrAdmin, (_req, res) => {
    res.json(loadCustomerPrefs());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CRM API ROUTES (Phase 9 — additive, all behind requireAuth)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Customer master lookup ─────────────────────────────────────────────────

  /**
   * GET /api/customers/search?q=
   * Search customersMaster by name or phone (partial, case-insensitive). Max 10 results.
   */
  app.get("/api/customers/search", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.json([]);
      // Search distinct phone+name combos from past orders (phone is primary)
      const results = await db
        .selectDistinctOn([orders.customerPhone], {
          name:  orders.customerName,
          phone: orders.customerPhone,
        })
        .from(orders)
        .where(
          or(
            ilike(orders.customerPhone, `${q}%`),
            ilike(orders.customerName,  `%${q}%`),
          )
        )
        .orderBy(orders.customerPhone, desc(orders.createdAt))
        .limit(10);
      res.json(results.filter(r => r.phone));
    } catch (error) {
      res.status(500).json({ error: "Search failed" });
    }
  });

  /**
   * GET /api/crm/segments — every customer's RFM segment in ONE query, keyed by customer key.
   * The Intelligence grid used to fire GET /api/crm/customers/:key per card (several queries each)
   * just to draw the RFM chip.
   */
  app.get("/api/crm/segments", requireAuth, async (_req, res) => {
    try {
      const rows = await db
        .select({
          key: customersMaster.key,
          segment: customerSegments.segment,
          rfmScore: customerSegments.rfmScore,
          recencyScore: customerSegments.recencyScore,
          frequencyScore: customerSegments.frequencyScore,
          monetaryScore: customerSegments.monetaryScore,
          updatedAt: customerSegments.updatedAt,
        })
        .from(customerSegments)
        .innerJoin(customersMaster, eq(customersMaster.id, customerSegments.customerId));
      const byKey: Record<string, Omit<typeof rows[number], "key">> = {};
      for (const { key, ...seg } of rows) byKey[key] = seg;
      res.json(byKey);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * GET /api/crm/customers/:key
   * Returns the master record + DB profile + current segment for a customer.
   * Falls back gracefully if the customer hasn't been synced to DB yet.
   */
  app.get("/api/crm/customers/:key", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      if (!master) return res.json({ exists: false });

      const profile = await getCustomerProfile(key);
      const segment = await getCustomerSegment(master.id);

      res.json({
        exists:  true,
        id:      master.id,
        key:     master.key,
        name:    master.name,
        phone:   master.phone,
        profile: profile ? dbProfileToExtra(profile) : null,
        segment: segment ? {
          segment:        segment.segment,
          rfmScore:       segment.rfmScore,
          recencyScore:   segment.recencyScore,
          frequencyScore: segment.frequencyScore,
          monetaryScore:  segment.monetaryScore,
          updatedAt:      segment.updatedAt,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Customer events / timeline ─────────────────────────────────────────────

  /**
   * GET /api/crm/customers/:key/events
   * Returns the CRM event timeline for a customer (newest first).
   */
  app.get("/api/crm/customers/:key/events", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      if (!master) return res.json([]);

      const limit  = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
      const events = await getCustomerEvents(master.id, limit);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Profile upsert (sync from client localStorage → DB) ───────────────────

  /**
   * POST /api/crm/customers/:key/profile
   * Saves or updates the extended CRM profile for a customer.
   * Called from the EditCustomerModal Save handler to keep DB in sync.
   */
  app.post("/api/crm/customers/:key/profile", requireAuth, async (req, res) => {
    try {
      const key   = decodeURIComponent(req.params.key);
      const extra = req.body as { name?: string; phone?: string; [key: string]: unknown };

      const name  = extra.name  ?? key;
      const phone = typeof extra.phone === "string" ? extra.phone : undefined;

      const customerId = await resolveCustomerId(key, name, phone);
      const profile    = await upsertCustomerProfile(customerId, extra as any);

      // Backfill phone into past phone-less orders ONLY when a phone was just added to a customer
      // that had none (backfillPhone), and only for orders under this customer's exact key. It ran on
      // every save and matched the free-text display name too, so walk-ins of other people sharing
      // a first name were given this customer's phone (merging them into one customer).
      let backfilled = 0;
      if (phone && key && (extra as any).backfillPhone === true) {
        backfilled = await backfillOrderPhone(key, key, phone);
      }

      res.json({ ok: true, id: customerId, profile: dbProfileToExtra(profile), backfilled });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/sync-extras
   * Bulk-syncs the entire localStorage extras map to the DB.
   * Body: { extras: Record<string, CustomerExtra & { name?, phone? }> }
   */
  app.post("/api/crm/sync-extras", requireAuth, async (req, res) => {
    try {
      const { extras } = req.body as { extras: Record<string, any> };
      if (!extras || typeof extras !== "object") {
        return res.status(400).json({ error: "extras map required" });
      }
      const result = await syncLocalStorageExtras(extras);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Recommendations ────────────────────────────────────────────────────────

  /**
   * GET /api/crm/recommendations/:key
   * Returns personalised item recommendations for a customer.
   */
  app.get("/api/crm/recommendations/:key", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const result = await getRecommendations(key);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Message history ────────────────────────────────────────────────────────

  /**
   * GET /api/crm/customers/:key/messages
   * Returns the full message history for a customer.
   */
  app.get("/api/crm/customers/:key/messages", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      if (!master) return res.json([]);

      const messages = await getCustomerMessages(master.id);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/customers/:key/message
   * Send a manual message to a customer via any channel.
   */
  app.post("/api/crm/customers/:key/message", requireManagerOrAdmin, async (req, res) => {
    try {
      const key     = decodeURIComponent(req.params.key);
      const { channel, to, message, subject, trigger } = req.body as {
        channel: "whatsapp" | "email" | "sms";
        to:      string;
        message: string;
        subject?: string;
        trigger?: string;
      };

      if (!channel || !to || !message) {
        return res.status(400).json({ error: "channel, to, and message are required" });
      }

      const master = await getCustomerMaster(key);
      const name   = master?.name ?? key;

      const config = getAutomationConfig();
      const result = await sendMessage(key, name, { channel, to, message, subject, trigger }, {
        watiApiKey:   config.watiApiKey,
        watiEndpoint: config.watiEndpoint,
      });

      res.json({ ok: result.success, mode: result.mode, error: result.error });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Segmentation ───────────────────────────────────────────────────────────

  /**
   * GET /api/crm/segments/all
   * Returns server-computed RFM segments for all customers (key → segment).
   */
  app.get("/api/crm/segments/all", requireAuth, async (_req, res) => {
    try {
      const rows = await db
        .select({
          key:      customersMaster.key,
          segment:  customerSegments.segment,
          rfmScore: customerSegments.rfmScore,
          updatedAt: customerSegments.updatedAt,
        })
        .from(customerSegments)
        .innerJoin(customersMaster, eq(customerSegments.customerId, customersMaster.id));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Registered BEFORE /api/crm/segment/:key — Express matches in order, so "batch" was being
  // captured as a customer key and this admin route was unreachable.
  /**
   * POST /api/crm/segment/batch
   * Runs full batch segmentation for all customers.
   */
  app.post("/api/crm/segment/batch", requireAdmin, async (_req, res) => {
    try {
      const result = await runSegmentationForAll();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/segment/:key
   * Recomputes the RFM segment for a single customer.
   */
  app.post("/api/crm/segment/:key", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      const result = await runSegmentationForCustomer(
        key,
        master?.name ?? key,
        master?.phone
      );
      res.json({ ok: !!result, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });


  // ── Server-side automation ─────────────────────────────────────────────────

  /**
   * POST /api/crm/automation/run
   * Runs the server-side rule engine (separate from the client-side engine).
   */
  // Admin only, like POST /api/automation/run: it sends a REAL WhatsApp batch (any session could
  // fire one, with force on by default and any batch size — a ban risk on the restaurant's number).
  app.post("/api/crm/automation/run", requireAdmin, async (req, res) => {
    try {
      const { force, limit } = req.body as { force?: boolean; limit?: number };
      const n = Number(limit);
      const safeLimit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : undefined;
      const result = await runAutomationServerSide({ force: force === true, limit: safeLimit });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * GET /api/crm/automation/rules
   * Returns all automation rules from DB.
   */
  app.get("/api/crm/automation/rules", requireAuth, async (_req, res) => {
    try {
      const rules = await db.select().from(automationRules).orderBy(automationRules.createdAt);
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/automation/rules
   * Creates a new automation rule.
   */
  app.post("/api/crm/automation/rules", requireAdmin, async (req, res) => {
    try {
      const { name, triggerType, conditions, actions, isActive } = req.body;
      const [rule] = await db
        .insert(automationRules)
        .values({ name, triggerType, conditions, actions, isActive: isActive ?? true })
        .returning();
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * PATCH /api/crm/automation/rules/:id
   * Updates an existing automation rule.
   */
  app.patch("/api/crm/automation/rules/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, triggerType, conditions, actions, isActive } = req.body;
      const [rule] = await db
        .update(automationRules)
        .set({ name, triggerType, conditions, actions, isActive })
        .where(eq(automationRules.id, id))
        .returning();
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * GET /api/crm/automation/jobs
   * Returns recent automation jobs (newest first).
   */
  app.get("/api/crm/automation/jobs", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
      const jobs  = await db
        .select()
        .from(automationJobs)
        .orderBy(desc(automationJobs.scheduledAt))
        .limit(limit);
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ==========================================================================
  // STAFF MANAGEMENT ROUTES
  // ==========================================================================

  // NOTE: GET /api/staff is registered in staffRoutes.ts (requireManagerOrAdmin) and, being
  // registered earlier via registerStaffRoutes(app) above, wins over any duplicate here — a
  // second registration was previously here with a weaker `requireAuth` guard and has been
  // removed rather than left as dead code (see CLAUDE.md's staff/payroll authorization note).

  // PUT /api/staff/:id/profile — upsert staff profile (salary, biometricId, dept, etc.)
  app.put("/api/staff/:id/profile", requireManagerOrAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (Number.isNaN(userId)) return res.status(400).json({ message: "Invalid staff id" });
      const profile = await storage.upsertStaffProfile(userId, req.body);
      res.json(profile);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance — list with optional ?userId=&date=&month=YYYY-MM
  app.get("/api/attendance", requireAuth, async (req, res) => {
    try {
      const { userId, date, month } = req.query as Record<string, string>;
      res.json(await storage.getAttendance({
        userId: userId ? parseInt(userId) : undefined,
        date: date || undefined,
        month: month || undefined,
      }));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/today
  app.get("/api/attendance/today", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getTodayAttendance());
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/range?from&to&key= — device attendance rows for the unified roster.
  app.get("/api/attendance/range", requireAuth, async (req, res) => {
    try {
      const { from, to, key } = req.query as { from?: string; to?: string; key?: string };
      res.json(await storage.getAttendanceRange({ from, to, key: key && key !== "all" ? key : undefined }));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/summary?from&to — per-person device attendance summary (unified roster).
  app.get("/api/attendance/summary", requireAuth, async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      res.json(await storage.getAttendanceSummary({ from, to }));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/report?month=YYYY-MM
  app.get("/api/attendance/report", requireAuth, async (req, res) => {
    try {
      const month = (req.query.month as string) || istCalendarDate().slice(0, 7);
      res.json(await storage.getAttendanceReport(month));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/attendance/import — upload biometric Excel (.xlsx/.xls/.csv). Owner-only.
  app.post("/api/attendance/import", requireAdmin, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const profiles = await storage.getStaffProfiles();
      const bioMap = new Map<string, number>();
      profiles.forEach(p => { if (p.biometricId) bioMap.set(p.biometricId.toString().trim(), p.userId); });
      const nameMap = new Map<string, number>();
      profiles.forEach(p => nameMap.set(p.user.username.toLowerCase(), p.userId));

      let imported = 0;
      const unmatched: string[] = [];

      for (const row of rows) {
        const empId   = String(row["Emp ID"] ?? row["EmpID"] ?? row["Employee ID"] ?? row["emp_id"] ?? "").trim();
        const empName = String(row["Name"] ?? row["Employee Name"] ?? row["EmpName"] ?? "").trim();
        const dateStr = row["Date"] ?? row["date"] ?? "";
        const inTime  = String(row["In-Time"] ?? row["InTime"] ?? row["Clock In"] ?? row["in_time"] ?? "").trim();
        const outTime = String(row["Out-Time"] ?? row["OutTime"] ?? row["Clock Out"] ?? row["out_time"] ?? "").trim();

        if (!dateStr) continue;

        let parsedDate: string;
        if (typeof dateStr === "number") {
          const d = XLSX.SSF.parse_date_code(dateStr);
          parsedDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        } else {
          const d = new Date(String(dateStr));
          if (isNaN(d.getTime())) continue;
          parsedDate = d.toISOString().split('T')[0];
        }

        const userId = bioMap.get(empId) ?? nameMap.get(empName.toLowerCase());
        if (!userId) { if (empName) unmatched.push(empName); continue; }

        let workingHours: string | undefined;
        let status: string = "present";

        const parseTimeToMinutes = (t: string): number | null => {
          const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
          if (!m) return null;
          let h = parseInt(m[1]);
          const min = parseInt(m[2]);
          if (m[3]?.toUpperCase() === "PM" && h < 12) h += 12;
          if (m[3]?.toUpperCase() === "AM" && h === 12) h = 0;
          return h * 60 + min;
        };

        if (inTime && outTime) {
          const inMin = parseTimeToMinutes(inTime);
          const outMin = parseTimeToMinutes(outTime);
          if (inMin !== null && outMin !== null && outMin > inMin) {
            const hours = (outMin - inMin) / 60;
            workingHours = hours.toFixed(2);
            if (hours < 4) status = "half-day";
          }
        } else {
          status = "absent";
        }

        await storage.upsertAttendance(userId, parsedDate, {
          clockIn: inTime || undefined,
          clockOut: outTime || undefined,
          status,
          workingHours: workingHours ?? undefined,
        });
        imported++;
      }

      res.json({ imported, unmatched: Array.from(new Set(unmatched)) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/attendance/device-punch — biometric (K30) feed from the Electron agent.
  // Body: { deviceId?, punches: [{ biometricId, date?, time?, timestamp? }] }
  // Auth: device token (LAN agent) or an admin (owner) session only — managers & staff cannot.
  app.post("/api/attendance/device-punch", requireDeviceAuth, async (req, res) => {
    try {
      const { deviceId, punches } = req.body ?? {};
      const result = await ingestDevicePunches(punches ?? [], deviceId);
      if (result.affected.length > 0) {
        broadcast({
          type: "ATTENDANCE_UPDATE",
          dates: Array.from(new Set(result.affected.map(a => a.date))),
          userIds: Array.from(new Set(result.affected.map(a => a.userId).filter((x): x is number => x != null))),
          staffMemberIds: Array.from(new Set(result.affected.map(a => a.staffMemberId).filter((x): x is number => x != null))),
        });
      }
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/me?month=YYYY-MM — the logged-in person's OWN records only.
  // `users` and `staffMembers` share the integer id space, so disambiguate by `_isStaffMember`
  // to avoid a cross-table IDOR (a staff member reading a user's records with the same id).
  app.get("/api/attendance/me", requireAuth, async (req, res) => {
    try {
      const u = req.user as any;
      const month = (req.query.month as string) || undefined;
      const filter = u?._isStaffMember ? { staffMemberId: u.id, month } : { userId: u.id, month };
      res.json(await storage.getAttendance(filter));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/payroll/me/:month — the logged-in person's OWN payroll row only (kind-disambiguated).
  app.get("/api/payroll/me/:month", requireAuth, async (req, res) => {
    try {
      const u = req.user as any;
      const all = await storage.getPayrollReport(req.params.month);
      const row = all.find((r: any) => u?._isStaffMember
        ? r.kind === "staff" && r.staffMemberId === u.id
        : r.kind === "user"  && r.userId === u.id);
      res.json(row ?? null);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/person?kind=user|staff&id=<n>&month=YYYY-MM — an ARBITRARY person's
  // records, for the My Attendance page's admin/manager "view another member" picker.
  // Manager-or-admin, gated further by the admin-controlled managerCanViewAllAttendance toggle
  // (admins always allowed; managers only when the toggle is on). `getPayrollPeople()` excludes
  // admins/owner by construction, so a caller can never target another admin/owner account.
  app.get("/api/attendance/person", requireManagerOrAdmin, async (req, res) => {
    try {
      const role = (req.user as any)?.role;
      if (role === "manager" && !getSettings().managerCanViewAllAttendance) {
        return res.status(403).json({ message: "Manager attendance viewing is disabled" });
      }
      const kind = req.query.kind as string;
      const id = parseInt(req.query.id as string);
      const month = (req.query.month as string) || undefined;
      if ((kind !== "user" && kind !== "staff") || !Number.isFinite(id)) {
        return res.status(400).json({ message: "kind and id are required" });
      }
      const people = await storage.getPayrollPeople();
      if (!people.some(p => p.kind === kind && p.id === id)) {
        return res.status(404).json({ message: "Person not found" });
      }
      const filter = kind === "staff" ? { staffMemberId: id, month } : { userId: id, month };
      res.json(await storage.getAttendance(filter));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/payroll/person/:month?kind=user|staff&id=<n> — same "arbitrary person" shape as
  // above, for the Net Pay card. Same gating.
  app.get("/api/payroll/person/:month", requireManagerOrAdmin, async (req, res) => {
    try {
      const role = (req.user as any)?.role;
      if (role === "manager" && !getSettings().managerCanViewAllAttendance) {
        return res.status(403).json({ message: "Manager attendance viewing is disabled" });
      }
      const kind = req.query.kind as string;
      const id = parseInt(req.query.id as string);
      if ((kind !== "user" && kind !== "staff") || !Number.isFinite(id)) {
        return res.status(400).json({ message: "kind and id are required" });
      }
      const people = await storage.getPayrollPeople();
      if (!people.some(p => p.kind === kind && p.id === id)) {
        return res.status(404).json({ message: "Person not found" });
      }
      const all = await storage.getPayrollReport(req.params.month);
      const row = all.find((r: any) => kind === "staff"
        ? r.kind === "staff" && r.staffMemberId === id
        : r.kind === "user"  && r.userId === id);
      res.json(row ?? null);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PUT /api/attendance/:id — admin override. Owner-only.
  app.put("/api/attendance/:id", requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateAttendance(parseInt(req.params.id), {
        ...req.body,
        markedBy: (req.user as any)?.id,
      });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/attendance/manual — admin marks attendance manually. Owner-only.
  app.post("/api/attendance/manual", requireAdmin, async (req, res) => {
    try {
      const { userId, date, status, clockIn, clockOut, notes } = req.body;
      const record = await storage.upsertAttendance(userId, date, {
        status, clockIn, clockOut, notes,
        markedBy: (req.user as any)?.id,
      });
      res.json(record);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/leaves — ?status=&month=&userId=&staffMemberId=
  app.get("/api/leaves", requireAuth, async (req, res) => {
    try {
      const { userId, staffMemberId, month, status } = req.query as Record<string, string>;
      res.json(await storage.getLeaves({
        userId: userId ? parseInt(userId) : undefined,
        staffMemberId: staffMemberId ? parseInt(staffMemberId) : undefined,
        month: month || undefined,
        status: status || undefined,
      }));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/leaves — body { kind:"user"|"staff", id, leaveType, startDate, endDate, reason, totalDays }
  // (legacy { userId } still accepted). Stamps exactly one of userId/staffMemberId per the person kind.
  // requireManagerOrAdmin (not requireAuth): this takes an arbitrary {kind,id} target, not "self" —
  // a bare staff-tier session could otherwise file a leave request as anyone.
  app.post("/api/leaves", requireManagerOrAdmin, async (req, res) => {
    try {
      const { kind, id, userId, ...rest } = req.body;
      const person = kind && id != null ? { kind, id: Number(id) } : { kind: "user" as const, id: Number(userId) };
      res.json(await storage.createLeave({
        ...rest,
        userId: person.kind === "user" ? person.id : null,
        staffMemberId: person.kind === "staff" ? person.id : null,
      }));
    } catch (err: any) {
      const status = /overlapping/i.test(err.message ?? "") ? 409 : 500;
      res.status(status).json({ message: err.message });
    }
  });

  // PUT /api/leaves/:id — approve or reject. requireManagerOrAdmin: this is the approval
  // action, with no restriction against approving one's own request — a bare staff-tier
  // session could previously approve/reject any leave, including its own. Gating this
  // also makes reviewedBy: req.user.id safe by construction, since only a `users` account
  // (never a staffMember session) can carry role manager/admin — see CLAUDE.md's
  // id-collision note.
  app.put("/api/leaves/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const { status, notes } = req.body;
      const updated = await storage.updateLeave(parseInt(req.params.id), {
        status, notes,
        reviewedBy: (req.user as any)?.id,
        reviewedAt: new Date(),
      });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/shifts
  app.get("/api/shifts", requireAuth, async (req, res) => {
    try { res.json(await storage.getShifts()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/shifts — creates a shift TYPE definition (Morning/Evening/etc).
  app.post("/api/shifts", requireManagerOrAdmin, async (req, res) => {
    try { res.json(await storage.createShift(req.body)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PUT /api/shifts/:id
  app.put("/api/shifts/:id", requireManagerOrAdmin, async (req, res) => {
    try { res.json(await storage.updateShift(parseInt(req.params.id), req.body)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/shifts/roster?week=YYYY-WW
  app.get("/api/shifts/roster", requireAuth, async (req, res) => {
    try {
      // shared/weekMath.ts, the same week rule as the Staff page (the inline formula disagreed with it).
      const week = (req.query.week as string) || weekStringOf(new Date(`${istCalendarDate()}T12:00:00`));
      res.json(await storage.getRoster(week));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/shifts/roster — manually assign a shift to a person (user OR staff member) on a date.
  // Body { kind:"user"|"staff", id, date, shiftId } (legacy { userId } still accepted).
  // requireManagerOrAdmin: assigns/unassigns ANY employee to ANY date — roster management,
  // not self-service; a bare staff-tier session could previously do this for anyone.
  app.post("/api/shifts/roster", requireManagerOrAdmin, async (req, res) => {
    try {
      const { kind, id, userId, date, shiftId } = req.body;
      const person = kind && id != null
        ? { kind, id: Number(id) }
        : { kind: "user" as const, id: Number(userId) };
      res.json(await storage.upsertShiftAssignment(person, date, Number(shiftId), (req.user as any)?.id));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // DELETE /api/shifts/roster/:id — removes a MANUAL assignment (auto rows re-derive from punches).
  app.delete("/api/shifts/roster/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      await storage.deleteShiftAssignment(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/attendance/recompute-shifts — admin backfill: re-derive shift sessions + hours for a
  // month from stored punch endpoints. Body { month?: "YYYY-MM" } (defaults to current month).
  app.post("/api/attendance/recompute-shifts", requireAdmin, async (req, res) => {
    try {
      const month = (req.body?.month as string) || istCalendarDate().slice(0, 7);
      res.json(await recomputeShiftSessions(month));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/payroll/people — the unified payroll roster (accounts {manager,staff} + staff members;
  // admins/owner excluded). Used by the Staff "Biometric Setup" annotate-only list.
  app.get("/api/payroll/people", requireManagerOrAdmin, async (_req, res) => {
    try { res.json(await storage.getPayrollPeople()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });


  // GET /api/payroll/report/:month — YYYY-MM
  app.get("/api/payroll/report/:month", requireManagerOrAdmin, async (req, res) => {
    try { res.json(await storage.getPayrollReport(req.params.month)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  return httpServer;
}
