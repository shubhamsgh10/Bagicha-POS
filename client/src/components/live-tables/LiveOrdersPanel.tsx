import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import type { LiveOrder } from "@/hooks/useLiveOrders";
import { serialNum } from "@/lib/orderDisplay";

// ── Status badge map ──────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:    { bg: "bg-yellow-50",  text: "text-yellow-700",  label: "Pending"    },
  preparing:  { bg: "bg-amber-50",   text: "text-amber-700",   label: "Preparing"  },
  ready:      { bg: "bg-green-50",   text: "text-green-700",   label: "Ready"      },
  dispatched: { bg: "bg-blue-50",    text: "text-blue-700",    label: "Dispatched" },
  delivered:  { bg: "bg-emerald-50", text: "text-emerald-700", label: "Delivered"  },
  collected:  { bg: "bg-green-50",   text: "text-green-700",   label: "Collected"  },
  served:     { bg: "bg-gray-100",   text: "text-gray-500",    label: "Served"     },
  hold:       { bg: "bg-orange-50",  text: "text-orange-700",  label: "On Hold"    },
};

function getStatus(s: string) {
  return STATUS_BADGE[s] ?? { bg: "bg-gray-100", text: "text-gray-500", label: s };
}

// Pure function — called during render; re-renders come from RailSection's single tick timer
function getElapsed(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000);
  if (mins < 1) return "just now";
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m ago`;
}

// ── Open POS button — icon expands into text on hover ────────────────────────

function OpenPOSButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className="relative flex items-center justify-end overflow-hidden rounded-lg bg-gray-900 hover:bg-gray-700 text-white shrink-0 transition-colors"
      style={{ height: 24 }}
      initial={{ width: 24 }}
      animate={{ width: hovered ? 86 : 24 }}
      transition={{ type: "spring", stiffness: 520, damping: 36 }}
    >
      {/* Text slides in from left as button expands */}
      <motion.span
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.12 }}
        className="absolute left-[7px] text-[10px] font-semibold whitespace-nowrap pointer-events-none"
      >
        Open POS
      </motion.span>
      <ArrowRight className="w-3 h-3 mr-[5px] shrink-0" />
    </motion.button>
  );
}

// ── Individual order card inside the expanded rail panel ──────────────────────

function OrderRailCard({ order, index }: { order: LiveOrder; index: number }) {
  const [, navigate] = useLocation();
  const elapsed = getElapsed(order.createdAt);
  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
  const status = getStatus(order.status);
  const isDelivery = order.orderType === "delivery";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.93 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 380, damping: 28 }}
      className="rounded-xl border border-gray-100 bg-white p-2.5 space-y-1.5 shadow-sm"
    >
      {/* Order number + status badge */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-gray-900 truncate">{serialNum(order.id)}</span>
        <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </div>

      {/* Customer name + phone */}
      <div className="text-[11px] text-gray-500 leading-tight truncate">
        {order.customerName || "Guest"}
        {order.customerPhone ? ` · ${order.customerPhone}` : ""}
      </div>

      {/* Address preview — delivery only, sourced from notes */}
      {isDelivery && order.notes && (
        <div className="text-[10px] text-gray-400 truncate">
          📍 {order.notes.length > 30 ? `${order.notes.substring(0, 30)}…` : order.notes}
        </div>
      )}

      {/* Meta row + Open POS */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[10px] text-gray-400 min-w-0">
          <span className="shrink-0">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
          <span className="text-gray-200 shrink-0">·</span>
          <span className="font-semibold text-gray-700 shrink-0">₹{order.totalAmount.toFixed(0)}</span>
          <span className="text-gray-200 shrink-0">·</span>
          <span className="shrink-0">{elapsed}</span>
        </div>
        <OpenPOSButton onClick={() => navigate(`/pos?orderId=${order.id}&mode=${order.orderType}`)} />
      </div>

      {/* New items pulse — auto-clears after 6 s (managed by useLiveOrders) */}
      {order.hasNewItems && (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span className="text-[9px] text-emerald-600 font-semibold">New items added</span>
        </div>
      )}
    </motion.div>
  );
}

// ── Rail section: tab + expandable card panel ────────────────────────────────

interface TypeConfig {
  emoji:      string;
  label:      string;
  accentHex:  string;
  tabActiveBg:     string;
  tabActiveBorder: string;
  panelHeadBg:  string;
  panelHeadText: string;
}

const TYPE_CFG: Record<"pickup" | "delivery", TypeConfig> = {
  pickup: {
    emoji:           "📦",
    label:           "Pickup",
    accentHex:       "#f97316",
    tabActiveBg:     "rgba(249,115,22,0.10)",
    tabActiveBorder: "rgba(249,115,22,0.32)",
    panelHeadBg:     "bg-orange-50",
    panelHeadText:   "text-orange-700",
  },
  delivery: {
    emoji:           "🛵",
    label:           "Delivery",
    accentHex:       "#3b82f6",
    tabActiveBg:     "rgba(59,130,246,0.10)",
    tabActiveBorder: "rgba(59,130,246,0.32)",
    panelHeadBg:     "bg-blue-50",
    panelHeadText:   "text-blue-700",
  },
};

const PANEL_W = 284;

function RailSection({ type, orders }: { type: "pickup" | "delivery"; orders: LiveOrder[] }) {
  const [open, setOpen] = useState(false);
  const cfg = TYPE_CFG[type];
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single 30-second tick causes all child cards to re-render their elapsed time
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleEnter = () => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setOpen(true);
  };

  const handleLeave = () => {
    // 80 ms grace period prevents flicker when cursor crosses the gap between tab and panel
    leaveTimer.current = setTimeout(() => setOpen(false), 80);
  };

  return (
    // pointer-events-auto so this section receives mouse events through the parent's pointer-events-none
    <div
      className="flex flex-row items-start pointer-events-auto"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Expanding panel — sits LEFT of the tab, grows toward the left */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: PANEL_W, opacity: 1 }}
            exit={{ width: 0, opacity: 0, transition: { duration: 0.18, ease: "easeInOut" } }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="overflow-hidden rounded-l-2xl shadow-2xl"
            style={{
              borderLeft:     "1px solid rgba(229,231,235,0.75)",
              borderTop:      "1px solid rgba(229,231,235,0.75)",
              borderBottom:   "1px solid rgba(229,231,235,0.75)",
              background:     "rgba(255,255,255,0.97)",
              backdropFilter: "blur(12px)",
            }}
          >
            {/* Fixed-width inner wrapper prevents content from squishing during width animation */}
            <div style={{ width: PANEL_W }}>
              <div className={`px-3 py-2 border-b border-gray-100 ${cfg.panelHeadBg}`}>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.panelHeadText}`}>
                  {cfg.emoji} {cfg.label} · {orders.length} order{orders.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div
                className="p-2.5 space-y-2.5"
                style={{ maxHeight: "calc(100vh - 12rem)", overflowY: "auto" }}
              >
                <AnimatePresence initial={false}>
                  {orders.map((order, i) => (
                    <OrderRailCard key={order.id} order={order} index={i} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rail tab — always visible, flush with right edge of screen */}
      <motion.div
        className="w-10 flex flex-col items-center justify-center gap-1.5 py-4 rounded-l-xl cursor-pointer select-none"
        animate={{ backgroundColor: open ? cfg.tabActiveBg : "rgba(255,255,255,0.88)" }}
        transition={{ duration: 0.15 }}
        style={{
          backdropFilter:  "blur(10px)",
          borderLeft:   `1px solid ${open ? cfg.tabActiveBorder : "rgba(229,231,235,0.70)"}`,
          borderTop:    `1px solid ${open ? cfg.tabActiveBorder : "rgba(229,231,235,0.70)"}`,
          borderBottom: `1px solid ${open ? cfg.tabActiveBorder : "rgba(229,231,235,0.70)"}`,
          boxShadow: open
            ? `-4px 0 20px ${cfg.accentHex}1A, 0 2px 8px rgba(0,0,0,0.06)`
            : "-2px 0 12px rgba(0,0,0,0.07)",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        }}
      >
        <span className="text-base leading-none">{cfg.emoji}</span>
        <span
          className="text-[11px] font-bold tabular-nums"
          style={{
            color: open ? cfg.accentHex : "#6b7280",
            transition: "color 0.15s ease",
          }}
        >
          {orders.length}
        </span>
      </motion.div>
    </div>
  );
}

// ── Mobile horizontal strip ───────────────────────────────────────────────────

function MobileStrip({ deliveryOrders, pickupOrders }: { deliveryOrders: LiveOrder[]; pickupOrders: LiveOrder[] }) {
  const [, navigate] = useLocation();
  const all = [...deliveryOrders, ...pickupOrders];
  if (all.length === 0) return null;

  return (
    <div className="md:hidden w-full mb-1">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Live Orders</span>
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">
          {all.length}
        </span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {all.map((order, i) => {
          const isDelivery = order.orderType === "delivery";
          const itemCount = order.items.reduce((s, item) => s + item.quantity, 0);
          const status = getStatus(order.status);
          return (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, scale: 0.9, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: i * 0.04, type: "spring", stiffness: 400, damping: 28 }}
              className="shrink-0 w-48 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isDelivery ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                  {isDelivery ? "🛵 Delivery" : "📦 Pickup"}
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${status.bg} ${status.text}`}>
                  {status.label}
                </span>
              </div>
              <div className="text-xs font-bold text-gray-800 truncate mb-0.5">{serialNum(order.id)}</div>
              <div className="text-[10px] text-gray-500 truncate mb-2.5">
                {order.customerName || "Guest"} · {itemCount} item{itemCount !== 1 ? "s" : ""} · ₹{order.totalAmount.toFixed(0)}
              </div>
              <button
                onClick={() => navigate(`/pos?orderId=${order.id}&mode=${order.orderType}`)}
                className="w-full text-[10px] font-bold py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 active:scale-95 transition-all"
              >
                Open POS →
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Exported components (keep same names so Tables.tsx needs no changes) ──────

interface RailProps {
  deliveryOrders: LiveOrder[];
  pickupOrders: LiveOrder[];
}

/**
 * Desktop floating rail — replaces the old fixed panel.
 * Renders compact tabs on the right edge; each tab expands leftward on hover
 * revealing live order cards. pointer-events-none on the container ensures
 * the table grid underneath remains fully interactive.
 */
export function LiveOrdersPanel({ deliveryOrders, pickupOrders }: RailProps) {
  if (deliveryOrders.length === 0 && pickupOrders.length === 0) return null;

  return (
    <div className="hidden md:flex fixed right-0 top-14 z-40 flex-col gap-3 pointer-events-none">
      {pickupOrders.length > 0 && (
        <RailSection type="pickup" orders={pickupOrders} />
      )}
      {deliveryOrders.length > 0 && (
        <RailSection type="delivery" orders={deliveryOrders} />
      )}
    </div>
  );
}

/**
 * Mobile horizontal scrollable strip — shown only below the md breakpoint.
 * Renders inside the Tables page <main> flow, above the table grid.
 */
export function LiveOrdersStrip({ deliveryOrders, pickupOrders }: RailProps) {
  return <MobileStrip deliveryOrders={deliveryOrders} pickupOrders={pickupOrders} />;
}
