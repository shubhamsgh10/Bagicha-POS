/**
 * razorpayService.ts
 *
 * Razorpay payment gateway integration.
 *
 * Uses Razorpay's REST API directly — no `razorpay` npm dep required, which
 * keeps the bundle small and avoids dragging in another transitive tree.
 *
 * Flow:
 *   1. Server creates a Razorpay Order with amount in paise.
 *   2. Client opens the Razorpay Checkout (script loaded from CDN), customer pays.
 *   3. Checkout returns { razorpay_payment_id, razorpay_order_id, razorpay_signature }.
 *   4. Server verifies the signature (HMAC SHA256 of `${order_id}|${payment_id}` with secret).
 *   5. On success → mark POS order paid, log payment_transactions row.
 *   6. Webhook (optional) provides async confirmation for edge cases.
 */

import crypto from "crypto";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { paymentTransactions, orders } from "../../shared/schema";
import { getAutomationConfig } from "./automationStore";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RazorpayOrderResponse {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
}

export interface VerifyPaymentInput {
  razorpay_order_id:   string;
  razorpay_payment_id: string;
  razorpay_signature:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCredentials() {
  const config = getAutomationConfig();
  return {
    keyId:         config.razorpayKeyId,
    keySecret:     config.razorpayKeySecret,
    webhookSecret: config.razorpayWebhookSecret,
  };
}

function basicAuthHeader(keyId: string, keySecret: string): string {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

export function isConfigured(): boolean {
  const { keyId, keySecret } = getCredentials();
  return Boolean(keyId && keySecret);
}

export function getPublicKeyId(): string {
  return getCredentials().keyId;
}

// ── Order creation ────────────────────────────────────────────────────────────

/**
 * Creates a Razorpay Order so the client can launch checkout.
 * Amount is converted from rupees to paise (smallest unit).
 *
 * Throws if credentials are missing — caller should pre-check via isConfigured().
 */
export async function createRazorpayOrder(
  posOrderId: number,
  amountRupees: number,
  receipt: string,
  notes: Record<string, string> = {}
): Promise<RazorpayOrderResponse> {
  const { keyId, keySecret } = getCredentials();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay not configured. Add keys in Settings → Payment.");
  }

  const amountPaise = Math.round(amountRupees * 100);

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  basicAuthHeader(keyId, keySecret),
    },
    body: JSON.stringify({
      amount:   amountPaise,
      currency: "INR",
      receipt:  receipt.slice(0, 40),
      notes:    { ...notes, posOrderId: String(posOrderId) },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Razorpay createOrder failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json() as RazorpayOrderResponse;

  // Log a pending transaction
  await db.insert(paymentTransactions).values({
    orderId:         posOrderId,
    gateway:         "razorpay",
    gatewayOrderId:  data.id,
    amount:          amountRupees.toFixed(2),
    currency:        "INR",
    status:          "pending",
    raw:             { receipt, notes } as any,
  });

  return data;
}

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Verifies the HMAC-SHA256 signature returned by Razorpay Checkout.
 * Returns true on match; false otherwise. Constant-time comparison.
 */
export function verifySignature(input: VerifyPaymentInput): boolean {
  const { keySecret } = getCredentials();
  if (!keySecret) return false;

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(input.razorpay_signature, "hex"),
    );
  } catch {
    return false;
  }
}

/** Verify webhook signature (different secret than payment signature). */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const { webhookSecret } = getCredentials();
  if (!webhookSecret) return false;

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

// ── Mark transaction success / failure ────────────────────────────────────────

export async function markTransactionSuccess(
  gatewayOrderId: string,
  gatewayPaymentId: string,
  gatewaySignature: string,
  method?: string,
): Promise<void> {
  await db
    .update(paymentTransactions)
    .set({
      gatewayPaymentId,
      gatewaySignature,
      method:      method ?? null,
      status:      "success",
      completedAt: new Date(),
    })
    .where(eq(paymentTransactions.gatewayOrderId, gatewayOrderId));
}

export async function markTransactionFailed(
  gatewayOrderId: string,
  errorCode?: string,
  errorDescription?: string,
): Promise<void> {
  await db
    .update(paymentTransactions)
    .set({
      status:           "failed",
      errorCode:        errorCode ?? null,
      errorDescription: errorDescription ?? null,
      completedAt:      new Date(),
    })
    .where(eq(paymentTransactions.gatewayOrderId, gatewayOrderId));
}

// ── Fetch payment details (used by webhook handler & reconciliation) ──────────

export async function fetchPayment(paymentId: string): Promise<any | null> {
  const { keyId, keySecret } = getCredentials();
  if (!keyId || !keySecret) return null;

  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: basicAuthHeader(keyId, keySecret) },
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Order lookup (helper for the verify route) ────────────────────────────────

export async function getPosOrderForRazorpay(gatewayOrderId: string): Promise<number | null> {
  const rows = await db
    .select({ orderId: paymentTransactions.orderId })
    .from(paymentTransactions)
    .where(eq(paymentTransactions.gatewayOrderId, gatewayOrderId))
    .limit(1);

  return rows[0]?.orderId ?? null;
}

// Re-export orders table for convenience in routes (not heavily used)
export { orders };
