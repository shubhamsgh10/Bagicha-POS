/**
 * Server-side order pricing — resolves authoritative menu prices + configured
 * rates, then delegates the math to the pure, unit-tested core in @shared.
 * See shared/orderPricing.ts for the anti-tamper strategy.
 */
import { db } from "../db";
import { menuItems } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { getSettings } from "../settingsStore";
import {
  priceResolved,
  computeTotals,
  type PricingItemInput,
  type PricedOrder,
  type ResolvedMenuItem,
} from "@shared/orderPricing";

export type { PricingItemInput, PricedOrder, PricedLine, ResolvedMenuItem } from "@shared/orderPricing";

/** Rates from the settings singleton (tax as a fraction). */
export function pricingRates(): { taxRate: number } {
  const settings = getSettings() as any;
  return {
    taxRate: Number(settings?.taxRate ?? 18) / 100,
  };
}

/** DB-backed pricing for POST /orders and PUT /orders/:id/items. `containerChargeRaw`
 * is the staff-typed manual container charge for this order (see shared/orderPricing.ts). */
export async function priceOrder(
  items: PricingItemInput[],
  discountAmountRaw: unknown,
  containerChargeRaw: unknown = 0,
): Promise<PricedOrder> {
  const list = Array.isArray(items) ? items : [];
  const ids = Array.from(
    new Set(list.map((i) => Number(i.menuItemId)).filter((n) => Number.isFinite(n))),
  );
  const rows = ids.length
    ? await db.select().from(menuItems).where(inArray(menuItems.id, ids))
    : [];
  const byId = new Map<number, ResolvedMenuItem>(
    rows.map((r) => [r.id, { id: r.id, price: r.price, sizes: r.sizes ?? null }]),
  );
  return priceResolved(list, byId, pricingRates(), discountAmountRaw, containerChargeRaw);
}

/**
 * Recompute totals for an order whose items already live in the DB (merge/split),
 * using the configured tax rate and a clamped discount. `containerCharge` is a
 * manually-entered flat amount, not derived from the items — pass through whatever
 * value should apply to the recomputed order (defaults to 0).
 */
export function computeTotalsFromLines(
  lineTotals: number[],
  discountAmountRaw: unknown,
  containerCharge = 0,
): { subtotal: number; discount: number; tax: number; total: number; containerCharge: number } {
  return computeTotals(lineTotals, discountAmountRaw, pricingRates().taxRate, containerCharge);
}
