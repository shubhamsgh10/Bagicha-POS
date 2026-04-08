// ── Types ─────────────────────────────────────────────────────────────────────

export type WhatsAppTemplate = "thank_you" | "inactive_offer" | "vip_reward";

export interface WhatsAppResult {
  success: boolean;
  error?: string;
}

// ── Message templates ─────────────────────────────────────────────────────────

const TEMPLATES: Record<
  WhatsAppTemplate,
  { label: string; emoji: string; build: (name: string, restaurant: string) => string }
> = {
  thank_you: {
    label: "Thank You",
    emoji: "🙏",
    build: (name, restaurant) =>
      `Hi ${name}! 🙏 Thank you for dining at *${restaurant}*. We hope you enjoyed your meal and we look forward to welcoming you again soon!`,
  },
  inactive_offer: {
    label: "Win-Back Offer",
    emoji: "🎁",
    build: (name, restaurant) =>
      `Hi ${name}! 🌿 We miss you at *${restaurant}*! Come back and enjoy *10% off* your next order — just show this message. Valid for 7 days. See you soon! 🍽️`,
  },
  vip_reward: {
    label: "VIP Reward",
    emoji: "⭐",
    build: (name, restaurant) =>
      `Hi ${name}! ⭐ As one of our most valued guests at *${restaurant}*, enjoy a *complimentary dessert* on your next visit — just show this message. Thank you for your loyalty! 🙏`,
  },
};

// ── Public helpers ────────────────────────────────────────────────────────────

export function getTemplateInfo(template: WhatsAppTemplate) {
  const { label, emoji } = TEMPLATES[template];
  return { label, emoji };
}

export function buildMessage(
  template: WhatsAppTemplate,
  customerName: string,
  restaurantName = "Bagicha"
): string {
  return TEMPLATES[template].build(customerName, restaurantName);
}

/** Normalize an Indian phone number to 91XXXXXXXXXX format */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

// ── Send via WhatsApp Web/App (no API key required) ───────────────────────────

/**
 * Opens WhatsApp with a pre-filled message using wa.me.
 * Works immediately — no API credentials needed.
 */
export function sendViaWhatsAppWeb(
  phone: string,
  template: WhatsAppTemplate,
  customerName: string,
  restaurantName?: string
): WhatsAppResult {
  const normalized = normalizePhone(phone);
  if (normalized.length < 12) {
    return { success: false, error: "Invalid phone number" };
  }
  const message = buildMessage(template, customerName, restaurantName);
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return { success: true };
}

// ── Send via WATI API (production integration) ────────────────────────────────

export interface WATIConfig {
  /** e.g. "https://live-mt-server.wati.io/YOUR_ACCOUNT_ID" */
  apiEndpoint: string;
  apiKey: string;
}

/**
 * Sends a WhatsApp message via WATI API.
 * Requires a WATI account and API key configured in Settings.
 */
export async function sendViaWATI(
  phone: string,
  template: WhatsAppTemplate,
  customerName: string,
  config: WATIConfig,
  restaurantName?: string
): Promise<WhatsAppResult> {
  const normalized = normalizePhone(phone);
  const message    = buildMessage(template, customerName, restaurantName);

  try {
    const resp = await fetch(
      `${config.apiEndpoint}/api/v1/sendSessionMessage/${normalized}`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageText: message }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => String(resp.status));
      return { success: false, error: `WATI ${resp.status}: ${text}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? "Network error" };
  }
}
