/**
 * automationStore.ts
 * Persists automation config, logs, and per-customer preferences to JSON files.
 * Same pattern as settingsStore.ts — no database schema changes required.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── File paths ─────────────────────────────────────────────────────────────────

const CONFIG_FILE  = path.join(process.cwd(), "automation-config.json");
const LOG_FILE     = path.join(process.cwd(), "automation-logs.json");
const PREFS_FILE   = path.join(process.cwd(), "customer-prefs.json");

// ── Types ──────────────────────────────────────────────────────────────────────

export type TriggerType = "AT_RISK" | "VIP_REWARD" | "WIN_BACK" | "WELCOME" | "FAVORITE_ITEM";

export interface AutomationConfig {
  enabled: boolean;
  runIntervalHours: number;     // default 1
  maxPerRun: number;            // max messages per scheduler run (default 50)
  sendDelayMs: number;          // ms between sends (default 3000)
  // WATI provider
  watiApiKey: string;
  watiEndpoint: string;         // e.g. https://live-mt-server.wati.io/ACCOUNT_ID
  // Meta WhatsApp Cloud API provider
  metaPhoneNumberId: string;    // WhatsApp Phone Number ID from Meta Dashboard
  metaAccessToken: string;      // System User permanent access token
  // Other
  anthropicApiKey: string;      // if set → use Claude for message generation
  restaurantName: string;
  trackingBaseUrl: string;      // e.g. https://your-pos.com — appended to tracking links

  // ── Phase 1 growth additions ──────────────────────────────────────────────
  /** Razorpay API key (public). Set via Settings → Payment integration. */
  razorpayKeyId: string;
  /** Razorpay secret. Server-side only — never returned to client unmasked. */
  razorpayKeySecret: string;
  /** Razorpay webhook secret for signature verification. */
  razorpayWebhookSecret: string;

  /** Owner WhatsApp number that receives the daily AI digest (e.g. 919812345678). */
  ownerWhatsappPhone: string;
  /** Daily digest enable flag. */
  dailyDigestEnabled: boolean;
  /** Hour of day (0–23, restaurant local time) to send the digest. Default 23. */
  dailyDigestHour: number;

  /** NPS / feedback enable flag. When true, payment auto-triggers feedback send. */
  feedbackEnabled: boolean;
  /** Minutes after payment before the feedback message goes out (default 120). */
  feedbackDelayMinutes: number;
  /** Public-facing base URL used in feedback links (defaults to trackingBaseUrl). */
  feedbackBaseUrl: string;

  /** Birthday automation enable flag. */
  birthdayEnabled: boolean;
  /** Hour of day (0–23) to fire birthday/anniversary scan. Default 9. */
  birthdayHour: number;

  // ── Staff / Attendance ────────────────────────────────────────────────────
  /** Google Sheet URL for biometric attendance export. */
  attendanceSheetUrl: string;
  /** Maps sheet column headers to attendance fields. */
  attendanceColumnMapping: {
    employeeName:  string;
    employeeCode?: string;
    date:          string;
    punchIn?:      string;
    punchOut?:     string;
    hoursWorked?:  string;
    status?:       string;
  } | null;
  /** Auto-sync attendance daily at this hour (0–23). -1 = disabled. */
  attendanceAutoSyncHour: number;
}

export interface AutomationLog {
  id: string;                   // uuid
  customerId: string;           // phone || name (dedup key)
  customerName: string;
  phone: string;
  trigger: TriggerType;
  message: string;
  sentAt: string;               // ISO
  status: "sent" | "failed" | "skipped";
  error?: string;
  campaign: string;             // same as trigger, for tracking
}

export interface CustomerPref {
  doNotSend: boolean;
  mutedUntil?: string;          // ISO — temporary mute
}

// ── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AutomationConfig = {
  enabled: false,
  runIntervalHours: 1,
  maxPerRun: 50,
  sendDelayMs: 3000,
  watiApiKey: "",
  watiEndpoint: "",
  metaPhoneNumberId: "",
  metaAccessToken: "",
  anthropicApiKey: "",
  restaurantName: "Bagicha",
  trackingBaseUrl: "",
  razorpayKeyId: "",
  razorpayKeySecret: "",
  razorpayWebhookSecret: "",
  ownerWhatsappPhone: "",
  dailyDigestEnabled: false,
  dailyDigestHour: 23,
  feedbackEnabled: false,
  feedbackDelayMinutes: 120,
  feedbackBaseUrl: "",
  birthdayEnabled: false,
  birthdayHour: 9,
  attendanceSheetUrl: "",
  attendanceColumnMapping: null,
  attendanceAutoSyncHour: -1,
};

// ── Generic JSON helpers ───────────────────────────────────────────────────────

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch {}
  return fallback;
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── Config ─────────────────────────────────────────────────────────────────────

export function getAutomationConfig(): AutomationConfig {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<AutomationConfig>>(CONFIG_FILE, {}) };
}

export function saveAutomationConfig(patch: Partial<AutomationConfig>): AutomationConfig {
  const current = getAutomationConfig();
  const updated  = { ...current, ...patch };
  writeJson(CONFIG_FILE, updated);
  return updated;
}

// ── Logs ───────────────────────────────────────────────────────────────────────

const MAX_LOGS = 2000;

export function loadLogs(): AutomationLog[] {
  return readJson<AutomationLog[]>(LOG_FILE, []);
}

export function appendLog(entry: Omit<AutomationLog, "id">): AutomationLog {
  const logs = loadLogs();
  const newEntry: AutomationLog = { id: crypto.randomUUID(), ...entry };
  logs.push(newEntry);
  // Keep only most recent MAX_LOGS
  writeJson(LOG_FILE, logs.slice(-MAX_LOGS));
  return newEntry;
}

export function clearLogs(): void {
  writeJson(LOG_FILE, []);
}

/** Returns true if this customer already has a log entry from today. */
export function hasBeenMessagedToday(customerId: string): boolean {
  const today = new Date().toDateString();
  return loadLogs().some(
    l => l.customerId === customerId && new Date(l.sentAt).toDateString() === today
  );
}

// ── Per-customer preferences ───────────────────────────────────────────────────

export function loadCustomerPrefs(): Record<string, CustomerPref> {
  return readJson<Record<string, CustomerPref>>(PREFS_FILE, {});
}

export function setCustomerPref(customerId: string, pref: Partial<CustomerPref>): void {
  const prefs = loadCustomerPrefs();
  prefs[customerId] = { ...prefs[customerId], ...pref };
  writeJson(PREFS_FILE, prefs);
}

export function isOptedOut(customerId: string): boolean {
  const prefs = loadCustomerPrefs();
  const pref  = prefs[customerId];
  if (!pref) return false;
  if (pref.doNotSend) return true;
  if (pref.mutedUntil && new Date(pref.mutedUntil) > new Date()) return true;
  return false;
}

// ── Stats ──────────────────────────────────────────────────────────────────────

export function getAutomationStats() {
  const logs    = loadLogs();
  const today   = new Date().toDateString();
  const sentToday = logs.filter(l => new Date(l.sentAt).toDateString() === today && l.status === "sent").length;
  const total     = logs.filter(l => l.status === "sent").length;
  const failed    = logs.filter(l => l.status === "failed").length;

  const byTrigger: Record<string, number> = {};
  for (const l of logs) {
    if (l.status === "sent") byTrigger[l.trigger] = (byTrigger[l.trigger] ?? 0) + 1;
  }

  return { total, sentToday, failed, byTrigger };
}
