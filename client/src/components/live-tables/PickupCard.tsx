import { memo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, ChevronDown, ChevronUp } from "lucide-react";
import type { LiveOrder } from "@/hooks/useLiveOrders";

// ── Status types + config ─────────────────────────────────────────────────────

export type PickupStatus = "preparing" | "ready" | "collected";

export const PICKUP_STATUS_ORDER: PickupStatus[] = ["preparing", "ready", "collected"];

const STEPS: {
  key: PickupStatus;
  label: string;
  emoji: string;
  activeCls: string;
  doneCls: string;
}[] = [
  { key: "preparing", label: "Preparing", emoji: "🍳",
    activeCls: "bg-amber-500   text-white       border-amber-500",
    doneCls:   "bg-amber-50    text-amber-600   border-amber-200" },
  { key: "ready",     label: "Ready",     emoji: "✅",
    activeCls: "bg-green-500   text-white       border-green-500",
    doneCls:   "bg-green-50    text-green-600   border-green-200" },
  { key: "collected", label: "Collected", emoji: "📦",
    activeCls: "bg-orange-500  text-white       border-orange-500",
    doneCls:   "bg-orange-50   text-orange-600  border-orange-200" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsedLabel(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface PickupCardProps {
  order: LiveOrder;
  index: number;
  status: PickupStatus;
  onStatusChange: (s: PickupStatus) => void;
}

export const PickupCard = memo(function PickupCard({
  order,
  index,
  status,
  onStatusChange,
}: PickupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const statusIdx = PICKUP_STATUS_ORDER.indexOf(status);

  const cardBg =
    status === "collected" ? "bg-orange-50/80  border-orange-300/60" :
    status === "ready"     ? "bg-green-50/80   border-green-300/60"  :
                             "bg-white/80      border-gray-200/70";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1 }}
      exit={{    opacity: 0, scale: 0.93 }}
      transition={{ delay: index * 0.03, duration: 0.18, ease: "easeOut" }}
      className={`relative backdrop-blur-sm border rounded-2xl shadow-sm p-3.5 ${cardBg}`}
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      {/* Row 1: order number + ping | clock + items count */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">
            #{order.orderNumber}
          </span>
          {order.hasNewItems && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
            <Clock className="w-2.5 h-2.5" />
            {elapsedLabel(order.createdAt)}
          </span>
          <span className="text-[9px] text-gray-400">
            · {order.items.reduce((s, i) => s + i.quantity, 0)} items
          </span>
        </div>
      </div>
      {/* Row 2: customer name | amount */}
      <div className="flex items-end justify-between gap-2 mt-1">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 truncate leading-tight">
            {order.customerName ?? "Walk-in"}
          </p>
          {order.customerPhone && (
            <p className="text-[10px] text-gray-400 mt-0.5">{order.customerPhone}</p>
          )}
        </div>
        <p className="text-sm font-bold text-gray-800 shrink-0">
          ₹{order.totalAmount.toLocaleString("en-IN")}
        </p>
      </div>

      {/* ── Items (collapsible) ──────────────────────────────────── */}
      <div
        className="mt-2 pt-2 border-t border-black/5 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center justify-between gap-2">
          {!expanded ? (
            <p className="text-[10px] text-gray-500 truncate flex-1">
              {order.items.slice(0, 2)
                .map(i => `${i.quantity}× ${i.name}${i.size ? ` (${i.size})` : ""}`)
                .join("  ·  ")}
              {order.items.length > 2 && (
                <span className="text-gray-400"> +{order.items.length - 2}</span>
              )}
            </p>
          ) : (
            <span className="text-[10px] font-semibold text-gray-500">Items</span>
          )}
          {expanded
            ? <ChevronUp   className="w-3 h-3 text-gray-400 shrink-0" />
            : <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />}
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{    height: 0,      opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-1.5">
                {order.items.map(item => (
                  <div key={item.id} className="flex items-start gap-1.5">
                    <span className="shrink-0 text-[8px] font-bold bg-gray-100 text-gray-600 px-1 py-0.5 rounded min-w-[20px] text-center mt-0.5">
                      {item.quantity}×
                    </span>
                    <div className="min-w-0">
                      <span className="text-[11px] font-semibold text-gray-700">
                        {item.name}
                        {item.size && (
                          <span className="font-normal text-gray-400"> ({item.size})</span>
                        )}
                      </span>
                      {item.specialInstructions && (
                        <p className="text-[9px] text-amber-600 italic truncate">
                          {item.specialInstructions}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Status stepper ──────────────────────────────────────── */}
      <div className="mt-3 pt-2.5 border-t border-black/5 flex items-center gap-1 flex-wrap">
        {STEPS.map((step, i) => {
          const isCurrent = i === statusIdx;
          const isDone    = i  < statusIdx;
          return (
            <button
              key={step.key}
              onClick={() => onStatusChange(step.key)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-all active:scale-95 ${
                isCurrent ? step.activeCls :
                isDone    ? step.doneCls + " opacity-80" :
                "bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100"
              }`}
            >
              <span className="text-[11px] leading-none">{step.emoji}</span>
              <span>{step.label}</span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
});
