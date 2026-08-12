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
 * Open items (negative menuItemId, no menu row — see shared/schema.ts) have no
 * DB floor to check against, so their client price is trusted directly instead.
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

export interface ContainerChargeInput {
  quantity: number | string;
  serviceMode?: string | null;
  parcelLeftover?: boolean | null;
}

/**
 * Container charge rounds up per line, never per fractional quantity — ceil-then-sum,
 * not sum-then-ceil (two separate 0.5-qty parcel lines need two containers, not one
 * that a naive ceil(0.5+0.5) would give). Factored out of priceResolved so every other
 * caller that needs to (re)compute a container charge from a set of order_items rows
 * (merge/split) uses the exact same rule instead of a second, potentially-diverging copy.
 */
export function computeContainerCharge(items: ContainerChargeInput[], containerRate: number): number {
  let containerCharge = 0;
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    const sm = it.serviceMode ?? null;
    if (sm === "pickup" || sm === "delivery") containerCharge += Math.ceil(qty) * containerRate;
    else if (it.parcelLeftover) containerCharge += containerRate;
  }
  return containerCharge;
}

export function priceResolved(
  items: PricingItemInput[],
  menuById: Map<number, ResolvedMenuItem>,
  opts: { taxRate: number; containerRate: number },
  discountAmountRaw: unknown,
): PricedOrder {
  const { taxRate, containerRate } = opts;
  const list = Array.isArray(items) ? items : [];

  let subtotal = 0;
  const lines: PricedLine[] = [];

  for (const it of list) {
    const mid = Number(it.menuItemId);
    const qty = Number(it.quantity);
    if (!Number.isFinite(mid) || !Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid line item (menuItemId=${it.menuItemId}, qty=${it.quantity})`);
    }
    let unitPrice: number;
    if (mid < 0) {
      // Open item (staff-typed, no menu row — see shared/schema.ts's menuItemId
      // doc). No DB floor exists, so the client price is the ONLY source of
      // truth for this line; require it strictly positive (mirrors POS.tsx's
      // openItemValid gate) since there's no floor to fall back to on a bad value.
      const clientUnit = Number(it.price);
      if (!Number.isFinite(clientUnit) || clientUnit <= 0) {
        throw new Error(`Invalid open item price (menuItemId=${mid}, price=${it.price})`);
      }
      unitPrice = clientUnit;
    } else {
      const menu = menuById.get(mid);
      if (!menu) throw new Error(`Unknown menu item ${mid}`);

      let floor = parseFloat(String(menu.price));
      if (it.size && Array.isArray(menu.sizes)) {
        const s = menu.sizes.find((x) => x.size === it.size);
        if (s) floor = Number(s.price);
      }
      const clientUnit = Number(it.price);
      unitPrice = Number.isFinite(clientUnit) && clientUnit >= floor - EPS ? clientUnit : floor;
    }

    subtotal += unitPrice * qty;

    lines.push({
      menuItemId: mid,
      quantity: qty,
      unitPrice,
      serviceMode: it.serviceMode ?? null,
      parcelLeftover: !!it.parcelLeftover,
      size: it.size ?? null,
    });
  }

  const containerCharge = computeContainerCharge(lines, containerRate);
  const discount = Math.min(Math.max(0, Number(discountAmountRaw) || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  const total = taxable + tax + containerCharge;

  return { subtotal, discount, taxRate, tax, containerCharge, total, lines };
}

/**
 * Recompute totals for lines whose per-line totals are already known (merge/split).
 * `containerCharge` defaults to 0 for backward compatibility with existing callers
 * that don't track it, but merge/split now pass the real value — see
 * computeContainerCharge, which must be run over the actual item rows first.
 */
export function computeTotals(
  lineTotals: number[],
  discountAmountRaw: unknown,
  taxRate: number,
  containerCharge = 0,
): { subtotal: number; discount: number; tax: number; total: number; containerCharge: number } {
  const subtotal = lineTotals.reduce((s, v) => s + v, 0);
  const discount = Math.min(Math.max(0, Number(discountAmountRaw) || 0), subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  return { subtotal, discount, tax, containerCharge, total: taxable + tax + containerCharge };
}

export interface BillTotals {
  subtotal: number;
  discount: number;
  containerCharge: number;
  tax: number;
  total: number;
}

/**
 * Resolve the four bill-line components (subtotal/discount/container/tax) for a
 * persisted order, for any place that needs to print or re-derive them.
 *
 * `orders` used to have no `subtotalAmount`/`containerCharge` columns, so every such
 * site reconstructed subtotal as `totalAmount - taxAmount` — correct ONLY when
 * discount = 0 AND containerCharge = 0, since the true relation (see priceResolved
 * above) is `total = (subtotal - discount) * (1 + taxRate) + containerCharge`, i.e.
 * `total - tax = subtotal - discount + containerCharge`, not `subtotal` alone. With a
 * discount and a container charge both present this was wrong by a very real amount
 * (see scripts/verify-bill-derivation.ts for a worked example) — the printed "Sub
 * Total" line didn't match the actual pre-discount item sum, and re-deriving it as
 * the base for a second discount (coupon/loyalty) compounded the error.
 *
 * Both columns are now populated at order-creation/edit time from the same `priced`
 * object that computes totalAmount/taxAmount/discountAmount, so this prefers them.
 * The `total - tax` fallback only fires for legacy rows written before those columns
 * existed — deliberately left as-is for those (not retroactively recomputed from
 * order_items), since it doesn't change what those rows already show today.
 */
export function deriveBillTotals(order: {
  totalAmount: string | number;
  taxAmount: string | number;
  discountAmount?: string | number | null;
  subtotalAmount?: string | number | null;
  containerCharge?: string | number | null;
}): BillTotals {
  const total = Number(order.totalAmount) || 0;
  const tax = Number(order.taxAmount) || 0;
  const discount = Number(order.discountAmount ?? 0) || 0;
  const subtotal =
    order.subtotalAmount != null ? Number(order.subtotalAmount) || 0 : total - tax;
  const containerCharge =
    order.containerCharge != null ? Number(order.containerCharge) || 0 : 0;
  return { subtotal, discount, containerCharge, tax, total };
}
