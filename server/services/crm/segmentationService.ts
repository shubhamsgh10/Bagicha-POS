/**
 * segmentationService.ts
 *
 * Phase 4 — Customer Segmentation & RFM Scoring
 *
 * Calculates Recency / Frequency / Monetary scores for each customer
 * and assigns them to a segment (VIP | Regular | New | At Risk | Lapsed).
 *
 * Runs:
 *   - After every new order (single-customer update)
 *   - Via hourly cron job (full batch refresh)
 */

import { db } from "../../db";
import { desc, eq, sql } from "drizzle-orm";
import {
  orders,
  customersMaster,
  customerSegments,
  type CustomerSegment,
} from "../../../shared/schema";
import { resolveCustomerId } from "./customerIdService";
import { logMilestone } from "./eventService";

// ── RFM thresholds (mirrors useCustomerIntelligence.ts constants) ─────────────

const AT_RISK_DAYS    = 15;
const VIP_MIN_VISITS  = 10;
const HIGH_SPEND_AVG  = 600;
const LAPSED_DAYS     = 60;

// ── Scoring functions ─────────────────────────────────────────────────────────

function recencyScore(daysSinceLast: number): number {
  if (daysSinceLast === 0)  return 10;
  if (daysSinceLast <= 3)   return 9;
  if (daysSinceLast <= 7)   return 8;
  if (daysSinceLast <= 14)  return 6;
  if (daysSinceLast <= 30)  return 4;
  if (daysSinceLast <= 60)  return 2;
  return 1;
}

function frequencyScore(visits: number): number {
  if (visits >= 20) return 10;
  if (visits >= 10) return 8;
  if (visits >= 5)  return 6;
  if (visits >= 3)  return 4;
  if (visits === 2) return 2;
  return 1;
}

function monetaryScore(avgSpend: number): number {
  if (avgSpend >= 1000) return 10;
  if (avgSpend >= 600)  return 8;
  if (avgSpend >= 400)  return 6;
  if (avgSpend >= 250)  return 4;
  if (avgSpend >= 100)  return 2;
  return 1;
}

function segmentFrom(
  visits: number,
  avgSpend: number,
  daysSinceLast: number
): CustomerSegment["segment"] {
  if (daysSinceLast > LAPSED_DAYS && visits > 2)                     return "Lapsed";
  if (daysSinceLast > AT_RISK_DAYS && visits > 2)                    return "At Risk";
  if (visits > VIP_MIN_VISITS && avgSpend >= HIGH_SPEND_AVG)         return "VIP";
  if (visits >= 3)                                                    return "Regular";
  return "New";
}

// ── Single-customer scoring ───────────────────────────────────────────────────

export interface CustomerRFM {
  customerId:     string;
  segment:        string;
  rfmScore:       number;
  recencyScore:   number;
  frequencyScore: number;
  monetaryScore:  number;
}

/**
 * Computes RFM score for a single customer from live order data and
 * upserts the result into customer_segments.
 */
