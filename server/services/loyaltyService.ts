/**
 * loyaltyService.ts
 *
 * Server-backed loyalty point ledger.
 *
 * Configuration (matches client useLoyalty.ts):
 *   - 10 points earned per ₹100 spent
 *   - 100 points minimum to redeem
 *   - 100 points = ₹10 discount
 *
 * Storage: append-only `loyalty_points` ledger.
 *   - +N points rows mean earn events
 *   - -N points rows mean redeem events
 *   - Balance = sum of all rows for a customer
 */

import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { loyaltyPoints, CRM_EVENT_TYPES } from "../../shared/schema";
import { resolveCustomerId } from "./crm/customerIdService";
import { logEventByKey } from "./crm/eventService";

// ── Config ────────────────────────────────────────────────────────────────────

export const POINTS_PER_RUPEE   = 0.1;     // ₹1 = 0.1 pts → ₹100 = 10 pts
export const RUPEES_PER_POINT   = 0.1;     // 1 pt = ₹0.10 → 100 pts = ₹10
export const MIN_REDEEM_POINTS  = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function computeEarnPoints(amountSpent: number): number {
  return Math.floor(Math.max(0, amountSpent) * POINTS_PER_RUPEE);
}

export function pointsToRupees(points: number): number {
  return Math.floor(points * RUPEES_PER_POINT);
}

export function maxRedeemablePoints(balance: number): number {
  return Math.floor(Math.max(0, balance) / MIN_REDEEM_POINTS) * MIN_REDEEM_POINTS;
}

// ── Ledger operations ─────────────────────────────────────────────────────────

export async function getBalance(customerKey: string): Promise<number> {
  if (!customerKey) return 0;
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${loyaltyPoints.points}), 0)::int` })
    .from(loyaltyPoints)
    .where(eq(loyaltyPoints.customerKey, customerKey));
  return Number(row?.total ?? 0);
}

export async function getLedger(customerKey: string, limit = 50) {
  if (!customerKey) return [];
  return db
    .select()
    .from(loyaltyPoints)
    .where(eq(loyaltyPoints.customerKey, customerKey))
    .orderBy(sql`${loyaltyPoints.createdAt} desc`)
    .limit(limit);
}

export async function earnPointsForOrder(
  customerKey: string,
  customerName: string,
  orderId: number,
  orderAmount: number,
): Promise<number> {
  if (!customerKey || orderAmount <= 0) return 0;
  const points = computeEarnPoints(orderAmount);
  if (points <= 0) return 0;

  let customerId: string;
  try {
    customerId = await resolveCustomerId(customerKey, customerName, null);
  } catch {
    return 0;
  }

  await db.insert(loyaltyPoints).values({
    customerId,
    customerKey,
    points,
    reason:  "earn_order",
    orderId,
    metadata: { orderAmount } as any,
  });

  logEventByKey(customerKey, customerName, CRM_EVENT_TYPES.POINTS_EARNED, {
    points,
    orderId,
    orderAmount,
  }).catch(() => {});

  return points;
}

export async function redeemPoints(
  customerKey: string,
  customerName: string,
  pointsToRedeem: number,
  orderId: number | null,
): Promise<{ ok: boolean; reason?: string; discount: number }> {
  if (!customerKey) return { ok: false, reason: "Customer required", discount: 0 };
  if (pointsToRedeem <= 0) return { ok: false, reason: "Invalid points", discount: 0 };
  if (pointsToRedeem % MIN_REDEEM_POINTS !== 0) {
    return { ok: false, reason: `Redeem in multiples of ${MIN_REDEEM_POINTS}`, discount: 0 };
  }

  const balance = await getBalance(customerKey);
  if (pointsToRedeem > balance) {
    return { ok: false, reason: `Only ${balance} pts available`, discount: 0 };
  }

  let customerId: string;
  try {
    customerId = await resolveCustomerId(customerKey, customerName, null);
  } catch {
    return { ok: false, reason: "Customer lookup failed", discount: 0 };
  }

  await db.insert(loyaltyPoints).values({
    customerId,
    customerKey,
    points:  -pointsToRedeem,
    reason:  "redeem_order",
    orderId: orderId ?? null,
  });

  const discount = pointsToRupees(pointsToRedeem);

  logEventByKey(customerKey, customerName, CRM_EVENT_TYPES.POINTS_REDEEMED, {
    points: pointsToRedeem,
    discount,
    orderId,
  }).catch(() => {});

  return { ok: true, discount };
}
