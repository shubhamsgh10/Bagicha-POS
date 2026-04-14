import { type CustomerProfile, type CustomerTag } from "@/hooks/useCustomerIntelligence";

// ── Automation Settings (localStorage-backed) ─────────────────────────────────

export interface AutomationSettings {
  enabled: boolean;
  whatsappMode: "web" | "api";   // "web" = open wa.me, "api" = WATI
  templateMode: boolean;          // true = smart templates, false = AI (Claude)
  dailyLimit: number;             // max messages per run
  inactivityDays: number;         // days before "at risk" trigger fires
  quietHours: { start: number; end: number }; // 0–23; no sends in this window
}

const SETTINGS_KEY = "bagicha_automation_settings";

export const DEFAULT_SETTINGS: AutomationSettings = {
  enabled: true,
  whatsappMode: "web",
  templateMode: true,
  dailyLimit: 50,
  inactivityDays: 7,
  quietHours: { start: 22, end: 9 },
};

export function getAutomationSettings(): AutomationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAutomationSettings(settings: AutomationSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriggerType = "AT_RISK" | "VIP_REWARD" | "WIN_BACK" | "WELCOME";

export interface AutomationLogEntry {
  customerId: string;    // customer key (phone || name)
  customerName: string;
  trigger: TriggerType;
  message: string;
  sentAt: string;        // ISO date string
}

export interface FollowUpItem {
  customer: CustomerProfile;
  trigger: TriggerType;
  message: string;
  priority: number;      // lower = higher priority (0 is most urgent)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_KEY = "bagicha_automation_log";
const AT_RISK_TRIGGER_DAYS = 7;   // flag after 7 days (lower than the 15-day "At Risk" tag threshold)
const INACTIVE_TRIGGER_DAYS = 30; // win-back for very inactive

// ── Log management ────────────────────────────────────────────────────────────

export function loadAutomationLog(): AutomationLogEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
}

function saveLog(log: AutomationLogEntry[]) {
  // Keep last 500 entries
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500)));
}

export function hasBeenMessagedToday(customerId: string): boolean {
  const today = new Date().toDateString();
  return loadAutomationLog().some(
    e => e.customerId === customerId && new Date(e.sentAt).toDateString() === today
  );
}

export function logMessageSent(
  customerId: string,
  customerName: string,
  trigger: TriggerType,
  message: string
): void {
  const log = loadAutomationLog();
  log.push({ customerId, customerName, trigger, message, sentAt: new Date().toISOString() });
  saveLog(log);
}

export function clearAutomationLog(): void {
  localStorage.removeItem(LOG_KEY);
}

// ── Trigger evaluation ────────────────────────────────────────────────────────

interface CustomerExtra {
  doNotSendUpdate: boolean;
  notificationEnabled: boolean;
}

/**
 * Determines which follow-up trigger applies to a customer.
 * Returns null if the customer should not be messaged.
 */
export function evaluateCustomerTrigger(
  customer: CustomerProfile,
  extra: CustomerExtra
): TriggerType | null {
  // Safety gates
  if (extra.doNotSendUpdate) return null;
  if (!extra.notificationEnabled) return null;
  if (!customer.phone) return null;           // can't WhatsApp without phone

  const { tag, daysSinceLastVisit, totalVisits } = customer;

  if (daysSinceLastVisit >= INACTIVE_TRIGGER_DAYS) return "WIN_BACK";
  if (tag === "At Risk" && daysSinceLastVisit >= AT_RISK_TRIGGER_DAYS) return "AT_RISK";
  if (tag === "VIP") return "VIP_REWARD";
  if (tag === "New" && totalVisits === 1) return "WELCOME";

  return null;
}

// ── Message generation ────────────────────────────────────────────────────────

const RESTAURANT = "Bagicha";

