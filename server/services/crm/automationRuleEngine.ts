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
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import {
  orders,
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
import { getAutomationConfig } from "../automationStore";

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

// ── Trigger evaluation ────────────────────────────────────────────────────────

function evaluateDefaultTriggers(c: CustomerSnapshot): ServerTriggerType | null {
  if (c.daysSinceLastVisit >= 30) return "WIN_BACK";
  if (c.segment === "At Risk" && c.daysSinceLastVisit >= 7) return "AT_RISK";
  if (c.segment === "VIP") return "VIP_REWARD";
  if (c.segment === "New" && c.totalVisits === 1) return "WELCOME";
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
    const today    = new Date();
    const birthday = new Date(c.dob);
    return birthday.getMonth() === today.getMonth() && birthday.getDate() === today.getDate();
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
      watiApiKey:   config.watiApiKey,
      watiEndpoint: config.watiEndpoint,
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

      // Check if messaged today (DB-side)
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const recentJob = await db
        .select({ id: automationJobs.id })
        .from(automationJobs)
        .where(
          and(
            sql`${automationJobs.customerId} IN (SELECT id FROM customers_master WHERE key = ${customer.key})`,
            sql`${automationJobs.scheduledAt} >= ${todayStart}`,
            eq(automationJobs.status, "sent")
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
          message = String(actions["message"] ?? buildMessage(customer, trigger as ServerTriggerType));
          break;
        }
      }

      if (!trigger) {
        const defaultTrigger = evaluateDefaultTriggers(customer);
        if (!defaultTrigger) { stats.skipped++; continue; }
        trigger = defaultTrigger;
        message = buildMessage(customer, defaultTrigger);
      }

      // Resolve customer UUID and create a pending job
      const customerId = await resolveCustomerId(customer.key, customer.name, customer.phone);

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
