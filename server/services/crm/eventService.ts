/**
 * eventService.ts
 *
 * Phase 3 — Customer Event Engine
 *
 * Append-only event log for every meaningful customer action.
 * All functions are fire-and-forget safe — they never throw to the caller.
 */

import { db } from "../../db";
import { desc, eq, and, gte } from "drizzle-orm";
import { customerEvents, CRM_EVENT_TYPES, type CustomerEvent, type CrmEventType } from "../../../shared/schema";
import { resolveCustomerId } from "./customerIdService";

// ── Core: log a single event ──────────────────────────────────────────────────

/**
 * Logs a customer event by UUID.
 * Most callers should use `logEventByKey` (below) for convenience.
 */
export async function logCustomerEvent(
  customerId: string,
  eventType: CrmEventType,
  metadata?: Record<string, unknown>
): Promise<CustomerEvent> {
  const rows = await db
    .insert(customerEvents)
    .values({ customerId, eventType, metadata: metadata ?? {} })
    .returning();
  return rows[0];
}

/**
 * Resolves the customer UUID from their string key and logs an event.
 * Creates the customer_master record if it doesn't exist yet.
 * Silent on DB errors — never throws.
 */
export async function logEventByKey(
  key: string,
  name: string,
  eventType: CrmEventType,
  metadata?: Record<string, unknown>,
  phone?: string | null
): Promise<void> {
  try {
    const customerId = await resolveCustomerId(key, name, phone);
    await logCustomerEvent(customerId, eventType, metadata);
  } catch (err) {
    console.warn(`[CRM] Failed to log event ${eventType} for ${key}:`, err);
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/** Called from the POST /api/orders route after an order is created. */
export async function logOrderPlaced(
  key: string,
  name: string,
  phone: string | null | undefined,
  orderId: number,
  orderNumber: string,
  totalAmount: number
): Promise<void> {
  await logEventByKey(key, name, CRM_EVENT_TYPES.ORDER_PLACED, {
    orderId,
    orderNumber,
    totalAmount,
  }, phone);
}

/** Log that a message was sent to a customer. */
export async function logMessageSentEvent(
  key: string,
  name: string,
  channel: string,
  trigger: string,
  messagePreview: string
): Promise<void> {
  await logEventByKey(key, name, CRM_EVENT_TYPES.MESSAGE_SENT, {
    channel,
    trigger,
    preview: messagePreview.slice(0, 120),
  });
}

/** Log a loyalty milestone (e.g. 10th visit, ₹10k spend). */
export async function logMilestone(
  key: string,
  name: string,
  milestoneType: string,
  value: number | string
): Promise<void> {
  await logEventByKey(key, name, CRM_EVENT_TYPES.MILESTONE, {
    milestoneType,
    value,
  });
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Returns the most recent events for a customer (by UUID), newest first. */
export async function getCustomerEvents(
  customerId: string,
  limit = 50
): Promise<CustomerEvent[]> {
  return db
    .select()
    .from(customerEvents)
    .where(eq(customerEvents.customerId, customerId))
    .orderBy(desc(customerEvents.createdAt))
    .limit(limit);
}

/** Returns events of a specific type in the last N days. */
export async function getRecentEventsByType(
  customerId: string,
  eventType: CrmEventType,
  daysSince = 30
): Promise<CustomerEvent[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysSince);

  return db
    .select()
    .from(customerEvents)
    .where(
      and(
        eq(customerEvents.customerId, customerId),
        eq(customerEvents.eventType, eventType),
        gte(customerEvents.createdAt, since)
      )
    )
    .orderBy(desc(customerEvents.createdAt));
}

/** Count events of a type for a customer — useful for frequency scoring. */
export async function countEvents(
  customerId: string,
  eventType: CrmEventType
): Promise<number> {
  const rows = await db
    .select()
    .from(customerEvents)
    .where(
      and(
        eq(customerEvents.customerId, customerId),
        eq(customerEvents.eventType, eventType)
      )
    );
  return rows.length;
}
