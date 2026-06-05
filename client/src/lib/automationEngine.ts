import { apiUrl } from '@/lib/api';
import { type CustomerProfile } from "@/hooks/useCustomerIntelligence";

// ── Automation Settings (localStorage-backed) ─────────────────────────────────

export interface AutomationSettings {
  enabled: boolean;
  autoOff: boolean;               // disable automation outside send window
  whatsappMode: "web" | "api" | "meta"; // "web"=wa.me, "api"=WATI, "meta"=Meta Cloud API
  templateMode: boolean;          // true = smart templates, false = AI (Claude)
  dailyLimit: number;             // max messages per run (legacy alias for maxPerRun)
  inactivityDays: number;         // days before "at risk" trigger fires
  quietHours: { start: number; end: number }; // 0–23; no sends in this window
  cooldownHours: number;          // min hours between messages to same customer
  vipEnabled: boolean;            // enable VIP_REWARD trigger
  welcomeEnabled: boolean;        // enable WELCOME trigger
  birthdayEnabled: boolean;       // enable BIRTHDAY trigger
  maxPerRun: number;              // max messages per single run
  // WATI credentials
  watiApiKey: string;
  watiEndpoint: string;           // e.g. https://live-mt-server.wati.io/ACCOUNT_ID
  // Meta WhatsApp Cloud API credentials
  metaPhoneNumberId: string;      // WhatsApp Phone Number ID from Meta Developer Console
  metaAccessToken: string;        // System User permanent access token
  // Custom message templates (per trigger). Empty string = use default.
  messageTemplates: Partial<Record<TriggerType, string>>;
}

const SETTINGS_KEY = "bagicha_automation_settings";

export const DEFAULT_SETTINGS: AutomationSettings = {
  enabled: true,
  autoOff: false,
  whatsappMode: "web",
  templateMode: true,
  dailyLimit: 50,
  inactivityDays: 7,
  quietHours: { start: 22, end: 9 },
  cooldownHours: 24,
  vipEnabled: true,
  welcomeEnabled: true,
  birthdayEnabled: true,
  maxPerRun: 20,
  watiApiKey: "",
  watiEndpoint: "",
  metaPhoneNumberId: "",
  metaAccessToken: "",
  messageTemplates: {},
};

export function loadAutomationSettings(): AutomationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Backward-compat alias
export const getAutomationSettings = loadAutomationSettings;

export function saveAutomationSettings(settings: AutomationSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  // Sync provider credentials to server in background when API/Meta mode is active
  if (settings.whatsappMode === "api" || settings.whatsappMode === "meta") {
    syncSettingsToServer(settings).catch(e =>
      console.warn("[Automation] Server sync failed:", e)
    );
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriggerType =
  | "AT_RISK"
  | "VIP_REWARD"
  | "WIN_BACK"
  | "WELCOME"
  | "FAVORITE_ITEM"
  | "BIRTHDAY";

export type MessageChannel = "web" | "wati" | "meta";

export interface AutomationLogEntry {
  customerId: string;    // customer key (phone || name)
  customerName: string;
  trigger: TriggerType;
  message: string;
  sentAt: string;        // ISO date string
  channel?: MessageChannel;
  status?: "sent" | "failed" | "dry_run";
  error?: string;
}

export interface FollowUpItem {
  customer: CustomerProfile;
  trigger: TriggerType;
  message: string;
  priority: number;      // lower = higher priority
  channel: MessageChannel;
}

export interface RunResult {
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
  blockedByQuietHours: boolean;
  // Extended structured fields
  scanned: number;
  eligible: number;
  queued: number;
  failed: number;
  failures: Array<{ name: string; error: string }>;
  dryRun?: number;
  mode?: "web" | "api";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOG_KEY     = "bagicha_automation_log";
const RUN_LOG_KEY = "bagicha_automation_logs";

// ── Log management ────────────────────────────────────────────────────────────

export function loadAutomationLog(): AutomationLogEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
}

function saveLog(log: AutomationLogEntry[]) {
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500)));
}