export function generatePersonalizedMessage(
  customer: CustomerProfile,
  trigger: TriggerType,
  favoriteItem?: string | null
): string {
  const name = customer.name.split(" ")[0]; // first name only
  const favPart = favoriteItem ? ` (especially your favourite *${favoriteItem}*)` : "";

  switch (trigger) {
    case "WIN_BACK":
      return (
        `Hi ${name}! 🌿 We've been missing you at *${RESTAURANT}*! ` +
        `It's been ${customer.daysSinceLastVisit} days since your last visit${favPart}. ` +
        `Come back and enjoy *10% off* your next order — just show this message. Valid for 7 days. See you soon! 🍽️`
      );

    case "AT_RISK":
      return (
        `Hi ${name}! 🙏 We noticed it's been a while since you visited *${RESTAURANT}*. ` +
        `We'd love to have you back! Here's a little treat: *complimentary dessert* on your next visit. ` +
        `Simply show this message. Hope to see you soon! 😊`
      );

    case "VIP_REWARD":
      return (
        `Hi ${name}! ⭐ As one of our most valued guests at *${RESTAURANT}* with ${customer.totalVisits} visits, ` +
        `we truly appreciate your loyalty. Enjoy a *complimentary starter* on your next visit — ` +
        `just show this message at the counter. Thank you for being special! 🙏`
      );

    case "WELCOME":
      return (
        `Hi ${name}! 🎉 Welcome to the *${RESTAURANT}* family! We're so glad you dined with us. ` +
        `As a welcome gift, enjoy *5% off* your next visit — show this message to claim it. ` +
        `Looking forward to serving you again! 🌿`
      );
  }
}

// ── Priority scoring ──────────────────────────────────────────────────────────

const TRIGGER_PRIORITY: Record<TriggerType, number> = {
  WIN_BACK:   0,
  AT_RISK:    1,
  VIP_REWARD: 2,
  WELCOME:    3,
};

export const TRIGGER_LABELS: Record<TriggerType, { label: string; color: string; emoji: string }> = {
  WIN_BACK:   { label: "Win-Back",   color: "text-red-600 bg-red-50 border-red-200",       emoji: "🎁" },
  AT_RISK:    { label: "At Risk",    color: "text-orange-600 bg-orange-50 border-orange-200", emoji: "⚠️" },
  VIP_REWARD: { label: "VIP Reward", color: "text-amber-600 bg-amber-50 border-amber-200",  emoji: "⭐" },
  WELCOME:    { label: "Welcome",    color: "text-emerald-600 bg-emerald-50 border-emerald-200", emoji: "🎉" },
};

// ── Queue builder ─────────────────────────────────────────────────────────────

/**
 * Builds the full automation follow-up queue from all customers.
 * Filters out already-messaged-today and safety-gated customers.
 * Sorted by priority (Win-Back first).
 */
export function buildFollowUpQueue(
  customers: CustomerProfile[],
  extras: Record<string, { doNotSendUpdate: boolean; notificationEnabled: boolean }>,
  favoriteItems?: Record<string, string | null>
): FollowUpItem[] {
  const queue: FollowUpItem[] = [];

  for (const customer of customers) {
    if (hasBeenMessagedToday(customer.key)) continue;

    const extra = extras[customer.key] ?? { doNotSendUpdate: false, notificationEnabled: true };
    const trigger = evaluateCustomerTrigger(customer, extra);
    if (!trigger) continue;

    const favItem = favoriteItems?.[customer.key] ?? null;
    const message = generatePersonalizedMessage(customer, trigger, favItem);

    queue.push({
      customer,
      trigger,
      message,
      priority: TRIGGER_PRIORITY[trigger],
    });
  }

  // Sort by priority then by days since last visit (most overdue first)
  return queue.sort((a, b) =>
    a.priority !== b.priority
      ? a.priority - b.priority
      : b.customer.daysSinceLastVisit - a.customer.daysSinceLastVisit
  );
}

// ── Run-log (separate from send-log — tracks automation run outcomes) ─────────