export async function runSegmentationForCustomer(
  key: string,
  name: string,
  phone?: string | null
): Promise<CustomerRFM | null> {
  try {
    const customerId = await resolveCustomerId(key, name, phone);

    // Fetch all orders for this customer (keyed by phone or name)
    const customerOrders = await db
      .select({
        totalAmount: orders.totalAmount,
        createdAt:   orders.createdAt,
      })
      .from(orders)
      .where(
        sql`(${orders.customerPhone} = ${key} OR ${orders.customerName} = ${key})`
      )
      .orderBy(desc(orders.createdAt));

    if (!customerOrders.length) return null;

    const totalSpend   = customerOrders.reduce((s, o) => s + parseFloat(String(o.totalAmount ?? 0)), 0);
    const avgSpend     = totalSpend / customerOrders.length;
    const lastVisit    = new Date(customerOrders[0].createdAt);
    const daysSinceLast = Math.floor((Date.now() - lastVisit.getTime()) / 86_400_000);
    const visits       = customerOrders.length;

    const rScore = recencyScore(daysSinceLast);
    const fScore = frequencyScore(visits);
    const mScore = monetaryScore(avgSpend);
    const rfm    = rScore + fScore + mScore;
    const seg    = segmentFrom(visits, avgSpend, daysSinceLast);

    // Check for milestone events before upserting
    const existing = await db
      .select({ segment: customerSegments.segment })
      .from(customerSegments)
      .where(eq(customerSegments.customerId, customerId))
      .limit(1);

    const wasSegment = existing[0]?.segment;

    // Upsert
    if (existing.length > 0) {
      await db
        .update(customerSegments)
        .set({ segment: seg, rfmScore: rfm, recencyScore: rScore, frequencyScore: fScore, monetaryScore: mScore, updatedAt: new Date() })
        .where(eq(customerSegments.customerId, customerId));
    } else {
      await db
        .insert(customerSegments)
        .values({ customerId, segment: seg, rfmScore: rfm, recencyScore: rScore, frequencyScore: fScore, monetaryScore: mScore });
    }

    // Fire milestone event on VIP upgrade
    if (wasSegment && wasSegment !== "VIP" && seg === "VIP") {
      await logMilestone(key, name, "SEGMENT_UPGRADE", "VIP");
    }

    // Visit count milestones
    if ([5, 10, 25, 50].includes(visits)) {
      await logMilestone(key, name, "VISIT_MILESTONE", visits);
    }

    return { customerId, segment: seg, rfmScore: rfm, recencyScore: rScore, frequencyScore: fScore, monetaryScore: mScore };
  } catch (err) {
    console.warn(`[CRM] Segmentation failed for ${key}:`, err);
    return null;
  }
}

// ── Full batch segmentation ───────────────────────────────────────────────────

/**
 * Runs segmentation for all customers that have orders.
 * Called by the hourly cron job or manually via API.
 */
export async function runSegmentationForAll(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed    = 0;

  try {
    // Get all unique customer keys from the orders table
    const uniqueKeys = await db
      .selectDistinct({
        key:   sql<string>`COALESCE(${orders.customerPhone}, ${orders.customerName})`,
        name:  orders.customerName,
        phone: orders.customerPhone,
      })
      .from(orders)
      .where(sql`${orders.customerPhone} IS NOT NULL OR ${orders.customerName} IS NOT NULL`);

    for (const row of uniqueKeys) {
      if (!row.key) continue;
      const result = await runSegmentationForCustomer(
        row.key,
        row.name ?? row.key,
        row.phone
      );
      if (result) processed++;
      else failed++;
    }
  } catch (err) {
    console.error("[CRM] Batch segmentation failed:", err);
  }

  console.log(`[CRM] Segmentation complete — processed: ${processed}, failed: ${failed}`);
  return { processed, failed };
}

// ── Read segment ──────────────────────────────────────────────────────────────

/** Returns the stored segment for a customer UUID. */
export async function getCustomerSegment(customerId: string): Promise<CustomerSegment | null> {
  const rows = await db
    .select()
    .from(customerSegments)
    .where(eq(customerSegments.customerId, customerId))
    .limit(1);
  return rows[0] ?? null;
}

// ── Segment scheduler ─────────────────────────────────────────────────────────

let segmentTimer: ReturnType<typeof setInterval> | null = null;

export function startSegmentationScheduler(intervalHours = 1): void {
  if (segmentTimer) clearInterval(segmentTimer);
  segmentTimer = setInterval(
    () => runSegmentationForAll().catch(e => console.error("[CRM] Scheduler error:", e)),
    intervalHours * 60 * 60 * 1000
  );
  console.log(`[CRM] Segmentation scheduler started (every ${intervalHours}h)`);
}

export function stopSegmentationScheduler(): void {
  if (segmentTimer) { clearInterval(segmentTimer); segmentTimer = null; }
}
