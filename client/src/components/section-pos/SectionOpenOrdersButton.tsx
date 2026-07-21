import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ClipboardList } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLiveOrders } from "@/hooks/useLiveOrders";
import { OrderRailCard } from "@/components/live-tables/LiveOrdersPanel";

/**
 * Top-bar entry point for a section counter's OTHER open orders (e.g. South Indian).
 * Replaces the Tables-page hover/tap flyout (SectionOrdersFlyout) for this context —
 * that flyout is anchored to a small card and relies on hover/tap-away, which isn't
 * usable on a phone. This opens a full dialog instead: reliable on touch, scrollable,
 * reuses the same OrderRailCard the flyout and the pickup/delivery rail already use.
 */
export function SectionOpenOrdersButton({
  sectionId,
  sectionName,
  currentOrderId,
}: {
  sectionId: string;
  sectionName: string;
  currentOrderId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const { sectionOrders } = useLiveOrders();
  const orders = (sectionOrders[sectionId] ?? []).filter((o) => o.id !== currentOrderId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg hover:bg-amber-100 active:scale-[0.97] transition-all shrink-0"
      >
        <ClipboardList className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Open Orders</span>
        {orders.length > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
            {orders.length}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden rounded-2xl max-h-[85vh] flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-gray-100 bg-amber-50 text-left space-y-0.5 shrink-0">
            <DialogTitle className="text-sm font-bold text-amber-800">
              🍲 {sectionName} · {orders.length} Open
            </DialogTitle>
            <DialogDescription className="text-xs text-amber-600">
              Tap an order to view, print, or settle it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {orders.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No other open orders right now.</p>
            ) : (
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
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
