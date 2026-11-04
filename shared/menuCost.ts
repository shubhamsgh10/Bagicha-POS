/**
 * Pure plate-cost math — no DB, shared between client (live cost/margin preview in
 * AddMenuItemModal/Menu.tsx) and server (the storage.computeMenuItemCost wrapper that
 * snapshots orderItems.unitCost at sale time). Same shape as shared/orderPricing.ts:
 * one calculation, used everywhere, so the number staff see while editing a recipe is
 * exactly the number that gets recorded on the order.
 */

export interface InventoryLink {
  inventoryId: number;
  quantity: number;
}

export interface MenuCostResult {
  cost: number;
  /** true when at least one linked ingredient has no costPerUnit set — the UI should
   *  show "cost incomplete" rather than a misleadingly low number. */
  hasIncompleteCost: boolean;
}

/**
 * @param costByInventoryId  Map of inventory.id -> costPerUnit (null/undefined = not set).
 * @param sizeMultiplier     Scales the whole recipe (e.g. Large = 1.5); 1 for no size or
 *                           a size with no configured multiplier.
 */
export function computeMenuItemCost(
  inventoryLinks: InventoryLink[] | null | undefined,
  costByInventoryId: Map<number, number | string | null | undefined>,
  sizeMultiplier: number = 1,
): MenuCostResult {
  if (!inventoryLinks || inventoryLinks.length === 0) {
    return { cost: 0, hasIncompleteCost: false };
  }
  let cost = 0;
  let hasIncompleteCost = false;
  for (const link of inventoryLinks) {
    const raw = costByInventoryId.get(link.inventoryId);
    const perUnit = raw == null ? null : typeof raw === "string" ? parseFloat(raw) : raw;
    if (perUnit == null || !Number.isFinite(perUnit)) {
      hasIncompleteCost = true;
      continue;
    }
    cost += link.quantity * perUnit * sizeMultiplier;
  }
  return { cost, hasIncompleteCost };
}

/** Resolves the per-size stock/cost multiplier from a menu item's `sizes` array. */
export function resolveSizeMultiplier(
  sizes: Array<{ size: string; price: number; stockMultiplier?: number }> | null | undefined,
  size: string | null | undefined,
): number {
  if (!size || !Array.isArray(sizes)) return 1;
  return sizes.find((s) => s.size === size)?.stockMultiplier ?? 1;
}

/**
 * Plate cost of each order line, positionally. `null` for a line whose menu item has no recipe
 * (cost unknown — never a fabricated 0), an open item, or an unknown id. The order routes feed it
 * the menu rows and ingredient costs they already read for the save, so this costs no DB work.
 */
export function computeLineCosts(
  items: Array<{ menuItemId: number; size?: string | null }>,
  menuById: Map<number, { inventoryLinks?: InventoryLink[] | null; sizes?: Array<{ size: string; price: number; stockMultiplier?: number }> | null }>,
  costByInventoryId: Map<number, number | string | null | undefined>,
): Array<MenuCostResult | null> {
  return items.map(({ menuItemId, size }) => {
    const item = menuById.get(menuItemId);
    if (!item?.inventoryLinks || item.inventoryLinks.length === 0) return null;
    return computeMenuItemCost(item.inventoryLinks, costByInventoryId, resolveSizeMultiplier(item.sizes, size));
  });
}

/** Margin % given a sale price and a plate cost. Returns null when price is 0/invalid. */
export function computeMarginPercent(price: number, cost: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  return ((price - cost) / price) * 100;
}
