/**
 * Pure planner for a bulk menu price revision (used by scripts/apply-menu-prices-2026-11.ts,
 * locked by scripts/verify-menu-price-plan.ts). It never touches the DB: given the live
 * menu rows, the categories and a hand-checked target table, it returns exactly which rows
 * to update / insert, or the reasons it refuses.
 *
 * Safety rules:
 *  - every update is keyed on id AND the expected current name (or the rename target, so a
 *    second run after a successful one is a no-op) — a row edited since the table was made
 *    is an error, never silently re-priced;
 *  - prices go through shared/menuValidation.ts, the same checks POST/PUT /api/menu apply;
 *  - a sized item (pizza) is only re-priced through a "sizes" target that names exactly its
 *    sizes; each size keeps its other fields (stockMultiplier); base price = the Small price;
 *  - a new dish whose name already exists is "already present" when price and category
 *    match (re-run), and an error otherwise.
 */
import { menuPriceError, menuSizesError } from "../../shared/menuValidation";

export interface SizeRow { size: string; price: number; stockMultiplier?: number; [k: string]: unknown }
export interface MenuRow {
  id: number;
  name: string;
  price: string | number;
  category_id: number;
  is_deleted: boolean;
  sizes: SizeRow[] | null;
}
export interface CategoryRow { id: number; name: string }
/** One row of the owner's PDF: [row number, item name, revised price]. */
export type PdfRow = readonly [number, string, number];

export type SizePrices = { Small: number; Medium: number; Large: number };
export type Target =
  | { kind: "update"; rows: number[]; id: number; name: string; price: number; rename?: string }
  | { kind: "sizes"; rows: [number, number, number]; id: number; name: string; sizes: SizePrices }
  | { kind: "new"; rows: number[]; name: string; categoryId: number; category: string; price: number };

export type Change =
  | { op: "update"; id: number; name: string; newName?: string; fromPrice: number; toPrice: number; fromSizes?: SizeRow[]; toSizes?: SizeRow[] }
  | { op: "insert"; name: string; categoryId: number; category: string; price: number };

export interface Plan {
  changes: Change[];
  /** ids already at their target price (and name). */
  unchanged: number[];
  /** new-dish names that already exist with the same price and category. */
  alreadyPresent: string[];
  errors: string[];
}

const SIZE_ORDER = ["Small", "Medium", "Large"] as const;
const EPS = 0.005;

/** Case/space-insensitive name key ("Tomato & Basil " == "tomato  & basil"). */
export function nameKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}
const samePrice = (a: number, b: number) => Math.abs(a - b) < EPS;
/** Same check POST/PUT /api/menu apply to a price string ("349", "349.5"), plus > 0. */
function priceError(n: number): string | null {
  if (!(n > 0)) return "price must be above 0";
  return menuPriceError(String(n));
}

