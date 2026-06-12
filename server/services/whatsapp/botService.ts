/**
 * botService.ts — deterministic keyword FAQ bot for inbound WhatsApp messages.
 *
 * Pure decision function, no I/O — easy to test and impossible to surprise.
 * Anything it can't answer gets a polite fallback that lists the options;
 * "STAFF"-style requests hand the thread off to a human agent.
 */

export type BotIntent =
  | "GREETING" | "HOURS" | "LOCATION" | "PHONE" | "MENU"
  | "HANDOFF" | "STOP" | "UNKNOWN";

export interface BotContext {
  customerName?: string | null;   // linked customers_master name, if known
  restaurantName: string;
  address: string;
  phone: string;
  hoursText: string;              // config.botHoursText
  menuUrl: string;                // config.menuUrl
  menuText: string;               // config.menuText (fallback when no URL)
}

export interface BotDecision {
  intent: BotIntent;
  reply: string | null;           // null = stay silent (never happens today)
}

// Keyword sets — lowercased substring match, includes common Hinglish
const KEYWORDS: Array<{ intent: BotIntent; words: string[] }> = [
  { intent: "STOP",     words: ["stop", "unsubscribe", "opt out", "optout", "band karo", "mat bhejo", "dont send", "don't send"] },
  { intent: "HANDOFF",  words: ["staff", "agent", "human", "manager", "talk", "speak", "call me", "baat", "help", "complaint", "problem", "issue", "refund"] },
  { intent: "MENU",     words: ["menu", "card", "price", "rate", "items", "dish", "khana", "order"] },
  { intent: "HOURS",    words: ["hour", "time", "timing", "open", "close", "kab khulta", "kitne baje"] },
  { intent: "LOCATION", words: ["where", "location", "address", "direction", "map", "kahan", "kaha hai"] },
  { intent: "PHONE",    words: ["phone", "contact", "number", "call"] },
  { intent: "GREETING", words: ["hi", "hello", "hey", "namaste", "good morning", "good evening", "good afternoon"] },
];

function detectIntent(text: string): BotIntent {
  const t = text.toLowerCase().trim();
  for (const { intent, words } of KEYWORDS) {
    for (const w of words) {
      // Whole-word match so "history" doesn't trigger "hi"
      const re = new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`);
      if (re.test(t)) return intent;
    }
  }
  return "UNKNOWN";
}

const FALLBACK_OPTIONS = "Reply *MENU*, *HOURS*, *LOCATION* — or *STAFF* to talk to our team. 🙏";

export function decide(text: string, ctx: BotContext): BotDecision {
  const intent = detectIntent(text);
  const name = ctx.customerName?.trim().split(/\s+/)[0]; // first name only

  switch (intent) {
    case "STOP":
      return {
        intent,
        reply: `You won't receive any more promotional messages from ${ctx.restaurantName}. Reply START anytime to hear from us again. 🙏`,
      };

    case "HANDOFF":
      return {
        intent,
        reply: `Connecting you to our team — someone will reply here shortly. 🙏`,
      };

    case "GREETING":
      return {
        intent,
        reply: name
          ? `Hi ${name}! 👋 Welcome back to *${ctx.restaurantName}*. ${FALLBACK_OPTIONS}`
          : `Hi! 👋 Welcome to *${ctx.restaurantName}*. ${FALLBACK_OPTIONS}`,
      };

    case "HOURS":
      return {
        intent,
        reply: ctx.hoursText
          ? `🕐 Our timings: ${ctx.hoursText}`
          : `Please give us a call${ctx.phone ? ` at ${ctx.phone}` : ""} to check today's timings. Or reply *STAFF* to ask our team.`,
      };

    case "LOCATION":
      return {
        intent,
        reply: ctx.address
          ? `📍 Find us at: ${ctx.address}`
          : `Reply *STAFF* and our team will share the location with you.`,
      };

    case "PHONE":
      return {
        intent,
        reply: ctx.phone
          ? `📞 You can reach us at ${ctx.phone}.`
          : `Reply *STAFF* and our team will get in touch with you.`,
      };

    case "MENU":
      if (ctx.menuUrl) return { intent, reply: `🍽️ Here's our menu: ${ctx.menuUrl}` };
      if (ctx.menuText) return { intent, reply: `🍽️ Our menu:\n${ctx.menuText}` };
      return { intent, reply: `Reply *STAFF* and our team will send you today's menu.` };

    default:
      return {
        intent: "UNKNOWN",
        reply: `Sorry, I didn't quite get that. 🤖\n${FALLBACK_OPTIONS}`,
      };
  }
}
