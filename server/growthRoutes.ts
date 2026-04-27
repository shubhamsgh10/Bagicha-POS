/**
 * growthRoutes.ts
 *
 * Phase 1 growth routes: Razorpay, Feedback NPS, Coupons, Loyalty,
 * Birthday automation triggers, and AI daily digest.
 *
 * Mounted from server/routes.ts via registerGrowthRoutes(app, broadcast).
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  orders,
  feedback,
  coupons,
  couponRedemptions,
  loyaltyPoints,
  dailyDigests,
  paymentTransactions,
} from "../shared/schema";
import { storage } from "./storage";

import {
  isConfigured as razorpayConfigured,
  getPublicKeyId,
  createRazorpayOrder,
  verifySignature,
  verifyWebhookSignature,
  markTransactionSuccess,
  markTransactionFailed,
  getPosOrderForRazorpay,
} from "./services/razorpayService";

import {
  validateCoupon,
  redeemCoupon,
  issueCoupon,
  listCoupons,
} from "./services/couponService";

import {
  earnPointsForOrder,
  redeemPoints,
  getBalance,
  getLedger,
  maxRedeemablePoints,
  pointsToRupees,
  MIN_REDEEM_POINTS,
} from "./services/loyaltyService";

import {
  scheduleFeedbackForOrder,
  submitFeedback,
  getFeedbackStats,
  getFeedbackByToken,
  processPendingFeedback,
} from "./services/feedbackService";

import {
  generateAndSendDailyDigest,
  buildDailyMetrics,
  listRecentDigests,
} from "./services/dailyDigestService";

import { runBirthdayAutomation } from "./services/birthdayService";
import { getAutomationConfig } from "./services/automationStore";

// ── Auth middleware (re-implementing here so we don't introduce a circular import) ──

function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function customerKeyFromOrder(order: { customerPhone?: string | null; customerName?: string | null }): string | null {
  return order.customerPhone?.trim() || order.customerName?.trim() || null;
}

// ── Public routes (no auth) ───────────────────────────────────────────────────

export function registerPublicGrowthRoutes(app: Express): void {
  // Public feedback view (token-gated)
  app.get("/api/feedback/:token", async (req: Request, res: Response) => {
    try {
      const row = await getFeedbackByToken(req.params.token);
      if (!row) return res.status(404).json({ error: "Invalid link" });
      const config = getAutomationConfig();
      res.json({
        token:        row.token,
        rating:       row.rating,
        submitted:    !!row.submittedAt,
        customerName: row.customerName,
        restaurantName: config.restaurantName,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/feedback/:token/submit", async (req: Request, res: Response) => {
    try {
      const { rating, comment, npsScore } = req.body as {
        rating: number;
        comment?: string;
        npsScore?: number;
      };
      const result = await submitFeedback(
        req.params.token,
        Number(rating),
        comment ?? null,
        npsScore != null ? Number(npsScore) : null,
      );
      if (!result.ok) return res.status(400).json({ error: result.reason });
      res.json({ ok: true, recoveryCoupon: result.recoveryCoupon });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Razorpay webhook (no auth — verified via signature)
  app.post("/api/razorpay/webhook", async (req: Request, res: Response) => {
    try {
      const signature = (req.headers["x-razorpay-signature"] as string) ?? "";
      const rawBody = JSON.stringify(req.body);

      if (!verifyWebhookSignature(rawBody, signature)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      const event = req.body?.event as string;
      const payload = req.body?.payload?.payment?.entity;

      if (event === "payment.captured" && payload) {
        const orderRef = payload.order_id as string;
        const posOrderId = await getPosOrderForRazorpay(orderRef);
        if (posOrderId) {
          await markTransactionSuccess(orderRef, payload.id, "", payload.method);
          await storage.updateOrder(posOrderId, {
            paymentStatus: "paid",
            paymentMethod: payload.method ?? "online",
            status: "served",
          } as any);
        }
      } else if (event === "payment.failed" && payload) {
        const orderRef = payload.order_id as string;
        await markTransactionFailed(orderRef, payload.error_code, payload.error_description);
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Razorpay] webhook error:", err);
      res.status(500).json({ error: err?.message });
    }
  });
}

// ── Authenticated routes ──────────────────────────────────────────────────────

export function registerGrowthRoutes(app: Express, broadcast: (data: any) => void): void {
  // ── Razorpay ────────────────────────────────────────────────────────────────

  /** Status — exposes whether Razorpay is configured + the public key (no secret). */
  app.get("/api/razorpay/status", requireAuth, (_req, res) => {
    res.json({
      configured: razorpayConfigured(),
      keyId:      razorpayConfigured() ? getPublicKeyId() : null,
    });
  });

  /** Create a Razorpay order for a POS order. */
  app.post("/api/razorpay/create-order", requireAuth, async (req, res) => {
    try {
      if (!razorpayConfigured()) {
        return res.status(400).json({ error: "Razorpay not configured" });
      }
      const { orderId, amount } = req.body as { orderId: number; amount: number };
      const posOrder = await storage.getOrderById(Number(orderId));
      if (!posOrder) return res.status(404).json({ error: "Order not found" });

      const amt = Number(amount) || parseFloat(String(posOrder.totalAmount ?? 0));
      if (amt <= 0) return res.status(400).json({ error: "Invalid amount" });

      const rzpOrder = await createRazorpayOrder(
        posOrder.id,
        amt,
        posOrder.orderNumber,
        {
          customerName: posOrder.customerName ?? "",
          customerPhone: posOrder.customerPhone ?? "",
        },
      );

      res.json({
        keyId:    getPublicKeyId(),
        orderId:  rzpOrder.id,
        amount:   rzpOrder.amount,
        currency: rzpOrder.currency,
        receipt:  rzpOrder.receipt,
      });
    } catch (err: any) {
      console.error("[Razorpay] create-order error:", err);
      res.status(500).json({ error: err?.message ?? "Razorpay error" });
    }
  });

  /** Verify payment signature returned by Razorpay Checkout. */
  app.post("/api/razorpay/verify", requireAuth, async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, posOrderId, method } = req.body;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: "Missing signature fields" });
      }

      const valid = verifySignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature });
      if (!valid) {
        await markTransactionFailed(razorpay_order_id, "signature_mismatch", "Invalid signature");
        return res.status(400).json({ error: "Signature verification failed" });
      }

      await markTransactionSuccess(razorpay_order_id, razorpay_payment_id, razorpay_signature, method);

      // Mark POS order paid
      const posId = Number(posOrderId) || (await getPosOrderForRazorpay(razorpay_order_id));
      if (posId) {
        const updated = await storage.updateOrder(posId, {
          paymentStatus: "paid",
          paymentMethod: method ? `upi-${method}` : "online",
          status: "served",
        } as any);

        if ((updated as any).tableId) {
          await storage.updateTableStatus(Number((updated as any).tableId), "free", null);
          broadcast({ type: "TABLE_UPDATE" });
        }
        broadcast({ type: "ORDER_UPDATE", order: updated });

        // Earn loyalty + schedule feedback (fire-and-forget)
        const key = customerKeyFromOrder(updated as any);
        if (key) {
          earnPointsForOrder(
            key,
            (updated as any).customerName ?? key,
            posId,
            parseFloat(String((updated as any).totalAmount ?? 0)),
          ).catch(() => {});
        }
        scheduleFeedbackForOrder(posId).catch(() => {});
      }

      res.json({ ok: true, posOrderId: posId });
    } catch (err: any) {
      console.error("[Razorpay] verify error:", err);
      res.status(500).json({ error: err?.message ?? "Verify error" });
    }
  });

  /** List recent payment transactions (admin view). */
  app.get("/api/razorpay/transactions", requireAuth, async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(paymentTransactions)
        .orderBy(desc(paymentTransactions.createdAt))
        .limit(100);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Coupons ─────────────────────────────────────────────────────────────────

  /** Validate a coupon code without consuming it. */
  app.post("/api/coupons/validate", requireAuth, async (req, res) => {
    try {
      const { code, orderAmount, customerKey } = req.body as {
        code: string;
        orderAmount: number;
        customerKey?: string;
      };
      const result = await validateCoupon({
        code: String(code ?? ""),
        orderAmount: Number(orderAmount) || 0,
        customerKey: customerKey ? String(customerKey) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** Apply (redeem) a coupon to an order. */
  app.post("/api/coupons/apply", requireAuth, async (req, res) => {
    try {
      const { couponId, orderId, customerKey } = req.body as {
        couponId: number;
        orderId: number;
        customerKey?: string;
      };
      const order = await storage.getOrderById(Number(orderId));
      if (!order) return res.status(404).json({ error: "Order not found" });

      const subtotal = parseFloat(String(order.totalAmount ?? 0)) - parseFloat(String(order.taxAmount ?? 0));

      const result = await redeemCoupon(
        Number(couponId),
        Number(orderId),
        customerKey ?? customerKeyFromOrder(order),
        subtotal,
      );

      if (!result.ok) return res.status(400).json({ error: result.reason });

      // Update order's discount and totals
      const config = getAutomationConfig();
      const taxRate = 0.18;            // matches existing 18% fallback used elsewhere
      const baseDiscount = parseFloat(String(order.discountAmount ?? 0));
      const newDiscount = baseDiscount + result.discount;
      const taxable = Math.max(0, subtotal - newDiscount);
      const tax = taxable * taxRate;
      const total = taxable + tax;

      const updated = await storage.updateOrder(Number(orderId), {
        discountAmount: newDiscount.toFixed(2),
        taxAmount:      tax.toFixed(2),
        totalAmount:    total.toFixed(2),
      } as any);

      broadcast({ type: "ORDER_UPDATE", order: updated });
      res.json({ ok: true, discount: result.discount, order: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** List active coupons (admin). */
  app.get("/api/coupons", requireAuth, async (req, res) => {
    try {
      const includeInactive = req.query.all === "1";
      const list = await listCoupons(includeInactive);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** Manually issue a coupon (admin). */
  app.post("/api/coupons/issue", requireAdmin, async (req, res) => {
    try {
      const row = await issueCoupon(req.body as any);
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ error: err?.message });
    }
  });

  /** Coupon redemption history (admin). */
  app.get("/api/coupons/redemptions", requireAuth, async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(couponRedemptions)
        .orderBy(desc(couponRedemptions.redeemedAt))
        .limit(200);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Loyalty ─────────────────────────────────────────────────────────────────

  app.get("/api/loyalty/:customerKey", requireAuth, async (req, res) => {
    try {
      const key = decodeURIComponent(req.params.customerKey);
      const balance = await getBalance(key);
      const ledger  = await getLedger(key, 50);
      res.json({
        balance,
        redeemable:        maxRedeemablePoints(balance),
        rupeeValue:        pointsToRupees(maxRedeemablePoints(balance)),
        minRedeemPoints:   MIN_REDEEM_POINTS,
        ledger,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/loyalty/redeem", requireAuth, async (req, res) => {
    try {
      const { customerKey, points, orderId } = req.body as {
        customerKey: string;
        points: number;
        orderId?: number;
      };
      if (!customerKey) return res.status(400).json({ error: "customerKey required" });

      const order = orderId ? await storage.getOrderById(Number(orderId)) : null;
      const customerName = order?.customerName ?? customerKey;

      const result = await redeemPoints(customerKey, customerName, Number(points), orderId ?? null);
      if (!result.ok) return res.status(400).json({ error: result.reason });

      // Apply discount to order (if provided)
      if (order && result.discount > 0) {
        const subtotal = parseFloat(String(order.totalAmount ?? 0)) - parseFloat(String(order.taxAmount ?? 0));
        const baseDiscount = parseFloat(String(order.discountAmount ?? 0));
        const newDiscount = baseDiscount + result.discount;
        const taxable = Math.max(0, subtotal - newDiscount);
        const tax = taxable * 0.18;
        const total = taxable + tax;
        const updated = await storage.updateOrder(order.id, {
          discountAmount: newDiscount.toFixed(2),
          taxAmount:      tax.toFixed(2),
          totalAmount:    total.toFixed(2),
        } as any);
        broadcast({ type: "ORDER_UPDATE", order: updated });
      }

      res.json({ ok: true, discount: result.discount });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Feedback ────────────────────────────────────────────────────────────────

  /** Manually queue a feedback request for an order (admin). */
  app.post("/api/feedback/schedule", requireAuth, async (req, res) => {
    try {
      const { orderId } = req.body as { orderId: number };
      const result = await scheduleFeedbackForOrder(Number(orderId));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** Force a feedback dispatch run now. */
  app.post("/api/feedback/process-pending", requireAdmin, async (_req, res) => {
    try {
      const result = await processPendingFeedback();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** Aggregated feedback stats (NPS dashboard). */
  app.get("/api/feedback/stats", requireAuth, async (_req, res) => {
    try {
      res.json(await getFeedbackStats());
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** List recent feedback (admin). */
  app.get("/api/feedback", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
      const rows = await db
        .select()
        .from(feedback)
        .orderBy(desc(feedback.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Birthday automation (manual trigger) ────────────────────────────────────

  app.post("/api/automation/birthday/run", requireAuth, async (_req, res) => {
    try {
      const result = await runBirthdayAutomation({ force: true });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── AI daily digest ─────────────────────────────────────────────────────────

  /** Generate (and optionally send) today's digest. dryRun=true → preview only. */
  app.post("/api/digest/run", requireAuth, async (req, res) => {
    try {
      const dryRun = req.body?.dryRun === true || req.query.dryRun === "1";
      const date = req.body?.date ? new Date(req.body.date) : undefined;
      const result = await generateAndSendDailyDigest({ dryRun, date });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** Preview today's metrics (used by the Settings → Digest preview button). */
  app.get("/api/digest/preview", requireAuth, async (_req, res) => {
    try {
      const metrics = await buildDailyMetrics();
      res.json(metrics);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /** List recent sent digests. */
  app.get("/api/digest/history", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10), 100);
      const rows = await listRecentDigests(limit);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });
}
