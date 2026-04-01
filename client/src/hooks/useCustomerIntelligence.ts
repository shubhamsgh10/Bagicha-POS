import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CustomerTag = "VIP" | "Regular" | "New" | "At Risk";
export type SpendCategory = "High" | "Medium" | "Low";

export interface CustomerOrder {
  id: number;
  orderNumber: string;
  totalAmount: number;
  status: string;
  orderType: string;
  createdAt: string;
}

export interface CustomerProfile {
  key: string;             // dedup key: phone || name
  name: string;
  phone: string;
  totalVisits: number;
  totalSpend: number;
  avgOrderValue: number;
  lastVisit: Date;
  firstVisit: Date;
  daysSinceLastVisit: number;
  peakHour: number | null; // 0–23
  orders: CustomerOrder[];
  tag: CustomerTag;
  spendCategory: SpendCategory;
  suggestion: string | null;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

// Spending thresholds in INR
const HIGH_SPEND_AVG  = 600;
const MED_SPEND_AVG   = 250;
const VIP_MIN_VISITS  = 10;
const AT_RISK_DAYS    = 15;

// ── Helpers ───────────────────────────────────────────────────────────────────

function tagFor(
  visits: number,
  avgSpend: number,
  daysSinceLast: number
): CustomerTag {
  if (daysSinceLast > AT_RISK_DAYS && visits > 2) return "At Risk";
  if (visits > VIP_MIN_VISITS && avgSpend >= HIGH_SPEND_AVG) return "VIP";
  if (visits >= 3) return "Regular";
  return "New";
}

function spendCategoryFor(avg: number): SpendCategory {
  if (avg >= HIGH_SPEND_AVG) return "High";
  if (avg >= MED_SPEND_AVG)  return "Medium";
  return "Low";
}

function suggestionFor(tag: CustomerTag, cat: SpendCategory): string | null {
  if (tag === "At Risk")
    return "Offer a discount to win them back";
  if (tag === "VIP")
    return "Reward with loyalty perks or a complimentary item";
  if (tag === "Regular" && cat === "High")
    return "Consider VIP upgrade — high-value regular customer";
  if (tag === "New")
    return "Send a welcome offer to encourage the next visit";
  return null;
}

// ── Primary hook — aggregates customer profiles from orders ───────────────────

export function useCustomerIntelligence() {
  const { data: rawOrders = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/orders"],
    staleTime: 60_000,
  });

  const customers = useMemo<CustomerProfile[]>(() => {
    if (!rawOrders.length) return [];

    // Group orders by phone (preferred) or name
    const map = new Map<string, any[]>();
    for (const order of rawOrders) {
      if (!order.customerName && !order.customerPhone) continue;
      const key = (order.customerPhone?.trim() || order.customerName?.trim()) as string;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(order);
    }

    const now = Date.now();
    const profiles: CustomerProfile[] = [];

    for (const [key, orders] of map) {
      // Sort newest first
      const sorted = [...orders].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const newest = sorted[0];
      const oldest = sorted[sorted.length - 1];

      const totalSpend = orders.reduce(
        (s, o) => s + parseFloat(String(o.totalAmount ?? "0")),
        0
      );
      const avgOrderValue = totalSpend / orders.length;
      const lastVisit = new Date(newest.createdAt);
      const firstVisit = new Date(oldest.createdAt);
      const daysSinceLastVisit = Math.floor((now - lastVisit.getTime()) / 86_400_000);

      // Peak order hour
      const hourCounts: Record<number, number> = {};
      for (const o of orders) {
        const h = new Date(o.createdAt).getHours();
        hourCounts[h] = (hourCounts[h] ?? 0) + 1;
      }
      const peakHour = orders.length
        ? +Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0]
        : null;

      const tag          = tagFor(orders.length, avgOrderValue, daysSinceLastVisit);
      const spendCategory = spendCategoryFor(avgOrderValue);
      const suggestion   = suggestionFor(tag, spendCategory);

      profiles.push({
        key,
        name:  newest.customerName ?? "Unknown",
        phone: newest.customerPhone ?? "",
        totalVisits: orders.length,
        totalSpend,
        avgOrderValue,
        lastVisit,
        firstVisit,
        daysSinceLastVisit,
        peakHour,
        orders: sorted.slice(0, 10).map(o => ({
          id:          o.id,
          orderNumber: o.orderNumber,
          totalAmount: parseFloat(String(o.totalAmount ?? "0")),
          status:      o.status,
          orderType:   o.orderType,
          createdAt:   o.createdAt,
        })),
        tag,
        spendCategory,
        suggestion,
      });
    }

    // Sort: At Risk → VIP → Regular → New, then by total spend desc
    const rank: Record<CustomerTag, number> = {
      "At Risk": 0, VIP: 1, Regular: 2, New: 3,
    };
    profiles.sort((a, b) =>
      rank[a.tag] !== rank[b.tag]
        ? rank[a.tag] - rank[b.tag]
        : b.totalSpend - a.totalSpend
    );

    return profiles;
  }, [rawOrders]);

  // Derived stats
  const stats = useMemo(() => {
    const today = new Date().toDateString();
    return {
      total:   customers.length,
      vip:     customers.filter(c => c.tag === "VIP").length,
      atRisk:  customers.filter(c => c.tag === "At Risk").length,
      activeToday: customers.filter(c => c.lastVisit.toDateString() === today).length,
    };
  }, [customers]);

  return { customers, stats, isLoading };
}

// ── Detail hook — fetches items for a customer's recent orders ─────────────────

export function useCustomerOrderDetails(orderIds: number[]) {
  const top5 = orderIds.slice(0, 5);

  const results = useQueries({
    queries: top5.map(id => ({
      queryKey: [`/api/orders/${id}`],
      staleTime: 120_000,
      enabled: top5.length > 0,
    })),
  });

  const favoriteItem = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const r of results) {
      if (!r.data?.items) continue;
      for (const item of r.data.items) {
        const name = item.name ?? item.menuItemName ?? "Unknown";
        const label = item.size ? `${name} (${item.size})` : name;
        freq[label] = (freq[label] ?? 0) + item.quantity;
      }
    }
    const entries = Object.entries(freq);
    if (!entries.length) return null;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }, [results]);

  const ordersWithItems = results.map(r => r.data).filter(Boolean);
  const isLoading = results.some(r => r.isLoading);

  return { favoriteItem, ordersWithItems, isLoading };
}
