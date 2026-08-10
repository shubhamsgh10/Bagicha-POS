/**
 * automationRuleEngine.ts
 *
 * Phase 6 — Server-Side Automation Rule Engine
 *
 * Complements the existing client-side runAutomationClientSide().
 * This server-side engine:
 *   1. Fetches configurable automation_rules from DB
 *   2. Evaluates triggers against live customer data
 *   3. Creates automation_jobs in the queue
 *   4. Executes jobs via the messaging service
 *   5. Logs every outcome
 *
 * The client-side engine is KEPT intact — this is an additive parallel system.
 */

import { db } from "../../db";
import { eq, and, desc, isNull, sql, or, inArray } from "drizzle-orm";
import {
  orders,
  orderItems,
  menuItems,
  automationRules,
  automationJobs,
  customersMaster,
  customerProfiles,
  customerSegments,
  type AutomationRule,
  type AutomationJob,
} from "../../../shared/schema";
import { resolveCustomerId } from "./customerIdService";
import { sendMessage, type MessagingConfig } from "./messagingService";
import { getAutomationConfig, type AutomationConfig, type TriggerType as AITrigger } from "../automationStore";
import { generateMessage, type CustomerSnapshot as AISnapshot } from "../aiMessageService";
import { buildSnapshotForKey } from "../customerAutomationService";
import { enqueueWhatsApp } from "../whatsapp/outboundQueue";
import { getDriver } from "../whatsapp/driverManager";
import { istCalendarDayRange, istCalendarDate, istMonthDay } from "../../../shared/businessDay";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ServerTriggerType =
  | "INACTIVITY_7"
  | "INACTIVITY_14"
  | "INACTIVITY_30"
  | "BIRTHDAY"
  | "VISIT_MILESTONE"
  | "HIGH_SPEND"
  | "VIP_REWARD"
  | "WIN_BACK"
  | "WELCOME"
  | "AT_RISK";

export interface CustomerSnapshot {
  key:               string;
  name:              string;
  phone:             string | null;
  totalVisits:       number;
  totalSpend:        number;
  avgOrderValue:     number;
  daysSinceLastVisit: number;
  segment:           string;
  dob?:              string | null;
}

export interface RunServerResult {
  processed: number;
  sent:      number;
  skipped:   number;
  failed:    number;
  dryRun:    number;
}

// ── Message templates ─────────────────────────────────────────────────────────

const RESTAURANT = "Bagicha";

function buildMessage(customer: CustomerSnapshot, trigger: ServerTriggerType): string {
  const first = customer.name.split(" ")[0];

  const templates: Record<ServerTriggerType, string> = {
    WIN_BACK:
      `Hi ${first}! 🌿 We've missed you at *${RESTAURANT}*! ` +
      `It's been ${customer.daysSinceLastVisit} days since your last visit. ` +
      `Come back and enjoy *10% off* your next order — just show this message. Valid 7 days. 🍽️`,

    AT_RISK:
      `Hi ${first}! 🙏 We noticed it's been a while since you visited *${RESTAURANT}*. ` +
      `We'd love to have you back! Here's a little treat: *complimentary dessert* on your next visit. ` +
      `Just show this message. Hope to see you soon! 😊`,

    VIP_REWARD:
      `Hi ${first}! ⭐ As one of our most valued guests at *${RESTAURANT}* ` +
      `with ${customer.totalVisits} visits, we truly appreciate your loyalty. ` +
      `Enjoy a *complimentary starter* on your next visit — just show this message. 🙏`,

    WELCOME:
      `Hi ${first}! 🎉 Welcome to the *${RESTAURANT}* family! We're so glad you dined with us. ` +
      `As a welcome gift, enjoy *5% off* your next visit — show this message to claim it. 🌿`,

    INACTIVITY_7:
      `Hi ${first}! 👋 Haven't seen you at *${RESTAURANT}* in a week. ` +
      `We'd love to have you back soon! Come visit us when you're free. 🌿`,

    INACTIVITY_14:
      `Hi ${first}! 🌿 It's been 2 weeks since your last visit to *${RESTAURANT}*. ` +
      `We miss you! Here's a special *₹50 off* your next order — show this message. 😊`,

    INACTIVITY_30:
      `Hi ${first}! 🎁 We haven't seen you at *${RESTAURANT}* in a while. ` +
      `Come back and enjoy a *complimentary dessert* on us — just show this message. 🍽️`,

    BIRTHDAY:
      `Hi ${first}! 🎂 Happy Birthday from all of us at *${RESTAURANT}*! ` +
      `Wishing you a wonderful day. Come celebrate with us — enjoy a *complimentary dessert* today! 🥳`,

    VISIT_MILESTONE:
      `Hi ${first}! 🏆 Congratulations on your ${customer.totalVisits}th visit to *${RESTAURANT}*! ` +
      `Thank you for being such a loyal guest. Enjoy *10% off* your next order. 🙏`,

    HIGH_SPEND:
      `Hi ${first}! ⭐ You've spent over ₹${Math.floor(customer.totalSpend).toLocaleString("en-IN")} ` +
      `with us at *${RESTAURANT}*. Thank you for your incredible support! ` +
      `Enjoy a *complimentary starter* on your next visit. 🌿`,
  };

  return templates[trigger] ?? `Hi ${first}! Thanks for visiting *${RESTAURANT}*. 🌿`;
}

