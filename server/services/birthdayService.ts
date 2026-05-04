/**
 * birthdayService.ts
 *
 * Daily birthday & anniversary automation.
 *
 * Scans customer_profiles for:
 *   - dob matching today's MM-DD
 *   - anniversary matching today's MM-DD
 *
 * For each match:
 *   1. Issues a single-use birthday/anniversary coupon (free dessert / 15% off).
 *   2. Sends a personalized WhatsApp wish + the coupon code.
 *   3. Logs an event + automation_jobs entry to prevent duplicates.
 */

import { db } from "../db";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import {
  customersMaster,
  customerProfiles,
  automationJobs,
} from "../../shared/schema";
import { getAutomationConfig } from "./automationStore";
import { sendWhatsAppMessage } from "./whatsappService";
import { issueCoupon } from "./couponService";
import { logEventByKey } from "./crm/eventService";
import { CRM_EVENT_TYPES } from "../../shared/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayMonthDay(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/** Extract MM-DD from a YYYY-MM-DD or DD/MM/YYYY string. Returns null on parse error. */
function extractMonthDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  // ISO YYYY-MM-DD
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[2]}-${m[3]}`;
  // DD/MM/YYYY or DD-MM-YYYY
  m = /^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/.exec(v);
  if (m) return `${m[2]}-${m[1]}`;
  // YYYY/MM/DD
  m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(v);
  if (m) return `${m[2]}-${m[3]}`;
  return null;
}

// ── Job dedupe ────────────────────────────────────────────────────────────────

async function alreadySentToday(customerId: string, triggerType: string): Promise<boolean> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: automationJobs.id })
    .from(automationJobs)
    .where(
      and(
        eq(automationJobs.customerId, customerId),
        eq(automationJobs.triggerType, triggerType),
        gte(automationJobs.scheduledAt, todayStart),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ── Run ───────────────────────────────────────────────────────────────────────

export async function runBirthdayAutomation(options: { force?: boolean } = {}): Promise<{
  scanned: number;
  birthdaysSent: number;
  anniversariesSent: number;
  failed: number;
  skipped: number;
}> {
  const config = getAutomationConfig();
  const stats = { scanned: 0, birthdaysSent: 0, anniversariesSent: 0, failed: 0, skipped: 0 };

  if (!config.birthdayEnabled && !options.force) {
    console.log("[Birthday] disabled");
    return stats;
  }

  const md = todayMonthDay();

  const rows = await db
    .select({
      customerId:          customersMaster.id,
      key:                 customersMaster.key,
      name:                customersMaster.name,
      phone:               customersMaster.phone,
      dob:                 customerProfiles.dob,
      anniversary:         customerProfiles.anniversary,
      doNotSendUpdate:     customerProfiles.doNotSendUpdate,
      notificationEnabled: customerProfiles.notificationEnabled,
    })
    .from(customersMaster)
    .innerJoin(customerProfiles, eq(customersMaster.id, customerProfiles.customerId));

  stats.scanned = rows.length;

  for (const c of rows) {
    if (!c.phone) { stats.skipped++; continue; }
    if (c.doNotSendUpdate) { stats.skipped++; continue; }
    if (c.notificationEnabled === false) { stats.skipped++; continue; }

    const isBday = extractMonthDay(c.dob)         === md;
    const isAnni = extractMonthDay(c.anniversary) === md;

    if (!isBday && !isAnni) continue;

    const trigger = isBday ? "BIRTHDAY" : "ANNIVERSARY";
    if (await alreadySentToday(c.customerId, trigger)) { stats.skipped++; continue; }

    // Issue coupon
    let coupon: { code: string } | null = null;
    try {
      coupon = await issueCoupon({
        customerKey:   c.key,
        customerName:  c.name,
        type:          isBday ? "percent" : "percent",
        value:         isBday ? 15 : 20,
        description:   isBday ? "Happy Birthday!" : "Happy Anniversary!",
        validDays:     7,
        source:        isBday ? "birthday" : "anniversary",
        prefix:        isBday ? "BDAY" : "ANNI",
        maxDiscount:   500,
      });
    } catch (e) {
      console.warn("[Birthday] coupon issue failed for", c.key, e);
    }

    const first = c.name.split(" ")[0];
    const message = isBday
      ? `Hi ${first}! 🎂✨ Wishing you a *very Happy Birthday* from all of us at *${config.restaurantName}*!\n\n` +
        `🎁 Here's a special gift: *${coupon?.code ?? "BDAY GIFT"}* — 15% off (up to ₹500) when you visit us this week.\n\n` +
        `Come celebrate with us! 🥳`
      : `Hi ${first}! 💐 Wishing you a *very Happy Anniversary* from all of us at *${config.restaurantName}*!\n\n` +
        `🎁 Celebrate with us — use *${coupon?.code ?? "ANNI GIFT"}* for 20% off (up to ₹500), valid this week.\n\n` +
        `Hope to host you & your loved ones soon! 🌹`;

    const result = await sendWhatsAppMessage(c.phone, message, {
      watiApiKey:        config.watiApiKey,
      watiEndpoint:      config.watiEndpoint,
      metaPhoneNumberId: config.metaPhoneNumberId,
      metaAccessToken:   config.metaAccessToken,
    });

    await db.insert(automationJobs).values({
      customerId:  c.customerId,
      triggerType: trigger,
      status:      result.success ? "sent" : "failed",
      message,
      scheduledAt: new Date(),
      executedAt:  new Date(),
      error:       result.error ?? null,
    });

    if (result.success) {
      if (isBday) stats.birthdaysSent++; else stats.anniversariesSent++;
      logEventByKey(c.key, c.name, CRM_EVENT_TYPES.MESSAGE_SENT, {
        channel: "whatsapp",
        trigger,
        couponCode: coupon?.code,
      }).catch(() => {});
    } else {
      stats.failed++;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`[Birthday] today=${md} scanned=${stats.scanned} bday=${stats.birthdaysSent} anni=${stats.anniversariesSent} skip=${stats.skipped} fail=${stats.failed}`);
  return stats;
}
