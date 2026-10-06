/**
 * The compact "how was this paid" tag on an order row.
 *
 * Colours match the Tables-page Sales pill (cash = emerald, UPI = indigo) so the same money
 * reads the same way everywhere. A part payment gets a neutral pill carrying BOTH dots
 * rather than a third invented colour — the exact ₹ split is in the expanded order.
 *
 * Methods come from shared/paymentSplit.ts's collectedByMethod, never orders.paymentMethod,
 * which is only the largest leg's label (see CLAUDE.md's Reports section).
 */
import { collectedByMethod, methodName } from "@shared/paymentSplit";

const STYLE: Record<string, { pill: string; dot: string }> = {
  cash: { pill: "bg-emerald-100/70 text-emerald-700", dot: "bg-emerald-500" },
  upi:  { pill: "bg-indigo-100/70 text-indigo-700",   dot: "bg-indigo-500" },
};
const NEUTRAL = { pill: "bg-[var(--paper-100)] text-gray-600 border border-[var(--line)]", dot: "bg-gray-400" };

const BASE = "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-lg whitespace-nowrap";

/** Cash before UPI; anything unexpected (a legacy card row) sorts last. */
const ORDER = ["cash", "upi"];
const byOrder = (a: string, b: string) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
};

export function PaymentTag({ order, className = "" }: { order: any; className?: string }) {
  // A cancelled order collected nothing and must never look like it did.
  if (order?.status === "cancelled") return null;

  if (order?.paymentStatus === "pending" && order?.status === "served") {
    return (
      <span className={`${BASE} bg-amber-100/70 text-amber-700 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Due
      </span>
    );
  }
  if (order?.paymentStatus !== "paid") return null;

  const methods = Object.keys(collectedByMethod(order)).sort(byOrder);
  if (methods.length === 0) return null;

  if (methods.length === 1) {
    const s = STYLE[methods[0]] ?? NEUTRAL;
    return (
      <span className={`${BASE} ${s.pill} ${className}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        {methodName(methods[0])}
      </span>
    );
  }

  return (
    <span className={`${BASE} ${NEUTRAL.pill} ${className}`}>
      <span className="flex items-center gap-0.5">
        {methods.map(m => (
          <span key={m} className={`w-1.5 h-1.5 rounded-full ${(STYLE[m] ?? NEUTRAL).dot}`} />
        ))}
      </span>
      {methods.map(methodName).join(" + ")}
    </span>
  );
}
