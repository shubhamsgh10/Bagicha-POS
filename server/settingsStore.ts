import fs from "fs";
import { randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { eq, max, sql } from "drizzle-orm";
import { db } from "./db";
import { restaurantSettings, orders, kotTickets } from "@shared/schema";
import { dataPath } from "./dataDir";
import { createSettingsCache, SettingsUnavailableError } from "./settingsCache";

export { SettingsUnavailableError } from "./settingsCache";

const SETTINGS_FILE = dataPath("restaurant-settings.json");

// ── Print types (shared with client/Electron) ─────────────────────────────────

export type {
  PrinterConfig,
  KOTPrintSettings,
  BillPrintSettings,
  PrintConfigSettings,
  PosSection,
} from "@shared/print/types";
import type { PrintConfigSettings, PosSection } from "@shared/print/types";

// ── Cart-level permission types ───────────────────────────────────────────────

export type CartAction =
  | "discount" | "complimentary" | "clearCart" | "cancelOrder"
  | "editItem" | "removeItem" | "splitBill" | "moveTable" | "mergeTable"
  | "holdOrder" | "printKot" | "printBill" | "saveOrder" | "settleOrder"
  | "openItem" | "writeOff" | "cancelKotItem";

export type CartActionPermission = "off" | "pin" | "allowed";

export interface CartPermissions {
  manager: Record<CartAction, CartActionPermission>;
  staff:   Record<CartAction, CartActionPermission>;
}

const CART_ACTIONS: CartAction[] = [
  "discount", "complimentary", "clearCart", "cancelOrder",
  "editItem", "removeItem", "splitBill", "moveTable", "mergeTable",
  "holdOrder", "printKot", "printBill", "saveOrder", "settleOrder",
  "openItem", "writeOff", "cancelKotItem",
];

// "writeOff" (settling short and recording the gap as a loss — see shared/settlement.ts)
// defaults to "pin" alongside editItem/removeItem, not into the "off" list: unlike
// discount/cancelOrder/etc, a bare staff session settling a short payment is a normal
// end-of-shift occurrence, not something to fully lock out — but it's still money leaving
// the books uncollected, so it needs the same PIN gate an item edit gets. The server
// independently enforces this too (POST /api/orders/:id/payment's hasElevation check) —
// this default only controls the client-side prompt. "cancelKotItem" (removing a single
// item already sent to the kitchen on a printed KOT) is the same shape of decision — a
// normal, if regrettable, service occurrence rather than something to lock out entirely —
// and is likewise independently enforced server-side (PUT /api/orders/:id/items' own
// hasElevation check, see shared/kotItemCancel.ts).
export const DEFAULT_CART_PERMISSIONS: CartPermissions = {
  manager: Object.fromEntries(CART_ACTIONS.map(a => [
    a,
    (["editItem", "removeItem", "writeOff", "cancelKotItem"] as CartAction[]).includes(a) ? "pin" :
    (["discount","complimentary","clearCart","cancelOrder","splitBill","moveTable","mergeTable"] as CartAction[]).includes(a) ? "off" :
    "allowed",
  ])) as Record<CartAction, CartActionPermission>,
  staff: Object.fromEntries(CART_ACTIONS.map(a => [
    a,
    (["editItem", "removeItem", "writeOff", "cancelKotItem"] as CartAction[]).includes(a) ? "pin" :
    (["discount","complimentary","clearCart","cancelOrder","splitBill","moveTable","mergeTable"] as CartAction[]).includes(a) ? "off" :
    "allowed",
  ])) as Record<CartAction, CartActionPermission>,
};

// ── Biometric attendance device (K30 Pro) ─────────────────────────────────────

export interface AttendanceDeviceSettings {
  enabled: boolean;
  ip: string;
  port: number;            // ZKTeco TCP port, default 4370
  commKey: number;         // device comm key/password (0 = none)
  standardHours: number;   // hours/day before overtime kicks in
  syncIntervalSec: number; // reconcile full-pull interval for the Electron agent
  token: string;           // shared secret the Electron agent sends to authenticate punches
}

const DEFAULT_ATTENDANCE_DEVICE: AttendanceDeviceSettings = {
  enabled: false,
  ip: "",
  port: 4370,
  commKey: 0,
  standardHours: 8,
  syncIntervalSec: 60,
  token: "",
};

// ── Restaurant settings ───────────────────────────────────────────────────────

export interface RestaurantSettings {
  restaurantName: string;
  businessName: string;
  fssaiNumber: string;
  address: string;
  phone: string;
  email: string;
  gstNumber: string;
  taxRate: number;
  containerCharge: number; // flat per-container charge for pickup/delivery items & dine-in leftover parcels
  currency: string;
  currencySymbol: string;
  footerNote: string;
  posRoleTimeout: number;
  printSettings: PrintConfigSettings;
  managerAllowedPages: string[] | null; // null = all pages allowed
  staffAllowedPages: string[] | null;   // null = all pages allowed
  /** Admin-controlled: lets manager-tier sessions use My Attendance's "view another member" picker. Off by default. */
  managerCanViewAllAttendance: boolean;
  // Per-person page visibility for staff-tier people. Key "sm:<id>" (staff member) / "u:<id>" (staff
  // account) → allowed page hrefs. Absent key falls back to the person's role default (shared/pageAccess).
  staffPageAccess: Record<string, string[]>;
  cartPermissions: CartPermissions;
  billCounter: number;
  kotCounter: number;
  attendanceDevice: AttendanceDeviceSettings;
  /** Quick-POS sections (e.g. South Indian counter) — filtered menu + optional dedicated bill printer. */
  posSections: PosSection[];
}

const DEFAULT_PRINT_SETTINGS: PrintConfigSettings = {
  printers: [],
  kot: {
    enabled: true,
    printModifiedKOT: true,
    printModifiedItemsOnly: true,
    printCancelledKOT: true,
    printAddons: true,
    showDuplicateWatermark: true,
    printDeletedItems: true,
    printDeletedSeparate: false,
    printOnTableMove: false,
    kotPrinterId: null,
    autoKOTPrint: false,
    autoKOTDebounceMs: 1500,
    kotNumbering: true,
    categoryPrinterOverrides: {},
  },
  bill: {
    taxDisplay: 'none',
    itemPriceMode: 'exclusive',
    showBackwardTax: true,
    showDuplicate: true,
    showCustomerPayment: false,
    showKotAsToken: false,
    showAddons: true,
    mergeDuplicateItems: true,
    showOrderBarcode: false,
    showQuantityBreakdown: false,
    billPrinterId: null,
    showLogo: true,
    showFssai: false,
    showRoundOff: true,
    showNameField: true,
  },
};

const DEFAULT_SETTINGS: RestaurantSettings = {
  restaurantName: "Bagicha Restaurant",
  businessName: "",
  fssaiNumber: "",
  address: "",
  phone: "",
  email: "",
  gstNumber: "",
  taxRate: 18,
  containerCharge: 15,
  currency: "INR",
  currencySymbol: "₹",
  footerNote: "Thank you for dining with us!",
  posRoleTimeout: 2,
  printSettings: DEFAULT_PRINT_SETTINGS,
  managerAllowedPages: null,
  staffAllowedPages: null,
  managerCanViewAllAttendance: false,
  staffPageAccess: {},
  cartPermissions: DEFAULT_CART_PERMISSIONS,
  billCounter: 0,
  kotCounter: 0,
  attendanceDevice: DEFAULT_ATTENDANCE_DEVICE,
  posSections: [],
};

// ── In-memory cache (survives within a single serverless instance) ────────────
//
// The cache distinguishes REAL settings (read from / written to the DB — "live") from the
// DEFAULT_SETTINGS / committed-file fallback. See settingsCache.ts for why: a cold instance whose
// one-shot read failed used to serve the fallback (18% tax, no printers) indefinitely. Anything
// that prices an order or decides where to print must use getLiveSettings(), and every /api
// request passes settingsGuard first, which self-heals or refuses with 503.

const cache = createSettingsCache<RestaurantSettings>({
  load: loadFromDb,
  fallback: loadFromFile,
});

function buildSettings(data: Record<string, any>): RestaurantSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    printSettings: {
      ...DEFAULT_PRINT_SETTINGS,
      ...(data.printSettings ?? {}),
      kot: { ...DEFAULT_PRINT_SETTINGS.kot, ...(data.printSettings?.kot ?? {}) },
      bill: { ...DEFAULT_PRINT_SETTINGS.bill, ...(data.printSettings?.bill ?? {}) },
    },
    cartPermissions: {
      manager: { ...DEFAULT_CART_PERMISSIONS.manager, ...(data.cartPermissions?.manager ?? {}) },
      staff:   { ...DEFAULT_CART_PERMISSIONS.staff,   ...(data.cartPermissions?.staff   ?? {}) },
    },
    attendanceDevice: { ...DEFAULT_ATTENDANCE_DEVICE, ...(data.attendanceDevice ?? {}) },
  };
}

