/**
 * dailyDigestService.ts
 *
 * AI-powered end-of-day summary for the restaurant owner.
 *
 * Aggregates the day's KPIs, asks Claude to turn them into a punchy
 * 4-6 sentence WhatsApp digest, and sends it to the configured owner phone.
 *
 * Falls back to a deterministic template if no Anthropic key is configured.
 */

import { db } from "../db";
import { and, gte, lte, sql, eq, desc, isNotNull } from "drizzle-orm";
import {
  orders,
  orderItems,
  menuItems,
  inventory,
  customersMaster,
  customerSegments,
  feedback,
  dailyDigests,
} from "../../shared/schema";
import { getAutomationConfig } from "./automationStore";
import { sendWhatsAppMessage } from "./whatsappService";

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface DailyMetrics {
  date:          string;
  totalRevenue:  number;
  totalOrders:   number;
  avgOrderValue: number;
  paidRevenue:   number;
  dueRevenue:    number;
  paymentBreakdown: Record<string, number>;
  topItems:      Array<{ name: string; qty: number; revenue: number }>;
  worstItems:    Array<{ name: string; qty: number }>;
  newCustomers:  number;
  vipCount:      number;
  atRiskCount:   number;
  lowStockItems: string[];
  feedback: {
    avgRating:      number;
    responses:      number;
    detractors:     number;
  };
  hourlyPeaks:   Array<{ hour: number; count: number }>;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function buildDailyMetrics(date = new Date()): Promise<DailyMetrics> {
  const start = new Date(date);  start.setHours(0, 0, 0, 0);
  const end   = new Date(date);  end.setHours(23, 59, 59, 999);

  const dayOrders = await db
    .select()
    .from(orders)
    .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)));

  const totalRevenue = dayOrders.reduce((s, o) => s + parseFloat(String(o.totalAmount ?? 0)), 0);
  const paidOrders   = dayOrders.filter(o => o.paymentStatus === "paid");
  const dueOrders    = dayOrders.filter(o => o.paymentStatus === "pending");
  const paidRevenue  = paidOrders.reduce((s, o) => s + parseFloat(String(o.totalAmount ?? 0)), 0);
  const dueRevenue   = dueOrders.reduce((s, o) => s + parseFloat(String(o.totalAmount ?? 0)), 0);

  const paymentBreakdown: Record<string, number> = {};
  for (const o of paidOrders) {
    const m = o.paymentMethod || "cash";
    paymentBreakdown[m] = (paymentBreakdown[m] ?? 0) + parseFloat(String(o.totalAmount ?? 0));
  }

  // Top items today
  const topItems = await db
    .select({
      name:     menuItems.name,
      qty:      sql<number>`cast(sum(${orderItems.quantity}) as int)`,
      revenue:  sql<number>`cast(sum(cast(${orderItems.quantity} as numeric) * cast(${orderItems.price} as numeric)) as numeric)`,
    })
    .from(orderItems)
    .innerJoin(orders,    eq(orderItems.orderId, orders.id))
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)))
    .groupBy(menuItems.id, menuItems.name)
    .orderBy(sql`sum(${orderItems.quantity}) desc`)
    .limit(5);

  const worstItems = await db
    .select({
      name:     menuItems.name,
      qty:      sql<number>`cast(coalesce(sum(${orderItems.quantity}), 0) as int)`,
    })
    .from(menuItems)
    .leftJoin(orderItems, eq(menuItems.id, orderItems.menuItemId))
    .leftJoin(orders,     and(eq(orderItems.orderId, orders.id), gte(orders.createdAt, start), lte(orders.createdAt, end)))
    .where(eq(menuItems.isAvailable, true))
    .groupBy(menuItems.id, menuItems.name)
    .orderBy(sql`coalesce(sum(${orderItems.quantity}), 0) asc`)
    .limit(3);

  // New customers today (master.createdAt within today)
  const newCustomerRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersMaster)
    .where(and(gte(customersMaster.createdAt, start), lte(customersMaster.createdAt, end)));
  const newCustomers = Number(newCustomerRows[0]?.count ?? 0);

  // Segment counts
  const vipRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customerSegments)
    .where(eq(customerSegments.segment, "VIP"));
  const atRiskRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customerSegments)
    .where(eq(customerSegments.segment, "At Risk"));

  // Low stock
  const lowStock = await db
    .select({ itemName: inventory.itemName })
    .from(inventory)
    .where(sql`${inventory.currentStock} <= ${inventory.minStock}`)
    .limit(10);

  // Feedback today
  const dayFeedback = await db
    .select({
      rating:      feedback.rating,
      submittedAt: feedback.submittedAt,
    })
    .from(feedback)
    .where(and(
      isNotNull(feedback.submittedAt),
      gte(feedback.submittedAt, start),
      lte(feedback.submittedAt, end),
    ));

  const responded   = dayFeedback.filter(f => f.rating !== null);
  const avgRating   = responded.length
    ? responded.reduce((s, f) => s + (f.rating ?? 0), 0) / responded.length
    : 0;
  const detractors  = responded.filter(f => (f.rating ?? 0) <= 3).length;

  // Hourly peaks
  const hourMap: Record<number, number> = {};
  for (const o of dayOrders) {
    const h = new Date(o.createdAt).getHours();
    hourMap[h] = (hourMap[h] ?? 0) + 1;
  }
  const hourlyPeaks = Object.entries(hourMap)
    .map(([h, c]) => ({ hour: Number(h), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    date:          formatDate(start),
    totalRevenue,
    totalOrders:   dayOrders.length,
    avgOrderValue: dayOrders.length ? totalRevenue / dayOrders.length : 0,
    paidRevenue,
    dueRevenue,
    paymentBreakdown,
    topItems:      topItems.map(t => ({ name: t.name, qty: Number(t.qty), revenue: Number(t.revenue) })),
    worstItems:    worstItems.map(t => ({ name: t.name, qty: Number(t.qty) })),
    newCustomers,
    vipCount:      Number(vipRows[0]?.count ?? 0),
    atRiskCount:   Number(atRiskRows[0]?.count ?? 0),
    lowStockItems: lowStock.map(r => r.itemName),
    feedback:      { avgRating, responses: responded.length, detractors },
    hourlyPeaks,
  };
}

// ── Summary generation ────────────────────────────────────────────────────────

function fallbackSummary(m: DailyMetrics, restaurant: string): string {
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const lines: string[] = [];

  lines.push(`📊 *${restaurant} — Daily Digest (${m.date})*`);
  lines.push("");
  lines.push(`💰 Revenue: *${fmt(m.totalRevenue)}* across *${m.totalOrders}* orders (avg ${fmt(m.avgOrderValue)})`);
  if (m.dueRevenue > 0) lines.push(`⏳ Due: ${fmt(m.dueRevenue)}`);
  if (m.topItems.length > 0) {
    lines.push(`🏆 Top: ${m.topItems.slice(0, 3).map(t => `${t.name} (${t.qty})`).join(", ")}`);
  }
  if (m.feedback.responses > 0) {
    lines.push(`⭐ Rating: ${m.feedback.avgRating.toFixed(1)}/5 (${m.feedback.responses} reviews${m.feedback.detractors ? `, ${m.feedback.detractors} detractor${m.feedback.detractors > 1 ? "s" : ""}` : ""})`);
  }
  if (m.newCustomers > 0) lines.push(`👋 New customers: ${m.newCustomers}`);
  if (m.atRiskCount > 0)  lines.push(`⚠️ At-risk customers: ${m.atRiskCount}`);
  if (m.lowStockItems.length > 0) {
    lines.push(`📦 Low stock: ${m.lowStockItems.slice(0, 5).join(", ")}`);
  }
  return lines.join("\n");
}

async function aiSummary(m: DailyMetrics, restaurant: string, apiKey: string): Promise<string | null> {
  const prompt = `You're an AI assistant for a restaurant owner. Generate a concise *WhatsApp* daily digest message (5-7 short lines, friendly but business-focused). Use WhatsApp markdown (*bold* only). Use ₹ symbol. Include emojis sparingly. End with one actionable suggestion based on the data.

Restaurant: ${restaurant}
Date: ${m.date}

KPIs:
- Total revenue: ₹${Math.round(m.totalRevenue)}
- Orders: ${m.totalOrders} (avg order ₹${Math.round(m.avgOrderValue)})
- Paid: ₹${Math.round(m.paidRevenue)}, Due: ₹${Math.round(m.dueRevenue)}
- Payment mix: ${Object.entries(m.paymentBreakdown).map(([k, v]) => `${k}: ₹${Math.round(v)}`).join(", ") || "N/A"}
- Top items: ${m.topItems.map(t => `${t.name} (${t.qty})`).join(", ") || "None"}
- Slow movers: ${m.worstItems.map(t => `${t.name} (${t.qty})`).join(", ") || "None"}
- New customers: ${m.newCustomers}
- VIP customers: ${m.vipCount}, At-risk: ${m.atRiskCount}
- Low stock: ${m.lowStockItems.slice(0, 8).join(", ") || "None"}
- Feedback: avg ${m.feedback.avgRating.toFixed(1)}/5 from ${m.feedback.responses} reviews; ${m.feedback.detractors} detractors
- Peak hours: ${m.hourlyPeaks.map(h => `${h.hour}:00 (${h.count})`).join(", ")}

Output ONLY the message text, nothing else. Max ~600 chars.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:     "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages:  [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as any;
    return data?.content?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DigestResult {
  ok:          boolean;
  metrics:     DailyMetrics;
  summary:     string;
  sent:        boolean;
  sentTo?:     string;
  error?:      string;
}

export async function generateAndSendDailyDigest(
  options: { dryRun?: boolean; date?: Date } = {}
): Promise<DigestResult> {
  const config = getAutomationConfig();
  const date = options.date ?? new Date();
  const metrics = await buildDailyMetrics(date);

  const summary = config.anthropicApiKey
    ? (await aiSummary(metrics, config.restaurantName, config.anthropicApiKey)) ?? fallbackSummary(metrics, config.restaurantName)
    : fallbackSummary(metrics, config.restaurantName);

  // Persist (upsert by date)
  const existing = await db
    .select({ id: dailyDigests.id })
    .from(dailyDigests)
    .where(eq(dailyDigests.digestDate, metrics.date))
    .limit(1);

  if (existing.length > 0) {
    await db.update(dailyDigests).set({
      summary,
      metrics: metrics as any,
      status: "generated",
    }).where(eq(dailyDigests.id, existing[0].id));
  } else {
    await db.insert(dailyDigests).values({
      digestDate: metrics.date,
      summary,
      metrics:    metrics as any,
      status:     "generated",
    });
  }

  if (options.dryRun || !config.dailyDigestEnabled) {
    return { ok: true, metrics, summary, sent: false };
  }

  const phone = config.ownerWhatsappPhone.trim();
  if (!phone) {
    return { ok: false, metrics, summary, sent: false, error: "No owner phone configured" };
  }

  const result = await sendWhatsAppMessage(phone, summary, {
    watiApiKey:        config.watiApiKey,
    watiEndpoint:      config.watiEndpoint,
    metaPhoneNumberId: config.metaPhoneNumberId,
    metaAccessToken:   config.metaAccessToken,
  });

  await db.update(dailyDigests).set({
    sentAt: result.success ? new Date() : null,
    sentTo: phone,
    status: result.success ? "sent" : "failed",
    error:  result.error ?? null,
  }).where(eq(dailyDigests.digestDate, metrics.date));

  return {
    ok:    result.success,
    metrics,
    summary,
    sent:  result.success,
    sentTo: phone,
    error: result.error,
  };
}

export async function listRecentDigests(limit = 30) {
  return db.select().from(dailyDigests).orderBy(desc(dailyDigests.digestDate)).limit(limit);
}
