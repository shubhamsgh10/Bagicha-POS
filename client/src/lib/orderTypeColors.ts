/**
 * Order-type colors keyed on the raw DB `orders.orderType` values ("dine-in" | "takeaway" |
 * "delivery") — the vocabulary Reports.tsx's channel-stacked sales chart and
 * LiveAnalytics.tsx's Live Orders list both key off, as opposed to
 * client/src/components/live-tables/OrderCard.tsx's TYPE_CONFIG, which is keyed on the
 * UI-facing vocabulary ("dine-in" | "delivery" | "pickup") and specific to that component's
 * own card rendering (header backgrounds, emoji, border accents).
 *
 * Hex values are the literal stock Tailwind colors OrderCard.tsx's iconBg classes already
 * use (bg-green-600 / bg-orange-500 / bg-blue-600) — confirmed directly from the installed
 * tailwindcss package, not guessed — so a dine-in/pickup/delivery badge reads the same color
 * whether it's on the live-tables board, the live orders list, or a Reports chart.
 */
export type DbOrderType = "dine-in" | "takeaway" | "delivery";

export interface OrderTypeStyle {
  hex: string;
  label: string;
  emoji: string;
}

export const ORDER_TYPE_STYLES: Record<DbOrderType, OrderTypeStyle> = {
  "dine-in":  { hex: "#16a34a", label: "Dine-in", emoji: "🍽️" }, // green-600
  "takeaway": { hex: "#f97316", label: "Pickup",  emoji: "📦" }, // orange-500
  "delivery": { hex: "#2563eb", label: "Delivery", emoji: "🛵" }, // blue-600
};

/** Falls back to a neutral gray style for any unrecognized/legacy orderType value. */
export function orderTypeStyle(orderType: string | null | undefined): OrderTypeStyle {
  return ORDER_TYPE_STYLES[orderType as DbOrderType] ?? { hex: "#6b7280", label: orderType ?? "—", emoji: "🧾" };
}