function loadFromFile(): RestaurantSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return buildSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")));
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

// Reads the settings singleton from the DB. THROWS on any failure — retry, timeout and the
// fallback policy all belong to the cache (settingsCache.ts), never to this function. A
// returned value is, by construction, real DB state.
async function loadFromDb(): Promise<RestaurantSettings> {
  const rows = await db.select().from(restaurantSettings).where(eq(restaurantSettings.id, 1));
  if (rows.length > 0) return buildSettings(rows[0].settings as Record<string, any>);

  // The table is truly empty: first boot of a fresh database. Seed it from the committed JSON
  // file so existing config is preserved. Loud on purpose — on a deployment with no file this
  // seeds the built-in defaults, which is only right for a brand-new install.
  console.warn("[settings] no settings row found — seeding from restaurant-settings.json / defaults");
  const seeded = loadFromFile();
  await db.insert(restaurantSettings).values({ id: 1, settings: seeded as any }).onConflictDoNothing();
  // Another instance may have seeded first; read back whichever row actually won.
  const again = await db.select().from(restaurantSettings).where(eq(restaurantSettings.id, 1));
  return again.length > 0 ? buildSettings(again[0].settings as Record<string, any>) : seeded;
}

// Ensures a counter is never behind the actual max number already used in its
// table — guards against counter reset, data import, or any out-of-sync scenario.
// Necessary even with the atomic issueCounter() above: that only prevents the
// PERSISTED counter from drifting further behind going forward — it can't repair
// a counter that's already behind (e.g. left there by the old per-instance-cache
// issuance, which could overwrite the DB value backward when a stale instance's
// lower cached value raced a fresher one). A behind counter means the very next
// atomic increment collides with a row that already exists.
async function syncCounterFromMax(
  field: "billCounter" | "kotCounter",
  maxValueRaw: string | null,
): Promise<void> {
  if (!maxValueRaw) return;
  const dbMax = parseInt(maxValueRaw.replace(/\D/g, ""), 10) || 0;
  const cached = cache.get()[field] ?? 0;
  if (dbMax <= cached) return;
  // Only ever runs after a successful DB load (settingsCache.ts init()), so this blob is the
  // DB's own settings plus the repaired counter — never the built-in fallback.
  const repaired = { ...cache.get(), [field]: dbMax };
  cache.patch(() => repaired);
  await db.insert(restaurantSettings)
    .values({ id: 1, settings: repaired as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: restaurantSettings.id,
      set: { settings: repaired as any, updatedAt: new Date() },
    })
    .catch((err: unknown) => console.error(`[settings] ${field} sync save failed:`, err));
  console.log(`[settings] ${field} synced from DB max: ${dbMax}`);
}

