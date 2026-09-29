/**
 * Verifies shared/kotItemCancel.ts's findMissingKotCancelReasons — the new reason-matching
 * logic behind PUT /api/orders/:id/items' per-item "cancel after KOT sent" guard. Deliberately
 * does NOT re-test computeDelta's own diffing/flip-netting (already covered exhaustively by
 * scripts/verify-kot-delta.ts) — case 6 below exists only to assert that reusing computeDelta
 * DIRECTLY (rather than reimplementing) means that behavior is inherited here for free; if a
 * future refactor stops reusing it, this is the test that should catch it.
 * Run: npx tsx scripts/verify-kot-item-cancel.ts
 */
import { findMissingKotCancelReasons, type CancelledKotItemInput } from "../shared/kotItemCancel";
import type { SnapshotItem } from "../shared/kotDelta";

const checks: Array<[string, boolean]> = [];

const item = (over: Partial<SnapshotItem> = {}): SnapshotItem => ({
  itemId: 1, name: "Paneer Tikka", quantity: 2, size: null, serviceMode: "dinein",
  ...over,
});

// 1. Item present in both current and last snapshot — nothing dropped, nothing missing.
{
  const last = [item()];
  const current = [item()];
  const missing = findMissingKotCancelReasons(current, last, []);
  checks.push(["present in both: nothing missing", missing.length === 0]);
}

// 2. Item dropped, matching non-empty reason provided — nothing missing.
{
  const last = [item()];
  const current: SnapshotItem[] = [];
  const provided: CancelledKotItemInput[] = [{ itemId: 1, size: null, serviceMode: "dinein", reason: "Customer changed mind" }];
  const missing = findMissingKotCancelReasons(current, last, provided);
  checks.push(["dropped with matching reason: nothing missing", missing.length === 0]);
}

// 3. Item dropped, reason missing entirely — reported.
{
  const last = [item()];
  const current: SnapshotItem[] = [];
  const missing = findMissingKotCancelReasons(current, last, []);
  checks.push(["dropped with no reason at all: reported missing", missing.length === 1 && missing[0].itemId === 1]);
}

// 3b. Item dropped, reason provided but blank/whitespace-only — still reported.
{
  const last = [item()];
  const current: SnapshotItem[] = [];
  const provided: CancelledKotItemInput[] = [{ itemId: 1, size: null, serviceMode: "dinein", reason: "   " }];
  const missing = findMissingKotCancelReasons(current, last, provided);
  checks.push(["dropped with whitespace-only reason: reported missing", missing.length === 1]);
}

// 4. Item never on any KOT (not in `last` at all) and removed from current — not dropped,
//    no reason needed. A same-session add-then-remove before ever printing a KOT.
{
  const last: SnapshotItem[] = [];
  const current: SnapshotItem[] = [];
  const missing = findMissingKotCancelReasons(current, last, []);
  checks.push(["never-KOT'd item, nothing in either snapshot: nothing missing", missing.length === 0]);
}

// 5. Quantity decrease, not to zero — item still present in current, just fewer units.
//    computeDelta routes this to modifiedItems, never cancelledItems.
{
  const last = [item({ quantity: 3 })];
  const current = [item({ quantity: 1 })];
  const missing = findMissingKotCancelReasons(current, last, []);
  checks.push(["quantity decrease (not to zero): not dropped, nothing missing", missing.length === 0]);
}

// 6. THE IMPORTANT ONE — a pure service-mode flip on an otherwise-unchanged KOT'd line
//    (same itemId, size, quantity) must NOT require a reason. computeDelta's own
//    flip-netting pass removes this pair from cancelledItems before this module sees it —
//    this assertion exists specifically to catch a future refactor that stops reusing
//    computeDelta directly and reimplements the diff without that netting pass.
{
  const last = [item({ serviceMode: "dinein" })];
  const current = [item({ serviceMode: "pickup" })];
  const missing = findMissingKotCancelReasons(current, last, []);
  checks.push(["pure serviceMode flip on KOT'd item: NOT treated as cancelled, no reason required", missing.length === 0]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
