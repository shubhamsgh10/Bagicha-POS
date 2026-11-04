/**
 * feedbackService.ts
 *
 * Post-order NPS / feedback collection.
 *
 * Lifecycle:
 *   1. After payment, scheduleFeedbackForOrder() is called → inserts a feedback
 *      row with a unique token, marks sentAt=null.
 *   2. A background scheduler fires every minute, picks up rows where:
 *        sentAt IS NULL AND now() >= order.paidAt + delayMinutes
 *      and dispatches a WhatsApp/SMS message with the rating link.
 *   3. The customer opens the public link `/feedback/:token`, submits a rating.
 *   4. Low ratings (≤3) auto-issue a recovery coupon and notify the manager.
 */

import crypto from "crypto";
import { db } from "../db";
import { eq, and, isNull, lte, desc, asc, sql } from "drizzle-orm";
import {
  feedback,
  orders,
  CRM_EVENT_TYPES,
} from "../../shared/schema";
import { getAutomationConfig } from "./automationStore";
import { sendWhatsAppMessage } from "./whatsappService";
import { issueCoupon } from "./couponService";
import { logEventByKey } from "./crm/eventService";
import { automatedSendBlock } from "./whatsapp/outboundQueue";

// ── Token + URL helpers ───────────────────────────────────────────────────────

function generateToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function buildFeedbackUrl(token: string): string {
  const config = getAutomationConfig();
  const base = (config.feedbackBaseUrl || config.trackingBaseUrl || "").replace(/\/$/, "");
  if (!base) return `/feedback/${token}`;
  return `${base}/feedback/${token}`;
}

// ── Scheduling ────────────────────────────────────────────────────────────────

/**
 * Creates a pending feedback record for an order. Idempotent — if a feedback
 * row already exists for this order it returns the existing one.
 */
export async function scheduleFeedbackForOrder(orderId: number): Promise<{ ok: boolean; token?: string; reason?: string }> {
  const config = getAutomationConfig();
  if (!config.feedbackEnabled) return { ok: false, reason: "Feedback disabled" };

  // Existing check
  const existing = await db
    .select({ id: feedback.id, token: feedback.token })
    .from(feedback)
    .where(eq(feedback.orderId, orderId))
    .limit(1);
  if (existing.length > 0) return { ok: true, token: existing[0].token };

  const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = orderRows[0];
  if (!order) return { ok: false, reason: "Order not found" };
  if (!order.customerPhone) return { ok: false, reason: "No customer phone" };

  const token = generateToken();
  const customerKey = order.customerPhone || order.customerName || null;

  await db.insert(feedback).values({
    orderId:       order.id,
    customerKey,
    customerName:  order.customerName,
    customerPhone: order.customerPhone,
    token,
    channel:       "whatsapp",
  });

  return { ok: true, token };
}

// ── Sending ───────────────────────────────────────────────────────────────────

interface SendableFeedback {
  id:            number;
  orderId:       number;
  token:         string;
  customerName:  string | null;
  customerPhone: string | null;
  customerKey:   string | null;
}

/**
 * Sends a feedback request via WhatsApp.
 * Updates sentAt on success.
 */
async function sendFeedbackMessage(row: SendableFeedback, restaurantName: string): Promise<void> {
  if (!row.customerPhone) return;
  const config = getAutomationConfig();
  const link = buildFeedbackUrl(row.token);
  const first = (row.customerName ?? "there").split(" ")[0];

  const message =
    `Hi ${first}! 🌿 Thanks for visiting *${restaurantName}*.\n\n` +
    `We'd love to hear your feedback — could you take 10 seconds to rate your experience?\n\n` +
    `${link}\n\n` +
    `Your rating helps us serve you better. 🙏`;

  const result = await sendWhatsAppMessage(row.customerPhone, message, {
    watiApiKey:        config.watiApiKey,
    watiEndpoint:      config.watiEndpoint,
    metaPhoneNumberId: config.metaPhoneNumberId,
    metaAccessToken:   config.metaAccessToken,
  });

  if (result.success) {
    // sentAt was already stamped when the row was claimed (processPendingFeedback).
    if (row.customerKey) {
      logEventByKey(
        row.customerKey,
        row.customerName ?? row.customerKey,
        CRM_EVENT_TYPES.MESSAGE_SENT,
        { channel: "whatsapp", trigger: "FEEDBACK_REQUEST", orderId: row.orderId },
      ).catch(() => {});
    }
  } else {
    console.warn(`[Feedback] send failed for order ${row.orderId}: ${result.error}`);
  }
}