// Call once at server startup. Never throws: if the DB can't be read the cache simply stays
// NOT live, settingsGuard answers 503 until a read succeeds (it retries on every request), and
// nothing ever prices or prints from the built-in defaults in the meantime.
export async function initSettings(): Promise<void> {
  const ok = await cache.init(async () => {
    // Runs only after the settings loaded; a failure here is logged and must not discard them.
    const [[{ maxOrdNum }], [{ maxKotNum }]] = await Promise.all([
      db.select({ maxOrdNum: max(orders.orderNumber) }).from(orders),
      db.select({ maxKotNum: max(kotTickets.kotNumber) }).from(kotTickets),
    ]);
    await syncCounterFromMax("billCounter", maxOrdNum);
    await syncCounterFromMax("kotCounter", maxKotNum);
  });
  if (ok) {
    const s = cache.get();
    console.log(`[settings] loaded from DB (taxRate=${s.taxRate}%, printers=${s.printSettings.printers.length})`);
  } else {
    console.error("[settings] DB read failed at boot — /api requests are refused (503) until the settings load; retrying on each request");
  }
}

// Synchronous — never throws. Before the first successful load this is the file/defaults
// FALLBACK, which must not be used for anything that prices an order or chooses a printer:
// use getLiveSettings() there.
export function getSettings(): RestaurantSettings {
  return cache.get();
}

