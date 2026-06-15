/**
 * customerAutomationService.ts
 *
 * Main orchestrator for the AI-powered customer follow-up system.
 *
 * Responsibilities:
 *   1. Aggregate customer profiles from order history (server-side, same logic as
 *      useCustomerIntelligence on the client but running in Express)
 *   2. Evaluate triggers per customer
 *   3. Generate personalised messages (AI or smart templates)
 *   4. Send via WhatsApp (WATI or dry-run)
 *   5. Log every outcome
 *   6. Start / manage the hourly background scheduler
 */

import { db } from "../db";
import { orders, orderItems, menuItems } from "../../shared/schema";
import { desc, eq, or, sql, inArray } from "drizzle-orm";
import {
  getAutomationConfig,
  hasBeenMessagedToday,
  isOptedOut,
  appendLog,
  type TriggerType,
} from "./automationStore";
import {
  generateMessage,
  isGoodSendTime,
  type CustomerSnapshot,
} from "./aiMessageService";
import {
  sendWhatsAppMessage,
  delay,
} from "./whatsappService";
import { getDriver } from "./whatsapp/driverManager";
import { enqueueWhatsApp } from "./whatsapp/outboundQueue";
import { resolveCustomerId } from "./crm/customerIdService";

// ── Constants (mirrors useCustomerIntelligence thresholds) ────────────────────

const AT_RISK_DAYS    = 15;
const VIP_MIN_VISITS  = 10;
const HIGH_SPEND_AVG  = 600;
const WIN_BACK_DAYS   = 30;
const AT_RISK_TRIGGER = 7;  // start triggering at 7 days (before the 15-day tag kicks in)

// ── Customer profile builder ───────────────────────────────────────────────────

type RawOrder = {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  totalAmount: string;
  createdAt: Date | string;
};

type RawOrderItem = {
  orderId: number;
  menuItemId: number;
  quantity: number;
};

type RawMenuItem = {
  id: number;
  name: string;
};

function tagFor(
  visits: number,
  avgSpend: number,
  daysSinceLast: number
): CustomerSnapshot["tag"] {
  if (daysSinceLast > AT_RISK_DAYS && visits > 2) return "At Risk";
  if (visits > VIP_MIN_VISITS && avgSpend >= HIGH_SPEND_AVG) return "VIP";
  if (visits >= 3) return "Regular";
  return "New";
}