/**
 * Background scheduler — picks up pending feedback rows whose grace window
 * has elapsed and sends them.
 */
// One pass at a time: the scheduler ticks every minute and a pass with a backlog (1 s pacing +
// API latency) can outlast it — the next tick then picked the same unsent rows and sent them again.
let feedbackPassRunning = false;

export async function processPendingFeedback(): Promise<{ sent: number; skipped: number }> {
  if (feedbackPassRunning) return { sent: 0, skipped: 0 };
  feedbackPassRunning = true;
  try {
    return await processPendingFeedbackOnce();
  } finally {
    feedbackPassRunning = false;
  }
}

async function processPendingFeedbackOnce(): Promise<{ sent: number; skipped: number }> {
  const config = getAutomationConfig();
  if (!config.feedbackEnabled) return { sent: 0, skipped: 0 };
  // Without a public base URL the link is a bare "/feedback/<token>" a customer's phone can't open.
  // Don't send (or use up) requests until one is configured.
  if (!(config.feedbackBaseUrl || config.trackingBaseUrl)) {
    console.warn("[Feedback] not sending: set a Feedback base URL in Automation settings");
    return { sent: 0, skipped: 0 };
  }

  const cutoff = new Date(Date.now() - (config.feedbackDelayMinutes ?? 120) * 60_000);

  // Pending feedback rows + their parent order's createdAt
  const pending = await db
    .select({
      id:            feedback.id,
      orderId:       feedback.orderId,
      token:         feedback.token,
      customerName:  feedback.customerName,
      customerPhone: feedback.customerPhone,
      customerKey:   feedback.customerKey,
      orderCreatedAt: orders.createdAt,
      paymentStatus:  orders.paymentStatus,
    })
    .from(feedback)
    .innerJoin(orders, eq(feedback.orderId, orders.id))
    .where(
      and(
        isNull(feedback.sentAt),
        // The delay runs from PAYMENT (a 2-hour lunch shouldn't get its request before the bill).
        sql`coalesce(${orders.paidAt}, ${orders.createdAt}) <= ${cutoff}`,
        eq(orders.paymentStatus, "paid"),
      ),
    )
    .orderBy(asc(feedback.id))
    .limit(50);

  let sent = 0;
  let skipped = 0;

  for (const row of pending) {
    // A row is tried ONCE: it is marked sent before the attempt (claim), so a failed number
    // (invalid / not on WhatsApp) no longer retries every minute forever and fills the batch.
    const markDone = () => db.update(feedback).set({ sentAt: new Date() })
      .where(and(eq(feedback.id, row.id), isNull(feedback.sentAt))).returning({ id: feedback.id });
    if (!row.customerPhone) { await markDone(); skipped++; continue; }
    // Same opt-out / daily-cap rule as every other automated WhatsApp send.
    const block = await automatedSendBlock(row.customerPhone);
    if (block === "daily_cap") break;            // try again tomorrow
    if (block === "opted_out") { await markDone(); skipped++; continue; }
    const claimedRow = await markDone();
    if (claimedRow.length === 0) continue;       // another pass/instance took it
    await sendFeedbackMessage(row, config.restaurantName);
    sent++;
    // Pace sends
    await new Promise(r => setTimeout(r, 1000));
  }

  if (sent > 0) console.log(`[Feedback] sent ${sent} feedback request(s)`);
  return { sent, skipped };
}

// ── Submission ────────────────────────────────────────────────────────────────