/** Checks if customer was messaged within the last N hours (default 24 = today). */
export function hasBeenMessagedWithinCooldown(
  customerId: string,
  cooldownHours = 24
): boolean {
  if (cooldownHours <= 0) return false;
  const cutoff = Date.now() - cooldownHours * 3_600_000;
  return loadAutomationLog().some(
    e => e.customerId === customerId && new Date(e.sentAt).getTime() > cutoff
  );
}

/** Backward-compat: checks 24-hour window (= "today"). */
export function hasBeenMessagedToday(customerId: string): boolean {
  return hasBeenMessagedWithinCooldown(customerId, 24);
}

export function logMessageSent(
  customerId: string,
  customerName: string,
  trigger: TriggerType,
  message: string,
  channel: MessageChannel = "web"
): void {
  const log = loadAutomationLog();
  log.push({
    customerId,
    customerName,
    trigger,
    message,
    sentAt: new Date().toISOString(),
    channel,
    status: "sent",
  });
  saveLog(log);
}

export function clearAutomationLog(): void {
  localStorage.removeItem(LOG_KEY);
}

// ── Trigger evaluation ────────────────────────────────────────────────────────

interface CustomerExtra {
  doNotSendUpdate: boolean;
  notificationEnabled: boolean;
  dateOfBirth?: string;  // "YYYY-MM-DD" from CRM extras
}

function isBirthdayToday(dob: string): boolean {
  const parts = dob.split("-");
  if (parts.length < 3) return false;
  const today = new Date();
  return parseInt(parts[1], 10) === today.getMonth() + 1 &&
         parseInt(parts[2], 10) === today.getDate();
}

/**
 * Determines which follow-up trigger applies to a customer.
 * Returns null if the customer should not be messaged.
 */
export function evaluateCustomerTrigger(
  customer: CustomerProfile,
  extra: CustomerExtra,
  settings?: Pick<
    AutomationSettings,
    "inactivityDays" | "vipEnabled" | "welcomeEnabled" | "birthdayEnabled"
  >
): TriggerType | null {
  // Safety gates
  if (extra.doNotSendUpdate) return null;
  if (!extra.notificationEnabled) return null;
  if (!customer.phone) return null;

  // Birthday — highest priority, fires only on the actual day
  if (settings?.birthdayEnabled ?? true) {
    if (extra.dateOfBirth && isBirthdayToday(extra.dateOfBirth)) return "BIRTHDAY";
  }

  const { tag, daysSinceLastVisit, totalVisits } = customer;
  const inactivityDays = settings?.inactivityDays ?? 7;
  const winBackDays    = Math.max(inactivityDays * 3, 30);

  if (daysSinceLastVisit >= winBackDays) return "WIN_BACK";
  if (tag === "At Risk" && daysSinceLastVisit >= inactivityDays) return "AT_RISK";
  if (tag === "VIP" && (settings?.vipEnabled ?? true)) return "VIP_REWARD";
  if (tag === "New" && totalVisits === 1 && (settings?.welcomeEnabled ?? true)) return "WELCOME";

  return null;
}

// ── Message generation ────────────────────────────────────────────────────────

const RESTAURANT = "Bagicha";

/**
 * Default message templates using substitution tokens:
 *   {name}       — customer first name
 *   {restaurant} — restaurant name
 *   {visits}     — total visit count
 *   {days}       — days since last visit
 *   {favItem}    — favourite menu item (falls back to "our food")
 */
export const DEFAULT_MESSAGE_TEMPLATES: Record<TriggerType, string> = {
  BIRTHDAY:
    `🎂 Happy Birthday, {name}! 🎉 Wishing you a wonderful day from all of us at *{restaurant}*! ` +
    `As a special birthday treat, enjoy *15% off* your meal today — just show this message. ` +
    `Hope to celebrate with you soon! 🥳`,
  WIN_BACK:
    `Hi {name}! 🌿 We've been missing you at *{restaurant}*! ` +
    `It's been {days} days since your last visit. ` +
    `Come back and enjoy *10% off* your next order — just show this message. Valid for 7 days. See you soon! 🍽️`,
  AT_RISK:
    `Hi {name}! 🙏 We noticed it's been a while since you visited *{restaurant}*. ` +
    `We'd love to have you back! Here's a little treat: *complimentary dessert* on your next visit. ` +
    `Simply show this message. Hope to see you soon! 😊`,
  VIP_REWARD:
    `Hi {name}! ⭐ As one of our most valued guests at *{restaurant}* with {visits} visits, ` +
    `we truly appreciate your loyalty. Enjoy a *complimentary starter* on your next visit — ` +
    `just show this message at the counter. Thank you for being special! 🙏`,
  WELCOME:
    `Hi {name}! 🎉 Welcome to the *{restaurant}* family! We're so glad you dined with us. ` +
    `As a welcome gift, enjoy *5% off* your next visit — show this message to claim it. ` +
    `Looking forward to serving you again! 🌿`,
  FAVORITE_ITEM:
    `Hi {name}! 😋 We know you love *{favItem}* at *{restaurant}*! ` +
    `Come back soon and enjoy your favourite again. Show this message for a *special discount*. See you soon! 🍽️`,
};

