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

/** Rates from the settings singleton (tax as a fraction, container as ₹/unit). */
export function pricingRates(): { taxRate: number; containerRate: number } {
  const settings = getSettings() as any;
  return {
    taxRate: Number(settings?.taxRate ?? 18) / 100,
    containerRate: Number(settings?.containerCharge ?? 15),
  };
}

/** DB-backed pricing for POST /orders and PUT /orders/:id/items. */
export async function priceOrder(
  items: PricingItemInput[],
  discountAmountRaw: unknown,
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
  return priceResolved(list, byId, pricingRates(), discountAmountRaw);
}

/**
 * Recompute totals for an order whose items already live in the DB (merge/split),
 * using the configured tax rate and a clamped discount.
 */
export function computeTotalsFromLines(
  lineTotals: number[],
  discountAmountRaw: unknown,
): { subtotal: number; discount: number; tax: number; total: number } {
  return computeTotals(lineTotals, discountAmountRaw, pricingRates().taxRate);
}
