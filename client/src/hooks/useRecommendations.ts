import { useMemo } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Recommendation {
  itemName: string;
  count: number;
  reason: "Most ordered" | "Frequently ordered" | "Occasional";
}

export interface CategoryPreference {
  category: string;
  count: number;
}

export interface RecommendationResult {
  topItems: Recommendation[];
  categoryPrefs: CategoryPreference[];
  isEmpty: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Derives AI-style recommendations from already-fetched order-item data.
 * Pass `ordersWithItems` from `useCustomerOrderDetails` — no extra network calls.
 */
export function useRecommendations(ordersWithItems: any[]): RecommendationResult {
  return useMemo(() => {
    if (!ordersWithItems.length) {
      return { topItems: [], categoryPrefs: [], isEmpty: true };
    }

    const itemFreq: Record<string, number>  = {};
    const catFreq:  Record<string, number>  = {};

    for (const order of ordersWithItems) {
      const items: any[] = order?.items ?? [];
      for (const item of items) {
        // Item frequency
        const name  = item.name ?? item.menuItemName ?? "Unknown";
        const label = item.size ? `${name} (${item.size})` : name;
        const qty   = item.quantity ?? 1;
        itemFreq[label] = (itemFreq[label] ?? 0) + qty;

        // Category preference (if available)
        const cat = item.category ?? item.categoryName;
        if (cat) catFreq[cat] = (catFreq[cat] ?? 0) + qty;
      }
    }

    const topItems: Recommendation[] = Object.entries(itemFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([itemName, count], i) => ({
        itemName,
        count,
        reason: i === 0
          ? "Most ordered"
          : count >= 3
          ? "Frequently ordered"
          : "Occasional",
      }));

    const categoryPrefs: CategoryPreference[] = Object.entries(catFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, count]) => ({ category, count }));

    return {
      topItems,
      categoryPrefs,
      isEmpty: topItems.length === 0,
    };
  }, [ordersWithItems]);
}