function applyTemplate(
  template: string,
  customer: CustomerProfile,
  favoriteItem?: string | null,
  restaurant = RESTAURANT
): string {
  return template
    .replace(/\{name\}/g,       customer.name.split(" ")[0])
    .replace(/\{restaurant\}/g, restaurant)
    .replace(/\{visits\}/g,     String(customer.totalVisits))
    .replace(/\{days\}/g,       String(customer.daysSinceLastVisit))
    .replace(/\{favItem\}/g,    favoriteItem ?? "our food");
}

export function generatePersonalizedMessage(
  customer: CustomerProfile,
  trigger: TriggerType,
  favoriteItem?: string | null,
  messageTemplates?: Partial<Record<TriggerType, string>>
): string {
  const tpl = messageTemplates?.[trigger] || DEFAULT_MESSAGE_TEMPLATES[trigger];
  return applyTemplate(tpl, customer, favoriteItem);
}

// Alias used in requirement docs
export const generateFollowUpMessage = generatePersonalizedMessage;

// ── Priority scoring ──────────────────────────────────────────────────────────

const TRIGGER_PRIORITY: Record<TriggerType, number> = {
  BIRTHDAY:     0,
  WIN_BACK:     1,
  AT_RISK:      2,
  VIP_REWARD:   3,
  WELCOME:      4,
  FAVORITE_ITEM: 5,
};

export const TRIGGER_LABELS: Record<
  TriggerType,
  { label: string; color: string; emoji: string }
> = {
  BIRTHDAY:     { label: "Birthday",   color: "text-pink-600 bg-pink-50 border-pink-200",          emoji: "🎂" },
  WIN_BACK:     { label: "Win-Back",   color: "text-red-600 bg-red-50 border-red-200",             emoji: "🎁" },
  AT_RISK:      { label: "At Risk",    color: "text-orange-600 bg-orange-50 border-orange-200",    emoji: "⚠️" },
  VIP_REWARD:   { label: "VIP Reward", color: "text-amber-600 bg-amber-50 border-amber-200",       emoji: "⭐" },
  WELCOME:      { label: "Welcome",    color: "text-emerald-600 bg-emerald-50 border-emerald-200", emoji: "🎉" },
  FAVORITE_ITEM:{ label: "Fav Item",   color: "text-purple-600 bg-purple-50 border-purple-200",   emoji: "😋" },
};

// ── Blocked customer identification ──────────────────────────────────────────

export interface BlockedCustomer {
  customer: CustomerProfile;
  trigger: TriggerType;
  reason: "no_phone" | "opted_out";
}

/**
 * Returns customers who would match a follow-up trigger but can't be messaged
 * because of a missing phone number or opt-out. Used to surface actionable
 * gaps in the Queue tab so the admin knows what's preventing sends.
 */