// ── AI message generation helpers ────────────────────────────────────────────

function segmentToAITag(segment: string): AISnapshot["tag"] {
  if (segment === "VIP")     return "VIP";
  if (segment === "Regular") return "Regular";
  if (segment === "Lapsed" || segment === "At Risk") return "At Risk";
  return "New";
}

function serverTriggerToAI(trigger: ServerTriggerType): AITrigger {
  const map: Record<ServerTriggerType, AITrigger> = {
    WIN_BACK:         "WIN_BACK",
    AT_RISK:          "AT_RISK",
    VIP_REWARD:       "VIP_REWARD",
    WELCOME:          "WELCOME",
    HIGH_SPEND:       "VIP_REWARD",
    INACTIVITY_7:     "AT_RISK",
    INACTIVITY_14:    "WIN_BACK",
    INACTIVITY_30:    "WIN_BACK",
    BIRTHDAY:         "WIN_BACK",
    VISIT_MILESTONE:  "VIP_REWARD",
  };
  return map[trigger] ?? "WIN_BACK";
}

async function getMessageText(
  customer: CustomerSnapshot,
  trigger: ServerTriggerType,
  restaurantName: string,
  anthropicApiKey?: string
): Promise<string> {
  if (anthropicApiKey) {
    const aiSnapshot: AISnapshot = {
      key:                customer.key,
      name:               customer.name,
      phone:              customer.phone ?? "",
      totalVisits:        customer.totalVisits,
      totalSpend:         customer.totalSpend,
      avgOrderValue:      customer.avgOrderValue,
      daysSinceLastVisit: customer.daysSinceLastVisit,
      tag:                segmentToAITag(customer.segment),
      peakHour:           null,
      favoriteItem:       null,
    };
    const msg = await generateMessage(aiSnapshot, serverTriggerToAI(trigger), restaurantName, anthropicApiKey);
    if (msg) return msg;
  }
  return buildMessage(customer, trigger);
}

// ── Trigger evaluation ────────────────────────────────────────────────────────

function evaluateDefaultTriggers(c: CustomerSnapshot): ServerTriggerType | null {
  // Lapsed re-engagement only. WELCOME / VIP_REWARD are sent at bill settlement
  // (triggerSettlementMessage) — emitting them here too would double-message.
  if (c.daysSinceLastVisit >= 30) return "WIN_BACK";
  if (c.segment === "At Risk" && c.daysSinceLastVisit >= 7) return "AT_RISK";
  if (c.daysSinceLastVisit >= 14) return "INACTIVITY_14";
  if (c.daysSinceLastVisit >= 7)  return "INACTIVITY_7";
  return null;
}

