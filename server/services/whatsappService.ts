/**
 * whatsappService.ts
 *
 * Server-side WhatsApp message delivery.
 *
 * Supports two modes:
 *   1. WATI Business API  — sends programmatically (requires WATI account)
 *   2. Dry-run / logged   — records intent without sending (used when WATI not configured)
 */

export interface WhatsAppConfig {
  watiApiKey: string;
  watiEndpoint: string;   // e.g. https://live-mt-server.wati.io/YOUR_ACCOUNT_ID
}

export interface SendResult {
  success: boolean;
  mode: "wati" | "dry_run";
  error?: string;
}

/** Normalize Indian phone number to 91XXXXXXXXXX format */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("91") ? digits : `91${digits}`;
}

function isValidPhone(phone: string): boolean {
  const n = normalizePhone(phone);
  return n.length === 12; // 91 + 10 digits
}

/** Delay helper */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── WATI API ───────────────────────────────────────────────────────────────────

async function sendViaWATI(
  phone: string,
  message: string,
  config: WhatsAppConfig
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
 * Sends a WhatsApp message.
 * - If WATI is configured and phone is valid → sends via WATI API.
 * - Otherwise → records as dry_run (admin can see it in logs).
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
  config: WhatsAppConfig
): Promise<SendResult> {
  if (!isValidPhone(phone)) {
    return { success: false, mode: "dry_run", error: "Invalid or missing phone number" };
  }

  const watiReady = config.watiApiKey && config.watiEndpoint;

  if (watiReady) {
    return sendViaWATI(phone, message, config);
  }

  // Dry-run: log that we WOULD send, but no actual API call
  return { success: true, mode: "dry_run" };
}
