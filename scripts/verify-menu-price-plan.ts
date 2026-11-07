/**
 * DB-free checks for the Nov 2026 menu price revision (scripts/apply-menu-prices-2026-11.ts):
 * the pure planner (scripts/lib/menuPricePlan.ts) and the hand-transcribed PDF table
 * (scripts/data/menu-prices-2026-11.ts). Run: npx tsx scripts/verify-menu-price-plan.ts
 */
import { planMenuPrices, checkCoverage, type MenuRow, type CategoryRow, type Target, type PdfRow } from "./lib/menuPricePlan";
import { PDF_ROWS, TARGETS } from "./data/menu-prices-2026-11";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

const cats: CategoryRow[] = [{ id: 1, name: "Munchies" }, { id: 6, name: "Pasta" }, { id: 7, name: "Woodfire Pizza" }];
const menu: MenuRow[] = [
  { id: 1, name: "Garlic Bread", price: "299.00", category_id: 1, is_deleted: false, sizes: null },
  { id: 2, name: "Boiled Egg", price: "99.00", category_id: 1, is_deleted: false, sizes: null },
  { id: 3, name: "Old Thing", price: "50.00", category_id: 1, is_deleted: true, sizes: null },
  { id: 4, name: "Margherita", price: "349.00", category_id: 7, is_deleted: false,
    sizes: [{ size: "Small", price: 349 }, { size: "Medium", price: 449, stockMultiplier: 1.5 }, { size: "Large", price: 549, stockMultiplier: 2 }] },
  { id: 5, name: "Spaghetti ", price: "349.00", category_id: 6, is_deleted: false, sizes: [] },
  { id: 6, name: "Pesto Penne", price: "399.00", category_id: 6, is_deleted: false, sizes: null },
];
const plan1 = (t: Target[], m: MenuRow[] = menu) => planMenuPrices(m, cats, t);

