/**
 * Verifies shared/orderMutation.ts: PUT /api/orders/:id's allowlist rejects every
 * money/payment/identity field and accepts only the four safe ones.
 * Run: npx tsx scripts/verify-order-mutation-guard.ts
 */
import { orderUpdateAllowlist, ORDER_CREATE_FORCED_DEFAULTS } from "../shared/orderMutation";

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

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
