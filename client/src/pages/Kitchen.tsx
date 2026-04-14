/**
 * Kitchen.tsx — Drag-and-drop Kanban kitchen management board
 *
 * Status columns:
 *   Preparing (amber) → Ready (green) → Dispatched (blue) → Delivered/Collected (gray)
 *
 * Uses existing hooks (no backend changes):
 *   - useLiveTableOperations  → dine-in tables (real-time via WS)
 *   - useLiveOrders           → delivery / pickup orders (real-time via WS)
 *   - localStorage            → status persistence (same pattern as LiveTablesDashboard)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UtensilsCrossed, Bike, Package, Clock, RefreshCw,
  Wifi, WifiOff, GripVertical, ChevronRight, Volume2, VolumeX,
  CheckCircle2, Truck, Timer,
} from "lucide-react";
import { useLiveTableOperations } from "@/hooks/useLiveTableOperations";
import { useLiveOrders }           from "@/hooks/useLiveOrders";

// ── Types ─────────────────────────────────────────────────────────────────────

type KitchenStatus =
  | "preparing"   // amber — cooking
  | "ready"       // green — kitchen done
  | "dispatched"  // blue  — delivery out / pickup waiting
  | "done";       // gray  — delivered or collected

interface KitchenOrder {
  key: string;
  orderId: number | null;
  orderNumber: string | null;
  type: "dine-in" | "delivery" | "pickup";
  label: string;       // table name or customer name
  items: { name: string; quantity: number; size?: string | null }[];
  startTime: string | null;
  hasNewItems: boolean;
  status: KitchenStatus;
  totalAmount?: number;
}

// ── Column config ─────────────────────────────────────────────────────────────

interface ColumnDef {
  id: KitchenStatus;
  label: string;
  color: string;           // bg of column header
  textColor: string;
  borderColor: string;     // left border of card
  emptyLabel: string;
  icon: any;
}

const COLUMNS: ColumnDef[] = [
  {
    id: "preparing",
    label: "Preparing",
    color: "bg-amber-50",
    textColor: "text-amber-700",
    borderColor: "border-l-amber-400",
    emptyLabel: "No orders being prepared",
    icon: Timer,
  },
  {
    id: "ready",
    label: "Ready",
    color: "bg-green-50",
    textColor: "text-green-700",
    borderColor: "border-l-green-500",
    emptyLabel: "No orders ready yet",
    icon: CheckCircle2,
  },
  {
    id: "dispatched",
    label: "Dispatched",
    color: "bg-blue-50",
    textColor: "text-blue-700",
    borderColor: "border-l-blue-500",
    emptyLabel: "No orders dispatched",
    icon: Truck,
  },
  {
    id: "done",
    label: "Delivered",
    color: "bg-gray-50",
    textColor: "text-gray-500",
    borderColor: "border-l-gray-300",
    emptyLabel: "No completed orders",
    icon: CheckCircle2,
  },
];

// ── localStorage helpers ──────────────────────────────────────────────────────

const KIT_LS = "bagicha_kitchen";

function readKitchenMap(): Record<string, KitchenStatus> {
  try { return JSON.parse(localStorage.getItem(KIT_LS) ?? "{}"); } catch { return {}; }
}
function writeKitchenMap(map: Record<string, KitchenStatus>) {
  try { localStorage.setItem(KIT_LS, JSON.stringify(map)); } catch { /* ignore */ }
}

// ── Live elapsed timer ────────────────────────────────────────────────────────

function ElapsedTimer({ startTime, warn }: { startTime: string; warn?: boolean }) {
  const calc = () => Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000));
  const [s, setS] = useState(calc);
  useEffect(() => {
    setS(calc());
    const id = setInterval(() => setS(calc()), 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime]);

  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const display = h > 0
    ? `${h}h ${m % 60}m`
    : m > 0
    ? `${m}m ${s % 60}s`
    : `${s}s`;

  const isLate = m >= 15;
  return (
    <span className={`text-[10px] font-mono font-semibold ${
      isLate ? "text-red-500" : warn ? "text-amber-600" : "text-gray-400"
    }`}>
      {display}
    </span>
  );
}

// ── Type icon ─────────────────────────────────────────────────────────────────