function evaluateRule(rule: AutomationRule, c: CustomerSnapshot): boolean {
  const cond = (rule.conditions ?? {}) as Record<string, unknown>;

  if (rule.triggerType === "INACTIVITY") {
    const days = Number(cond["days"] ?? 7);
    return c.daysSinceLastVisit >= days;
  }
  if (rule.triggerType === "HIGH_SPEND") {
    const threshold = Number(cond["minTotalSpend"] ?? 5000);
    return c.totalSpend >= threshold;
  }
  if (rule.triggerType === "VISIT_MILESTONE") {
    const milestone = Number(cond["visits"] ?? 10);
    return c.totalVisits === milestone;
  }
  if (rule.triggerType === "BIRTHDAY") {
    if (!c.dob) return false;
    // IST month-day, not server-local — a second, independent birthday-matching site
    // from birthdayService.ts's own scan (this one backs the DB-configurable rule
    // engine). Same class of bug: local Date components read the server's ambient
    // timezone, not guaranteed to be IST (see CLAUDE.md).
    return istMonthDay(new Date(c.dob)) === istMonthDay();
  }
  return false;
}

// ── DB snapshot builder ───────────────────────────────────────────────────────

async function buildSnapshots(): Promise<CustomerSnapshot[]> {
  const rawOrders = await db.select().from(orders);
  if (!rawOrders.length) return [];

  const map = new Map<string, typeof rawOrders>();
  for (const order of rawOrders) {
    const key = (order.customerPhone?.trim() || order.customerName?.trim());
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(order);
  }

  // Fetch segments once
  const segments = await db.select().from(customerSegments);
  const masterRows = await db.select().from(customersMaster);
  const profileRows = await db.select({ customerId: customerProfiles.customerId, dob: customerProfiles.dob, doNotSendUpdate: customerProfiles.doNotSendUpdate, notificationEnabled: customerProfiles.notificationEnabled }).from(customerProfiles);

  const segMap  = new Map(segments.map(s => [s.customerId, s.segment]));
  const masterMap = new Map(masterRows.map(m => [m.key, m.id]));
  const profileMap = new Map(profileRows.map(p => [p.customerId, p]));

  const now = Date.now();
  const snapshots: CustomerSnapshot[] = [];

  for (const [key, customerOrders] of Array.from(map)) {
    const sorted = [...customerOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const newest = sorted[0];
    const totalSpend = customerOrders.reduce((s, o) => s + parseFloat(String(o.totalAmount ?? 0)), 0);
    const daysSinceLast = Math.floor((now - new Date(newest.createdAt).getTime()) / 86_400_000);

    const masterId = masterMap.get(key);
    const profile  = masterId ? profileMap.get(masterId) : undefined;

    // Skip opted-out customers
    if (profile?.doNotSendUpdate === true) continue;
    if (profile?.notificationEnabled === false) continue;

    const segment = (masterId ? segMap.get(masterId) : undefined) ?? "New";

    snapshots.push({
      key,
      name:              newest.customerName ?? "Guest",
      phone:             newest.customerPhone ?? null,
      totalVisits:       customerOrders.length,
      totalSpend,
      avgOrderValue:     totalSpend / customerOrders.length,
      daysSinceLastVisit: daysSinceLast,
      segment,
      dob:               profile?.dob ?? null,
    });
  }

  return snapshots;
}

// ── Main server-side automation run ──────────────────────────────────────────

let isRunning = false;

/**
 * Runs the full server-side automation flow.
 * Fetches DB rules, evaluates each customer, enqueues and sends messages.
 * The client-side engine (runAutomationClientSide) is completely separate.
 */
export async function runAutomationServerSide(
  options: { force?: boolean; limit?: number } = {}
): Promise<RunServerResult> {
  if (isRunning) {
    console.log("[CRM] Server automation already running — skipping");
    return { processed: 0, sent: 0, skipped: 0, failed: 0, dryRun: 0 };
  }

  isRunning = true;
  const stats: RunServerResult = { processed: 0, sent: 0, skipped: 0, failed: 0, dryRun: 0 };

  try {
    const config = getAutomationConfig();
    if (!config.enabled && !options.force) {
      console.log("[CRM] Server automation disabled");
      return stats;
    }

    const msgConfig: MessagingConfig = {
      watiApiKey:    config.watiApiKey,
      watiEndpoint:  config.watiEndpoint,
      msg91AuthKey:  config.msg91AuthKey,
      msg91SenderId: config.msg91SenderId,
    };

    // Load active rules (DB) + fall back to default built-in rules
    const dbRules = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.isActive, true));

    const snapshots = await buildSnapshots();
    const limit = options.limit ?? config.maxPerRun ?? 50;
    let sent = 0;

    for (const customer of snapshots) {
      if (sent >= limit) break;
      stats.processed++;

      if (!customer.phone) { stats.skipped++; continue; }

      // Resolve the UUID first so the same-day dedup is keyed on the canonical
      // customer (not the fragile phone-vs-name `key`) and coordinates with the
      // settlement + outbound-queue paths.
      const customerId = await resolveCustomerId(customer.key, customer.name, customer.phone);

      // IST midnight, not server-local — see hasJobToday's comment below for why.
      const { start: todayStart } = istCalendarDayRange(istCalendarDate());
      const recentJob = await db
        .select({ id: automationJobs.id })
        .from(automationJobs)
        .where(
          and(
            eq(automationJobs.customerId, customerId),
            sql`${automationJobs.scheduledAt} >= ${todayStart}`,
            inArray(automationJobs.status, ["pending", "sending", "sent"]),
          )
        )
        .limit(1);

      if (recentJob.length > 0) { stats.skipped++; continue; }

      // Evaluate DB rules first, then fall back to defaults
      let trigger: string | null = null;
      let message = "";

      for (const rule of dbRules) {
        if (evaluateRule(rule, customer)) {
          trigger = rule.triggerType;
          const actions = (rule.actions ?? {}) as Record<string, unknown>;
          const ruleMsg = actions["message"] as string | undefined;
          message = ruleMsg
            ? ruleMsg
            : await getMessageText(customer, trigger as ServerTriggerType, config.restaurantName || RESTAURANT, config.anthropicApiKey);
          break;
        }
      }

      if (!trigger) {
        const defaultTrigger = evaluateDefaultTriggers(customer);
        if (!defaultTrigger) { stats.skipped++; continue; }
        trigger = defaultTrigger;
        message = await getMessageText(customer, defaultTrigger, config.restaurantName || RESTAURANT, config.anthropicApiKey);
      }

      // Create a pending job (customerId resolved above for the dedup check)
      const [job] = await db
        .insert(automationJobs)
        .values({
          customerId,
          triggerType: trigger,
          status:      "pending",
          message,
          scheduledAt: new Date(),
        })
        .returning();

      // Send
      const result = await sendMessage(customer.key, customer.name, {
        channel: "whatsapp",
        to:      customer.phone,
        message,
        trigger,
      }, msgConfig);

      // Update job status
      await db
        .update(automationJobs)
        .set({
          status:     result.success ? "sent" : "failed",
          executedAt: new Date(),
          error:      result.error ?? null,
        })
        .where(eq(automationJobs.id, job.id));

      if (result.success) {
        sent++;
        if (result.mode === "dry_run") stats.dryRun++;
        else stats.sent++;
        console.log(`[CRM] ✓ ${customer.name} (${trigger}) → ${result.mode}`);
      } else {
        stats.failed++;
        console.warn(`[CRM] ✗ ${customer.name} — ${result.error}`);
      }

      // Rate limiting
      if (sent < limit) await new Promise(r => setTimeout(r, config.sendDelayMs ?? 800));
    }
  } catch (err: any) {
    console.error("[CRM] Server automation error:", err?.message);
  } finally {
    isRunning = false;
  }

  console.log(`[CRM] Run done — sent: ${stats.sent}, dry: ${stats.dryRun}, skip: ${stats.skipped}, fail: ${stats.failed}`);
  return stats;
}