export function getBlockedCustomers(
  customers: CustomerProfile[],
  extras: Record<string, { doNotSendUpdate: boolean; notificationEnabled: boolean }>,
  settings?: AutomationSettings
): BlockedCustomer[] {
  const blocked: BlockedCustomer[] = [];
  const cooldownHours = settings?.cooldownHours ?? 24;

  for (const customer of customers) {
    if (hasBeenMessagedWithinCooldown(customer.key, cooldownHours)) continue;
    const extra = extras[customer.key] ?? { doNotSendUpdate: false, notificationEnabled: true };

    // Determine reason for being blocked
    let reason: BlockedCustomer["reason"] | null = null;
    if (extra.doNotSendUpdate || !extra.notificationEnabled) {
      reason = "opted_out";
    } else if (!customer.phone) {
      reason = "no_phone";
    }
    if (!reason) continue;

    // Would they trigger if the block were resolved? Evaluate with a permissive check.
    const { tag, daysSinceLastVisit, totalVisits } = customer;
    const inactivityDays = settings?.inactivityDays ?? 7;
    const winBackDays    = Math.max(inactivityDays * 3, 30);

    let trigger: TriggerType | null = null;
    const dob = (extra as any).dateOfBirth as string | undefined;
    if ((settings?.birthdayEnabled ?? true) && dob && isBirthdayToday(dob)) trigger = "BIRTHDAY";
    else if (daysSinceLastVisit >= winBackDays) trigger = "WIN_BACK";
    else if (tag === "At Risk" && daysSinceLastVisit >= inactivityDays) trigger = "AT_RISK";
    else if (tag === "VIP" && (settings?.vipEnabled ?? true)) trigger = "VIP_REWARD";
    else if (tag === "New" && totalVisits === 1 && (settings?.welcomeEnabled ?? true)) trigger = "WELCOME";

    if (trigger) blocked.push({ customer, trigger, reason });
  }
  return blocked;
}

// ── Eligible customer extraction ──────────────────────────────────────────────

export function getEligibleCustomers(
  customers: CustomerProfile[],
  extras: Record<string, { doNotSendUpdate: boolean; notificationEnabled: boolean }>,
  settings: AutomationSettings
): Array<{ customer: CustomerProfile; trigger: TriggerType }> {
  const eligible: Array<{ customer: CustomerProfile; trigger: TriggerType }> = [];
  for (const customer of customers) {
    if (hasBeenMessagedWithinCooldown(customer.key, settings.cooldownHours)) continue;
    const extra   = extras[customer.key] ?? { doNotSendUpdate: false, notificationEnabled: true };
    const trigger = evaluateCustomerTrigger(customer, extra, settings);
    if (trigger) eligible.push({ customer, trigger });
  }
  return eligible;
}

// ── Queue builder ─────────────────────────────────────────────────────────────

/**
 * Builds the full automation follow-up queue from all customers.
 * Filters out cooldown-gated and safety-gated customers.
 * Sorted by priority (Win-Back first).
 */
export function buildFollowUpQueue(
  customers: CustomerProfile[],
  extras: Record<string, { doNotSendUpdate: boolean; notificationEnabled: boolean }>,
  favoriteItems?: Record<string, string | null>,
  settings?: AutomationSettings
): FollowUpItem[] {
  const queue: FollowUpItem[] = [];
  const cooldownHours = settings?.cooldownHours ?? 24;
  const channel: "web" | "wati" | "meta" =
    settings?.whatsappMode === "meta" ? "meta" :
    settings?.whatsappMode === "api"  ? "wati" : "web";

  for (const customer of customers) {
    if (hasBeenMessagedWithinCooldown(customer.key, cooldownHours)) continue;

    const extra   = extras[customer.key] ?? { doNotSendUpdate: false, notificationEnabled: true };
    const trigger = evaluateCustomerTrigger(customer, extra, settings);
    if (!trigger) continue;

    const favItem = favoriteItems?.[customer.key] ?? null;
    const message = generatePersonalizedMessage(customer, trigger, favItem, settings?.messageTemplates);

    queue.push({
      customer,
      trigger,
      message,
      priority: TRIGGER_PRIORITY[trigger],
      channel,
    });
  }

  return queue.sort((a, b) =>
    a.priority !== b.priority
      ? a.priority - b.priority
      : b.customer.daysSinceLastVisit - a.customer.daysSinceLastVisit
  );
}

// ── Provider helpers ──────────────────────────────────────────────────────────

export type ProviderStatus = "web" | "wati" | "meta" | "unconfigured";

