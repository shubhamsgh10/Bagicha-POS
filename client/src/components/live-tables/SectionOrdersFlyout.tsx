import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LiveOrder } from "@/hooks/useLiveOrders";
import { OrderRailCard } from "./LiveOrdersPanel";

/**
 * Tap flyout for a quick-POS section card (e.g. the South Indian counter).
 * Wraps the section card (children) and floats its open orders in front of it —
 * same visual language as the right-edge pickup/delivery rail panel, amber-themed.
 *
 * Tapping the count badge opens it; tapping the card itself always starts a new order.
 */
export function SectionOrdersFlyout({
  sectionId,
  sectionName,
  orders,
  children,
  onNewOrder,
}: {
  sectionId: string;
  sectionName: string;
  orders: LiveOrder[];
  children: React.ReactNode;
  onNewOrder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Single 30-second tick refreshes the elapsed labels on child cards
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Close when the last open order settles away
  useEffect(() => {
    if (orders.length === 0) setOpen(false);
  }, [orders.length]);

  // Tap-away close
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`relative ${open ? "z-30" : ""}`}
    >
      <div onClick={onNewOrder} className="h-full">
        {children}
      </div>

      {/* Count badge — the only way to open. Open-only (never toggle): touch devices
          emulate mouseenter before click, so a toggle would open-then-close on a single
          tap. Closing is tap-away. stopPropagation keeps card tap = new order. */}
      {orders.length > 0 && (
        <button
          onClick={e => { e.stopPropagation(); setOpen(true); }}
          className="absolute -top-2 -right-2 min-w-[28px] h-7 px-1.5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          aria-label={`${orders.length} open order${orders.length !== 1 ? "s" : ""} — show`}
        >
          {orders.length}
        </button>
      )}

      {/* Floating panel — in front of the section card, anchored below-left */}
      <AnimatePresence>
        {open && orders.length > 0 && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.15, ease: "easeInOut" } }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="absolute left-0 top-[calc(100%+6px)] z-50 rounded-2xl shadow-2xl overflow-hidden"
            style={{
              width: "min(284px, calc(100vw - 1.5rem))",
              border: "1px solid rgba(229,231,235,0.75)",
              background: "var(--paper-0)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="px-3 py-2 border-b border-gray-100 bg-amber-50">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                🍲 {sectionName} · {orders.length} open
              </span>
            </div>
            <div className="p-2.5 space-y-2.5" style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
              <AnimatePresence initial={false}>
                {orders.map((order, i) => (
                  <OrderRailCard
                    key={order.id}
                    order={order}
                    index={i}
                    posUrl={`/pos?orderId=${order.id}&section=${encodeURIComponent(sectionId)}&sectionName=${encodeURIComponent(sectionName)}`}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