// ── Default automation rules seeder ──────────────────────────────────────────

/** Creates default rules in DB if none exist yet. Call once on startup. */
export async function seedDefaultRules(): Promise<void> {
  try {
    const existing = await db.select({ id: automationRules.id }).from(automationRules).limit(1);
    if (existing.length > 0) return;

    await db.insert(automationRules).values([
      {
        name:        "Win-Back (30 days inactive)",
        triggerType: "INACTIVITY",
        conditions:  { days: 30 },
        actions:     { channel: "whatsapp", discountPercent: 10 },
        isActive:    true,
      },
      {
        name:        "At-Risk Re-engagement (14 days)",
        triggerType: "INACTIVITY",
        conditions:  { days: 14 },
        actions:     { channel: "whatsapp", offer: "complimentary_dessert" },
        isActive:    true,
      },
      {
        name:        "VIP Loyalty Reward",
        triggerType: "HIGH_SPEND",
        conditions:  { minTotalSpend: 10000 },
        actions:     { channel: "whatsapp", offer: "complimentary_starter" },
        isActive:    true,
      },
      {
        name:        "10-Visit Milestone",
        triggerType: "VISIT_MILESTONE",
        conditions:  { visits: 10 },
        actions:     { channel: "whatsapp", discountPercent: 10 },
        isActive:    true,
      },
    ]);

    console.log("[CRM] Default automation rules seeded");
  } catch (err) {
    console.warn("[CRM] Could not seed default rules:", err);
  }
}

