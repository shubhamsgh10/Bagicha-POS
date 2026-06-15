/**
 * automationStore.ts
 * Persists automation config, logs, and per-customer preferences to JSON files.
 * Same pattern as settingsStore.ts — no database schema changes required.
 */

import fs from "fs";
import crypto from "crypto";
import { dataPath } from "../dataDir";

// ── File paths ─────────────────────────────────────────────────────────────────

const CONFIG_FILE  = dataPath("automation-config.json");
const LOG_FILE     = dataPath("automation-logs.json");
const PREFS_FILE   = dataPath("customer-prefs.json");

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

  /** Hour of day (0–23) to run the server-side automation rule engine. Default 10. */
  serverAutomationHour: number;

  // ── SMS via MSG91 ─────────────────────────────────────────────────────────
  /** MSG91 auth key for SMS sending. */
  msg91AuthKey: string;
  /** MSG91 sender ID (6-char registered sender, e.g. "BAGICHA"). */
  msg91SenderId: string;

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

  // ── WhatsApp driver / chatbot / agent inbox ───────────────────────────────
  /** Active WhatsApp driver. "baileys" = unofficial QR-paired, "meta" = Cloud API, "none" = off. */
  whatsappDriver: "baileys" | "meta" | "none";
  /** When true, automation messages are queued and sent automatically through the
   *  active driver. When false, the manual wa.me Send-tab flow is used. */
  whatsappAutoSend: boolean;
  /** Hard daily cap on automated outbound messages (ban avoidance for Baileys). */
  maxPerDay: number;
  /** FAQ chatbot enable flag (inbound auto-replies). */
  botEnabled: boolean;
  /** Minutes of agent inactivity before a human-takeover conversation returns to the bot. */
  botReturnMinutes: number;
  /** Bot answer for opening-hours questions (free text, e.g. "12pm–11pm, all days"). */
  botHoursText: string;
  /** Public menu link sent by the bot (e.g. Google Drive PDF / website). */
  menuUrl: string;
  /** Fallback text menu if no menuUrl is set. */
  menuText: string;
  /** Meta webhook verify token (you choose this; must match the Meta dashboard). */
  metaWebhookVerifyToken: string;
  /** Meta app secret — used to verify X-Hub-Signature-256 on webhooks. */
  metaAppSecret: string;

  // ── Checkout (settlement-time) messaging ──────────────────────────────────
  /** Send a welcome message to brand-new customers when their (paid) bill is settled. */
  settlementWelcomeEnabled: boolean;
  /** What a returning customer receives at a paid settlement.
   *  "off" = nothing, "auto" = segment-appropriate (VIP/favorite/thank-you),
   *  or force a specific template. */
  settlementReturningMode: "off" | "auto" | "vip_reward" | "favorite_item" | "thank_you";
  /** Editable thank-you template for returning customers. Tokens: {name} {visits} {favItem} {restaurant}. */
  settlementReturningText: string;
  /** Send an itemized reminder when a bill is left unpaid (due). */
  dueMessageEnabled: boolean;
  /** Editable due-reminder wrapper. Tokens: {name} {restaurant} {due} {bill} (where {bill} = itemized list). */
  dueMessageTemplate: string;
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
  serverAutomationHour: 10,
  msg91AuthKey: "",
  msg91SenderId: "",
  attendanceSheetUrl: "",
  attendanceColumnMapping: null,
  attendanceAutoSyncHour: -1,
  whatsappDriver: "none",
  whatsappAutoSend: false,
  maxPerDay: 100,
  botEnabled: true,
  botReturnMinutes: 30,
  botHoursText: "",
  menuUrl: "",
  menuText: "",
  metaWebhookVerifyToken: "",
  metaAppSecret: "",
  settlementWelcomeEnabled: true,
  settlementReturningMode: "auto",
  settlementReturningText:
    "Hi {name}! 🙏 Thank you for dining with us at *{restaurant}* again — we always love having you. " +
    "See you next time! 🌿",
  dueMessageEnabled: true,
  dueMessageTemplate:
    "Hi {name}! 🙏 Thank you for visiting *{restaurant}*. Here are your bill details:\n\n" +
    "{bill}\n\n" +
    "*Amount due: ₹{due}*\n\nPlease settle it at your convenience. Thank you! 🌿",
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
