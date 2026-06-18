/**
 * inboundService.ts — pipeline for customer → restaurant WhatsApp messages.
 *
 * driver event → conversation upsert (+ customer link) → persist message →
 * WS broadcast → bot decision (FAQ reply / handoff / opt-out) while the bot
 * owns the thread; silence while a human agent has taken over.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { customersMaster, customerProfiles } from "../../../shared/schema";
import { getAutomationConfig, setCustomerPref } from "../automationStore";
import { getSettings } from "../../settingsStore";
import { logCustomerEvent } from "../crm/eventService";
import { publishRealtime } from "../../realtime/publisher";
import { getDriver } from "./driverManager";
import { decide } from "./botService";
import {
  getOrCreateConversation,
  recordMessage,
  setBotActive,
  setOptedOut,
} from "./conversationStore";
import type { WaInboundMessage } from "./types";

const BOT_REPLY_DELAY_MS = 1_500; // feel human, avoid instant-robot pacing

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function handleInbound(msg: WaInboundMessage): Promise<void> {
  let conversation = await getOrCreateConversation(msg.phone, msg.pushName);

  const stored = await recordMessage({
    conversationId: conversation.id,
    direction: "in",
    sender: "customer",
    body: msg.body,
    waMessageId: msg.waMessageId,
    status: "delivered",
  });
  if (!stored) return; // duplicate (Baileys re-delivery on reconnect)

  // Idle auto-return: human took over but went quiet → bot resumes
  const config = getAutomationConfig();
  if (!conversation.botActive) {
    const lastHuman = conversation.lastAgentReplyAt ?? conversation.humanTakeoverAt;
    const idleMs = (config.botReturnMinutes || 30) * 60_000;
    if (lastHuman && Date.now() - new Date(lastHuman).getTime() > idleMs) {
      await setBotActive(conversation.id, true);
      conversation = { ...conversation, botActive: true };
    }
  }

  void publishRealtime({ type: "WA_MESSAGE", conversationId: conversation.id, message: stored });
  void publishRealtime({ type: "WA_CONVERSATION_UPDATE", conversationId: conversation.id });

  // Opted-out customers can opt back in with START
  if (conversation.optedOut) {
    if (/(^|\W)start($|\W)/i.test(msg.body)) {
      await setOptedOut(conversation.id, false);
      if (conversation.customerId) {
        await setDoNotSendFlag(conversation.customerId, false);
        setCustomerPref(await customerKeyFor(conversation.customerId) ?? conversation.phone, { doNotSend: false });
      }
      setCustomerPref(conversation.phone, { doNotSend: false });
      await sendBotReply(conversation.id, msg.phone, "Welcome back! You'll hear from us again. 🙏", "START");
      void publishRealtime({ type: "WA_CONVERSATION_UPDATE", conversationId: conversation.id });
    }
    return; // never auto-reply further to opted-out threads
  }

  if (!conversation.botActive || !config.botEnabled) return; // human owns the thread

  // ── Bot decision ──────────────────────────────────────────────────────────
  const customerName = conversation.customerId
    ? await customerNameFor(conversation.customerId)
    : conversation.displayName;

  const settings = getSettings();
  const decision = decide(msg.body, {
    customerName,
    restaurantName: config.restaurantName || settings.restaurantName,
    address:        settings.address,
    phone:          settings.phone,
    hoursText:      config.botHoursText,
    menuUrl:        config.menuUrl,
    menuText:       config.menuText,
  });

  if (decision.intent === "STOP") {
    await setOptedOut(conversation.id, true);
    if (conversation.customerId) {
      await setDoNotSendFlag(conversation.customerId, true);
      const key = await customerKeyFor(conversation.customerId);
      if (key) setCustomerPref(key, { doNotSend: true });
      logCustomerEvent(conversation.customerId, "PROFILE_UPDATE", {
        source: "whatsapp", action: "opt_out_via_stop",
      }).catch(() => {});
    }
    // Also suppress by phone for unknown numbers
    setCustomerPref(conversation.phone, { doNotSend: true });
  }

  if (decision.intent === "HANDOFF") {
    await setBotActive(conversation.id, false);
  }

  if (decision.reply) {
    await sleep(BOT_REPLY_DELAY_MS);
    await sendBotReply(conversation.id, msg.phone, decision.reply, decision.intent);
  }

  if (decision.intent === "HANDOFF" || decision.intent === "STOP") {
    void publishRealtime({ type: "WA_CONVERSATION_UPDATE", conversationId: conversation.id });
  }
}

async function sendBotReply(
  conversationId: number,
  phone: string,
  text: string,
  intent: string,
): Promise<void> {
  const driver = getDriver();
  if (!driver || driver.getState() !== "connected") return;

  const result = await driver.sendText(phone, text);
  const msg = await recordMessage({
    conversationId,
    direction: "out",
    sender: "bot",
    body: text,
    waMessageId: result.waMessageId ?? null,
    status: result.success ? "sent" : "failed",
    trigger: intent,
  });
  void publishRealtime({ type: "WA_MESSAGE", conversationId, message: msg });
}

async function customerNameFor(customerId: string): Promise<string | null> {
  const rows = await db.select({ name: customersMaster.name })
    .from(customersMaster).where(eq(customersMaster.id, customerId)).limit(1);
  return rows[0]?.name ?? null;
}

async function customerKeyFor(customerId: string): Promise<string | null> {
  const rows = await db.select({ key: customersMaster.key })
    .from(customersMaster).where(eq(customersMaster.id, customerId)).limit(1);
  return rows[0]?.key ?? null;
}

/**
 * Targeted doNotSendUpdate flip. Deliberately NOT upsertCustomerProfile() —
 * that helper replaces the whole profile row and would null out email/DOB/tags.
 */
async function setDoNotSendFlag(customerId: string, value: boolean): Promise<void> {
  try {
    const existing = await db.select({ id: customerProfiles.id })
      .from(customerProfiles).where(eq(customerProfiles.customerId, customerId)).limit(1);
    if (existing[0]) {
      await db.update(customerProfiles)
        .set({ doNotSendUpdate: value, updatedAt: new Date() })
        .where(eq(customerProfiles.customerId, customerId));
    } else {
      await db.insert(customerProfiles).values({ customerId, doNotSendUpdate: value });
    }
  } catch (err) {
    console.warn("[WhatsApp] setDoNotSendFlag failed:", err);
  }
}