// ── Settlement-time messaging (welcome / returning / due reminder) ─────────────
//
// Fired from the payment route when a bill is settled. The PAID branch sends a
// relationship message (welcome for new, an admin-chosen template for returning);
// the DUE branch sends an itemized outstanding-bill reminder. All go through the
// outbound queue (auto-send) with a once-per-day idempotency guard.

type SettlementTrigger = "WELCOME" | "VIP_REWARD" | "FAVORITE_ITEM" | "THANK_YOU";
const RELATIONSHIP_TRIGGERS = ["WELCOME", "VIP_REWARD", "FAVORITE_ITEM", "THANK_YOU"];

// Fallbacks used when the admin leaves a template blank (mirrors automationStore defaults).
const DEFAULT_RETURNING_TEXT =
  "Hi {name}! 🙏 Thank you for dining with us at *{restaurant}* again — we always love having you. See you next time! 🌿";
const DEFAULT_DUE_TEMPLATE =
  "Hi {name}! 🙏 Thank you for visiting *{restaurant}*. Here are your bill details:\n\n{bill}\n\n" +
  "*Amount due: ₹{due}*\n\nPlease settle it at your convenience. Thank you! 🌿";

/** True if a same-day job already exists for this customer + any of these triggers. */
async function hasJobToday(customerId: string, triggers: string[]): Promise<boolean> {
  // IST midnight, not server-local — `new Date().setHours(0,0,0,0)` reads the SERVER's
  // ambient timezone (not guaranteed to be IST, per CLAUDE.md). On a non-IST host, a
  // customer settled at 11:50 PM IST and again at 12:10 AM IST (20 real-world minutes
  // apart, same night) could straddle the server's own local-midnight boundary, so this
  // check misses the earlier job and the documented "one message per customer per day"
  // guarantee silently breaks (a duplicate WELCOME/VIP/due-reminder goes out).
  const { start: todayStart } = istCalendarDayRange(istCalendarDate());
  const rows = await db
    .select({ id: automationJobs.id })
    .from(automationJobs)
    .where(
      and(
        eq(automationJobs.customerId, customerId),
        inArray(automationJobs.triggerType, triggers),
        sql`${automationJobs.scheduledAt} >= ${todayStart}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Replace {name} {restaurant} {visits} {favItem} {due} {bill} tokens. */
function applyTokens(
  tpl: string,
  v: { name?: string | null; restaurant: string; visits?: number; favItem?: string | null; due?: string; bill?: string },
): string {
  const first = (v.name ?? "there").split(" ")[0];
  return tpl
    .replace(/\{name\}/g, first)
    .replace(/\{restaurant\}/g, v.restaurant)
    .replace(/\{visits\}/g, String(v.visits ?? ""))
    .replace(/\{favItem\}/g, v.favItem ?? "our food")
    .replace(/\{due\}/g, v.due ?? "")
    .replace(/\{bill\}/g, v.bill ?? "");
}

/** Build the relationship message text for a settlement trigger. */
function settlementMessageText(snap: AISnapshot, trigger: SettlementTrigger, config: AutomationConfig): string {
  const restaurant = config.restaurantName || RESTAURANT;
  const first = snap.name.split(" ")[0];
  if (trigger === "THANK_YOU") {
    return applyTokens(config.settlementReturningText?.trim() || DEFAULT_RETURNING_TEXT, {
      name: snap.name, restaurant, visits: snap.totalVisits, favItem: snap.favoriteItem,
    });
  }
  if (trigger === "FAVORITE_ITEM") {
    return `Hi ${first}! 😋 We know you love *${snap.favoriteItem ?? "our food"}* at *${restaurant}*! ` +
      `Come back soon and enjoy your favourite again — show this message for a *special discount*. 🍽️`;
  }
  // WELCOME / VIP_REWARD via the server template bank
  const local: CustomerSnapshot = {
    key: snap.key, name: snap.name, phone: snap.phone, totalVisits: snap.totalVisits,
    totalSpend: snap.totalSpend, avgOrderValue: snap.avgOrderValue,
    daysSinceLastVisit: snap.daysSinceLastVisit, segment: snap.tag,
  };
  return buildMessage(local, trigger);
}

/** Send a settlement message — auto-send via the driver queue, else legacy direct send. */
async function dispatchSettlement(args: {
  customerId: string; key: string; name: string; phone: string; trigger: string; message: string;
}): Promise<void> {
  const config = getAutomationConfig();
  if (config.whatsappAutoSend && getDriver()) {
    await enqueueWhatsApp({
      customerId: args.customerId, phone: args.phone, message: args.message, trigger: args.trigger,
    });
    return;
  }
  // Fallback: create a job row + send immediately through the messaging service.
  const [job] = await db
    .insert(automationJobs)
    .values({ customerId: args.customerId, triggerType: args.trigger, status: "pending", message: args.message, scheduledAt: new Date() })
    .returning();
  const msgConfig: MessagingConfig = {
    watiApiKey: config.watiApiKey, watiEndpoint: config.watiEndpoint,
    msg91AuthKey: config.msg91AuthKey, msg91SenderId: config.msg91SenderId,
  };
  const result = await sendMessage(args.key, args.name, { channel: "whatsapp", to: args.phone, message: args.message, trigger: args.trigger }, msgConfig);
  await db
    .update(automationJobs)
    .set({ status: result.success ? "sent" : "failed", executedAt: new Date(), error: result.error ?? null })
    .where(eq(automationJobs.id, job.id));
}

/**
 * Relationship message at a PAID settlement: welcome for a first-time customer,
 * or the admin-chosen template for a returning one.
 */
export async function triggerSettlementMessage(
  key: string,
  name: string,
  phone: string | null | undefined,
): Promise<void> {
  const config = getAutomationConfig();
  if (!config.enabled || !phone) return;

  const snap = await buildSnapshotForKey(key, name, phone);
  if (!snap) return;

  let trigger: SettlementTrigger | null = null;
  if (snap.totalVisits <= 1) {
    if (!config.settlementWelcomeEnabled) return;
    trigger = "WELCOME";
  } else {
    switch (config.settlementReturningMode) {
      case "off":           return;
      case "vip_reward":    trigger = "VIP_REWARD"; break;
      case "favorite_item": trigger = "FAVORITE_ITEM"; break;
      case "thank_you":     trigger = "THANK_YOU"; break;
      case "auto":
      default:
        if (snap.tag === "VIP") trigger = "VIP_REWARD";
        else if (snap.favoriteItem && snap.tag === "Regular") trigger = "FAVORITE_ITEM";
        else trigger = "THANK_YOU";
    }
  }
  if (!trigger) return;

  const customerId = await resolveCustomerId(key, name, phone);
  if (await hasJobToday(customerId, RELATIONSHIP_TRIGGERS)) return;

  const message = settlementMessageText(snap, trigger, config);
  await dispatchSettlement({ customerId, key, name, phone, trigger, message });
  console.log(`[CRM] Settlement message queued — ${name} (${trigger})`);
}

/**
 * Itemized reminder when a bill is left unpaid (due). Lists the order's items +
 * the outstanding amount, wrapped in the admin-editable due template.
 */
export async function triggerDueBillMessage(
  orderId: number,
  name: string,
  phone: string | null | undefined,
): Promise<void> {
  const config = getAutomationConfig();
  if (!config.enabled || !config.dueMessageEnabled || !phone) return;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;

  const key = order.customerPhone?.trim() || order.customerName?.trim() || phone;
  const custName = order.customerName ?? name;
  const customerId = await resolveCustomerId(key, custName, order.customerPhone ?? phone);
  if (await hasJobToday(customerId, ["DUE_REMINDER"])) return;

  const block = await buildOrderBillBlock(orderId);
  if (!block) return;

  const message = applyTokens(config.dueMessageTemplate?.trim() || DEFAULT_DUE_TEMPLATE, {
    name: custName, restaurant: config.restaurantName || RESTAURANT,
    due: String(Math.round(block.due)), bill: block.bill,
  });

  await dispatchSettlement({ customerId, key, name: custName, phone: order.customerPhone ?? phone, trigger: "DUE_REMINDER", message });
  console.log(`[CRM] Due reminder queued — ${custName} (₹${Math.round(block.due)} due)`);
}

/**
 * Build one order's itemized bill block for a WhatsApp message.
 * Open-item safe: prefers the stored `orderItems.name` snapshot, falling back to the
 * joined menu name (per CLAUDE.md — open items have a negative menuItemId with no menu row).
 */
export async function buildOrderBillBlock(
  orderId: number,
): Promise<{ header: string; itemLines: string[]; bill: string; total: number; paid: number; due: number } | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const rawItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const allMenu = await db.select({ id: menuItems.id, name: menuItems.name }).from(menuItems);
  const menuName: Record<number, string> = {};
  for (const m of allMenu) menuName[m.id] = m.name;

  const total = parseFloat(String(order.totalAmount ?? "0"));
  const paid  = parseFloat(String(order.paidAmount ?? "0"));
  const due   = Math.max(0, total - paid);

  const itemLines = rawItems.map(it => {
    const nm  = menuName[it.menuItemId] ?? "Item";
    const amt = Math.round(Number(it.quantity) * parseFloat(String(it.price ?? "0")));
    return `• ${nm} x${it.quantity} — ₹${amt}`;
  });
  const header = `Order ${order.orderNumber}` + (order.tableNumber ? ` · Table ${order.tableNumber}` : "");
  const bill =
    `${header}\n${itemLines.join("\n")}\nTotal: ₹${Math.round(total)}` +
    (paid > 0 ? `\nPaid: ₹${Math.round(paid)}` : "");

  return { header, itemLines, bill, total, paid, due };
}

/**
 * Send ONE consolidated WhatsApp e-bill covering ALL of a customer's open tabs
 * (served + unpaid orders), itemized per order, with a grand outstanding total.
 * Owner-driven (Reports → Dues), unlike the per-order due reminder above.
 * Returns the resolved recipient + built message so the caller can offer a wa.me fallback.
 */
export async function sendConsolidatedEbill(args: {
  name: string; phone: string; orderIds: number[]; totalDue: number;
}): Promise<{ ok: boolean; mode: "driver" | "queued"; message: string }> {
  const config = getAutomationConfig();
  const blocks: string[] = [];
  for (const id of args.orderIds) {
    const b = await buildOrderBillBlock(id);
    if (b) blocks.push(b.bill);
  }
  const bill = blocks.join("\n\n") + `\n\n*Total outstanding: ₹${Math.round(args.totalDue)}*`;
  const key = args.phone.trim() || args.name.trim();
  const customerId = await resolveCustomerId(key, args.name, args.phone);
  const message = applyTokens(config.dueMessageTemplate?.trim() || DEFAULT_DUE_TEMPLATE, {
    name: args.name, restaurant: config.restaurantName || RESTAURANT,
    due: String(Math.round(args.totalDue)), bill,
  });
  const mode: "driver" | "queued" = (config.whatsappAutoSend && getDriver()) ? "driver" : "queued";
  await dispatchSettlement({ customerId, key, name: args.name, phone: args.phone, trigger: "DUE_EBILL", message });
  console.log(`[CRM] Consolidated e-bill queued — ${args.name} (₹${Math.round(args.totalDue)} across ${args.orderIds.length} orders)`);
  return { ok: true, mode, message };
}
