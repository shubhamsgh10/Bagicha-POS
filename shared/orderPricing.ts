/**
 * Pure order-pricing math — no DB, no settings singleton, so it is shared and
 * unit-testable. The server wrapper (server/services/orderPricing.ts) resolves
 * menu rows + rates and delegates here.
 *
 * Strategy: for each line, use the authoritative DB floor (matched size price,
 * else base price). Add-ons/variants only ever ADD, so a client unit price at or
 * above the floor is accepted; anything below is pulled up to the floor (blocks
 * the ₹500-item-for-₹1 attack). The aggregate is always recomputed here from the
 * validated line prices, the configured tax rate, and a discount clamped to
 * [0, subtotal] — so totals/tax/discount can never be forged by the client.
 */

export interface PricingItemInput {
  menuItemId: number | string;
  quantity: number | string;
  price: number | string;
  size?: string | null;
  serviceMode?: string | null;
  parcelLeftover?: boolean;
}

export interface PricedLine {
  menuItemId: number;
  quantity: number;
  unitPrice: number;
  serviceMode: string | null;
  parcelLeftover: boolean;
  size: string | null;
}

export interface PricedOrder {
  subtotal: number;
  discount: number;
  taxRate: number; // fraction, e.g. 0.18
  tax: number;
  containerCharge: number;
  total: number;
  lines: PricedLine[]; // same order as input
}

/** Minimal menu shape the pure pricer needs (base price + optional sizes). */
export interface ResolvedMenuItem {
  id: number;
  price: string | number;
  sizes?: Array<{ size: string; price: number }> | null;
}

const EPS = 0.01;

export function priceResolved(
  items: PricingItemInput[],
  menuById: Map<number, ResolvedMenuItem>,
  opts: { taxRate: number; containerRate: number },
  discountAmountRaw: unknown,
): PricedOrder {
  const { taxRate, containerRate } = opts;
  const list = Array.isArray(items) ? items : [];

  let subtotal = 0;
  let containerCharge = 0;
  const lines: PricedLine[] = [];

  for (const it of list) {
    const mid = Number(it.menuItemId);
    const qty = Number(it.quantity);
    if (!Number.isFinite(mid) || !Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid line item (menuItemId=${it.menuItemId}, qty=${it.quantity})`);
    }
    const menu = menuById.get(mid);
    if (!menu) throw new Error(`Unknown menu item ${mid}`);

    let floor = parseFloat(String(menu.price));
    if (it.size && Array.isArray(menu.sizes)) {
      const s = menu.sizes.find((x) => x.size === it.size);
      if (s) floor = Number(s.price);
    }
    const clientUnit = Number(it.price);
    const unitPrice =
      Number.isFinite(clientUnit) && clientUnit >= floor - EPS ? clientUnit : floor;

    subtotal += unitPrice * qty;

    const sm = it.serviceMode ?? null;
    if (sm === "pickup" || sm === "delivery") containerCharge += Math.ceil(qty) * containerRate;
    else if (it.parcelLeftover) containerCharge += containerRate;

    lines.push({
      menuItemId: mid,
      quantity: qty,
      unitPrice,
      serviceMode: sm,
      parcelLeftover: !!it.parcelLeftover,
      size: it.size ?? null,
    });
  }

  const discount = Math.min(Math.max(0, Number(discountAmountRaw) || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  const total = taxable + tax + containerCharge;

  return { subtotal, discount, taxRate, tax, containerCharge, total, lines };
}

/** Recompute totals for lines whose per-line totals are already known (merge/split). */
export function computeTotals(
  lineTotals: number[],
  discountAmountRaw: unknown,
  taxRate: number,
): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = lineTotals.reduce((s, v) => s + v, 0);
  const discount = Math.min(Math.max(0, Number(discountAmountRaw) || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  return { subtotal, discount, tax, total: taxable + tax };
}