// The settings as read from (or written to) the DB; throws SettingsUnavailableError (status 503)
// if this process has never held real settings. This is what pricing and printing use.
export function getLiveSettings(): RestaurantSettings {
  return cache.getLive();
}

// Async — re-reads the settings row straight from the DB and refreshes the cache, instead
// of trusting this process's possibly-stale copy. On Vercel the cache is per-instance and only
// updated by writes THIS instance performs — a concurrently-warm instance that was
// cold-started before some other instance saved a change (e.g. a newly-added posSections
// entry from Admin -> Print Settings) keeps serving its old snapshot until it re-reads (the
// cache also re-reads on its own every ~60s). A single attempt: callers are request paths, and
// if the DB is down the last real value (or a SettingsUnavailableError) is the right answer.
export async function getSettingsFresh(): Promise<RestaurantSettings> {
  await cache.refresh({ attempts: 1 });
  return cache.getLive();
}

/**
 * Express guard mounted on /api in both server entries, BEFORE any route. It makes the rule
 * "no request is served from fallback defaults" structural rather than per-handler:
 *  - settings live and fresh        → next() (no DB work)
 *  - live but older than ~60s       → one quick re-read, then next() (serves last-known-good on failure)
 *  - not live (the boot read failed) → retries the read; still failing → 503, never defaults
 * /health and /version stay reachable so uptime probes work while settings are unavailable.
 */
export function settingsGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health" || req.path === "/version") return next();
  cache.ensureLive().then(
    () => next(),
    (err) => {
      if (err instanceof SettingsUnavailableError) {
        res.setHeader("Retry-After", "2");
        res.status(err.status).json({ message: err.message });
        return;
      }
      next(err);
    },
  );
}

/**
 * BENCH ONLY (scripts/bench-print-latency.ts): swaps the in-memory settings snapshot so the
 * print pipeline can run with fake printers WITHOUT reading or writing the restaurant's real
 * settings. Hard-gated on PRINT_BENCH=1, which no server entry point ever sets — calling it
 * from a request path throws.
 */
export function __setSettingsForBench(next: RestaurantSettings | null): void {
  if (process.env.PRINT_BENCH !== "1") {
    throw new Error("__setSettingsForBench is only available to bench scripts (PRINT_BENCH=1)");
  }
  if (next === null) cache.reset();
  else cache.set(next);
}

