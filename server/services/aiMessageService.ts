/**
 * aiMessageService.ts
 *
 * Generates personalised WhatsApp messages for customers.
 *
 * Strategy (in order):
 *   1. If `anthropicApiKey` is configured → call Claude API for truly AI-generated text.
 *   2. Otherwise → use smart rich templates with dynamic discounts and personalisation.
 *
 * Both paths produce 2-3 sentence messages in a friendly tone with a clear incentive.
 */

import { type TriggerType } from "./automationStore";

// ── Customer snapshot (server-side, from DB aggregation) ──────────────────────

export interface CustomerSnapshot {
  key: string;         // dedup key (phone || name)
  name: string;
  phone: string;
  totalVisits: number;
  totalSpend: number;
  avgOrderValue: number;
  daysSinceLastVisit: number;
  tag: "VIP" | "Regular" | "New" | "At Risk";
  peakHour: number | null;
  favoriteItem: string | null;
}

// ── Discount by tag ────────────────────────────────────────────────────────────

function discountFor(tag: CustomerSnapshot["tag"]): string {
  switch (tag) {
    case "VIP":       return "5%";
    case "Regular":   return "10%";
    case "At Risk":   return "15%";
    case "New":       return "10%";
    default:          return "10%";
  }
}

function incentiveFor(trigger: TriggerType, tag: CustomerSnapshot["tag"]): string {
  if (trigger === "VIP_REWARD")    return "a complimentary starter";
  if (trigger === "WIN_BACK")      return `${discountFor(tag)} off your next order`;
  if (trigger === "AT_RISK")       return "a complimentary dessert";
  if (trigger === "WELCOME")       return `${discountFor(tag)} off your next visit`;
  if (trigger === "FAVORITE_ITEM") return "your favourite item at a special price";
  return "a special discount";
}

// ── Smart template messages ────────────────────────────────────────────────────

function templateMessage(
  customer: CustomerSnapshot,
  trigger: TriggerType,
  restaurant: string,
  trackingLink?: string
): string {
  const firstName   = customer.name.split(" ")[0];
  const incentive   = incentiveFor(trigger, customer.tag);
  const favPart     = customer.favoriteItem ? ` (especially your favourite *${customer.favoriteItem}*)` : "";
  const linkPart    = trackingLink ? `\n🔗 ${trackingLink}` : "";

  switch (trigger) {
    case "WIN_BACK":
      return (
        `Hi ${firstName}! 🌿 We've been missing you at *${restaurant}*! ` +
        `It's been ${customer.daysSinceLastVisit} days since your last visit${favPart}. ` +
        `Come back and enjoy *${incentiveFor(trigger, customer.tag)}* — just show this message. Valid for 7 days. See you soon! 🍽️${linkPart}`
      );

    case "AT_RISK":
      return (
        `Hi ${firstName}! 🙏 We noticed it's been a while since you visited *${restaurant}*. ` +
        `We'd love to have you back! As a special treat, enjoy *${incentive}* on your next visit — just show this message. ` +
        `Hope to see you soon! 😊${linkPart}`
      );

    case "VIP_REWARD":
      return (
        `Hi ${firstName}! ⭐ You're one of our most valued guests at *${restaurant}* — ` +
        `${customer.totalVisits} visits and counting! ` +
        `Enjoy *${incentive}* on your next visit, just show this message. We're grateful for your loyalty! 🙏${linkPart}`
      );

    case "WELCOME":
      return (
        `Hi ${firstName}! 🎉 Welcome to the *${restaurant}* family! ` +
        `We hope your first experience was delightful. ` +
        `As a welcome gift, enjoy *${incentive}* on your next visit — show this message to claim it. ` +
        `Looking forward to seeing you again! 🌿${linkPart}`
      );

    case "FAVORITE_ITEM":
      return (
        `Hi ${firstName}! 😊 Craving *${customer.favoriteItem ?? "your favourite"}* again? ` +
        `It's waiting for you at *${restaurant}*! ` +
        `Come visit us and enjoy *${incentive}* — valid this week only. Show this message at the counter. 🍽️${linkPart}`
      );
  }
}

// ── Claude API call ────────────────────────────────────────────────────────────

async function callClaude(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    return data?.content?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function generateMessage(
  customer: CustomerSnapshot,
  trigger: TriggerType,
  restaurant: string,
  anthropicApiKey?: string,
  trackingLink?: string
): Promise<string> {
  // Try Claude if key is configured
  if (anthropicApiKey) {
    const prompt = `Generate a short, friendly WhatsApp message for a restaurant customer.

Customer Name: ${customer.name}
Restaurant: ${restaurant}
Trigger: ${trigger}
Total Visits: ${customer.totalVisits}
Total Spend: ₹${Math.round(customer.totalSpend)}
Avg Order Value: ₹${Math.round(customer.avgOrderValue)}
Favourite Item: ${customer.favoriteItem ?? "unknown"}
Days Since Last Visit: ${customer.daysSinceLastVisit}
Incentive to offer: ${incentiveFor(trigger, customer.tag)}
Tracking link to include: ${trackingLink ?? "none"}

Rules:
- Under 3 sentences
- Friendly, warm tone — feel like a friend, not a brand
- Include the incentive and how to claim it
- Use first name only
- Use relevant emojis sparingly
- WhatsApp markdown: *bold* for emphasis
- Do NOT use hashtags or formal language
- Output ONLY the message text, nothing else`;

    const aiMessage = await callClaude(prompt, anthropicApiKey);
    if (aiMessage) return aiMessage;
    // Fall through to template if Claude fails
  }

  // Smart template fallback
  return templateMessage(customer, trigger, restaurant, trackingLink);
}

// ── Send time scoring ──────────────────────────────────────────────────────────

/**
 * Returns true if now is a good time to message this customer.
 * "Good" = within 2 hours of their historical peak ordering hour,
 *          OR no peak data available (always OK).
 * Also avoids 11 PM – 7 AM regardless.
 */
export function isGoodSendTime(customer: CustomerSnapshot): boolean {
  const hour = new Date().getHours();

  // Never disturb at night
  if (hour < 7 || hour >= 23) return false;

  if (customer.peakHour === null) return true;

  const diff = Math.abs(hour - customer.peakHour);
  return diff <= 2 || diff >= 22; // within 2h window (circular)
}