// 1. plain price change
{
  const p = plan1([{ kind: "update", rows: [1], id: 1, name: "Garlic Bread", price: 349 }]);
  const c = p.changes[0];
  check("price change → one update", p.errors.length === 0 && p.changes.length === 1 && c.op === "update" && c.id === 1 && c.fromPrice === 299 && c.toPrice === 349, p);
}
// 2. same price → unchanged
{
  const p = plan1([{ kind: "update", rows: [1], id: 2, name: "Boiled Egg", price: 99 }]);
  check("equal price → unchanged", p.errors.length === 0 && p.changes.length === 0 && p.unchanged.includes(2), p);
}
// 3. name mismatch / deleted / missing
{
  check("name mismatch → error", plan1([{ kind: "update", rows: [1], id: 1, name: "Garlic Toast", price: 349 }]).errors.length === 1);
  check("deleted row → error", plan1([{ kind: "update", rows: [1], id: 3, name: "Old Thing", price: 60 }]).errors.length === 1);
  check("missing id → error", plan1([{ kind: "update", rows: [1], id: 999, name: "Nope", price: 60 }]).errors.length === 1);
  check("trailing spaces in the stored name still match", plan1([{ kind: "update", rows: [1], id: 5, name: "Spaghetti", price: 349 }]).errors.length === 0);
}
// 4. sizes keep stockMultiplier, base = Small
{
  const p = plan1([{ kind: "sizes", rows: [1, 2, 3], id: 4, name: "Margherita", sizes: { Small: 399, Medium: 499, Large: 599 } }]);
  const c = p.changes[0] as any;
  const ok = p.errors.length === 0 && c?.op === "update" && c.toPrice === 399 &&
    JSON.stringify(c.toSizes) === JSON.stringify([{ size: "Small", price: 399 }, { size: "Medium", price: 499, stockMultiplier: 1.5 }, { size: "Large", price: 599, stockMultiplier: 2 }]);
  check("pizza sizes re-priced, stockMultiplier kept, base = Small", ok, p);
  const same = plan1([{ kind: "sizes", rows: [1, 2, 3], id: 4, name: "Margherita", sizes: { Small: 349, Medium: 449, Large: 549 } }]);
  check("unchanged sizes → unchanged", same.changes.length === 0 && same.unchanged.includes(4), same);
  const mism = plan1([{ kind: "sizes", rows: [1, 2, 3], id: 1, name: "Garlic Bread", sizes: { Small: 1, Medium: 2, Large: 3 } }]);
  check("size target on an item without those sizes → error", mism.errors.length === 1, mism);
  const sizedAsPlain = plan1([{ kind: "update", rows: [1], id: 4, name: "Margherita", price: 399 }]);
  check("plain update on a sized item → error", sizedAsPlain.errors.length === 1, sizedAsPlain);
}
// 5. new dishes
{
  const p = plan1([{ kind: "new", rows: [1], name: "Pesto Spaghetti Pasta", categoryId: 6, category: "Pasta", price: 399 }]);
  check("new dish → insert", p.errors.length === 0 && p.changes.length === 1 && p.changes[0].op === "insert", p);
  const dup = plan1([{ kind: "new", rows: [1], name: "pesto  penne", categoryId: 6, category: "Pasta", price: 399 }]);
  check("new dish already present (same price+category) → alreadyPresent", dup.errors.length === 0 && dup.changes.length === 0 && dup.alreadyPresent.length === 1, dup);
  const dupDiff = plan1([{ kind: "new", rows: [1], name: "Pesto Penne", categoryId: 6, category: "Pasta", price: 449 }]);
  check("new dish present at another price → error", dupDiff.errors.length === 1, dupDiff);
  const badCat = plan1([{ kind: "new", rows: [1], name: "X Dish", categoryId: 6, category: "Pizza", price: 100 }]);
  check("category id/name mismatch → error", badCat.errors.length === 1, badCat);
}
// 6. rename is idempotent
{
  const t: Target[] = [{ kind: "update", rows: [1], id: 5, name: "Spaghetti", rename: "Alfredo Spaghetti Pasta", price: 349 }];
  const before = plan1(t);
  const c = before.changes[0] as any;
  check("rename before → update with newName", before.errors.length === 0 && c?.op === "update" && c.newName === "Alfredo Spaghetti Pasta", before);
  const renamed = menu.map((r) => (r.id === 5 ? { ...r, name: "Alfredo Spaghetti Pasta" } : r));
  const after = plan1(t, renamed);
  check("rename after → unchanged", after.errors.length === 0 && after.changes.length === 0 && after.unchanged.includes(5), after);
}
// 7. invalid price, duplicate id
{
  check("non-whole-paisa price → error", plan1([{ kind: "update", rows: [1], id: 1, name: "Garlic Bread", price: 349.999 }]).errors.length === 1);
  check("zero price → error", plan1([{ kind: "update", rows: [1], id: 1, name: "Garlic Bread", price: 0 }]).errors.length === 1);
  const dupId = plan1([
    { kind: "update", rows: [1], id: 1, name: "Garlic Bread", price: 349 },
    { kind: "update", rows: [2], id: 1, name: "Garlic Bread", price: 349 },
  ]);
  check("same id targeted twice → error", dupId.errors.length >= 1, dupId);
}
// 8. coverage
{
  const rows: PdfRow[] = [[1, "Garlic Bread", 349], [2, "Margherita - Small", 399], [3, "Margherita - Medium", 499], [4, "Margherita - Large", 599]];
  const ok: Target[] = [
    { kind: "update", rows: [1], id: 1, name: "Garlic Bread", price: 349 },
    { kind: "sizes", rows: [2, 3, 4], id: 4, name: "Margherita", sizes: { Small: 399, Medium: 499, Large: 599 } },
  ];
  check("full coverage → no errors", checkCoverage(rows, ok).length === 0, checkCoverage(rows, ok));
  check("missing PDF row → error", checkCoverage(rows, ok.slice(1)).length >= 1);
  const wrong: Target[] = [{ ...ok[0], price: 399 } as Target, ok[1]];
  check("price disagreeing with the PDF → error", checkCoverage(rows, wrong).length >= 1);
  const swapped: Target[] = [ok[0], { kind: "sizes", rows: [3, 2, 4], id: 4, name: "Margherita", sizes: { Small: 499, Medium: 399, Large: 599 } }];
  check("size rows out of Small/Medium/Large order → error", checkCoverage(rows, swapped).length >= 1);
  check("unknown PDF row referenced → error", checkCoverage(rows, [...ok, { kind: "update", rows: [9], id: 2, name: "Boiled Egg", price: 99 }]).length >= 1);
}
// 9. the real data
{
  const nums = PDF_ROWS.map((r) => r[0]);
  check("PDF_ROWS is rows 1..192 in order", nums.length === 192 && nums.every((n, i) => n === i + 1), nums.length);
  const cov = checkCoverage(PDF_ROWS, TARGETS);
  check("every PDF row is used and every target price matches the PDF", cov.length === 0, cov);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
