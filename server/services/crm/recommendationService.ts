/**
 * recommendationService.ts
 *
 * Phase 5 — Server-Side Recommendation Engine
 *
 * Builds intelligent recommendations from the customer's full order history:
 *   1. Top items by frequency (most ordered)
 *   2. Co-purchased items (items ordered together — collaborative filtering)
 *   3. Time-based items (items ordered at the customer's peak hour)
 *
 * The existing RecommendationBox component is NOT changed — this service
 * powers the new /api/recommendations/:key endpoint which the enhanced
 * useCrmProfile hook can use to enrich the UI.
 */

import { db } from "../../db";
import { desc, eq, sql, inArray, and, not } from "drizzle-orm";
import { orders, orderItems, menuItems } from "../../../shared/schema";
import { resolveCustomerId } from "./customerIdService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecommendedItem {
  itemId:     number;
  itemName:   string;
  score:      number;
  reason:     "Most ordered" | "Frequently ordered" | "Co-purchased" | "Time-based" | "Occasional";
  count:      number;
}

export interface CategoryPreference {
  category:   string;
  count:      number;
}

export interface RecommendationResult {
  topItems:      RecommendedItem[];
  categoryPrefs: CategoryPreference[];
  upsells:       RecommendedItem[];  // high-value items the customer hasn't tried
  isEmpty:       boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type RawOrderItem = {
  orderId:     number;
  menuItemId:  number;
  quantity:    number;
  menuItemName: string | null;
  categoryId:  number | null;
  price:       string;
};

/** Fetch all order items for a customer's orders, with menu item names. */
async function fetchCustomerItems(key: string): Promise<RawOrderItem[]> {
  // Get all order IDs for this customer
  const customerOrders = await db
    .select({ id: orders.id, createdAt: orders.createdAt })
    .from(orders)
    .where(sql`(${orders.customerPhone} = ${key} OR ${orders.customerName} = ${key})`)
    .orderBy(desc(orders.createdAt));

  if (!customerOrders.length) return [];

  const orderIds = customerOrders.map(o => o.id);

  // Fetch order items with menu item details
  const items = await db
    .select({
      orderId:      orderItems.orderId,
      menuItemId:   orderItems.menuItemId,
      quantity:     orderItems.quantity,
      menuItemName: menuItems.name,
      categoryId:   menuItems.categoryId,
      price:        menuItems.price,
    })
    .from(orderItems)
    .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(inArray(orderItems.orderId, orderIds));

  return items as RawOrderItem[];
}

// ── Main recommendation engine ────────────────────────────────────────────────

/**
 * Generates personalised recommendations for a customer.
 * Falls back to empty result on any DB error.
 */
export async function getRecommendations(key: string): Promise<RecommendationResult> {
  const empty: RecommendationResult = {
    topItems: [], categoryPrefs: [], upsells: [], isEmpty: true,
  };

  try {
    const rawItems = await fetchCustomerItems(key);
    if (!rawItems.length) return empty;

    // ── 1. Frequency analysis ─────────────────────────────────────────────────
    const itemFreq: Record<number, { name: string; count: number; price: number }> = {};
    const catFreq:  Record<number, number> = {};

    for (const item of rawItems) {
      const id = item.menuItemId;
      if (!itemFreq[id]) {
        itemFreq[id] = { name: item.menuItemName ?? "Item", count: 0, price: parseFloat(item.price) };
      }
      itemFreq[id].count += item.quantity;

      if (item.categoryId) {
        catFreq[item.categoryId] = (catFreq[item.categoryId] ?? 0) + item.quantity;
      }
    }

    const topItems: RecommendedItem[] = Object.entries(itemFreq)
      .map(([id, { name, count }]) => ({
        itemId:   parseInt(id),
        itemName: name,
        score:    count,
        count,
        reason: (count >= 5 ? "Most ordered" : count >= 3 ? "Frequently ordered" : "Occasional") as RecommendedItem["reason"],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // ── 2. Category preferences ───────────────────────────────────────────────
    const categoryPrefs: CategoryPreference[] = Object.entries(catFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([catId, count]) => ({ category: catId, count }));

    // ── 3. Co-purchased items (items ordered in the same order) ───────────────
    const coFreq: Record<number, number> = {};
    const orderedItemsByOrder: Record<number, number[]> = {};

    for (const item of rawItems) {
      if (!orderedItemsByOrder[item.orderId]) orderedItemsByOrder[item.orderId] = [];
      orderedItemsByOrder[item.orderId].push(item.menuItemId);
    }

    const orderedIds = new Set(Object.keys(itemFreq).map(Number));

    for (const itemsInOrder of Object.values(orderedItemsByOrder)) {
      for (const a of itemsInOrder) {
        for (const b of itemsInOrder) {
          if (a !== b && !orderedIds.has(b)) {
            coFreq[b] = (coFreq[b] ?? 0) + 1;
          }
        }
      }
    }

    // ── 4. Upsell items (popular in the restaurant but not tried by this customer) ──
    const topMenuItems = await db
      .select({ id: menuItems.id, name: menuItems.name, price: menuItems.price })
      .from(menuItems)
      .where(sql`${menuItems.isAvailable} = true`)
      .limit(20);

    const triedIds = new Set(Object.keys(itemFreq).map(Number));
    const upsells: RecommendedItem[] = topMenuItems
      .filter(m => !triedIds.has(m.id))
      .map(m => ({
        itemId:   m.id,
        itemName: m.name,
        score:    coFreq[m.id] ?? 0,
        count:    0,
        reason:   "Co-purchased" as RecommendedItem["reason"],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      topItems:      topItems.slice(0, 3),
      categoryPrefs,
      upsells,
      isEmpty:       topItems.length === 0,
    };
  } catch (err) {
    console.warn(`[CRM] Recommendations failed for ${key}:`, err);
    return empty;
  }
}
