import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { restaurantSettings } from "@shared/schema";

const SETTINGS_FILE = path.join(process.cwd(), "restaurant-settings.json");

// ── Print types (shared with client/Electron) ─────────────────────────────────

export type {
  PrinterConfig,
  KOTPrintSettings,
  BillPrintSettings,
  PrintConfigSettings,
} from "@shared/print/types";
import type { PrintConfigSettings } from "@shared/print/types";

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
  currency: string;
  currencySymbol: string;
  footerNote: string;
  posRoleTimeout: number;
  printSettings: PrintConfigSettings;
  managerAllowedPages: string[] | null; // null = all pages allowed
  staffAllowedPages: string[] | null;   // null = all pages allowed
  billCounter: number;
  kotCounter: number;
}

const DEFAULT_PRINT_SETTINGS: PrintConfigSettings = {
  printers: [],
  kot: {
    enabled: true,
    printOnBill: true,
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
  currency: "INR",
  currencySymbol: "₹",
  footerNote: "Thank you for dining with us!",
  posRoleTimeout: 2,
  printSettings: DEFAULT_PRINT_SETTINGS,
  managerAllowedPages: null,
  staffAllowedPages: null,
  billCounter: 0,
  kotCounter: 0,
};

// ── In-memory cache (survives within a single serverless instance) ────────────

let settingsCache: RestaurantSettings | null = null;

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

// Call once at server startup — seeds in-memory cache from DB (falls back to file)
export async function initSettings(): Promise<void> {
  try {
    const rows = await db.select().from(restaurantSettings).where(eq(restaurantSettings.id, 1));
    if (rows.length > 0) {
      settingsCache = buildSettings(rows[0].settings as Record<string, any>);
    } else {
      // First boot: seed DB from the committed JSON file so existing config is preserved
      const fileSettings = loadFromFile();
      settingsCache = fileSettings;
      await db.insert(restaurantSettings).values({ id: 1, settings: fileSettings as any });
    }
  } catch (e) {
    console.error("[settings] DB init failed, using file fallback:", e);
    settingsCache = loadFromFile();
  }
}

// Synchronous — reads from in-memory cache; falls back to file if cache not yet warm
export function getSettings(): RestaurantSettings {
  return settingsCache ?? loadFromFile();
}

// Sync — increments in-memory counter immediately, persists to DB async (fire-and-forget)
export function incrementBillCounter(): number {
  const current = getSettings();
  const next = (current.billCounter ?? 0) + 1;
  settingsCache = { ...current, billCounter: next };
  db.insert(restaurantSettings)
    .values({ id: 1, settings: settingsCache as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: restaurantSettings.id,
      set: { settings: settingsCache as any, updatedAt: new Date() },
    })
    .catch((err: unknown) => console.error("[settings] Bill counter save failed:", err));
  return next;
}

// Sync — increments in-memory KOT counter immediately, persists to DB async (fire-and-forget)
export function incrementKotCounter(): number {
  const current = getSettings();
  const next = (current.kotCounter ?? 0) + 1;
  settingsCache = { ...current, kotCounter: next };
  db.insert(restaurantSettings)
    .values({ id: 1, settings: settingsCache as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: restaurantSettings.id,
      set: { settings: settingsCache as any, updatedAt: new Date() },
    })
    .catch((err: unknown) => console.error("[settings] KOT counter save failed:", err));
  return next;
}

// Async — updates cache immediately, then awaits DB write before resolving
export async function saveSettings(settings: Partial<RestaurantSettings>): Promise<RestaurantSettings> {
  const current = getSettings();
  const updated: RestaurantSettings = { ...current, ...settings };
  if (settings.printSettings) {
    updated.printSettings = {
      ...current.printSettings,
      ...settings.printSettings,
      kot: { ...current.printSettings.kot, ...(settings.printSettings.kot ?? {}) },
      bill: { ...current.printSettings.bill, ...(settings.printSettings.bill ?? {}) },
    };
  }
  settingsCache = updated;
  await db.insert(restaurantSettings)
    .values({ id: 1, settings: updated as any, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: restaurantSettings.id,
      set: { settings: updated as any, updatedAt: new Date() },
    });
  return updated;
}
