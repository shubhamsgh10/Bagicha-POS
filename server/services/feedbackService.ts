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
import { eq, and, isNull, lte } from "drizzle-orm";
import {
  feedback,
  orders,
  CRM_EVENT_TYPES,
} from "../../shared/schema";
import { getAutomationConfig } from "./automationStore";
import { sendWhatsAppMessage } from "./whatsappService";
import { issueCoupon } from "./couponService";
import { logEventByKey } from "./crm/eventService";

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
    await db
      .update(feedback)
      .set({ sentAt: new Date() })
      .where(eq(feedback.id, row.id));

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
export async function processPendingFeedback(): Promise<{ sent: number; skipped: number }> {
  const config = getAutomationConfig();
  if (!config.feedbackEnabled) return { sent: 0, skipped: 0 };

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
        lte(orders.createdAt, cutoff),
        eq(orders.paymentStatus, "paid"),
      ),
    )
    .limit(50);

  let sent = 0;
  let skipped = 0;

  for (const row of pending) {
    if (!row.customerPhone) { skipped++; continue; }
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
  if (rating < 1 || rating > 5) return { ok: false, reason: "Rating must be 1-5" };

  const rows = await db.select().from(feedback).where(eq(feedback.token, token)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, reason: "Invalid link" };
  if (row.submittedAt) return { ok: false, reason: "Already submitted" };

  const sentiment = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";

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
    } catch (e) {
      console.warn("[Feedback] recovery coupon issue failed:", e);
    }
  }

  await db
    .update(feedback)
    .set({
      rating,
      comment:          comment ?? null,
      npsScore:         npsScore ?? null,
      sentiment,
      submittedAt:      new Date(),
      recoveryStatus:   rating <= 3 ? "pending" : "none",
      recoveryCouponId,
    })
    .where(eq(feedback.id, row.id));

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
    .orderBy(eq(feedback.id, feedback.id))   // placeholder so order param is set
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