export function planMenuPrices(menu: MenuRow[], categories: CategoryRow[], targets: Target[]): Plan {
  const plan: Plan = { changes: [], unchanged: [], alreadyPresent: [], errors: [] };
  const byId = new Map(menu.map((r) => [r.id, r] as const));
  const catById = new Map(categories.map((c) => [c.id, c] as const));
  const seenIds = new Set<number>();
  const seenNewNames = new Set<string>();

  for (const t of targets) {
    const where = `PDF row(s) ${t.rows.join(",")}`;

    if (t.kind === "new") {
      const key = nameKey(t.name);
      if (seenNewNames.has(key)) { plan.errors.push(`${where}: new dish "${t.name}" listed twice`); continue; }
      seenNewNames.add(key);
      const cat = catById.get(t.categoryId);
      if (!cat || nameKey(cat.name) !== nameKey(t.category)) {
        plan.errors.push(`${where}: category #${t.categoryId} is "${cat?.name ?? "missing"}", expected "${t.category}"`);
        continue;
      }
      const pe = priceError(t.price);
      if (pe) { plan.errors.push(`${where}: "${t.name}" ${pe}`); continue; }
      const existing = menu.filter((r) => !r.is_deleted && nameKey(r.name) === key);
      if (existing.length > 0) {
        const r = existing[0];
        if (existing.length === 1 && r.category_id === t.categoryId && samePrice(Number(r.price), t.price) && !(r.sizes && r.sizes.length)) {
          plan.alreadyPresent.push(t.name);
        } else {
          plan.errors.push(`${where}: new dish "${t.name}" already exists as #${r.id} (₹${Number(r.price)}, category #${r.category_id})`);
        }
        continue;
      }
      plan.changes.push({ op: "insert", name: t.name, categoryId: t.categoryId, category: cat.name, price: t.price });
      continue;
    }

    if (seenIds.has(t.id)) { plan.errors.push(`${where}: item #${t.id} is targeted more than once`); continue; }
    seenIds.add(t.id);
    const row = byId.get(t.id);
    if (!row) { plan.errors.push(`${where}: item #${t.id} "${t.name}" not found`); continue; }
    if (row.is_deleted) { plan.errors.push(`${where}: item #${t.id} "${row.name}" is deleted`); continue; }
    const current = nameKey(row.name);
    const renameTo = t.kind === "update" ? t.rename : undefined;
    const nameOk = current === nameKey(t.name) || (renameTo !== undefined && current === nameKey(renameTo));
    if (!nameOk) {
      plan.errors.push(`${where}: item #${t.id} is now named "${row.name}", expected "${t.name}"`);
      continue;
    }
    const fromPrice = Number(row.price);
    const needsRename = renameTo !== undefined && current !== nameKey(renameTo);
    const hasSizes = Array.isArray(row.sizes) && row.sizes.length > 0;

    if (t.kind === "update") {
      if (hasSizes) { plan.errors.push(`${where}: item #${t.id} "${row.name}" has sizes; needs a sizes target`); continue; }
      const pe = priceError(t.price);
      if (pe) { plan.errors.push(`${where}: "${row.name}" ${pe}`); continue; }
      if (samePrice(fromPrice, t.price) && !needsRename) { plan.unchanged.push(t.id); continue; }
      plan.changes.push({
        op: "update", id: t.id, name: row.name, fromPrice, toPrice: t.price,
        ...(needsRename ? { newName: renameTo } : {}),
      });
      continue;
    }

    // kind === "sizes"
    const sizes = row.sizes ?? [];
    const names = sizes.map((s) => s.size).sort().join("|");
    if (!hasSizes || names !== [...SIZE_ORDER].sort().join("|")) {
      plan.errors.push(`${where}: item #${t.id} "${row.name}" sizes are [${sizes.map((s) => s.size).join(", ")}], expected Small/Medium/Large`);
      continue;
    }
    const toSizes = sizes.map((s) => ({ ...s, price: t.sizes[s.size as keyof SizePrices] }));
    const se = menuSizesError(toSizes) ?? priceError(t.sizes.Small);
    if (se) { plan.errors.push(`${where}: "${row.name}" ${se}`); continue; }
    const toPrice = t.sizes.Small;
    const sizesSame = sizes.every((s) => samePrice(Number(s.price), t.sizes[s.size as keyof SizePrices]));
    if (sizesSame && samePrice(fromPrice, toPrice)) { plan.unchanged.push(t.id); continue; }
    plan.changes.push({ op: "update", id: t.id, name: row.name, fromPrice, toPrice, fromSizes: sizes, toSizes });
  }
  return plan;
}

/**
 * Proves the target table is a faithful use of the PDF: every PDF row is referenced, no
 * unknown row is referenced, each target's price equals its row(s), and a sizes target's
 * rows are its Small / Medium / Large lines in that order.
 */
export function checkCoverage(pdfRows: readonly PdfRow[], targets: Target[]): string[] {
  const errors: string[] = [];
  const byRow = new Map(pdfRows.map((r) => [r[0], r] as const));
  const used = new Set<number>();
  for (const t of targets) {
    const label = t.kind === "new" ? `new "${t.name}"` : `#${t.id} "${t.name}"`;
    t.rows.forEach((n, i) => {
      const r = byRow.get(n);
      if (!r) { errors.push(`${label}: PDF row ${n} does not exist`); return; }
      used.add(n);
      if (t.kind === "sizes") {
        const size = SIZE_ORDER[i];
        if (!new RegExp(`\\b${size}\\b`, "i").test(r[1])) errors.push(`${label}: PDF row ${n} "${r[1]}" is not the ${size} line`);
        if (!samePrice(r[2], t.sizes[size])) errors.push(`${label}: ${size} ₹${t.sizes[size]} but PDF row ${n} says ₹${r[2]}`);
      } else if (!samePrice(r[2], t.price)) {
        errors.push(`${label}: ₹${t.price} but PDF row ${n} "${r[1]}" says ₹${r[2]}`);
      }
    });
    if (t.kind === "sizes" && t.rows.length !== 3) errors.push(`${label}: a sizes target needs exactly 3 PDF rows`);
  }
  for (const r of pdfRows) if (!used.has(r[0])) errors.push(`PDF row ${r[0]} "${r[1]}" (₹${r[2]}) is not used by any target`);
  return errors;
}

const rs = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
export function formatChange(c: Change): string {
  if (c.op === "insert") return `ADD     ${c.name}  ${rs(c.price)}  [${c.category}]`;
  const rename = c.newName ? `  (rename → "${c.newName}")` : "";
  if (c.toSizes) {
    const from = (c.fromSizes ?? []).map((s) => `${s.size} ${rs(Number(s.price))}`).join(" / ");
    const to = c.toSizes.map((s) => `${s.size} ${rs(Number(s.price))}`).join(" / ");
    return `#${String(c.id).padEnd(4)} ${c.name.trim()}  ${from}  →  ${to}${rename}`;
  }
  return `#${String(c.id).padEnd(4)} ${c.name.trim()}  ${rs(c.fromPrice)} → ${rs(c.toPrice)}${rename}`;
}