/** Build full customer profiles from raw DB orders + items */
async function buildCustomerProfiles(): Promise<CustomerSnapshot[]> {
  // Fetch all orders (latest first)
  const rawOrders = await db.select().from(orders).orderBy(desc(orders.createdAt)) as RawOrder[];
  if (!rawOrders.length) return [];

  // Group by phone (preferred) or name
  const orderMap = new Map<string, RawOrder[]>();
  for (const order of rawOrders) {
    if (!order.customerName && !order.customerPhone) continue;
    const key = (order.customerPhone?.trim() || order.customerName?.trim()) as string;
    if (!key) continue;
    if (!orderMap.has(key)) orderMap.set(key, []);
    orderMap.get(key)!.push(order);
  }

  // Fetch order items in bulk for top orders
  const allOrderItems = await db.select().from(orderItems) as RawOrderItem[];
  const allMenuItems  = await db.select().from(menuItems) as RawMenuItem[];

  // Build fast lookup maps
  const menuNameMap: Record<number, string> = {};
  for (const m of allMenuItems) menuNameMap[m.id] = m.name;

  const itemsByOrder: Record<number, RawOrderItem[]> = {};
  for (const item of allOrderItems) {
    if (!itemsByOrder[item.orderId]) itemsByOrder[item.orderId] = [];
    itemsByOrder[item.orderId].push(item);
  }

  const now = Date.now();
  const profiles: CustomerSnapshot[] = [];

  for (const [key, customerOrders] of Array.from(orderMap)) {
    // Sort newest first
    const sorted = [...customerOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const newest = sorted[0];

    const totalSpend = customerOrders.reduce(
      (s: number, o: RawOrder) => s + parseFloat(String(o.totalAmount ?? "0")),
      0
    );
    const avgOrderValue      = totalSpend / customerOrders.length;
    const lastVisit          = new Date(newest.createdAt);
    const daysSinceLastVisit = Math.floor((now - lastVisit.getTime()) / 86_400_000);

    // Peak order hour
    const hourCounts: Record<number, number> = {};
    for (const o of customerOrders) {
      const h = new Date(o.createdAt).getHours();
      hourCounts[h] = (hourCounts[h] ?? 0) + 1;
    }
    const peakHour = customerOrders.length
      ? +Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null;

    // Favorite item — frequency analysis over top-5 orders
    const top5Ids = sorted.slice(0, 5).map(o => o.id);
    const freqMap: Record<string, number> = {};
    for (const orderId of top5Ids) {
      const items = itemsByOrder[orderId] ?? [];
      for (const item of items) {
        const name = menuNameMap[item.menuItemId] ?? "Unknown";
        freqMap[name] = (freqMap[name] ?? 0) + item.quantity;
      }
    }
    const freqEntries = Object.entries(freqMap);
    const favoriteItem = freqEntries.length
      ? freqEntries.sort((a, b) => b[1] - a[1])[0][0]
      : null;

    const tag = tagFor(customerOrders.length, avgOrderValue, daysSinceLastVisit);

    profiles.push({
      key,
      name:              newest.customerName ?? "Guest",
      phone:             newest.customerPhone ?? "",
      totalVisits:       customerOrders.length,
      totalSpend,
      avgOrderValue,
      daysSinceLastVisit,
      tag,
      peakHour,
      favoriteItem,
    });
  }

  return profiles;
}

/**
 * Builds a single customer's snapshot (visits / spend / favorite / tag) on demand —
 * used at settlement time so we don't rebuild every profile. Matches the same
 * aggregation as buildCustomerProfiles. Returns null if no orders are found.
 */
export async function buildSnapshotForKey(
  key: string,
  name: string,
  phone?: string | null,
): Promise<CustomerSnapshot | null> {
  const last10 = (phone ?? "").replace(/\D/g, "").slice(-10);
  const conds: any[] = [];
  if (last10.length === 10) {
    conds.push(sql`right(regexp_replace(coalesce(${orders.customerPhone}, ''), '\\D', '', 'g'), 10) = ${last10}`);
  }
  if (name) conds.push(eq(orders.customerName, name));
  if (key && key !== name) conds.push(eq(orders.customerName, key));
  if (!conds.length) return null;

  const customerOrders = await db
    .select()
    .from(orders)
    .where(conds.length === 1 ? conds[0] : or(...conds))
    .orderBy(desc(orders.createdAt)) as RawOrder[];
  if (!customerOrders.length) return null;

  const newest = customerOrders[0];
  const now = Date.now();

  const totalSpend = customerOrders.reduce(
    (s, o) => s + parseFloat(String(o.totalAmount ?? "0")),
    0,
  );
  const avgOrderValue      = totalSpend / customerOrders.length;
  const lastVisit          = new Date(newest.createdAt);
  const daysSinceLastVisit = Math.floor((now - lastVisit.getTime()) / 86_400_000);

  const hourCounts: Record<number, number> = {};
  for (const o of customerOrders) {
    const h = new Date(o.createdAt).getHours();
    hourCounts[h] = (hourCounts[h] ?? 0) + 1;
  }
  const peakHour = +Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0];

  // Favorite item — frequency over the 5 most recent orders
  const top5Ids = customerOrders.slice(0, 5).map(o => o.id);
  const items = top5Ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, top5Ids)) as RawOrderItem[]
    : [];
  const allMenuItems = await db.select().from(menuItems) as RawMenuItem[];
  const menuNameMap: Record<number, string> = {};
  for (const m of allMenuItems) menuNameMap[m.id] = m.name;

  const freqMap: Record<string, number> = {};
  for (const item of items) {
    const itemName = menuNameMap[item.menuItemId] ?? "Unknown";
    freqMap[itemName] = (freqMap[itemName] ?? 0) + item.quantity;
  }
  const freqEntries = Object.entries(freqMap);
  const favoriteItem = freqEntries.length
    ? freqEntries.sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const tag = tagFor(customerOrders.length, avgOrderValue, daysSinceLastVisit);

  return {
    key,
    name:              newest.customerName ?? name ?? "Guest",
    phone:             newest.customerPhone ?? phone ?? "",
    totalVisits:       customerOrders.length,
    totalSpend,
    avgOrderValue,
    daysSinceLastVisit,
    tag,
    peakHour,
    favoriteItem,
  };
}

// ── Trigger engine ─────────────────────────────────────────────────────────────

function evaluateTrigger(customer: CustomerSnapshot): TriggerType | null {
  const { tag, daysSinceLastVisit } = customer;

  // Lapsed re-engagement only. WELCOME / VIP_REWARD / FAVORITE_ITEM are sent at
  // bill settlement (automationRuleEngine.triggerSettlementMessage) — emitting
  // them here too would double-message the customer.
  if (daysSinceLastVisit >= WIN_BACK_DAYS)                        return "WIN_BACK";
  if (tag === "At Risk" && daysSinceLastVisit >= AT_RISK_TRIGGER) return "AT_RISK";

  return null;
}

// ── Tracking link ──────────────────────────────────────────────────────────────

function buildTrackingLink(
  customerId: string,
  trigger: TriggerType,
  baseUrl: string
): string | undefined {
  if (!baseUrl) return undefined;
  const hash = Buffer.from(customerId).toString("base64url").slice(0, 8);
  return `${baseUrl.replace(/\/$/, "")}?ref=auto&c=${hash}&utm=${trigger.toLowerCase()}`;
}

