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
  // Diagnostic, not a business event: written by the POS when a Settle took >= 4s (POST
  // /api/perf/slow-settle) so a slow one can be explained afterwards. Not part of any report.
  "perf.slow_settle":     { label: "Slow Settle",    color: "bg-amber-100 text-amber-800" },
  // Same, for a KOT/Bill tap that took >= 3s (POST /api/perf/slow-print).
  "perf.slow_print":      { label: "Slow Print",     color: "bg-amber-100 text-amber-800" },
  // Diagnostics too (shared/requestTiming.ts): a client request >= 4s / timed out, and a server
  // handler >= 1.5s. Summarised by scripts/report-latency.ts.
  "perf.slow_request":    { label: "Slow Request",   color: "bg-amber-100 text-amber-800" },
  "perf.slow_handler":    { label: "Slow Handler",   color: "bg-amber-100 text-amber-800" },
  // The desktop stall breaker reset a dead connection and retried (POST /api/perf/stall-reset).
  "perf.stall_reset":     { label: "Connection Reset", color: "bg-amber-100 text-amber-800" },
  "order.payment":        { label: "Payment",        color: "bg-green-100 text-green-800" },
  "order.write_off":      { label: "Write-off",      color: "bg-red-100 text-red-800" },
  // Not red: the amount collected is unchanged by construction (shared/paymentEdit.ts) —
  // this is a corrected label, not money forgiven.
  "order.payment_method_edit": { label: "Payment Method Changed", color: "bg-indigo-100 text-indigo-800" },
  // A customer paying an open tab. Money IS collected here (unlike the correction above), so it is
  // green like a payment — a write-off, if any, gets its own red row.
  "order.due_settled":    { label: "Due Settled",    color: "bg-emerald-100 text-emerald-800" },
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
  "settings.bill_number_reset": { label: "Bill No. Reset", color: "bg-orange-100 text-orange-800" },
  "whatsapp.reply":       { label: "WhatsApp Reply", color: "bg-green-100 text-green-800" },
};

export function actionLabel(action: string): ActionLabel {
  return ACTION_LABELS[action] ?? { label: action, color: "bg-gray-100 text-gray-700" };
}

/** " · approved by rajbhaghel" when the row records whose PIN approved it (older rows don't). */
function approvedSuffix(meta: Record<string, unknown>): string {
  const by = meta.approvedBy as { name?: string; role?: string } | null | undefined;
  return by?.name ? ` · approved by ${by.name}` : "";
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
  if (action === "order.payment_method_edit") return `${meta.beforeLabel} → ${meta.afterLabel} (₹${meta.collectedTotal} unchanged) — ${meta.reason ?? ""}${approvedSuffix(meta)}`;
  if (action === "order.due_settled") {
    const short = Number(meta.shortfallAmount) > 0 ? ` (₹${meta.shortfallAmount} short)` : "";
    return `${meta.customerName ? `${meta.customerName} · ` : ""}Due ₹${meta.orderTotal} settled — ${meta.afterLabel}${short}${approvedSuffix(meta)}`;
  }
  if (action === "perf.slow_settle") {
    const secs = (ms: unknown) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "?");
    const legs = Array.isArray(meta.legs) ? (meta.legs as Array<Record<string, unknown>>) : [];
    const slowest = legs.find((l) => l.leg === meta.slowestLeg);
    const lag = typeof meta.startLagMs === "number" && meta.startLagMs >= 1500 ? ` · nothing was sent for the first ${secs(meta.startLagMs)}` : "";
    const cold = slowest && typeof slowest.coldMs === "number" ? `, cold start ${secs(slowest.coldMs)}` : "";
    const slow = slowest ? ` · slowest: ${slowest.leg} ${secs(slowest.durationMs)} (server ${slowest.serverMs ?? "?"}ms${cold}${slowest.instance ? `, instance ${slowest.instance}` : ""})` : "";
    const idle = typeof meta.idleMs === "number" ? ` · connection quiet ${secs(meta.idleMs)} before the click` : "";
    const net = meta.onlineAtClick === false ? " · browser was OFFLINE at click" : "";
    return `Settle took ${secs(meta.totalMs)} (${meta.outcome ?? "?"})${lag}${slow}${idle}${net}`;
  }
  if (action === "perf.slow_print") {
    const secs = (ms: unknown) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "?");
    const stages = (meta.stages ?? {}) as Record<string, unknown>;
    const server = (meta.server ?? {}) as Record<string, unknown>;
    const req = typeof stages.save_http === "number" ? stages.save_http : null;
    const srv = typeof server.app === "number" ? server.app : typeof server.total === "number" ? server.total : null;
    // The request's own time minus the server's handler time = time spent before/after the server
    // (network, a dead connection being detected, a cold instance starting).
    const split = req !== null && srv !== null ? ` · request ${secs(req)}, server ${secs(srv)} → ${secs(req - srv)} outside the server` : "";
    const idle = typeof meta.idleMs === "number" ? ` · connection quiet ${secs(meta.idleMs)} before the tap` : "";
    const net = meta.onlineAtClick === false ? " · browser was OFFLINE at click" : "";
    const resets = Number(meta.resets) > 0 ? ` · ${meta.resets} connection reset${Number(meta.resets) > 1 ? "s" : ""}` : "";
    const replayed = meta.replayed === true ? " · answer replayed" : "";
    return `${String(meta.kind ?? "print").toUpperCase()} tap took ${secs(meta.totalMs)}${split}${idle}${net}${resets}${replayed}`;
  }
  if (action === "perf.stall_reset") {
    const secs = (ms: unknown) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "?");
    const outcome =
      meta.retryOutcome === "ok" ? `retry ok in ${secs(meta.retryMs)}`
      : meta.retryOutcome === "not_retried" ? "not retried (write without a key)"
      : `retry failed after ${secs(meta.retryMs)}`;
    const idle = typeof meta.idleMs === "number" ? ` · connection quiet ~${secs(meta.idleMs)} before` : "";
    const hidden = Number(meta.hiddenResets) > 0 ? ` · +${meta.hiddenResets} while minimised` : "";
    return `${meta.method} ${meta.path}: dead connection reset after ${secs(meta.detectMs)}, ${outcome}${idle}${hidden}`;
  }
  if (action === "perf.slow_request") {
    const secs = (ms: unknown) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "?");
    const where = meta.timedOut ? "no response (timed out)" : `server ${meta.appMs ?? "?"}ms${typeof meta.coldMs === "number" ? `, cold start ${secs(meta.coldMs)}` : ""}`;
    const retry = Number(meta.attempt) > 1 ? " · retried" : "";
    return `${meta.method} ${meta.path} took ${secs(meta.clientMs)} (${where}) → ${meta.cause ?? "?"}${retry}${meta.connection ? ` · ${meta.connection}` : ""}`;
  }
  if (action === "perf.slow_handler") {
    return `${meta.method} ${meta.path} handler took ${meta.appMs}ms (status ${meta.status}${typeof meta.coldMs === "number" ? `, cold start ${meta.coldMs}ms` : ""})`;
  }
  if (action === "order.write_off") return `₹${meta.shortfallAmount} written off — collected ₹${meta.paidAmount} of ₹${meta.orderTotal}${approvedSuffix(meta)}`;
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
