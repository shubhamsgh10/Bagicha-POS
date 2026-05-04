/**
 * couponService.ts
 *
 * Coupon validation, redemption, and auto-issuance.
 *
 * - Validates a code against an order context (amount, customer, usage limits).
 * - Applies the coupon (computes discount).
 * - Logs the redemption for audit & per-customer limits.
 * - Auto-issues coupons for triggers (birthday, NPS recovery, win-back).
 */

import { db } from "../db";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  coupons,
  couponRedemptions,
  customersMaster,
  CRM_EVENT_TYPES,
} from "../../shared/schema";
import { resolveCustomerId } from "./crm/customerIdService";
import { logEventByKey } from "./crm/eventService";
import crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidateInput {
  code:        string;
  orderAmount: number;
  customerKey?: string;
}

export interface ValidateResult {
  ok:        boolean;
  reason?:   string;
  couponId?: number;
  discount?: number;
  type?:     string;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Computes the discount amount for a given coupon + order amount.
 * Returns 0 if invalid.
 */
function computeDiscount(
  type: string,
  value: number,
  orderAmount: number,
  maxDiscount: number | null,
): number {
  let discount = 0;
  if (type === "percent") {
    discount = (orderAmount * value) / 100;
  } else if (type === "flat") {
    discount = value;
  } else if (type === "item") {
    // Item-level discounts must be applied client-side; treated as flat ₹value here.
    discount = value;
  }
  if (maxDiscount && maxDiscount > 0 && discount > maxDiscount) discount = maxDiscount;
  if (discount > orderAmount) discount = orderAmount;
  return Math.round(discount * 100) / 100;
}

/**
 * Validates a coupon code without consuming it. Safe to call from the cart UI.
 */
export async function validateCoupon(input: ValidateInput): Promise<ValidateResult> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, reason: "Enter a coupon code" };

  const rows = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, code))
    .limit(1);

  const coupon = rows[0];
  if (!coupon) return { ok: false, reason: "Invalid coupon code" };
  if (!coupon.isActive) return { ok: false, reason: "Coupon is inactive" };

  const now = new Date();
  if (coupon.validFrom && coupon.validFrom > now) {
    return { ok: false, reason: "Coupon not yet active" };
  }
  if (coupon.validUntil && coupon.validUntil < now) {
    return { ok: false, reason: "Coupon has expired" };
  }

  const orderAmount = Number(input.orderAmount) || 0;
  const minAmount   = Number(coupon.minOrderAmount ?? 0);
  if (orderAmount < minAmount) {
    return { ok: false, reason: `Minimum order ₹${minAmount} required` };
  }

  // Total usage limit
  const [{ totalUsed }] = await db
    .select({ totalUsed: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .where(eq(couponRedemptions.couponId, coupon.id));
  if (totalUsed >= coupon.usageLimit) {
    return { ok: false, reason: "Coupon usage limit reached" };
  }

  // Per-customer limit (only enforced if a customer key is supplied)
  if (input.customerKey) {
    const [{ perCust }] = await db
      .select({ perCust: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, coupon.id),
          eq(couponRedemptions.customerKey, input.customerKey),
        ),
      );
    if (perCust >= coupon.perCustomerLimit) {
      return { ok: false, reason: "You've already used this coupon" };
    }
  }

  // Customer-bound coupon
  if (coupon.customerId && input.customerKey) {
    const masterRows = await db
      .select({ id: customersMaster.id })
      .from(customersMaster)
      .where(eq(customersMaster.key, input.customerKey))
      .limit(1);
    if (!masterRows[0] || masterRows[0].id !== coupon.customerId) {
      return { ok: false, reason: "Coupon not valid for this customer" };
    }
  } else if (coupon.customerId && !input.customerKey) {
    return { ok: false, reason: "Coupon is customer-specific — add customer to apply" };
  }

  const discount = computeDiscount(
    coupon.type,
    Number(coupon.value),
    orderAmount,
    coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
  );

  return {
    ok:       true,
    couponId: coupon.id,
    discount,
    type:     coupon.type,
  };
}

// ── Redemption ────────────────────────────────────────────────────────────────

/**
 * Records the use of a coupon. Re-validates inside a transaction-like flow.
 * Returns the discount actually applied.
 */
export async function redeemCoupon(
  couponId: number,
  orderId: number,
  customerKey: string | null,
  orderAmount: number,
): Promise<{ ok: boolean; discount: number; reason?: string }> {
  const rows = await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
  const coupon = rows[0];
  if (!coupon) return { ok: false, discount: 0, reason: "Coupon not found" };

  // Re-validate (race-safe enough for a small POS)
  const v = await validateCoupon({
    code: coupon.code,
    orderAmount,
    customerKey: customerKey ?? undefined,
  });
  if (!v.ok) return { ok: false, discount: 0, reason: v.reason };

  let customerId: string | null = null;
  if (customerKey) {
    try {
      customerId = await resolveCustomerId(customerKey, customerKey, null);
    } catch {
      customerId = null;
    }
  }

  await db.insert(couponRedemptions).values({
    couponId,
    orderId,
    customerId,
    customerKey: customerKey ?? null,
    discountApplied: (v.discount ?? 0).toFixed(2),
  });

  if (customerKey) {
    logEventByKey(customerKey, customerKey, CRM_EVENT_TYPES.COUPON_USED, {
      couponId,
      code: coupon.code,
      discount: v.discount,
      orderId,
    }).catch(() => {});
  }

  return { ok: true, discount: v.discount ?? 0 };
}

// ── Auto-issue ────────────────────────────────────────────────────────────────

/**
 * Generates a short, human-friendly coupon code with a prefix.
 * e.g. BDAY-7K3F9
 */
export function generateCouponCode(prefix: string): string {
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix.toUpperCase()}-${rand}`;
}

export interface IssueCouponInput {
  customerKey?:   string;
  customerName?:  string;
  type:           "percent" | "flat";
  value:          number;
  description?:   string;
  validDays?:     number;          // default 30
  source:         string;          // birthday | nps | win_back | welcome | referral
  minOrderAmount?: number;
  maxDiscount?:   number | null;
  prefix?:        string;          // code prefix; defaults to source
}

/**
 * Auto-issues a coupon (typically tied to a customer).
 * Returns the new coupon row.
 */
export async function issueCoupon(input: IssueCouponInput) {
  const code = generateCouponCode(input.prefix ?? input.source);
  const validDays = input.validDays ?? 30;
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);

  let customerId: string | null = null;
  if (input.customerKey) {
    try {
      customerId = await resolveCustomerId(
        input.customerKey,
        input.customerName ?? input.customerKey,
        null,
      );
    } catch {
      customerId = null;
    }
  }

  const [row] = await db.insert(coupons).values({
    code,
    type:             input.type,
    value:            input.value.toFixed(2),
    description:      input.description ?? null,
    minOrderAmount:   (input.minOrderAmount ?? 0).toFixed(2),
    maxDiscount:      input.maxDiscount != null ? input.maxDiscount.toFixed(2) : null,
    usageLimit:       1,
    perCustomerLimit: 1,
    validFrom:        new Date(),
    validUntil,
    isActive:         true,
    customerId,
    source:           input.source,
  }).returning();

  return row;
}

/** List active coupons (admin view). */
export async function listCoupons(includeInactive = false) {
  if (includeInactive) {
    return db.select().from(coupons).orderBy(sql`${coupons.createdAt} desc`);
  }
  return db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.isActive, true),
        or(isNull(coupons.validUntil), gt(coupons.validUntil, new Date())),
      ),
    )
    .orderBy(sql`${coupons.createdAt} desc`);
}