// ── Main automation run ────────────────────────────────────────────────────────

let isRunning = false;

export async function runCustomerAutomation(options: { force?: boolean } = {}): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  dryRun: number;
  queued: number;
}> {
  if (isRunning) {
    console.log("[Automation] Previous run still in progress — skipping");
    return { processed: 0, sent: 0, skipped: 0, failed: 0, dryRun: 0, queued: 0 };
  }

  isRunning = true;
  const stats = { processed: 0, sent: 0, skipped: 0, failed: 0, dryRun: 0, queued: 0 };

  try {
    const config = getAutomationConfig();
    // Scheduled runs respect the enabled flag; manual (force) runs always proceed
    if (!config.enabled && !options.force) {
      console.log("[Automation] Disabled — skipping scheduled run (use force:true to override)");
      return stats;
    }

    console.log("[Automation] Starting run…");
    const customers = await buildCustomerProfiles();
    console.log(`[Automation] ${customers.length} customer profiles loaded`);

    let messagesSent = 0;

    for (const customer of customers) {
      if (messagesSent >= config.maxPerRun) break;
      stats.processed++;

      // Safety checks
      if (!customer.phone)                         { stats.skipped++; continue; }
      if (isOptedOut(customer.key))                { stats.skipped++; continue; }
      if (hasBeenMessagedToday(customer.key))      { stats.skipped++; continue; }
      if (!isGoodSendTime(customer))               { stats.skipped++; continue; }

      const trigger = evaluateTrigger(customer);
      if (!trigger)                                { stats.skipped++; continue; }

      // Generate message
      const trackingLink = buildTrackingLink(customer.key, trigger, config.trackingBaseUrl);
      const message = await generateMessage(
        customer,
        trigger,
        config.restaurantName,
        config.anthropicApiKey || undefined,
        trackingLink
      );

      // Fully automated path: queue through the active WhatsApp driver.
      // The outbound worker owns pacing (sendDelayMs + jitter), retries, the
      // maxPerDay cap, and all logging — so we just enqueue and move on.
      if (config.whatsappAutoSend && getDriver()) {
        try {
          const customerId = await resolveCustomerId(customer.key, customer.name, customer.phone);
          await enqueueWhatsApp({
            customerId,
            phone:   customer.phone,
            message,
            trigger,
          });
          messagesSent++;
          stats.queued++;
          console.log(`[Automation] ⇢ queued ${customer.name} (${trigger})`);
        } catch (err: any) {
          stats.failed++;
          console.warn(`[Automation] ✗ enqueue failed for ${customer.name} — ${err?.message}`);
        }
        continue;
      }

      // Manual/legacy path (Meta takes priority over WATI when both configured)
      const result = await sendWhatsAppMessage(customer.phone, message, {
        watiApiKey:        config.watiApiKey,
        watiEndpoint:      config.watiEndpoint,
        metaPhoneNumberId: config.metaPhoneNumberId,
        metaAccessToken:   config.metaAccessToken,
      });

      // Log
      appendLog({
        customerId:   customer.key,
        customerName: customer.name,
        phone:        customer.phone,
        trigger,
        message,
        sentAt:       new Date().toISOString(),
        status:       result.success ? "sent" : "failed",
        error:        result.error,
        campaign:     trigger,
      });

      if (result.success) {
        messagesSent++;
        if (result.mode === "dry_run") stats.dryRun++;
        else stats.sent++;
        console.log(`[Automation] ✓ ${customer.name} (${trigger}) → ${result.mode}`);
      } else {
        stats.failed++;
        console.warn(`[Automation] ✗ ${customer.name} — ${result.error}`);
      }

      // Rate limiting — pause between sends
      if (messagesSent < config.maxPerRun) {
        await delay(config.sendDelayMs);
      }
    }

    console.log(
      `[Automation] Run complete — sent: ${stats.sent}, dry-run: ${stats.dryRun}, ` +
      `skipped: ${stats.skipped}, failed: ${stats.failed}`
    );
  } catch (err: any) {
    console.error("[Automation] Run error:", err?.message ?? err);
  } finally {
    isRunning = false;
  }

  return stats;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startAutomationScheduler(): void {
  const config = getAutomationConfig();
  const intervalMs = (config.runIntervalHours || 1) * 60 * 60 * 1000;

  if (schedulerTimer) clearInterval(schedulerTimer);

  schedulerTimer = setInterval(() => {
    runCustomerAutomation().catch(err =>
      console.error("[Automation] Scheduler error:", err)
    );
  }, intervalMs);

  console.log(
    `[Automation] Scheduler started — runs every ${config.runIntervalHours}h` +
    (config.enabled ? "" : " (currently disabled)")
  );
}

export function stopAutomationScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[Automation] Scheduler stopped");
  }
}

/** Restart scheduler with updated interval (call after config changes). */
export function restartScheduler(): void {
  stopAutomationScheduler();
  startAutomationScheduler();
}