function TypeIcon({ type }: { type: "dine-in" | "delivery" | "pickup" }) {
  if (type === "delivery") return <Bike className="w-3.5 h-3.5 text-blue-500" />;
  if (type === "pickup")   return <Package className="w-3.5 h-3.5 text-orange-500" />;
  return <UtensilsCrossed className="w-3.5 h-3.5 text-green-600" />;
}

// ── Draggable order card ──────────────────────────────────────────────────────

function KitchenCard({
  order,
  onDragStart,
  colDef,
}: {
  order: KitchenOrder;
  onDragStart: (e: React.DragEvent, key: string) => void;
  colDef: ColumnDef;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      draggable
      onDragStart={(e: any) => onDragStart(e, order.key)}
      className={`
        bg-white rounded-xl border border-gray-100 border-l-4
        ${colDef.borderColor}
        shadow-sm cursor-grab active:cursor-grabbing select-none
        hover:shadow-md transition-shadow duration-150
        ${order.hasNewItems ? "ring-2 ring-amber-300 ring-offset-1" : ""}
      `}
    >
      {/* Header */}
      <div className={`px-3 pt-2.5 pb-2 rounded-t-xl ${colDef.color}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <TypeIcon type={order.type} />
            <span className="text-[11px] font-bold text-gray-700 truncate">
              {order.label}
            </span>
            {order.hasNewItems && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <GripVertical className="w-3 h-3 text-gray-300" />
          </div>
        </div>

        {order.orderNumber && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            #{order.orderNumber}
          </p>
        )}
      </div>

      {/* Items */}
      <div className="px-3 py-2 space-y-0.5">
        {order.items.slice(0, 4).map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold bg-gray-100 text-gray-500 rounded px-1 py-0.5 min-w-[20px] text-center">
              {item.quantity}×
            </span>
            <span className="text-[11px] text-gray-700 truncate">
              {item.name}
              {item.size ? ` (${item.size})` : ""}
            </span>
          </div>
        ))}
        {order.items.length > 4 && (
          <p className="text-[9px] text-gray-400 pl-6">
            +{order.items.length - 4} more
          </p>
        )}
        {order.items.length === 0 && (
          <p className="text-[10px] text-gray-300 italic">No items</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 pb-2.5 pt-1 flex items-center justify-between border-t border-gray-50">
        <div className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5 text-gray-300" />
          {order.startTime
            ? <ElapsedTimer startTime={order.startTime} warn={order.status === "preparing"} />
            : <span className="text-[10px] text-gray-300">—</span>}
        </div>
        {order.totalAmount !== undefined && (
          <span className="text-[10px] font-bold text-gray-600">
            ₹{order.totalAmount.toFixed(0)}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ── Drop column ───────────────────────────────────────────────────────────────

function KanbanColumn({
  col,
  orders,
  onDragStart,
  onDrop,
  dragOverCol,
  setDragOverCol,
}: {
  col: ColumnDef;
  orders: KitchenOrder[];
  onDragStart: (e: React.DragEvent, key: string) => void;
  onDrop: (colId: KitchenStatus) => void;
  dragOverCol: KitchenStatus | null;
  setDragOverCol: (c: KitchenStatus | null) => void;
}) {
  const isOver = dragOverCol === col.id;

  return (
    <div
      className="flex flex-col min-w-[200px] w-full flex-1"
      onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
      onDragLeave={() => setDragOverCol(null)}
      onDrop={e => { e.preventDefault(); setDragOverCol(null); onDrop(col.id); }}
    >
      {/* Column header */}
      <div className={`rounded-xl px-3 py-2 mb-2 flex items-center gap-2 ${col.color}`}>
        <col.icon className={`w-3.5 h-3.5 ${col.textColor}`} />
        <span className={`text-xs font-bold ${col.textColor}`}>{col.label}</span>
        <span className={`ml-auto text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/60 ${col.textColor}`}>
          {orders.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        className={`
          flex-1 min-h-[120px] rounded-xl transition-all duration-150 space-y-2 p-1
          ${isOver
            ? `bg-gradient-to-b ${col.color} ring-2 ring-offset-1 ring-opacity-60 ` +
              (col.id === "preparing" ? "ring-amber-300" :
               col.id === "ready"     ? "ring-green-400" :
               col.id === "dispatched"? "ring-blue-400"  : "ring-gray-300")
            : "bg-gray-50/30"
          }
        `}
      >
        <AnimatePresence>
          {orders.map(o => (
            <KitchenCard
              key={o.key}
              order={o}
              onDragStart={onDragStart}
              colDef={col}
            />
          ))}
        </AnimatePresence>

        {orders.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-8 text-center rounded-xl border-2 border-dashed ${
            isOver ? "border-opacity-60 scale-[0.98]" : "border-transparent"
          } transition-all`}>
            <p className="text-xs text-gray-300">{col.emptyLabel}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Kitchen() {
  const { tables, isLoading: tablesLoading, connectionStatus, refresh: refreshTables } = useLiveTableOperations();
  const { deliveryOrders, pickupOrders, isLoading: ordersLoading, refresh: refreshOrders } = useLiveOrders();

  const [kitMap, setKitMap] = useState<Record<string, KitchenStatus>>(readKitchenMap);
  const [dragKey, setDragKey]         = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KitchenStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevOrderCount = useRef(0);

  const isConnected = connectionStatus === "Open";
  const isLoading   = tablesLoading || ordersLoading;

  // ── Sound alert for new orders ───────────────────────────────────────────────
  useEffect(() => {
    const totalNow = tables.filter(t => t.status !== "free").length
      + deliveryOrders.length + pickupOrders.length;

    if (prevOrderCount.current > 0 && totalNow > prevOrderCount.current && soundEnabled) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } catch { /* AudioContext not available */ }
    }
    prevOrderCount.current = totalNow;
  }, [tables, deliveryOrders, pickupOrders, soundEnabled]);

  // ── Build unified order list ─────────────────────────────────────────────────
  const allOrders = useMemo((): KitchenOrder[] => {
    const out: KitchenOrder[] = [];

    // Dine-in tables
    for (const t of tables) {
      if (t.status === "free") continue;
      const key = `dine-${t.id}`;
      out.push({
        key,
        orderId:     t.currentOrderId,
        orderNumber: t.orderNumber,
        type:        "dine-in",
        label:       t.name,
        items:       t.items.map(i => ({ name: i.name, quantity: i.quantity, size: i.size })),
        startTime:   t.startedAt,
        hasNewItems: t.hasNewItems,
        status:      kitMap[key] ?? "preparing",
      });
    }

    // Delivery orders
    for (const o of deliveryOrders) {
      const key = `dlv-${o.id}`;
      out.push({
        key,
        orderId:     o.id,
        orderNumber: o.orderNumber,
        type:        "delivery",
        label:       o.customerName ?? o.customerPhone ?? "Customer",
        items:       o.items.map(i => ({ name: i.name, quantity: i.quantity, size: i.size })),
        startTime:   o.createdAt,
        hasNewItems: o.hasNewItems,
        status:      kitMap[key] ?? "preparing",
        totalAmount: o.totalAmount,
      });
    }

    // Pickup orders
    for (const o of pickupOrders) {
      const key = `pku-${o.id}`;
      out.push({
        key,
        orderId:     o.id,
        orderNumber: o.orderNumber,
        type:        "pickup",
        label:       o.customerName ?? o.customerPhone ?? "Walk-in",
        items:       o.items.map(i => ({ name: i.name, quantity: i.quantity, size: i.size })),
        startTime:   o.createdAt,
        hasNewItems: o.hasNewItems,
        status:      kitMap[key] ?? "preparing",
        totalAmount: o.totalAmount,
      });
    }

    return out;
  }, [tables, deliveryOrders, pickupOrders, kitMap]);

  // Grouped by column
  const byStatus = useMemo(() => {
    const map: Record<KitchenStatus, KitchenOrder[]> = {
      preparing: [], ready: [], dispatched: [], done: [],
    };
    for (const o of allOrders) {
      map[o.status].push(o);
    }
    // Sort: hasNewItems first, then by startTime newest
    for (const col of Object.values(map)) {
      col.sort((a, b) => {
        if (a.hasNewItems !== b.hasNewItems) return a.hasNewItems ? -1 : 1;
        return (new Date(b.startTime ?? 0).getTime()) - (new Date(a.startTime ?? 0).getTime());
      });
    }
    return map;
  }, [allOrders]);

  // ── Drag handlers ────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.DragEvent, key: string) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback((targetStatus: KitchenStatus) => {
    if (!dragKey) return;

    // Validate: dine-in cannot go to dispatched/done
    const order = allOrders.find(o => o.key === dragKey);
    if (!order) return;
    if (order.type === "dine-in" && (targetStatus === "dispatched" || targetStatus === "done")) {
      setDragKey(null);
      return;
    }

    setKitMap(prev => {
      const next = { ...prev, [dragKey]: targetStatus };
      writeKitchenMap(next);
      return next;
    });
    setDragKey(null);
  }, [dragKey, allOrders]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refreshTables(), refreshOrders()]);
    setIsRefreshing(false);
  }, [refreshTables, refreshOrders]);

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:     allOrders.length,
    preparing: byStatus.preparing.length,
    ready:     byStatus.ready.length,
    late:      allOrders.filter(o => {
      if (!o.startTime || o.status === "done") return false;
      return (Date.now() - new Date(o.startTime).getTime()) > 15 * 60 * 1000;
    }).length,
  }), [allOrders, byStatus]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">

        {/* Title */}
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">Kitchen Board</h1>
          <p className="text-[10px] text-gray-400">{stats.total} active · {stats.preparing} preparing</p>
        </div>

        {/* Stat pills */}
        <div className="hidden sm:flex items-center gap-2 ml-2">
          {[
            { label: "Preparing", value: stats.preparing, color: "bg-amber-100 text-amber-700" },
            { label: "Ready",     value: stats.ready,     color: "bg-green-100 text-green-700"  },
            { label: "Late",      value: stats.late,      color: "bg-red-100 text-red-600"      },
          ].map(p => (
            <span key={p.label} className={`text-[10px] font-bold px-2 py-1 rounded-full ${p.color}`}>
              {p.value} {p.label}
            </span>
          ))}
        </div>

        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Sound toggle */}
          <button
            onClick={() => setSoundEnabled(v => !v)}
            title={soundEnabled ? "Mute alerts" : "Enable alerts"}
            className={`p-2 rounded-lg transition-colors ${soundEnabled ? "text-emerald-600 bg-emerald-50" : "text-gray-400 bg-gray-100"}`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Connection dot */}
          <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold ${
            isConnected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
          }`}>
            {isConnected
              ? <Wifi className="w-3 h-3" />
              : <WifiOff className="w-3 h-3" />}
            <span className="hidden sm:inline">{isConnected ? "Live" : "Offline"}</span>
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Legend bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2 bg-white border-b border-gray-100 flex items-center gap-4 overflow-x-auto scrollbar-hide">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide shrink-0">Drag to move →</span>
        {[
          { emoji: "🍽️", label: "Dine-in", color: "text-green-600" },
          { emoji: "🛵", label: "Delivery", color: "text-blue-500" },
          { emoji: "📦", label: "Pickup",   color: "text-orange-500" },
        ].map(t => (
          <span key={t.label} className={`flex items-center gap-1 text-[10px] font-medium ${t.color} shrink-0`}>
            {t.emoji} {t.label}
          </span>
        ))}
        <span className="text-[9px] text-amber-500 font-semibold ml-auto shrink-0 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> New order
        </span>
      </div>

      {/* ── Kanban board ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex-1 p-4 flex gap-3 overflow-x-auto">
          {COLUMNS.map(col => (
            <div key={col.id} className="flex flex-col min-w-[200px] flex-1 gap-2">
              <div className={`h-9 rounded-xl ${col.color} animate-pulse`} />
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-28 rounded-xl bg-white border border-gray-100 animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 p-4 flex gap-3 overflow-x-auto overflow-y-hidden"
          onDragEnd={() => { setDragKey(null); setDragOverCol(null); }}
        >
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              col={col}
              orders={byStatus[col.id]}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              dragOverCol={dragOverCol}
              setDragOverCol={setDragOverCol}
            />
          ))}
        </div>
      )}

      {/* ── Mobile swipe hint (show only on touch devices with few cols) ─────── */}
      <div className="shrink-0 py-1.5 text-center md:hidden">
        <span className="text-[9px] text-gray-300 font-medium flex items-center justify-center gap-1">
          <ChevronRight className="w-3 h-3" /> Scroll right for more columns
        </span>
      </div>
    </div>
  );
}
