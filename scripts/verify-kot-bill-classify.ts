/**
 * Verifies shared/orderAudit.ts's classifyItemsEditRow — the pure-function twin of the
 * raw-SQL classification inside server/services/auditService.ts's getKotBillActivitySummary
 * (Reports.tsx's "KOT & Bill Activity" tab). Both express the identical rule for splitting
 * one order.items_edit audit row into "KOT Modified" / "Bill Modified" buckets; this script
 * locks in the rule itself so a future change to one side has something to check against.
 * Run: npx tsx scripts/verify-kot-bill-classify.ts
 */
import { classifyItemsEditRow, type ItemsEditMetadata } from "../shared/orderAudit";

const checks: Array<[string, boolean]> = [];

const base = (over: Partial<ItemsEditMetadata> = {}): ItemsEditMetadata => ({
  added: [], removed: [], changed: [],
  totalBefore: 500, totalAfter: 500,
  discountBefore: 0, discountAfter: 0,
  containerBefore: 0, containerAfter: 0,
  ...over,
});

// 1. Adding an item is BOTH a KOT change and a bill change — the common, non-exclusive case.
{
  const r = classifyItemsEditRow(base({ added: [{ name: "Naan" }], totalBefore: 500, totalAfter: 540 }));
  checks.push(["adding an item: both kotModified and billModified true", r.kotModified && r.billModified]);
}

// 2. A pure service-mode flip (dine-in<->parcel), quantity/price/total unchanged: only KOT.
//    Container charge is a manually-entered flat amount, not derived from service mode, so
//    a flip genuinely leaves totalBefore/totalAfter (and discount/container) unchanged.
{
  const r = classifyItemsEditRow(base({ changed: [{ modeBefore: "dinein", modeAfter: "pickup" }] }));
  checks.push(["pure serviceMode flip: kotModified true, billModified false", r.kotModified && !r.billModified]);
}

// 3. Container-charge-only edit, item lines completely unchanged: only Bill.
{
  const r = classifyItemsEditRow(base({ containerBefore: 0, containerAfter: 30 }));
  checks.push(["container-charge-only edit: billModified true, kotModified false", !r.kotModified && r.billModified]);
}

// 4. Discount-only edit, item lines unchanged: only Bill.
{
  const r = classifyItemsEditRow(base({ discountBefore: 0, discountAfter: 50, totalBefore: 500, totalAfter: 450 }));
  checks.push(["discount-only edit: billModified true, kotModified false", !r.kotModified && r.billModified]);
}

// 5. Nothing changed at all (the Auto-KOT no-op sync case) — neither bucket.
{
  const r = classifyItemsEditRow(base());
  checks.push(["no-op edit: neither bucket true", !r.kotModified && !r.billModified]);
}

// 6. A removed item is a KOT change and (since it changes the total) also a bill change.
{
  const r = classifyItemsEditRow(base({ removed: [{ name: "Water" }], totalBefore: 540, totalAfter: 500 }));
  checks.push(["removing an item: both buckets true", r.kotModified && r.billModified]);
}

// 7. Missing/undefined metadata (a malformed or ancient row) never throws, classifies as
//    unmodified rather than crashing the aggregation.
{
  const r = classifyItemsEditRow(null);
  checks.push(["null metadata: neither bucket true, no throw", !r.kotModified && !r.billModified]);
}
{
  const r = classifyItemsEditRow(undefined);
  checks.push(["undefined metadata: neither bucket true, no throw", !r.kotModified && !r.billModified]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
