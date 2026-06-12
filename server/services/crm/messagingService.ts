/**
 * messagingService.ts
 *
 * Phase 7 — Unified Omnichannel Messaging Service
 *
 * Wraps WhatsApp (WATI / wa.me), Email (SMTP / SendGrid), and SMS
 * behind a single `sendMessage()` interface.
 *
 * Every send is logged to customer_messages table.
 * Existing sendViaWhatsAppWeb (client-side) is NOT changed.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { customerMessages } from "../../../shared/schema";
import { resolveCustomerId } from "./customerIdService";
import { logMessageSentEvent } from "./eventService";
import { getDriver } from "../whatsapp/driverManager";
import { getOrCreateConversation, recordMessage } from "../whatsapp/conversationStore";
import { publishRealtime } from "../../realtime/publisher";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MessageChannel = "whatsapp" | "email" | "sms";

export interface MessagePayload {
  channel:   MessageChannel;
  to:        string;         // phone for whatsapp/sms, email address for email
  message:   string;
  subject?:  string;         // email only
  trigger?:  string;         // automation trigger type (for logging)
}

export interface SendResult {
  success: boolean;
  mode:    "api" | "dry_run" | "web" | "driver";
  /** Driver/Meta message id — enables delivery-receipt tracking. */
  waMessageId?: string;
  error?:  string;
}

// ── WhatsApp via WATI ─────────────────────────────────────────────────────────

async function sendWhatsAppWATI(
  phone: string,
  message: string,
  watiKey: string,
  watiEndpoint: string
): Promise<SendResult> {
  const normalised = phone.replace(/\D/g, "");
  const e164       = normalised.startsWith("91") ? normalised : `91${normalised}`;

  try {
    const res = await fetch(`${watiEndpoint}/api/v1/sendSessionMessage/${e164}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${watiKey}`,
      },
      body: JSON.stringify({ messageText: message }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { success: false, mode: "api", error: `WATI ${res.status}: ${text}` };
    }
    return { success: true, mode: "api" };
  } catch (err: any) {
    return { success: false, mode: "api", error: err?.message ?? "Network error" };
  }
}

// ── Email via SMTP / SendGrid ─────────────────────────────────────────────────

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  smtpConfig?: { host: string; port: number; user: string; pass: string; from: string }
): Promise<SendResult> {
  // Nodemailer is an optional dep — fall back to dry_run if not configured
  if (!smtpConfig?.host) {
    console.log(`[CRM][Email][DRY-RUN] To: ${to} | Subject: ${subject}`);
    return { success: true, mode: "dry_run" };
  }

  try {
    // Dynamic import so the app works even without nodemailer installed
    const nodemailer = await import("nodemailer" as string).catch(() => null) as any;
    if (!nodemailer) return { success: true, mode: "dry_run" };

    const transporter = nodemailer.default.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465,
      auth: { user: smtpConfig.user, pass: smtpConfig.pass },
    });

    await transporter.sendMail({
      from: smtpConfig.from,
      to,
      subject,
      text: body,
      html: `<p>${body.replace(/\n/g, "<br>")}</p>`,
    });

    return { success: true, mode: "api" };
  } catch (err: any) {
    return { success: false, mode: "api", error: err?.message };
  }
}

// ── SMS via MSG91 ─────────────────────────────────────────────────────────────

async function sendSMS(
  to: string,
  message: string,
  authKey?: string,
  senderId?: string
): Promise<SendResult> {
  if (!authKey || !senderId) {
    console.log(`[CRM][SMS][DRY-RUN] To: ${to} | ${message.slice(0, 60)}`);
    return { success: true, mode: "dry_run" };
  }

  const normalised = to.replace(/\D/g, "");
  const mobile     = normalised.startsWith("91") ? normalised : `91${normalised}`;

  try {
    const url = new URL("https://api.msg91.com/api/sendhttp.php");
    url.searchParams.set("authkey",  authKey);
    url.searchParams.set("mobiles",  mobile);
    url.searchParams.set("message",  message);
    url.searchParams.set("sender",   senderId);
    url.searchParams.set("route",    "4");   // transactional route
    url.searchParams.set("country",  "91");
    url.searchParams.set("unicode",  "1");   // UTF-8 support for ₹ etc.

    const res = await fetch(url.toString(), { method: "GET" });
    const text = await res.text().catch(() => "");

    // MSG91 returns "success" prefix on success
    if (!res.ok || text.toLowerCase().startsWith("error")) {
      return { success: false, mode: "api", error: `MSG91: ${text}` };
    }
    return { success: true, mode: "api" };
  } catch (err: any) {
    return { success: false, mode: "api", error: err?.message ?? "Network error" };
  }
}