// Counter issuance is allocated by the DATABASE, not from the in-memory cache.
//
// The number must be unique across every process that can create an order, and
// the settings cache is per-process: on Vercel each serverless instance holds its own
// cache + its own mutex, so a JS-side read-modify-write ("next = cache + 1") let two
// instances hand out the SAME orderNumber — the loser blew up on the
// orderNumber/kotNumber UNIQUE constraint and surfaced as a generic 400 that
// succeeded on retry. A warm instance also drifts behind once another instance issues
// numbers (the cache now re-reads about once a minute, but issuance must never depend on it).
//
// This single UPDATE increments the counter inside the settings JSON and RETURNs
// the new value. Postgres takes a row lock on id=1, so concurrent callers queue and
// each re-reads the committed value before incrementing — unique numbers across all
// instances, no app-level mutex needed. It also only touches the counter key, so an
// order can no longer clobber unrelated settings with a stale cached blob.
async function issueCounter(field: "billCounter" | "kotCounter"): Promise<number> {
  const result: any = await db.execute(sql`
    UPDATE restaurant_settings
    SET settings = jsonb_set(
          settings::jsonb,
          ARRAY[${field}]::text[],
          to_jsonb(COALESCE((settings ->> ${field})::int, 0) + 1)
        )::json,
        updated_at = NOW()
    WHERE id = 1
    RETURNING (settings ->> ${field})::int AS value
  `);
  const next = Number(result?.rows?.[0]?.value);
  if (!Number.isFinite(next)) {
    // id=1 is seeded by initSettings(); a miss means the settings row is gone.
    throw new Error(`Counter '${field}' could not be issued (settings row missing?)`);
  }
  // Keep the local cache roughly warm for getSettings() readers. The DB is the
  // source of truth for issuance — this value is only cosmetic. patch(), not set(): a counter
  // bump must not make the cached tax rate / printers look freshly read, or an instance that
  // issues order numbers every few seconds would never re-read settings saved elsewhere.
  cache.patch((current) => ({ ...current, [field]: next }));
  return next;
}

function nextCounter(field: "billCounter" | "kotCounter"): Promise<number> {
  return issueCounter(field);
}

export function incrementBillCounter(): Promise<number> {
  return nextCounter("billCounter");
}

export function incrementKotCounter(): Promise<number> {
  return nextCounter("kotCounter");
}

// Async — reads, merges, and writes inside ONE db.transaction with a row lock
// (SELECT ... FOR UPDATE) on id=1, so the whole read-modify-write is atomic against
// both a concurrent saveSettings call AND issueCounter()'s atomic jsonb_set UPDATE.
//
// Before this, saveSettings did its read (readSettingsFromDb) and its write
// (onConflictDoUpdate) as two separate round trips with no lock between them. If
// issueCounter incremented billCounter 5->6 and committed in that window, this
// function's `updated` object still had the stale billCounter:5 it read earlier
// baked in, and its full-row write stomped the counter back down to 5 — the exact
// class of bug CLAUDE.md documents as already fixed for counter issuance, just not
// yet closed for general settings saves. FOR UPDATE serializes against issueCounter's
// plain UPDATE on the same row (a bare UPDATE on a row waits for a FOR UPDATE lock
// on that row to release), so a counter increment can no longer land inside this
// function's read-to-write window.
export async function saveSettings(settings: Partial<RestaurantSettings>): Promise<RestaurantSettings> {
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.select().from(restaurantSettings).where(eq(restaurantSettings.id, 1)).for("update");
    const current: RestaurantSettings = rows.length > 0 ? buildSettings(rows[0].settings as Record<string, any>) : loadFromFile();

    const merged: RestaurantSettings = { ...current, ...settings };
    if (settings.attendanceDevice) {
      merged.attendanceDevice = { ...current.attendanceDevice, ...settings.attendanceDevice };
      // A blank incoming token (e.g. redacted from a non-owner view) must never wipe the real one.
      if (!settings.attendanceDevice.token) {
        merged.attendanceDevice.token = current.attendanceDevice.token;
      }
      // Auto-provision a device token the first time the device is enabled.
      if (merged.attendanceDevice.enabled && !merged.attendanceDevice.token) {
        merged.attendanceDevice = { ...merged.attendanceDevice, token: randomBytes(24).toString("hex") };
      }
    }
    if (settings.printSettings) {
      merged.printSettings = {
        ...current.printSettings,
        ...settings.printSettings,
        kot: { ...current.printSettings.kot, ...(settings.printSettings.kot ?? {}) },
        bill: { ...current.printSettings.bill, ...(settings.printSettings.bill ?? {}) },
      };
    }

    await tx.insert(restaurantSettings)
      .values({ id: 1, settings: merged as any, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: restaurantSettings.id,
        set: { settings: merged as any, updatedAt: new Date() },
      });
    return merged;
  });
  cache.set(updated); // authoritative: just written to the DB, so live + fresh
  return updated;
}