/** Returns which provider is active and whether it is ready. */
export function getAutomationProvider(settings: AutomationSettings): ProviderStatus {
  if (settings.whatsappMode === "meta") {
    if (settings.metaPhoneNumberId && settings.metaAccessToken) return "meta";
    return "unconfigured";
  }
  if (settings.whatsappMode === "api") {
    if (settings.watiApiKey && settings.watiEndpoint) return "wati";
    return "unconfigured";
  }
  return "web";
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

/** Opens WhatsApp Web tab for a single customer. */
export function sendFollowUpViaWeb(phone: string, message: string): boolean {
  const normalized = normalizePhone(phone);
  if (normalized.length < 12) return false;
  window.open(
    `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`,
    "_blank",
    "noopener,noreferrer"
  );
  return true;
}

// Alias
export const sendFollowUpMessage = sendFollowUpViaWeb;

// ── Server sync ───────────────────────────────────────────────────────────────

/** Push relevant settings to server automation-config.json. */
export async function syncSettingsToServer(settings: AutomationSettings): Promise<void> {
  const body: Record<string, unknown> = {
    enabled:        settings.enabled,
    maxPerRun:      settings.maxPerRun || settings.dailyLimit,
    restaurantName: "Bagicha",
  };
  // Only send credentials when non-empty (never overwrite with empty string)
  if (settings.watiApiKey)        body.watiApiKey        = settings.watiApiKey;
  if (settings.watiEndpoint)      body.watiEndpoint      = settings.watiEndpoint;
  if (settings.metaPhoneNumberId) body.metaPhoneNumberId = settings.metaPhoneNumberId;
  if (settings.metaAccessToken)   body.metaAccessToken   = settings.metaAccessToken;

  const resp = await fetch(apiUrl("/api/automation/config"), {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Config sync failed: HTTP ${resp.status}`);
}

/** Run the server-side automation pipeline (WATI mode). */
async function runAutomationViaServer(): Promise<RunResult> {
  const resp = await fetch(apiUrl("/api/automation/run"), {
    method:      "POST",
    credentials: "include",
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
    throw new Error(`Server automation failed: ${errText}`);
  }

  const data = await resp.json() as {
    ok?: boolean;
    processed?: number;
    sent?: number;
    skipped?: number;
    failed?: number;
    dryRun?: number;
    error?: string;
  };

  if (data.ok === false) {
    throw new Error(data.error ?? "Server returned ok=false");
  }

  const sent      = data.sent    ?? 0;
  const dryRun    = data.dryRun  ?? 0;
  const failed    = data.failed  ?? 0;
  const processed = data.processed ?? 0;
  const skipped   = data.skipped   ?? 0;

  return {
    processed,
    sent:               sent + dryRun,
    skipped,
    errors:             failed,
    blockedByQuietHours: false,
    scanned:            processed,
    eligible:           sent + failed + dryRun,
    queued:             0,
    failed,
    failures:           [],
    dryRun,
    mode:               "api",
  };
}

// ── Run log ───────────────────────────────────────────────────────────────────

export interface RunLogEntry {
  type: "success" | "error" | "skipped";
  customerId?: string;
  customerName?: string;
  trigger?: TriggerType;
  message?: string;
  errorMessage?: string;
  timestamp: string;
  provider?: MessageChannel;
}

export function loadRunLog(): RunLogEntry[] {
  try { return JSON.parse(localStorage.getItem(RUN_LOG_KEY) || "[]"); } catch { return []; }
}

export function logRunSuccess(
  customer: CustomerProfile,
  trigger: TriggerType,
  message: string,
  provider?: MessageChannel
): void {
  const logs = loadRunLog();
  logs.unshift({
    type:         "success",
    customerId:   customer.key,
    customerName: customer.name,
    trigger,
    message,
    timestamp:    new Date().toISOString(),
    provider,
  });
  localStorage.setItem(RUN_LOG_KEY, JSON.stringify(logs.slice(0, 500)));
}

export function logRunError(errorMessage: string): void {
  const logs = loadRunLog();
  logs.unshift({ type: "error", errorMessage, timestamp: new Date().toISOString() });
  localStorage.setItem(RUN_LOG_KEY, JSON.stringify(logs.slice(0, 500)));
}

// Named aliases matching requirement spec
export const logAutomationSuccess = logRunSuccess;
export const logAutomationError   = logRunError;

export function clearRunLog(): void {
  localStorage.removeItem(RUN_LOG_KEY);
}

/** No-op hook — components use their own logVersion counter to trigger re-renders. */
export function refreshAutomationState(): void { /* triggers via component state */ }

// ── Quiet-hours check ─────────────────────────────────────────────────────────

export function isInQuietHours(quietHours: { start: number; end: number }): boolean {
  const h = new Date().getHours();
  const { start, end } = quietHours;
  if (start > end) return h >= start || h < end;   // wraps midnight e.g. 22–09
  return h >= start && h < end;
}

// ── Client-side run (WhatsApp Web mode) ───────────────────────────────────────

export async function runAutomationClientSide(
  customers: CustomerProfile[],
  extras: Record<string, { doNotSendUpdate: boolean; notificationEnabled: boolean }>,
  settings: AutomationSettings
): Promise<RunResult> {
  const result: RunResult = {
    processed:          0,
    sent:               0,
    skipped:            0,
    errors:             0,
    blockedByQuietHours: false,
    scanned:            customers.length,
    eligible:           0,
    queued:             0,
    failed:             0,
    failures:           [],
    mode:               "web",
  };

  if (!settings.enabled) {
    logRunError("Automation is disabled — enable it in Settings to run");
    throw new Error("Automation is turned OFF. Enable it in Settings first.");
  }

  if (isInQuietHours(settings.quietHours)) {
    result.blockedByQuietHours = true;
    logRunError(
      `Quiet hours active (${settings.quietHours.start}:00 – ${settings.quietHours.end}:00). No messages sent.`
    );
    return result;
  }

  const queue = buildFollowUpQueue(customers, extras, undefined, settings);
  result.eligible = queue.length;

  if (queue.length === 0) {
    logRunError("No eligible customers found for follow-up today");
    return result;
  }

  const limit = Math.min(queue.length, settings.maxPerRun || settings.dailyLimit);
  result.queued = limit;

  for (let i = 0; i < limit; i++) {
    const item = queue[i];
    result.processed++;

    try {
      if (!item.customer.phone) { result.skipped++; continue; }

      const phone = normalizePhone(item.customer.phone);
      if (phone.length < 12)    { result.skipped++; continue; }

      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(item.message)}`,
        "_blank",
        "noopener,noreferrer"
      );

      logMessageSent(item.customer.key, item.customer.name, item.trigger, item.message, "web");
      logRunSuccess(item.customer, item.trigger, item.message, "web");
      result.sent++;

      if (i < limit - 1) await new Promise(r => setTimeout(r, 800));
    } catch (err: any) {
      const errMsg = err?.message ?? "Unknown error";
      result.errors++;
      result.failed++;
      result.failures.push({ name: item.customer.name, error: errMsg });
      logRunError(`Failed for ${item.customer.name}: ${errMsg}`);
    }
  }

  return result;
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Primary entry point for running the automation pipeline.
 *
 * - In "web" mode  → evaluates customers client-side, opens WhatsApp tabs.
 * - In "api" mode  → syncs WATI config to server, then calls the server pipeline.
 *
 * Always throws on total failure; partial failures are returned in RunResult.failures.
 */
export async function runCustomerAutomation(
  customers: CustomerProfile[],
  extras: Record<string, { doNotSendUpdate: boolean; notificationEnabled: boolean }>,
  settings: AutomationSettings
): Promise<RunResult> {
  if (!settings.enabled) {
    throw new Error("Automation is turned OFF. Enable it in Settings first.");
  }

  if (settings.whatsappMode === "api" || settings.whatsappMode === "meta") {
    const provider = getAutomationProvider(settings);

    if (provider === "unconfigured") {
      const modeLabel = settings.whatsappMode === "meta" ? "Meta WhatsApp" : "WATI API";
      const settingsHint = settings.whatsappMode === "meta"
        ? "Add your Meta Phone Number ID and Access Token in Settings → Meta WhatsApp Configuration."
        : "Add your WATI API Endpoint and API Key in Settings → WATI API Configuration.";
      throw new Error(`${modeLabel} mode is selected but credentials are missing. ${settingsHint}`);
    }

    // Push latest credentials to server before running
    try {
      await syncSettingsToServer(settings);
    } catch (syncErr: any) {
      console.warn("[Automation] Settings sync failed, using server's stored config:", syncErr.message);
    }

    return await runAutomationViaServer();
  }

  return await runAutomationClientSide(customers, extras, settings);
}
