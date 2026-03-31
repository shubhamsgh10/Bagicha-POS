import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  User,
  Phone,
  FileText,
  IndianRupee,
  ShoppingBag,
  Clock,
  Hash,
} from "lucide-react";
import type { EnrichedTable } from "@/hooks/useLiveTables";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value: string | number | null | undefined): string {
  const n = parseFloat(String(value ?? 0));
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
  }).format(n);
}

function getElapsedLabel(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

// ── Status maps ───────────────────────────────────────────────────────────────

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Pending",   cls: "bg-amber-50  text-amber-600  border-amber-200" },
  running:   { label: "Running",   cls: "bg-blue-50   text-blue-600   border-blue-200" },
  served:    { label: "Served",    cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  cancelled: { label: "Cancelled", cls: "bg-red-50    text-red-600    border-red-200" },
  hold:      { label: "On Hold",   cls: "bg-gray-50   text-gray-500   border-gray-200" },
};

const PAY_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Unpaid", cls: "bg-red-50    text-red-600    border-red-200" },
  paid:    { label: "Paid",   cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface TableDrawerProps {
  table: EnrichedTable | null;
  onClose: () => void;
}

export function TableDrawer({ table, onClose }: TableDrawerProps) {
  const order = table?.order ?? null;

  return (
    <AnimatePresence>
      {table && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed right-0 top-0 h-full w-[390px] max-w-[95vw] flex flex-col bg-white/92 backdrop-blur-xl border-l border-white/40 shadow-2xl z-50"
          >
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="shrink-0 flex items-start justify-between px-5 py-4 border-b border-gray-100/80">
              <div>
                <h2 className="text-lg font-bold text-gray-900 leading-tight">
                  {table.name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5 capitalize">
                  {table.section} section · Seats {table.capacity}
                </p>
              </div>
              <button
                onClick={onClose}
                className="mt-0.5 p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* ── Body ───────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {order ? (
                <>
                  {/* Order header row */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Hash className="w-3.5 h-3.5" />
                      <span className="text-sm font-semibold">{order.orderNumber}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          (ORDER_STATUS[order.status] ?? ORDER_STATUS.pending).cls
                        }`}
                      >
                        {(ORDER_STATUS[order.status] ?? ORDER_STATUS.pending).label}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          (PAY_STATUS[order.paymentStatus] ?? PAY_STATUS.pending).cls
                        }`}
                      >
                        {(PAY_STATUS[order.paymentStatus] ?? PAY_STATUS.pending).label}
                      </span>
                    </div>
                  </div>

                  {/* Time elapsed */}
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>Started {getElapsedLabel(order.createdAt)}</span>
                  </div>

                  {/* Customer info */}
                  {(order.customerName || order.customerPhone) && (
                    <div className="bg-gray-50/80 rounded-xl p-3 space-y-1.5 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Customer
                      </p>
                      {order.customerName && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="font-medium">{order.customerName}</span>
                        </div>
                      )}
                      {order.customerPhone && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>{order.customerPhone}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order items */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Items ({order.items.length})
                    </p>
                    <div className="rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
                      {order.items.map(item => (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 px-3 py-2.5 bg-white/60"
                        >
                          {/* Qty badge */}
                          <span className="shrink-0 mt-0.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-md px-1.5 py-0.5 min-w-[28px] text-center">
                            ×{item.quantity}
                          </span>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {item.name}
                            </p>
                            {item.size && (
                              <p className="text-[11px] text-gray-400">{item.size}</p>
                            )}
                            {item.specialInstructions && (
                              <p className="text-[11px] text-amber-600 italic mt-0.5">
                                "{item.specialInstructions}"
                              </p>
                            )}
                          </div>

                          <span className="shrink-0 text-sm font-semibold text-gray-700">
                            {fmt(parseFloat(item.price) * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Order notes */}
                  {order.notes && (
                    <div className="bg-amber-50/80 border border-amber-100 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <p className="text-xs font-semibold text-amber-600">Order Notes</p>
                      </div>
                      <p className="text-sm text-amber-800 leading-relaxed">{order.notes}</p>
                    </div>
                  )}
                </>
              ) : (
                /* No active order */
                <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                  <ShoppingBag className="w-14 h-14 mb-4" />
                  <p className="text-sm font-semibold text-gray-400">No active order</p>
                  <p className="text-xs text-gray-300 mt-1">This table is currently available</p>
                </div>
              )}
            </div>

            {/* ── Footer — totals ─────────────────────────────────────────── */}
            {order && (
              <div className="shrink-0 border-t border-gray-100 px-5 py-4 bg-white/70 backdrop-blur-sm space-y-1.5">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Subtotal</span>
                  <span>
                    {fmt(
                      parseFloat(order.totalAmount) - parseFloat(order.taxAmount)
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Tax</span>
                  <span>{fmt(order.taxAmount)}</span>
                </div>
                {parseFloat(order.discountAmount ?? "0") > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600">
                    <span>Discount</span>
                    <span>−{fmt(order.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
                  <span>Total</span>
                  <div className="flex items-center gap-0.5">
                    <IndianRupee className="w-4 h-4" />
                    <span>
                      {parseFloat(order.totalAmount).toLocaleString("en-IN", {
                        minimumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
