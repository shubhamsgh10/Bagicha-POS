/**
 * Verifies shared/kotDelta.ts's computeDelta — specifically the parcel/service-mode
 * flip fix: snapKey includes serviceMode (needed so two concurrent lines of the same
 * dish in different modes, e.g. Section POS's per-item "eat here" vs "parcel" toggle,
 * track their quantities independently), but that meant a PURE serviceMode flip on an
 * otherwise-unchanged line (same dish, same size, same quantity) used to fall into the
 * cancel/new logic as a spurious full VOID + full NEW pair — telling the kitchen to
 * stop cooking something already in progress and start a fresh identical order.
 * computeDelta now nets out exactly this pair.
 * Run: npx tsx scripts/verify-kot-delta.ts
 */
import { computeDelta, mergedInstructions, instructionsByKey, snapKey, type SnapshotItem } from "../shared/kotDelta";

const checks: Array<[string, boolean]> = [];

const item = (over: Partial<SnapshotItem>): SnapshotItem => ({
  itemId: 1, name: "Dosa", quantity: 2, size: null, serviceMode: "dinein", ...over,
});

// ── Full serviceMode flip, unchanged quantity: nets to nothing ────────────────
{
  const last = [item({ serviceMode: "dinein", quantity: 2 })];
  const current = [item({ serviceMode: "pickup", quantity: 2 })];
  const delta = computeDelta(current, last);
  checks.push(["full flip: no new items", delta.newItems.length === 0]);
  checks.push(["full flip: no modified items", delta.modifiedItems.length === 0]);
  checks.push(["full flip: no cancelled items", delta.cancelledItems.length === 0]);
}

// ── Two concurrent lines, same dish, different serviceMode: tracked independently ──
{
  const last = [
    item({ serviceMode: "dinein", quantity: 1 }),
    item({ serviceMode: "pickup", quantity: 1 }),
  ];
  // Dine-in line goes up to 2, pickup line unchanged — must NOT net against each other.
  const current = [
    item({ serviceMode: "dinein", quantity: 2 }),
    item({ serviceMode: "pickup", quantity: 1 }),
  ];
  const delta = computeDelta(current, last);
  checks.push(["concurrent lines: dine-in increment shows as new (+1)",
    delta.newItems.length === 1 && delta.newItems[0].serviceMode === "dinein" && delta.newItems[0].quantity === 1 && delta.newItems[0].previousQty === 1]);
  checks.push(["concurrent lines: pickup line untouched", delta.modifiedItems.length === 0 && delta.cancelledItems.length === 0]);
}

// ── Genuine cancellation (no matching new item) still reported ────────────────
{
  const last = [item({ serviceMode: "dinein", quantity: 2 })];
  const current: SnapshotItem[] = [];
  const delta = computeDelta(current, last);
  checks.push(["genuine cancellation: reported", delta.cancelledItems.length === 1 && delta.cancelledItems[0].quantity === 2]);
  checks.push(["genuine cancellation: no phantom new item", delta.newItems.length === 0]);
}

// ── Genuine brand-new item (no matching cancellation) still reported ──────────
{
  const last: SnapshotItem[] = [];
  const current = [item({ serviceMode: "dinein", quantity: 3 })];
  const delta = computeDelta(current, last);
  checks.push(["genuine new item: reported", delta.newItems.length === 1 && delta.newItems[0].quantity === 3]);
  checks.push(["genuine new item: no previousQty (not a flip or increment)", delta.newItems[0].previousQty === undefined]);
}

// ── Quantity increase (same key) still tags previousQty, unaffected by the flip fix ──
{
  const last = [item({ serviceMode: "dinein", quantity: 1 })];
  const current = [item({ serviceMode: "dinein", quantity: 1.5 })];
  const delta = computeDelta(current, last);
  checks.push(["qty increase: shows as +0.5 new with previousQty", delta.newItems.length === 1 && delta.newItems[0].quantity === 0.5 && delta.newItems[0].previousQty === 1]);
}

// ── Two DIFFERENT dishes, one cancelled one new, same quantity — must NOT net ──
{
  const last = [item({ itemId: 1, serviceMode: "dinein", quantity: 2 })];
  const current = [item({ itemId: 2, serviceMode: "dinein", quantity: 2 })];
  const delta = computeDelta(current, last);
  checks.push(["different dishes, same qty: both reported (no false net)",
    delta.newItems.length === 1 && delta.cancelledItems.length === 1]);
}

