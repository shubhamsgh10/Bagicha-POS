import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Phone, ChevronDown, ChevronUp } from "lucide-react";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeliveryStatus = "preparing" | "ready" | "dispatched" | "delivered";
export type PickupStatus   = "preparing" | "ready" | "collected";

export interface UnifiedItem {
  id: number;
  name: string;
  quantity: number;
  size?: string | null;
  specialInstructions?: string | null;
}

export interface UnifiedOrder {
  key: string;
  orderId: number | null;
  orderNumber: string | null;
  type: "dine-in" | "delivery" | "pickup";

  // Dine-in
  tableId?: number;
  tableName?: string;
  section?: string;
  tableStatus?: string;

  // Delivery / Pickup
  customerName?: string | null;
  customerPhone?: string | null;
  totalAmount?: number;

  startTime: string | null;
  items: UnifiedItem[];
  hasNewItems: boolean;
  lastUpdated: number;
  currentStatus?: DeliveryStatus | PickupStatus;
}

interface OrderCardProps {
  order: UnifiedOrder;
  index: number;
  restaurantName: string;
  onStatusChange: (orderId: number, orderType: string, status: string) => void;
}

// ── Live timer — counts up every second ──────────────────────────────────────

function LiveTimer({ startTime }: { startTime: string }) {
  const getElapsed = () =>
    Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000));
  const [elapsed, setElapsed] = useState(getElapsed);
  useEffect(() => {
    setElapsed(getElapsed());
    const id = setInterval(() => setElapsed(getElapsed()), 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return (
    <span>
      {h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`}
    </span>
  );
}

// ── Per-type config ───────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  "dine-in": {
    headerBg:    "bg-[#eef7ee]",
    iconBg:      "bg-green-600",
    iconEmoji:   "🍽️",
    label:       "Dine In",
    labelColor:  "text-green-700",
    borderLeft:  "border-l-4 border-l-green-500",
  },
  "delivery": {
    headerBg:    "bg-[#eef2fb]",
    iconBg:      "bg-blue-600",
    iconEmoji:   "🛵",
    label:       "Delivery",
    labelColor:  "text-blue-700",
    borderLeft:  "border-l-4 border-l-blue-500",
  },
  "pickup": {
    headerBg:    "bg-[#fef3ea]",
    iconBg:      "bg-orange-500",
    iconEmoji:   "📦",
    label:       "Pick Up",
    labelColor:  "text-orange-600",
    borderLeft:  "border-l-4 border-l-orange-400",
  },
};

// ── Next action button resolver ───────────────────────────────────────────────

function getNextAction(type: "delivery" | "pickup", status: string) {
  if (type === "delivery") {
    if (status === "preparing")  return { label: "Food Is Ready",  next: "ready",      cls: "bg-orange-500 hover:bg-orange-600 text-white border-transparent" };
    if (status === "ready")      return { label: "Dispatch",        next: "dispatched", cls: "bg-blue-600 hover:bg-blue-700 text-white border-transparent" };
    if (status === "dispatched") return { label: "Mark Delivered",  next: "delivered",  cls: "bg-emerald-600 hover:bg-emerald-700 text-white border-transparent" };
    return { label: "Delivered ✓", next: null, cls: "bg-gray-50 text-gray-400 border-gray-200 cursor-default" };
  } else {
    if (status === "preparing") return { label: "Food Is Ready",  next: "ready",     cls: "bg-orange-500 hover:bg-orange-600 text-white border-transparent" };
    if (status === "ready")     return { label: "Mark Collected", next: "collected", cls: "bg-emerald-600 hover:bg-emerald-700 text-white border-transparent" };
    return { label: "Collected ✓", next: null, cls: "bg-gray-50 text-gray-400 border-gray-200 cursor-default" };
  }
}

// ── OrderCard ─────────────────────────────────────────────────────────────────

export function OrderCard({ order, index, restaurantName, onStatusChange }: OrderCardProps) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);

  const cfg           = TYPE_CONFIG[order.type];
  const currentStatus = order.currentStatus ?? "preparing";
  const nextAction    = order.type !== "dine-in" ? getNextAction(order.type, currentStatus) : null;
  const visibleItems  = expanded ? order.items : order.items.slice(0, 8);
  const hiddenCount   = order.items.length - 8;

  const handleNavigateToPOS = useCallback(() => {
    if (order.tableId && order.orderId) {
      navigate(`/pos?tableId=${order.tableId}&orderId=${order.orderId}&tableName=${encodeURIComponent(order.tableName ?? "")}`);
    } else if (order.orderId) {
      navigate(`/pos?orderId=${order.orderId}`);
    }
  }, [order, navigate]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,  scale: 1    }}
      exit={{    opacity: 0, scale: 0.95          }}
      transition={{ delay: Math.min(index * 0.025, 0.25), duration: 0.18, ease: "easeOut" }}
      className={`bg-white rounded-xl shadow-sm border border-gray-200 ${cfg.borderLeft} overflow-hidden flex flex-col ${
        order.hasNewItems ? "ring-2 ring-yellow-400/60 shadow-yellow-100" : ""
      }`}
    >
      {/* ═══════════════════════════════════════════════════════════
           HEADER — 3-column: outlet meta | centered badge | table info
      ═══════════════════════════════════════════════════════════ */}
      <div className={`${cfg.headerBg} px-3.5 pt-3 pb-3 relative`}>
        <div className="flex items-start gap-2">

          {/* LEFT: outlet name + KOT/BILL + staff/customer */}
          <div className="flex-1 min-w-0 space-y-1 pr-1">
            <p className="text-xs font-bold text-gray-800 leading-tight">{restaurantName}</p>
            {order.orderNumber && (
              <p className="text-[10px] text-gray-500 font-medium leading-tight">
                KOT: {order.orderNumber}{" "}
                <span className="text-gray-300 mx-0.5">|</span>{" "}
                BILL: <span className="font-bold text-gray-700">{order.orderNumber}</span>
              </p>
            )}
            {/* Staff / customer row */}
            {order.type === "dine-in" ? (
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <User className="w-3 h-3" />
                <span>Not Assigned</span>
              </div>
            ) : order.customerPhone ? (
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <Phone className="w-3 h-3" />
                <span>{order.customerPhone}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <User className="w-3 h-3" />
                <span>{order.customerName ?? "Walk-in"}</span>
              </div>
            )}
          </div>

          {/* CENTER: large circular icon + timer */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className={`w-11 h-11 rounded-full ${cfg.iconBg} flex items-center justify-center shadow-md relative`}>
              <span className="text-xl leading-none">{cfg.iconEmoji}</span>
              {/* New-order ping */}
              {order.hasNewItems && (
                <span className="absolute -top-0.5 -right-0.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400" />
                  </span>
                </span>
              )}
            </div>
            {/* Timer */}
            {order.startTime && (
              <div className="bg-white/80 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold text-gray-600 whitespace-nowrap">
                <LiveTimer startTime={order.startTime} />
              </div>
            )}
          </div>

          {/* RIGHT: table/order type + status/label */}
          <div className="flex-1 min-w-0 text-right space-y-1 pl-1">
            {order.type === "dine-in" ? (
              <>
                <p className="text-xs font-bold text-gray-800 leading-tight">
                  TABLE : {order.tableName ?? "—"}
                </p>
                <p className={`text-[10px] font-bold ${cfg.labelColor}`}>{cfg.label}</p>
                {order.tableStatus && (
                  <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                    order.tableStatus === "billed" ? "bg-yellow-100 text-yellow-700" : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {order.tableStatus === "billed" ? "Billing" : "Running"}
                  </span>
                )}
              </>
            ) : (
              <>
                <p className="text-[10px] font-bold text-gray-500 uppercase leading-tight">COD</p>
                <p className={`text-[10px] font-bold ${cfg.labelColor}`}>{cfg.label}</p>
                {order.currentStatus && (
                  <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                    currentStatus === "preparing"  ? "bg-amber-100 text-amber-700"   :
                    currentStatus === "ready"      ? "bg-green-100 text-green-700"   :
                    currentStatus === "dispatched" ? "bg-blue-100 text-blue-700"     :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {order.currentStatus}
                  </span>
                )}
              </>
            )}
          </div>

        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
           ITEMS — two-column grid
      ═══════════════════════════════════════════════════════════ */}
      <div className="flex-1 px-3.5 py-3 border-t border-gray-100">
        {order.type === "delivery" && (
          <p className="text-[10px] text-gray-400 italic mb-1.5">
            🚚 {order.customerName ?? "Customer"} will receive the delivery
          </p>
        )}
        {order.type === "pickup" && (
          <p className="text-[10px] text-gray-400 italic mb-1.5">
            📦 Customer will pick up the order
          </p>
        )}

        {order.items.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No items recorded</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {visibleItems.map((item, i) => (
                <div key={item.id ?? i} className="text-xs text-gray-700 leading-snug">
                  <span className="text-gray-500">{item.quantity} x </span>
                  {item.name}{item.size ? ` (${item.size})` : ""}
                  {item.specialInstructions && (
                    <span className="block text-[9px] text-amber-500 italic truncate">
                      📝 {item.specialInstructions}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!expanded && hiddenCount > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="mt-1.5 text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
                +{hiddenCount} more
              </button>
            )}
            {expanded && hiddenCount > 0 && (
              <button
                onClick={() => setExpanded(false)}
                className="mt-1.5 text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
                Show less
              </button>
            )}
          </>
        )}

        {/* Amount — bottom-right of items section (matches reference) */}
        {order.totalAmount !== undefined && (
          <p className="text-right text-sm font-bold text-gray-800 mt-3">
            ₹{order.totalAmount.toLocaleString("en-IN")}
          </p>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
           BUTTON STRIP — full-width buttons separated by divider
      ═══════════════════════════════════════════════════════════ */}
      <div className="shrink-0 border-t border-gray-100 flex">
        {/* Info */}
        <button
          onClick={handleNavigateToPOS}
          className="flex-none px-4 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 border-r border-gray-100 transition-colors"
        >
          Info
        </button>

        {/* Primary action — takes remaining space */}
        {order.type === "dine-in" ? (
          <button
            onClick={handleNavigateToPOS}
            className="flex-1 py-2.5 text-xs font-bold bg-gray-700 hover:bg-gray-800 text-white transition-colors"
          >
            Settle &amp; Save
          </button>
        ) : nextAction ? (
          <button
            disabled={!nextAction.next}
            onClick={() => {
              if (nextAction.next && order.orderId) {
                onStatusChange(order.orderId, order.type, nextAction.next);
              }
            }}
            className={`flex-1 py-2.5 text-xs font-bold border transition-colors ${nextAction.cls}`}
          >
            {nextAction.label}
          </button>
        ) : (
          <div className="flex-1 py-2.5 text-xs text-center text-gray-400">—</div>
        )}
      </div>
    </motion.div>
  );
}
