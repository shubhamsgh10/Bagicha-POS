/**
 * whatsappService.ts
 *
 * Server-side WhatsApp message delivery.
 *
 * Supports three modes:
 *   1. Meta WhatsApp Cloud API — direct Meta integration (App ID / Access Token)
 *   2. WATI Business API       — third-party provider
 *   3. Dry-run / logged        — records intent without sending (no provider configured)
 *
 * Priority: Meta > WATI > dry-run
 */

export interface WhatsAppConfig {
  // WATI
  watiApiKey:         string;
  watiEndpoint:       string;   // e.g. https://live-mt-server.wati.io/YOUR_ACCOUNT_ID
  // Meta WhatsApp Cloud API
  metaPhoneNumberId:  string;   // From: Meta Dashboard → WhatsApp → Phone Numbers
  metaAccessToken:    string;   // Permanent System User token (or temporary for testing)
}

export interface SendResult {
  success: boolean;
  mode: "meta" | "wati" | "dry_run";
  error?: string;
}

/** Normalize Indian phone number to 91XXXXXXXXXX format (E.164 without +) */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("91") ? digits : `91${digits}`;
}

function isValidPhone(phone: string): boolean {
  return normalizePhone(phone).length === 12; // 91 + 10 digits
}

/** Delay helper */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Meta WhatsApp Cloud API ───────────────────────────────────────────────────
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
//
// IMPORTANT: Free-form text messages can only be sent within 24 hours of the last
// customer-initiated message (user-initiated conversation window).
// Outside that window, you must use a Meta-approved Template message.
// This service sends free-form text. Ensure your customers have messaged you
// recently, or use template messages for cold outreach.

async function sendViaMeta(
  phone: string,
  message: string,
  config: Pick<WhatsAppConfig, "metaPhoneNumberId" | "metaAccessToken">
): Promise<SendResult> {
  const normalized = normalizePhone(phone);

  if (!isValidPhone(phone)) {
    return { success: false, mode: "meta", error: "Invalid phone number" };
  }

  const url = `https://graph.facebook.com/v19.0/${config.metaPhoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${config.metaAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to:                normalized,
        type:              "text",
        text:              { body: message, preview_url: false },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => String(response.status));
      // Parse Meta error format: { error: { message, type, code } }
      let errMsg = `Meta API ${response.status}`;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error?.message) {
          errMsg = `Meta API ${response.status}: ${parsed.error.message}`;
        }
      } catch {
        errMsg = `Meta API ${response.status}: ${body.slice(0, 120)}`;
      }
      return { success: false, mode: "meta", error: errMsg };
    }

    // Successful response: { messages: [{ id: "wamid.xxx" }] }
    return { success: true, mode: "meta" };
  } catch (err: any) {
    return {
      success: false,
      mode:    "meta",
      error:   `Meta network error: ${err?.message ?? "Unknown"}`,
    };
  }
}

// ── WATI API ──────────────────────────────────────────────────────────────────

async function sendViaWATI(
  phone: string,
  message: string,
  config: Pick<WhatsAppConfig, "watiApiKey" | "watiEndpoint">
): Promise<SendResult> {
  const normalized = normalizePhone(phone);

  if (!isValidPhone(phone)) {
    return { success: false, mode: "wati", error: "Invalid phone number" };
  }

  try {
    const response = await fetch(
      `${config.watiEndpoint}/api/v1/sendSessionMessage/${normalized}`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${config.watiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageText: message }),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => String(response.status));
      return { success: false, mode: "wati", error: `WATI ${response.status}: ${text}` };
    }

    return { success: true, mode: "wati" };
  } catch (err: any) {
    return { success: false, mode: "wati", error: err?.message ?? "Network error" };
  }
}

// ── Public send function ───────────────────────────────────────────────────────

/**
 * Sends a WhatsApp message via the best available provider.
 *
 * Priority order:
 *   1. Meta WhatsApp Cloud API (if metaPhoneNumberId + metaAccessToken are set)
 *   2. WATI API               (if watiApiKey + watiEndpoint are set)
 *   3. Dry-run                (logs intent, no actual send)
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
  config: WhatsAppConfig
): Promise<SendResult> {
  if (!isValidPhone(phone)) {
    return { success: false, mode: "dry_run", error: "Invalid or missing phone number" };
  }

  // Priority 1: Meta Cloud API
  if (config.metaPhoneNumberId && config.metaAccessToken) {
    return sendViaMeta(phone, message, config);
  }

  // Priority 2: WATI
  if (config.watiApiKey && config.watiEndpoint) {
    return sendViaWATI(phone, message, config);
  }

  // Fallback: dry-run
  console.log(`[WhatsApp][DRY-RUN] To: ${normalizePhone(phone)} | ${message.slice(0, 60)}…`);
  return { success: true, mode: "dry_run" };
}
