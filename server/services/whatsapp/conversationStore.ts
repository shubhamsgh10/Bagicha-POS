/**
 * conversationStore.ts — DB access for WhatsApp chat threads.
 *
 * Both the inbound pipeline and the outbound queue write here so every thread
 * is complete regardless of who sent the first message. The conversation's
 * normalized phone (91XXXXXXXXXX) is the source of truth; customerId is a
 * best-effort link to customers_master resolved by last-10-digit match.
 */

import { db } from "../../db";
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import {
  conversations,
  conversationMessages,
  customersMaster,
  customerSegments,
  type Conversation,
  type ConversationMessage,
} from "../../../shared/schema";
import { normalizeWaPhone } from "./types";

/** Best-effort link: match stored (user-entered, messy) phones on last 10 digits. */
async function findCustomerIdByPhone(phone: string): Promise<string | null> {
  const last10 = normalizeWaPhone(phone).slice(-10);
  if (last10.length !== 10) return null;
  const rows = await db
    .select({ id: customersMaster.id })
    .from(customersMaster)
    .where(and(
      isNotNull(customersMaster.phone),
      sql`right(regexp_replace(${customersMaster.phone}, '\\D', '', 'g'), 10) = ${last10}`,
    ))
    .orderBy(desc(customersMaster.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function getOrCreateConversation(
  rawPhone: string,
  pushName?: string,
): Promise<Conversation> {
  const phone = normalizeWaPhone(rawPhone);
  const existing = await db.select().from(conversations).where(eq(conversations.phone, phone)).limit(1);
  if (existing[0]) {
    // Backfill the customer link / display name if they appeared later
    const patch: Partial<typeof conversations.$inferInsert> = {};
    if (!existing[0].customerId) {
      const customerId = await findCustomerIdByPhone(phone);
      if (customerId) patch.customerId = customerId;
    }
    if (pushName && !existing[0].displayName) patch.displayName = pushName;
    if (Object.keys(patch).length) {
      const [updated] = await db.update(conversations).set(patch)
        .where(eq(conversations.id, existing[0].id)).returning();
      return updated;
    }
    return existing[0];
  }

  const customerId = await findCustomerIdByPhone(phone);
  const [created] = await db.insert(conversations).values({
    phone,
    customerId,
    displayName: pushName ?? null,
  }).returning();
  return created;
}

export interface RecordMessageInput {
  conversationId: number;
  direction: "in" | "out";
  sender: "customer" | "bot" | "agent" | "automation";
  senderName?: string | null;
  body: string;
  waMessageId?: string | null;
  status?: string;
  trigger?: string | null;
}

/** Insert a message and refresh the thread's preview / unread counters. */
export async function recordMessage(input: RecordMessageInput): Promise<ConversationMessage | null> {
  // Dedup — Baileys re-emits messages on reconnect
  if (input.waMessageId) {
    const dup = await db.select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.waMessageId, input.waMessageId))
      .limit(1);
    if (dup[0]) return null;
  }

  const [msg] = await db.insert(conversationMessages).values({
    conversationId: input.conversationId,
    direction:      input.direction,
    sender:         input.sender,
    senderName:     input.senderName ?? null,
    body:           input.body,
    waMessageId:    input.waMessageId ?? null,
    status:         input.status ?? (input.direction === "in" ? "delivered" : "pending"),
    trigger:        input.trigger ?? null,
  }).returning();

  await db.update(conversations).set({
    lastMessageAt:      new Date(),
    lastMessagePreview: input.body.slice(0, 120),
    ...(input.direction === "in"
      ? { unreadCount: sql`${conversations.unreadCount} + 1` }
      : {}),
  }).where(eq(conversations.id, input.conversationId));

  return msg;
}

export async function getConversation(id: number): Promise<Conversation | null> {
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getConversationByPhone(rawPhone: string): Promise<Conversation | null> {
  const rows = await db.select().from(conversations)
    .where(eq(conversations.phone, normalizeWaPhone(rawPhone))).limit(1);
  return rows[0] ?? null;
}

/** Thread list for the agent inbox, newest activity first, with customer context. */
export async function listConversations(limit = 100) {
  return db
    .select({
      id:                 conversations.id,
      phone:              conversations.phone,
      customerId:         conversations.customerId,
      displayName:        conversations.displayName,
      botActive:          conversations.botActive,
      assignedAgent:      conversations.assignedAgent,
      unreadCount:        conversations.unreadCount,
      lastMessageAt:      conversations.lastMessageAt,
      lastMessagePreview: conversations.lastMessagePreview,
      optedOut:           conversations.optedOut,
      customerName:       customersMaster.name,
      customerKey:        customersMaster.key,
      segment:            customerSegments.segment,
    })
    .from(conversations)
    .leftJoin(customersMaster, eq(conversations.customerId, customersMaster.id))
    .leftJoin(customerSegments, eq(customerSegments.customerId, customersMaster.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
}

export async function getConversationMessages(
  conversationId: number,
  limit = 50,
  beforeId?: number,
): Promise<ConversationMessage[]> {
  const where = beforeId
    ? and(eq(conversationMessages.conversationId, conversationId), lt(conversationMessages.id, beforeId))
    : eq(conversationMessages.conversationId, conversationId);
  const rows = await db.select().from(conversationMessages)
    .where(where)
    .orderBy(desc(conversationMessages.id))
    .limit(limit);
  return rows.reverse(); // oldest → newest for rendering
}

export async function markConversationRead(id: number): Promise<void> {
  await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, id));
}

export async function setBotActive(id: number, botActive: boolean, agent?: string): Promise<void> {
  await db.update(conversations).set(
    botActive
      ? { botActive: true, assignedAgent: null }
      : { botActive: false, humanTakeoverAt: new Date(), assignedAgent: agent ?? null },
  ).where(eq(conversations.id, id));
}

export async function setAgentReplied(id: number, agent: string): Promise<void> {
  await db.update(conversations).set({
    botActive: false,
    lastAgentReplyAt: new Date(),
    assignedAgent: agent,
  }).where(eq(conversations.id, id));
}

export async function setOptedOut(id: number, optedOut: boolean): Promise<void> {
  await db.update(conversations).set({ optedOut }).where(eq(conversations.id, id));
}

/** Total unread across all threads — drives the Conversations tab badge. */
export async function getUnreadTotal(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${conversations.unreadCount}), 0)` })
    .from(conversations);
  return Number(row?.total ?? 0);
}