export async function submitFeedback(
  token: string,
  rating: number,
  comment: string | null,
  npsScore: number | null,
): Promise<{ ok: boolean; reason?: string; recoveryCoupon?: string }> {
  if (!token) return { ok: false, reason: "Missing token" };
  // Whole numbers only: 2.5 passed the range check, then failed the integer column write AFTER the
  // coupon was issued — so the same link could be replayed for coupons forever.
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, reason: "Rating must be 1-5" };
  if (npsScore != null && (!Number.isInteger(npsScore) || npsScore < 0 || npsScore > 10)) {
    return { ok: false, reason: "Score must be 0-10" };
  }

  const rows = await db.select().from(feedback).where(eq(feedback.token, token)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, reason: "Invalid link" };
  if (row.submittedAt) return { ok: false, reason: "Already submitted" };

  const sentiment = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";

  // Claim the row FIRST (conditional on not yet submitted), then issue any coupon. Two taps of
  // Submit used to both pass the submittedAt check above and both issue a ₹100 coupon.
  const claimed = await db
    .update(feedback)
    .set({
      rating,
      comment:        comment ?? null,
      npsScore:       npsScore ?? null,
      sentiment,
      submittedAt:    new Date(),
      recoveryStatus: rating <= 3 ? "pending" : "none",
    })
    .where(and(eq(feedback.id, row.id), isNull(feedback.submittedAt)))
    .returning({ id: feedback.id });
  if (claimed.length === 0) return { ok: false, reason: "Already submitted" };

  let recoveryCouponId: number | null = null;
  let recoveryCode: string | undefined;

  // Auto-issue recovery coupon for low ratings
  if (rating <= 3 && row.customerKey) {
    try {
      const issued = await issueCoupon({
        customerKey:  row.customerKey,
        customerName: row.customerName ?? row.customerKey,
        type:         "flat",
        value:        100,
        description:  "We're sorry — please give us another try",
        validDays:    30,
        source:       "nps",
        prefix:       "SORRY",
      });
      recoveryCouponId = issued.id;
      recoveryCode     = issued.code;
      await db.update(feedback).set({ recoveryCouponId }).where(eq(feedback.id, row.id));
    } catch (e) {
      console.warn("[Feedback] recovery coupon issue failed:", e);
    }
  }

  if (row.customerKey) {
    logEventByKey(
      row.customerKey,
      row.customerName ?? row.customerKey,
      CRM_EVENT_TYPES.FEEDBACK_RECEIVED,
      { rating, sentiment, orderId: row.orderId, recoveryCouponId },
    ).catch(() => {});
  }

  return { ok: true, recoveryCoupon: recoveryCode };
}

// ── Admin queries ─────────────────────────────────────────────────────────────

export async function listRecentFeedback(limit = 50) {
  return db
    .select()
    .from(feedback)
    // Was `orderBy(eq(feedback.id, feedback.id))` — a boolean-constant "placeholder"
    // that isn't a sort at all, so the admin "recent feedback" list came back in
    // whatever order Postgres happened to produce, not newest-first as the name implies.
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
}

export async function getFeedbackStats() {
  const rows = await db.select({
    rating:     feedback.rating,
    sentiment:  feedback.sentiment,
    submittedAt: feedback.submittedAt,
  }).from(feedback);

  const submitted = rows.filter(r => r.rating !== null);
  const avg = submitted.length > 0
    ? submitted.reduce((s, r) => s + (r.rating ?? 0), 0) / submitted.length
    : 0;

  const byRating: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of submitted) {
    if (r.rating) byRating[r.rating] = (byRating[r.rating] ?? 0) + 1;
  }

  const sent      = rows.length;
  const responded = submitted.length;

  return {
    sent,
    responded,
    responseRate: sent ? (responded / sent) * 100 : 0,
    averageRating: avg,
    byRating,
    promoters:  byRating[5] + byRating[4],
    detractors: byRating[1] + byRating[2],
  };
}

export async function getFeedbackByToken(token: string) {
  const rows = await db.select().from(feedback).where(eq(feedback.token, token)).limit(1);
  return rows[0] ?? null;
}
