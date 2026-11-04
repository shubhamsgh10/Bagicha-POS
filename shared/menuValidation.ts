/**
 * Price checks for menu writes (POST/PUT /api/menu, POST /api/menu/bulk-update). The order
 * pricing floor (shared/orderPricing.ts) trusts the menu row, so a menu price is money: it used
 * to be stored as whatever string arrived — "abc", "-50", "1e9" — and every later order priced
 * from it (NaN totals, negative lines). Pure; locked by scripts/verify-menu-validation.ts.
 */
const MAX_PRICE = 100000;

/** A base price: a plain non-negative number up to ₹1,00,000 (0 is allowed for size-priced items). */
export function menuPriceError(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (s === "" || !/^\d+(\.\d{1,2})?$/.test(s)) return "Price must be a number like 120 or 99.50";
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return `Price must be between 0 and ${MAX_PRICE}`;
  return null;
}

/** Size list: each size needs a name and a positive price. null/undefined = no sizes. */
export function menuSizesError(sizes: unknown): string | null {
  if (sizes == null) return null;
  if (!Array.isArray(sizes)) return "Sizes must be a list";
  for (const z of sizes) {
    if (!z || typeof (z as any).size !== "string" || !(z as any).size.trim()) return "Every size needs a name";
    const n = Number((z as any).price);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return `Size "${(z as any).size}" needs a price above 0`;
  }
  return null;
}