// ── Unified send interface ────────────────────────────────────────────────────

export interface MessagingConfig {
  watiApiKey?:    string;
  watiEndpoint?:  string;
  msg91AuthKey?:  string;
  msg91SenderId?: string;
  smtp?: {
    host:  string;
    port:  number;
    user:  string;
    pass:  string;
    from:  string;
  };
}

/**
 * Send a message via any channel and log the result to customer_messages.
 *
 * @param customerKey  customer.key (phone || name) — used for DB logging
 * @param customerName human-readable name for event log
 * @param payload      what to send and how
 * @param config       provider credentials
 */
export async function sendMessage(
  customerKey: string,
  customerName: string,
  payload: MessagePayload,
  config: MessagingConfig = {}
): Promise<SendResult> {
  let result: SendResult = { success: false, mode: "dry_run", error: "Unsupported channel" };

  // ── Route by channel ──────────────────────────────────────────────────────
  if (payload.channel === "whatsapp") {
    const driver = getDriver();
    if (driver && driver.getState() === "connected") {
      // Active driver (Baileys / Meta) — real automated delivery with receipts
      const sent = await driver.sendText(payload.to, payload.message);
      result = { success: sent.success, mode: "driver", waMessageId: sent.waMessageId, error: sent.error };
      if (sent.success) {
        // Mirror into the conversation thread so the agent inbox shows it
        try {
          const conversation = await getOrCreateConversation(payload.to);
          const msg = await recordMessage({
            conversationId: conversation.id,
            direction: "out",
            sender: "automation",
            body: payload.message,
            waMessageId: sent.waMessageId ?? null,
            status: "sent",
            trigger: payload.trigger ?? null,
          });
          void publishRealtime({ type: "WA_MESSAGE", conversationId: conversation.id, message: msg });
        } catch (err) {
          console.warn("[CRM] conversation mirror failed:", err);
        }
      }
    } else if (config.watiApiKey && config.watiEndpoint) {
      result = await sendWhatsAppWATI(payload.to, payload.message, config.watiApiKey, config.watiEndpoint);
    } else {
      // No driver, no WATI — log as dry_run (client-side wa.me is the actual sender)
      console.log(`[CRM][WhatsApp][DRY-RUN] To: ${payload.to}`);
      result = { success: true, mode: "dry_run" };
    }
  } else if (payload.channel === "email") {
    result = await sendEmail(
      payload.to,
      payload.subject ?? "Message from Bagicha",
      payload.message,
      config.smtp
    );
  } else if (payload.channel === "sms") {
    result = await sendSMS(payload.to, payload.message, config.msg91AuthKey, config.msg91SenderId);
  }

  // ── Log to DB (fire-and-forget) ───────────────────────────────────────────
  logToDb(customerKey, customerName, payload, result).catch(
    e => console.warn("[CRM] Message log failed:", e)
  );

  return result;
}

async function logToDb(
  customerKey:  string,
  customerName: string,
  payload:      MessagePayload,
  result:       SendResult
): Promise<void> {
  try {
    const customerId = await resolveCustomerId(customerKey, customerName);

    await db.insert(customerMessages).values({
      customerId,
      channel: payload.channel,
      message: payload.message,
      status:  result.success ? "sent" : "failed",
      trigger: payload.trigger ?? null,
      waMessageId: result.waMessageId ?? null,
      sentAt:  result.success ? new Date() : null,
    });

    if (result.success) {
      await logMessageSentEvent(
        customerKey,
        customerName,
        payload.channel,
        payload.trigger ?? "manual",
        payload.message
      );
    }
  } catch (err) {
    console.warn("[CRM] logToDb failed:", err);
  }
}

// ── Query: message history for a customer ────────────────────────────────────

export async function getCustomerMessages(
  customerId: string,
  limit = 50
) {
  return db
    .select()
    .from(customerMessages)
    .where(eq(customerMessages.customerId, customerId))
    .orderBy(customerMessages.createdAt)
    .limit(limit);
}