export interface RunLogEntry {
  type: "success" | "error" | "skipped";
  customerId?: string;
  customerName?: string;
  trigger?: TriggerType;
  message?: string;
  errorMessage?: string;
  timestamp: string;
}

const RUN_LOG_KEY = "bagicha_automation_logs";

export function loadRunLog(): RunLogEntry[] {
  try { return JSON.parse(localStorage.getItem(RUN_LOG_KEY) || "[]"); } catch { return []; }
}

export function logRunSuccess(customer: CustomerProfile, trigger: TriggerType, message: string): void {
  const logs = loadRunLog();
  logs.unshift({
    type: "success",
    customerId: customer.key,
    customerName: customer.name,
    trigger,
    message,
    timestamp: new Date().toISOString(),
  });
  localStorage.setItem(RUN_LOG_KEY, JSON.stringify(logs.slice(0, 500)));
}

export function logRunError(errorMessage: string): void {
  const logs = loadRunLog();
  logs.unshift({ type: "error", errorMessage, timestamp: new Date().toISOString() });
  localStorage.setItem(RUN_LOG_KEY, JSON.stringify(logs.slice(0, 500)));
}

export function clearRunLog(): void {
  localStorage.removeItem(RUN_LOG_KEY);
}

// ── Quiet-hours check ─────────────────────────────────────────────────────────

export function isInQuietHours(quietHours: { start: number; end: number }): boolean {
  const h = new Date().getHours();
  const { start, end } = quietHours;
  if (start > end) return h >= start || h < end;   // e.g. 22–09 wraps midnight
  return h >= start && h < end;
}

// ── Phone normalizer ──────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

// ── Client-side automation run ────────────────────────────────────────────────

export interface RunResult {
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
  blockedByQuietHours: boolean;
}

/**
 * Runs the full automation flow client-side.
 * Opens WhatsApp Web for each eligible customer (whatsappMode === "web").
 * Returns a result summary and writes to the run log.
 *
 * This is the PRIMARY run path — 100% client-side, no server required.
 */
export async function runAutomationClientSide(
  customers: CustomerProfile[],
  extras: Record<string, { doNotSendUpdate: boolean; notificationEnabled: boolean }>,
  settings: AutomationSettings
): Promise<RunResult> {
  const result: RunResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
    blockedByQuietHours: false,
  };

  if (!settings.enabled) {
    logRunError("Automation is disabled — enable it in Settings to run");
    throw new Error("Automation is turned OFF. Enable it in Settings first.");
  }

  if (isInQuietHours(settings.quietHours)) {
    result.blockedByQuietHours = true;
    logRunError(`Quiet hours active (${settings.quietHours.start}:00 – ${settings.quietHours.end}:00). No messages sent.`);
    return result;
  }

  const queue = buildFollowUpQueue(customers, extras);

  if (queue.length === 0) {
    logRunError("No eligible customers found for follow-up today");
    return result;
  }

  const limit = Math.min(queue.length, settings.dailyLimit);

  for (let i = 0; i < limit; i++) {
    const item = queue[i];
    result.processed++;

    try {
      if (!item.customer.phone) {
        result.skipped++;
        continue;
      }

      if (settings.whatsappMode === "web") {
        const phone = normalizePhone(item.customer.phone);
        if (phone.length < 12) { result.skipped++; continue; }
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(item.message)}`;
        window.open(url, "_blank", "noopener,noreferrer");
      }
      // "api" mode: logged as dry-run since WATI key is managed server-side
      // Client-side just records the intent

      logMessageSent(item.customer.key, item.customer.name, item.trigger, item.message);
      logRunSuccess(item.customer, item.trigger, item.message);
      result.sent++;

      // Small delay so browser doesn't block popup openers
      if (i < limit - 1) await new Promise(r => setTimeout(r, 800));
    } catch (err: any) {
      result.errors++;
      logRunError(`Failed for ${item.customer.name}: ${err?.message ?? "Unknown error"}`);
    }
  }

  return result;
}