// ── Duplicate lines of the same dish key are SUMMED, not last-wins ─────────────
// (same dish with different add-ons, or the same dish added again after reopening the order)
{
  const last = [item({ itemId: 7, name: "Butter Naan", quantity: 1 })];
  const current = [item({ itemId: 7, name: "Butter Naan", quantity: 1 }), item({ itemId: 7, name: "Butter Naan", quantity: 1 })];
  const delta = computeDelta(current, last);
  checks.push(["second Naan added as its own line → +1 (now 2, was 1)",
    delta.newItems.length === 1 && delta.newItems[0].quantity === 1 && delta.newItems[0].previousQty === 1]);
}
{
  const last = [item({ itemId: 7, quantity: 1 }), item({ itemId: 7, quantity: 1 })];
  const current = [item({ itemId: 7, quantity: 1 })];
  const delta = computeDelta(current, last);
  checks.push(["removing one of two duplicate lines → a decrease (2 → 1), not unnoticed",
    delta.modifiedItems.length === 1 && delta.modifiedItems[0].quantity === 1 && delta.modifiedItems[0].previousQty === 2 && delta.cancelledItems.length === 0]);
}
{
  const current = [item({ itemId: 7, quantity: 1 }), item({ itemId: 7, quantity: 2 })];
  const delta = computeDelta(current, []);
  checks.push(["two new lines of one dish → one entry of 3", delta.newItems.length === 1 && delta.newItems[0].quantity === 3]);
}
{
  const last = [item({ itemId: 7, quantity: 1 }), item({ itemId: 7, quantity: 1 })];
  const current = [item({ itemId: 7, quantity: 2 })];
  checks.push(["two lines merged into one of the same total → no change", (() => {
    const d = computeDelta(current, last);
    return d.newItems.length === 0 && d.modifiedItems.length === 0 && d.cancelledItems.length === 0;
  })()]);
}
{
  const last = [item({ itemId: 7, quantity: 0.3 })];
  const current = [item({ itemId: 7, quantity: 0.1 }), item({ itemId: 7, quantity: 0.2 })];
  const d = computeDelta(current, last);
  checks.push(["0.1 + 0.2 equals 0.3 (no float-noise increment)", d.newItems.length === 0 && d.modifiedItems.length === 0]);
}
{
  // A summed flip still nets: two dine-in lines (1 + 1) re-tagged as one parcel line of 2.
  const last = [item({ itemId: 7, quantity: 1, serviceMode: "dinein" }), item({ itemId: 7, quantity: 1, serviceMode: "dinein" })];
  const current = [item({ itemId: 7, quantity: 2, serviceMode: "pickup" })];
  const d = computeDelta(current, last);
  checks.push(["flip of summed lines still nets out", d.newItems.length === 0 && d.cancelledItems.length === 0]);
}

// ── mergedInstructions / instructionsByKey ────────────────────────────────────
checks.push(["same instructions on every line → that text", mergedInstructions([{ quantity: 1, instructions: "Note: less oil" }, { quantity: 2, instructions: "Note: less oil" }]) === "Note: less oil"]);
checks.push(["no instructions anywhere → null", mergedInstructions([{ quantity: 1, instructions: "" }, { quantity: 1, instructions: null }]) === null]);
checks.push(["different instructions → each variant with its quantity",
  mergedInstructions([{ quantity: 1, instructions: null }, { quantity: 2, instructions: "+ Extra Cheese" }]) === "1x regular; 2x + Extra Cheese"]);
{
  const m = instructionsByKey([
    { itemId: 7, size: null, serviceMode: "dinein", quantity: 1, instructions: "" },
    { itemId: 7, size: null, serviceMode: "dinein", quantity: 1, instructions: "+ Ghee" },
    { itemId: 9, size: "L", serviceMode: "dinein", quantity: 1, instructions: "Note: hot" },
  ]);
  checks.push(["instructionsByKey groups by dish key", m.get(snapKey({ itemId: 7, size: null, serviceMode: "dinein" })) === "1x regular; 1x + Ghee" && m.get(snapKey({ itemId: 9, size: "L", serviceMode: "dinein" })) === "Note: hot"]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
