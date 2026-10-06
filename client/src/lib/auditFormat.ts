/**
 * Shared audit-log formatting — extracted from client/src/components/AuditLogPanel.tsx
 * (the requireAdmin-gated generic audit browser, mounted in Settings.tsx) so
 * Reports.tsx's narrower, date-scoped "KOT & Bill Activity" tab can render the same
 * action labels/one-line summaries for its drill-down list without forking a second
 * copy of this ~15-branch formatter.
 */
import { paymentLabel } from "@shared/paymentSplit";

export interface ActionLabel {
  label: string;
  color: string;
}

export const ACTION_LABELS: Record<string, ActionLabel> = {
  "order.payment":        { label: "Payment",        color: "bg-green-100 text-green-800" },
  "order.write_off":      { label: "Write-off",      color: "bg-red-100 text-red-800" },
  // Not red: the amount collected is unchanged by construction (shared/paymentEdit.ts) —
  // this is a corrected label, not money forgiven.
  "order.payment_method_edit": { label: "Payment Method Changed", color: "bg-indigo-100 text-indigo-800" },
  "order.cancel":         { label: "Cancellation",   color: "bg-red-100 text-red-800" },
  "order.items_edit":     { label: "Bill Edited",    color: "bg-amber-100 text-amber-800" },
  // Deliberately a different color from "order.cancel" above — that's the whole order
  // voided, this is one line item removed after its KOT was already sent. Never conflate.
  "order.item_cancel":    { label: "Item Cancelled", color: "bg-orange-100 text-orange-800" },
  "order.discount_applied": { label: "Discount Applied", color: "bg-amber-100 text-amber-800" },
  "order.hold":           { label: "Order Held",     color: "bg-gray-100 text-gray-800" },
  "order.move_table":     { label: "Table Moved",    color: "bg-blue-100 text-blue-800" },
  "order.merge":          { label: "Orders Merged",  color: "bg-blue-100 text-blue-800" },
  "order.split":          { label: "Bill Split",     color: "bg-blue-100 text-blue-800" },
  "kot.reprint":          { label: "KOT Reprinted",  color: "bg-sky-100 text-sky-800" },
  "bill.reprint":         { label: "Bill Reprinted", color: "bg-sky-100 text-sky-800" },
  "order.coupon_applied": { label: "Coupon Applied", color: "bg-yellow-100 text-yellow-800" },
  "order.loyalty_redeemed": { label: "Loyalty Redeemed", color: "bg-amber-100 text-amber-800" },
  "user.create":          { label: "User Created",   color: "bg-blue-100 text-blue-800" },
  "user.update":          { label: "User Updated",   color: "bg-blue-100 text-blue-800" },
  "user.delete":          { label: "User Deleted",   color: "bg-red-100 text-red-800" },
  "user.pin_update":      { label: "PIN Changed",    color: "bg-orange-100 text-orange-800" },
  "user.pin_reset_all":   { label: "All PINs Reset", color: "bg-orange-100 text-orange-800" },
  "coupon.issue":         { label: "Coupon Issued",  color: "bg-purple-100 text-purple-800" },
  "settings.update":      { label: "Settings Changed", color: "bg-gray-100 text-gray-800" },
};

export function actionLabel(action: string): ActionLabel {
  return ACTION_LABELS[action] ?? { label: action, color: "bg-gray-100 text-gray-700" };
}

export function metaSummary(action: string, meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  // Was `meta.amount` — routes.ts's order.payment log has always written `paidAmount`, so
  // every payment row here rendered "₹undefined via cash". Pre-existing, fixed once.
  // routes.ts logs every leg as `paymentBreakdown` ({cash, upi}); `paymentMethod` is only the largest
  // leg, so a part payment used to read "₹63 via cash". Rows logged before that field existed lack it.
  if (action === "order.payment") {
    const via = paymentLabel({
      paymentStatus: "paid",
      paymentMethod: meta.paymentMethod as string | null | undefined,
      paymentBreakdown: meta.paymentBreakdown as Record<string, string | number> | null | undefined,
      paidAmount: meta.paidAmount as string | number | null | undefined,
      changeAmount: meta.changeAmount as string | number | null | undefined,
    }) || meta.paymentMethod;
    return `₹${meta.paidAmount} via ${via}${Number(meta.shortfallAmount) > 0 ? ` (₹${meta.shortfallAmount} short)` : ""}`;
  }
  if (action === "order.payment_method_edit") return `${meta.beforeLabel} → ${meta.afterLabel} (₹${meta.collectedTotal} unchanged) — ${meta.reason ?? ""}`;
  if (action === "order.write_off") return `₹${meta.shortfallAmount} written off — collected ₹${meta.paidAmount} of ₹${meta.orderTotal}`;
  if (action === "order.cancel") return `Order ${meta.orderNumber ?? ""} table ${meta.tableNumber ?? ""}`;
  if (action === "order.items_edit") {
    const added = (meta.added as unknown[])?.length ?? 0;
    const removed = (meta.removed as unknown[])?.length ?? 0;
    const changed = (meta.changed as unknown[])?.length ?? 0;
    return `+${added}/-${removed}/~${changed} · ₹${meta.totalBefore} → ₹${meta.totalAfter}`;
  }
  if (action === "order.item_cancel") return `${meta.itemName ?? "Item"}${meta.size ? ` (${meta.size})` : ""} × ${meta.quantity ?? "?"} — ${meta.reason ?? ""}`;
  if (action === "order.discount_applied") return `₹${meta.discountBefore} → ₹${meta.discountAfter}`;
  if (action === "order.hold") return `Order ${meta.orderNumber ?? ""} table ${meta.tableNumber ?? ""}`;
  if (action === "order.move_table") return `Order ${meta.orderNumber ?? ""}: ${meta.fromTable ?? "—"} → ${meta.toTable ?? "—"}`;
  if (action === "order.merge") return `${meta.sourceOrderNumber} → ${meta.targetOrderNumber} · ₹${meta.totalBefore} → ₹${meta.totalAfter}`;
  if (action === "order.split") return `${meta.sourceOrderNumber} → ${meta.newOrderNumber} · ${meta.itemCount} item(s) · ₹${meta.splitTotal}`;
  if (action === "kot.reprint") return `KOT #${meta.kotNumber ?? "—"} reprinted`;
  if (action === "bill.reprint") return `Bill reprinted`;
  if (action === "order.coupon_applied") return `Coupon #${meta.couponId} → ₹${meta.discount} off`;
  if (action === "order.loyalty_redeemed") return `${meta.points} pts → ₹${meta.discount} off`;
  if (action === "user.create") return `${meta.username} (${meta.role})`;
  if (action === "user.update") return `Fields: ${(meta.fields as string[])?.join(", ")}`;
  if (action === "user.pin_reset_all") return `${meta.count} users cleared`;
  if (action === "user.pin_update") return meta.cleared ? "PIN cleared" : "PIN set";
  if (action === "coupon.issue") return `${meta.code} — ${meta.type} ₹${meta.value}`;
  if (action === "settings.update") return `Fields: ${(meta.fields as string[])?.join(", ")}`;
  return JSON.stringify(meta).slice(0, 60);
}
