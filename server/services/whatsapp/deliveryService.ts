/**
 * deliveryService.ts — applies driver delivery receipts (sent → delivered → read)
 * to conversation_messages AND customer_messages via the shared waMessageId.
 *
 * Receipts can arrive out of order; a status rank guard prevents downgrades
 * (e.g. a late "delivered" after "read").
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { conversationMessages, customerMessages } from "../../../shared/schema";
import { publishRealtime } from "../../realtime/publisher";
import type { WaStatusUpdate } from "./types";

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4, // terminal — once failed, stays failed
};

function shouldUpgrade(current: string, next: string): boolean {
  if (current === "failed") return false;
  return (STATUS_RANK[next] ?? 0) > (STATUS_RANK[current] ?? 0);
}

export async function handleStatusUpdate(update: WaStatusUpdate): Promise<void> {
  if (!update.waMessageId) return;

  // ── conversation_messages ────────────────────────────────────────────────
  const convRows = await db.select()
    .from(conversationMessages)
    .where(eq(conversationMessages.waMessageId, update.waMessageId))
    .limit(1);
  const convMsg = convRows[0];

  if (convMsg && shouldUpgrade(convMsg.status, update.status)) {
    await db.update(conversationMessages)
      .set({ status: update.status, ...(update.error ? { error: update.error } : {}) })
      .where(eq(conversationMessages.id, convMsg.id));

    void publishRealtime({
      type: "WA_STATUS",
      conversationId: convMsg.conversationId,
      waMessageId: update.waMessageId,
      status: update.status,
    });
  }

  // ── customer_messages (campaign History) ────────────────────────────────
  const histRows = await db.select()
    .from(customerMessages)
    .where(eq(customerMessages.waMessageId, update.waMessageId))
    .limit(1);
  const histMsg = histRows[0];

  if (histMsg && shouldUpgrade(histMsg.status, update.status)) {
    await db.update(customerMessages).set({
      status: update.status,
      ...(update.status === "delivered" ? { deliveredAt: new Date() } : {}),
      ...(update.status === "read" ? { readAt: new Date() } : {}),
    }).where(eq(customerMessages.id, histMsg.id));
  }
}
