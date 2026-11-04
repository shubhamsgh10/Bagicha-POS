/**
 * Verifies client/src/lib/settleSkip.ts — when Settle may go straight to POST /payment without
 * re-saving the cart first. Only when this tab's last successful save of THIS order sent exactly
 * this payload AND the server copy it sees hasn't moved since (same updatedAt).
 * Run: npx tsx scripts/verify-settle-skip.ts
 */
import { saveSignature, canSkipSaveBeforeSettle, type LastSave } from "../client/src/lib/settleSkip";

const checks: Array<[string, boolean]> = [];
const payload = {
  orderId: 7,
  items: [{ menuItemId: 3, quantity: 2, price: "40.00", name: "Naan", size: null, serviceMode: "dinein" }],
  discountAmount: "0.00",
  containerCharge: "10.00",
  deliveryCharge: "0.00",
  customerName: "Ravi",
  customerPhone: "",
  cancelledKotItems: [],
};
const sig = saveSignature(payload);

// ── saveSignature ──
checks.push(["print directives don't change the signature", saveSignature({ ...payload, print: "bill", markBilled: "always" } as any) === sig]);
checks.push(["the order id doesn't change the signature", saveSignature({ ...payload, orderId: 8 }) === sig]);
checks.push(["an item quantity changes it", saveSignature({ ...payload, items: [{ ...payload.items[0], quantity: 3 }] }) !== sig]);
checks.push(["a container charge changes it", saveSignature({ ...payload, containerCharge: "20.00" }) !== sig]);
checks.push(["a customer name changes it", saveSignature({ ...payload, customerName: "Ravi K" }) !== sig]);
checks.push(["a pending cancellation reason changes it", saveSignature({ ...payload, cancelledKotItems: [{ itemId: 3, reason: "x" }] }) !== sig]);
checks.push(["missing customer fields equal empty ones", saveSignature({ ...payload, customerPhone: undefined }) === sig]);

// ── canSkipSaveBeforeSettle ──
const last: LastSave = { orderId: 7, signature: sig, updatedAt: "2026-11-04T10:00:00.000Z" };
const server = { updatedAt: "2026-11-04T10:00:00.000Z", paymentStatus: "pending", status: "preparing" };
const can = (over: Partial<Parameters<typeof canSkipSaveBeforeSettle>[0]> = {}) =>
  canSkipSaveBeforeSettle({ lastSave: last, orderId: 7, signature: sig, serverOrder: server, ...over });

checks.push(["same payload, server unchanged → skip the save", can()]);
checks.push(["nothing saved yet this session → save", !can({ lastSave: null })]);
checks.push(["last save was another order → save", !can({ orderId: 8 })]);
checks.push(["cart changed since → save", !can({ signature: saveSignature({ ...payload, containerCharge: "0.00" }) })]);
checks.push(["server copy moved (another device / Auto-KOT) → save", !can({ serverOrder: { ...server, updatedAt: "2026-11-04T10:00:05.000Z" } })]);
checks.push(["server copy not loaded → save", !can({ serverOrder: undefined })]);
checks.push(["save returned no updatedAt → save", !can({ lastSave: { ...last, updatedAt: null } })]);
checks.push(["already paid → save (the server will refuse with the real reason)", !can({ serverOrder: { ...server, paymentStatus: "paid" } })]);
checks.push(["cancelled → save (the server will refuse with the real reason)", !can({ serverOrder: { ...server, status: "cancelled" } })]);
checks.push(["no order id → save", !can({ orderId: null })]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? `\nAll ${checks.length} checks passed.` : `\n${failed} of ${checks.length} checks FAILED.`);
process.exit(failed === 0 ? 0 : 1);
