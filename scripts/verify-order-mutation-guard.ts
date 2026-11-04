/**
 * Verifies shared/orderMutation.ts: PUT /api/orders/:id's allowlist rejects every
 * money/payment/identity field and accepts only the four safe ones.
 * Run: npx tsx scripts/verify-order-mutation-guard.ts
 */
import { orderUpdateAllowlist, ORDER_CREATE_FORCED_DEFAULTS, planStatusChange } from "../shared/orderMutation";
import { mergeBlock } from "../shared/orderStatusChange";

const checks: Array<[string, boolean]> = [];

function rejects(body: Record<string, unknown>): boolean {
  const result = orderUpdateAllowlist.safeParse(body);
  return !result.success;
}

function accepts(body: Record<string, unknown>): boolean {
  const result = orderUpdateAllowlist.safeParse(body);
  return result.success;
}

// 1. The four allowed fields pass through.
checks.push(["status alone is accepted", accepts({ status: "served" })]);
checks.push(["notes/customerName/customerPhone accepted", accepts({
  notes: "extra spicy", customerName: "Ravi", customerPhone: "9876543210",
})]);
checks.push(["empty body is accepted (all optional)", accepts({})]);

// 2. Every money/payment field is rejected (Zod object strips unknown keys by default —
//    createInsertSchema(...).pick({...}) only exposes the picked keys, so anything else
//    fails validation as an unrecognized key once .strict() semantics apply via drizzle-zod's
//    picked schema shape not containing them; assert via the parsed OUTPUT never carrying them).
const moneyFields = [
  { totalAmount: "0.01" },
  { taxAmount: "0" },
  { discountAmount: "9999" },
  // The two manual flat charges are persisted only by POST /api/orders and
  // PUT /api/orders/:id/items (clamped by shared/orderPricing.ts) — never settable here.
  { containerCharge: "9999" },
  { deliveryCharge: "9999" },
  { paidAmount: "0.01" },
  { paymentStatus: "paid" },
  { changeAmount: "0" },
  { paymentMethod: "cash" },
  { paymentBreakdown: { cash: "1" } },
];
for (const field of moneyFields) {
  const key = Object.keys(field)[0];
  const parsed = orderUpdateAllowlist.safeParse({ status: "served", ...field });
  const strippedOut = parsed.success && !(key in (parsed.data as any));
  checks.push([`${key} is stripped out, never reaches storage.updateOrder`, strippedOut]);
}

// 3. Identity fields (would let a client re-point an order at a different table/order-number)
//    are stripped too.
for (const field of [{ tableId: 5 }, { orderNumber: "ORD9999" }, { orderType: "delivery" }, { createdBy: 1 }]) {
  const key = Object.keys(field)[0];
  const parsed = orderUpdateAllowlist.safeParse({ status: "served", ...field });
  const strippedOut = parsed.success && !(key in (parsed.data as any));
  checks.push([`${key} is stripped out`, strippedOut]);
}

// 4. Order-creation forced defaults are exactly the "unpaid, no payment recorded" state.
checks.push(["ORDER_CREATE_FORCED_DEFAULTS.paymentStatus is pending", ORDER_CREATE_FORCED_DEFAULTS.paymentStatus === "pending"]);
checks.push(["ORDER_CREATE_FORCED_DEFAULTS.paidAmount is null", ORDER_CREATE_FORCED_DEFAULTS.paidAmount === null]);
checks.push(["ORDER_CREATE_FORCED_DEFAULTS.paymentMethod is null", ORDER_CREATE_FORCED_DEFAULTS.paymentMethod === null]);
// paid_at decides which business day a payment counts on AND how long it can be corrected, so a
// client must never be able to choose it — it is stamped only by the server's own settle paths.
checks.push(["ORDER_CREATE_FORCED_DEFAULTS.paidAt is null (client cannot pick the paid day)", (ORDER_CREATE_FORCED_DEFAULTS as any).paidAt === null]);
checks.push(["ORDER_CREATE_FORCED_DEFAULTS forces status pending and clears cancel/print state", ORDER_CREATE_FORCED_DEFAULTS.status === "pending" && ORDER_CREATE_FORCED_DEFAULTS.cancelReason === null && ORDER_CREATE_FORCED_DEFAULTS.kotPrintCount === 0 && ORDER_CREATE_FORCED_DEFAULTS.lastKotSnapshot === null]);
{
  const parsed = orderUpdateAllowlist.safeParse({ status: "served", paidAt: "2026-01-01T00:00:00.000Z" });
  checks.push(["paidAt is stripped from PUT /api/orders/:id", parsed.success && !("paidAt" in (parsed.data as any))]);
}

// ── planStatusChange: PUT /api/orders/:id status edits ──
{
  const P = (status: string, paymentStatus: string, next: string) => planStatusChange({ status, paymentStatus }, next);
  checks.push(["kitchen progress pending → preparing → ready is allowed", P("pending", "pending", "preparing") === null && P("preparing", "pending", "ready") === null]);
  checks.push(["same status is a no-op even when cancelled", P("cancelled", "pending", "cancelled") === null]);
  checks.push(["setting cancelled is refused (use Cancel Order)", P("pending", "pending", "cancelled")?.code === "use_cancel"]);
  checks.push(["un-cancelling is refused", P("cancelled", "pending", "pending")?.code === "cancelled"]);
  checks.push(["a held order can't be edited here", P("hold", "pending", "pending")?.code === "hold"]);
  checks.push(["a paid order can't go back to the kitchen", P("served", "paid", "preparing")?.code === "settled"]);
  checks.push(["a paid order may switch served ↔ delivered", P("served", "paid", "delivered") === null && P("delivered", "paid", "served") === null]);
  checks.push(["an open due can't be hidden as delivered", P("served", "pending", "delivered")?.code === "due"]);
  checks.push(["an open due can't go back to the kitchen", P("served", "pending", "ready")?.code === "due"]);
  checks.push(["an unpaid running order can't be marked served without settling", P("ready", "pending", "served")?.code === "unpaid"]);
  checks.push(["unknown status is a 400", P("pending", "pending", "paid")?.status === 400]);
}

// ── mergeBlock ──
{
  const o = (id: number, status = "pending", paymentStatus = "pending") => ({ id, status, paymentStatus });
  checks.push(["merge two running orders is fine", mergeBlock(o(1), o(2)) === null]);
  checks.push(["merge into itself refused", mergeBlock(o(5), o(5))?.code === "same_order"]);
  checks.push(["merge a paid order refused", mergeBlock(o(1), o(2, "served", "paid"))?.code === "settled"]);
  checks.push(["merge a cancelled order refused", mergeBlock(o(1, "cancelled"), o(2))?.code === "cancelled"]);
  checks.push(["merge a due refused", mergeBlock(o(1), o(2, "served"))?.code === "due"]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
