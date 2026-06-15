import fs from "fs";
import { eq, max } from "drizzle-orm";
import { db } from "./db";
import { restaurantSettings, orders } from "@shared/schema";
import { dataPath } from "./dataDir";

const SETTINGS_FILE = dataPath("restaurant-settings.json");

// ── Print types (shared with client/Electron) ─────────────────────────────────

export type {
  PrinterConfig,
  KOTPrintSettings,
  BillPrintSettings,
  PrintConfigSettings,
} from "@shared/print/types";
import type { PrintConfigSettings } from "@shared/print/types";

// ── Cart-level permission types ───────────────────────────────────────────────

export type CartAction =
  | "discount" | "complimentary" | "clearCart" | "cancelOrder"
  | "editItem" | "removeItem" | "splitBill" | "moveTable" | "mergeTable"
  | "holdOrder" | "printKot" | "printBill" | "saveOrder" | "settleOrder";

export type CartActionPermission = "off" | "pin" | "allowed";

export interface CartPermissions {
  manager: Record<CartAction, CartActionPermission>;
  staff:   Record<CartAction, CartActionPermission>;
}

const CART_ACTIONS: CartAction[] = [
  "discount", "complimentary", "clearCart", "cancelOrder",
  "editItem", "removeItem", "splitBill", "moveTable", "mergeTable",
  "holdOrder", "printKot", "printBill", "saveOrder", "settleOrder",
];

export const DEFAULT_CART_PERMISSIONS: CartPermissions = {
  manager: Object.fromEntries(CART_ACTIONS.map(a => [
    a,
    (["editItem", "removeItem"] as CartAction[]).includes(a) ? "pin" :
    (["discount","complimentary","clearCart","cancelOrder","splitBill","moveTable","mergeTable"] as CartAction[]).includes(a) ? "off" :
    "allowed",
  ])) as Record<CartAction, CartActionPermission>,
  staff: Object.fromEntries(CART_ACTIONS.map(a => [
    a,
    (["editItem", "removeItem"] as CartAction[]).includes(a) ? "pin" :
    (["discount","complimentary","clearCart","cancelOrder","splitBill","moveTable","mergeTable"] as CartAction[]).includes(a) ? "off" :
    "allowed",
  ])) as Record<CartAction, CartActionPermission>,
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
  cartPermissions: CartPermissions;
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
  containerCharge: 15,
  currency: "INR",
  currencySymbol: "₹",
  footerNote: "Thank you for dining with us!",
  posRoleTimeout: 2,
  printSettings: DEFAULT_PRINT_SETTINGS,
  managerAllowedPages: null,
  staffAllowedPages: null,
  cartPermissions: DEFAULT_CART_PERMISSIONS,
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
    cartPermissions: {
      manager: { ...DEFAULT_CART_PERMISSIONS.manager, ...(data.cartPermissions?.manager ?? {}) },
      staff:   { ...DEFAULT_CART_PERMISSIONS.staff,   ...(data.cartPermissions?.staff   ?? {}) },
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
    // Ensure billCounter is never behind the actual max order number in the DB
    // (guards against counter reset, data import, or any out-of-sync scenario)
    const [{ maxOrdNum }] = await db
      .select({ maxOrdNum: max(orders.orderNumber) })
      .from(orders);
    if (maxOrdNum) {
      const dbMax = parseInt(maxOrdNum.replace(/\D/g, ""), 10) || 0;
      const cached = settingsCache!.billCounter ?? 0;
      if (dbMax > cached) {
        settingsCache = { ...settingsCache!, billCounter: dbMax };
        db.insert(restaurantSettings)
          .values({ id: 1, settings: settingsCache as any, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: restaurantSettings.id,
            set: { settings: settingsCache as any, updatedAt: new Date() },
          })
          .catch((err: unknown) => console.error("[settings] Counter sync save failed:", err));
        console.log(`[settings] billCounter synced from DB max: ${dbMax}`);
      }
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
