/**
 * Verifies shared/orderAudit.ts's diffOrderLines — the before/after diffing used by
 * PUT /api/orders/:id/items to build the order.items_edit audit row. Deliberately checks
 * the specific ways this diverges from shared/kotDelta.ts's computeDelta (see that file's
 * and this one's own comments for why): a serviceMode flip must be reported, not netted,
 * and a quantity change must read as a transition, not an increment.
 * Run: npx tsx scripts/verify-order-audit.ts
 */
import { diffOrderLines, type AuditLine } from "../shared/orderAudit";

const checks: Array<[string, boolean]> = [];

const line = (over: Partial<AuditLine> = {}): AuditLine => ({
  menuItemId: 1,
  name: "Paneer Tikka",
  size: null,
  serviceMode: "dinein",
  quantity: 2,
  price: 250,
  ...over,
});

// 1. A pure addition.
{
  const before: AuditLine[] = [line()];
  const after: AuditLine[] = [line(), line({ menuItemId: 2, name: "Naan", price: 40 })];
  const d = diffOrderLines(before, after);
  checks.push(["pure add: one added, nothing else", d.added.length === 1 && d.removed.length === 0 && d.changed.length === 0 && !d.isEmpty]);
  checks.push(["pure add: added line is the new item", d.added[0]?.name === "Naan"]);
}

// 2. A pure removal.
{
  const before: AuditLine[] = [line(), line({ menuItemId: 2, name: "Naan", price: 40 })];
  const after: AuditLine[] = [line()];
  const d = diffOrderLines(before, after);
  checks.push(["pure remove: one removed, nothing else", d.removed.length === 1 && d.added.length === 0 && d.changed.length === 0]);
  checks.push(["pure remove: removed line is the dropped item", d.removed[0]?.name === "Naan"]);
}

// 3. Quantity change reports the transition (2 -> 3), not an increment ("+1") — the
//    opposite of kotDelta's kitchen-shaped "increment only" behavior.
{
  const before: AuditLine[] = [line({ quantity: 2 })];
  const after: AuditLine[] = [line({ quantity: 3 })];
  const d = diffOrderLines(before, after);
  checks.push(["qty change: one changed entry", d.changed.length === 1 && d.added.length === 0 && d.removed.length === 0]);
  checks.push(["qty change: before/after values, not a delta", d.changed[0]?.qtyBefore === 2 && d.changed[0]?.qtyAfter === 3]);
}

// 4. Price change on an otherwise-identical line is a changed entry.
{
  const before: AuditLine[] = [line({ price: 250 })];
  const after: AuditLine[] = [line({ price: 280 })];
  const d = diffOrderLines(before, after);
  checks.push(["price change: one changed entry with before/after", d.changed.length === 1 && d.changed[0]?.priceBefore === 250 && d.changed[0]?.priceAfter === 280]);
}

// 5. A pure serviceMode flip (dine-in -> parcel, same item/size/qty/price) must be
//    REPORTED as a changed line, not netted away — the deliberate divergence from
//    kotDelta.computeDelta, which nets this exact case out for the kitchen ticket.
{
  const before: AuditLine[] = [line({ serviceMode: "dinein" })];
  const after: AuditLine[] = [line({ serviceMode: "pickup" })];
  const d = diffOrderLines(before, after);
  checks.push(["serviceMode flip: reported as changed, not netted to isEmpty", d.changed.length === 1 && d.added.length === 0 && d.removed.length === 0 && !d.isEmpty]);
  checks.push(["serviceMode flip: mode before/after captured", d.changed[0]?.modeBefore === "dinein" && d.changed[0]?.modeAfter === "pickup"]);
}

// 6. Identical before/after is empty — the case that must NEVER produce an audit row,
//    since the POS Auto-KOT timer PUTs the unchanged cart on a debounce for every open
//    order and an unconditional log would bury real edits under thousands of no-ops.
{
  const before: AuditLine[] = [line(), line({ menuItemId: 2, name: "Naan", price: 40, quantity: 1 })];
  const after: AuditLine[] = [line(), line({ menuItemId: 2, name: "Naan", price: 40, quantity: 1 })];
  const d = diffOrderLines(before, after);
  checks.push(["identical input: isEmpty true, nothing in any bucket", d.isEmpty && d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0]);
}

// 7. Documented limitation (see orderAudit.ts's lineKey comment): two concurrent lines of
//    the same dish+size in different modes share one map slot here (unlike kotDelta's key,
//    which keeps them distinct for KOT purposes). Editing only ONE of the two lines still
//    diffs correctly — the untouched line's before/after values are identical, so its
//    silent loss from the map changes nothing observable.
{
  const before: AuditLine[] = [
    line({ serviceMode: "dinein", quantity: 1 }),
    line({ serviceMode: "pickup", quantity: 1 }),
  ];
  const after: AuditLine[] = [
    line({ serviceMode: "dinein", quantity: 1 }),  // untouched
    line({ serviceMode: "pickup", quantity: 2 }),  // the actual edit
  ];
  const d = diffOrderLines(before, after);
  checks.push(["editing one of two same-key lines still reports that edit correctly", d.changed.length === 1 && d.changed[0]?.qtyBefore === 1 && d.changed[0]?.qtyAfter === 2]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
