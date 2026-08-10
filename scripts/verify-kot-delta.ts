/**
 * Verifies server/kotDelta.ts's computeDelta — specifically the parcel/service-mode
 * flip fix: snapKey includes serviceMode (needed so two concurrent lines of the same
 * dish in different modes, e.g. Section POS's per-item "eat here" vs "parcel" toggle,
 * track their quantities independently), but that meant a PURE serviceMode flip on an
 * otherwise-unchanged line (same dish, same size, same quantity) used to fall into the
 * cancel/new logic as a spurious full VOID + full NEW pair — telling the kitchen to
 * stop cooking something already in progress and start a fresh identical order.
 * computeDelta now nets out exactly this pair.
 * Run: npx tsx scripts/verify-kot-delta.ts
 */
import { computeDelta, type SnapshotItem } from "../server/kotDelta";

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

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
