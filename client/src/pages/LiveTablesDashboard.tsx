import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Monitor, RefreshCw, Search, Wifi, WifiOff,
  LayoutGrid, Rows3, Volume2, VolumeX,
  Package, Bike, UtensilsCrossed, LayoutList,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLiveTableOperations } from "@/hooks/useLiveTableOperations";
import { useLiveOrders }           from "@/hooks/useLiveOrders";
import { OrderCard, type UnifiedOrder, type DeliveryStatus, type PickupStatus } from "@/components/live-tables/OrderCard";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChannelFilter = "all" | "dine-in" | "delivery" | "pickup";
type StatusFilter  = "all" | "food-ready" | "dispatched" | "delivered";

const CHANNEL_TABS: { key: ChannelFilter; emoji: string; label: string; icon: any }[] = [
  { key: "all",      emoji: "⚡",  label: "All",      icon: LayoutList      },
  { key: "dine-in",  emoji: "🍽️", label: "Dine-in",  icon: UtensilsCrossed },
  { key: "delivery", emoji: "🛵",  label: "Delivery", icon: Bike            },
  { key: "pickup",   emoji: "📦",  label: "Pickup",   icon: Package         },
];

// ── localStorage helpers ──────────────────────────────────────────────────────

const DLV_LS = "bagicha_dlv";
const PKU_LS = "bagicha_pku";

function readMap<T extends string>(key: string): Record<number, T> {
  try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
}
function writeMap<T extends string>(key: string, map: Record<number, T>) {
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 border-l-4 border-l-gray-200 overflow-hidden animate-pulse">
      <div className="px-3.5 pt-3 pb-2.5 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <div className="h-3 w-16 bg-gray-200 rounded" />
          <div className="h-3 w-12 bg-gray-200 rounded-full" />
        </div>
        <div className="h-4 w-24 bg-gray-200 rounded mt-2" />
        <div className="h-3 w-20 bg-gray-200 rounded mt-1.5" />
      </div>
      <div className="px-3.5 py-2.5 space-y-1.5">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-3 bg-gray-100 rounded" />)}
        </div>
      </div>
      <div className="px-3.5 pb-3 pt-2.5 border-t border-gray-50 flex items-center justify-between">
        <div className="h-4 w-10 bg-gray-200 rounded" />
        <div className="flex gap-1.5">
          <div className="h-7 w-10 bg-gray-100 rounded" />
          <div className="h-7 w-20 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
}

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white/70 border border-white/50 rounded-xl px-3 py-2 text-center shadow-sm min-w-[60px]">
      <div className={`text-lg font-bold leading-none ${color}`}>{value}</div>
      <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LiveTablesDashboard() {

  // ── Data hooks ────────────────────────────────────────────────────────────
  const { tables, isLoading: tablesLoading, connectionStatus, soundEnabled, setSoundEnabled, refresh } = useLiveTableOperations();
  const { deliveryOrders, pickupOrders, isLoading: ordersLoading, refresh: refreshOrders } = useLiveOrders();
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"], staleTime: 60_000 });
  const restaurantName = settings?.restaurantName ?? "Bagicha";

  // ── Status maps (delivery + pickup) ───────────────────────────────────────
  const [dlvMap, setDlvMap] = useState<Record<number, DeliveryStatus>>(() => readMap<DeliveryStatus>(DLV_LS));
  const [pkuMap, setPkuMap] = useState<Record<number, PickupStatus>>(() => readMap<PickupStatus>(PKU_LS));

  // Initialise newly arrived orders from localStorage
  useEffect(() => {
    const savedDlv = readMap<DeliveryStatus>(DLV_LS);
    setDlvMap(prev => {
      let changed = false; const next = { ...prev };
      for (const o of deliveryOrders) {
        if (!(o.id in next) && savedDlv[o.id]) { next[o.id] = savedDlv[o.id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [deliveryOrders]);

  useEffect(() => {
    const savedPku = readMap<PickupStatus>(PKU_LS);
    setPkuMap(prev => {
      let changed = false; const next = { ...prev };
      for (const o of pickupOrders) {
        if (!(o.id in next) && savedPku[o.id]) { next[o.id] = savedPku[o.id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [pickupOrders]);

  const handleStatusChange = useCallback((orderId: number, orderType: string, status: string) => {
    if (orderType === "delivery") {
      setDlvMap(prev => {
        const next = { ...prev, [orderId]: status as DeliveryStatus };
        writeMap(DLV_LS, next);
        return next;
      });
    } else if (orderType === "pickup") {
      setPkuMap(prev => {
        const next = { ...prev, [orderId]: status as PickupStatus };
        writeMap(PKU_LS, next);
        return next;
      });
    }
  }, []);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>("all");
  const [search,        setSearch]        = useState("");
  const [compact,       setCompact]       = useState(false);
  const [isRefreshing,  setIsRefreshing]  = useState(false);

  const isConnected = connectionStatus === "Open";
  const isLoading   = tablesLoading || ordersLoading;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refresh(), refreshOrders()]);
    setIsRefreshing(false);
  }, [refresh, refreshOrders]);

  // ── Build unified order list ───────────────────────────────────────────────
  const allOrders = useMemo((): UnifiedOrder[] => {
    const result: UnifiedOrder[] = [];

    // Active dine-in tables
    for (const t of tables) {
      if (t.status === "free") continue;
      result.push({
        key:         `dine-${t.id}`,
        orderId:     t.currentOrderId,
        orderNumber: t.orderNumber,
        type:        "dine-in",
        tableId:     t.id,
        tableName:   t.name,
        section:     t.section,
        tableStatus: t.status,
        startTime:   t.startedAt,
        items:       t.items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, size: i.size, specialInstructions: i.specialInstructions })),
        hasNewItems: t.hasNewItems,
        lastUpdated: t.lastUpdated,
      });
    }

    // Delivery orders
    for (const o of deliveryOrders) {
      result.push({
        key:           `dlv-${o.id}`,
        orderId:       o.id,
        orderNumber:   o.orderNumber,
        type:          "delivery",
        customerName:  o.customerName,
        customerPhone: o.customerPhone,
        totalAmount:   o.totalAmount,
        startTime:     o.createdAt,
        items:         o.items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, size: i.size, specialInstructions: i.specialInstructions })),
        hasNewItems:   o.hasNewItems,
        lastUpdated:   o.lastUpdated,
        currentStatus: dlvMap[o.id] ?? "preparing",
      });
    }

    // Pickup orders
    for (const o of pickupOrders) {
      result.push({
        key:           `pku-${o.id}`,
        orderId:       o.id,
        orderNumber:   o.orderNumber,
        type:          "pickup",
        customerName:  o.customerName,
        customerPhone: o.customerPhone,
        totalAmount:   o.totalAmount,
        startTime:     o.createdAt,
        items:         o.items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, size: i.size, specialInstructions: i.specialInstructions })),
        hasNewItems:   o.hasNewItems,
        lastUpdated:   o.lastUpdated,
        currentStatus: pkuMap[o.id] ?? "preparing",
      });
    }

    // Sort: new-items first → newest first
    return result.sort((a, b) => {
      if (a.hasNewItems !== b.hasNewItems) return a.hasNewItems ? -1 : 1;
      const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
      const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
      return tb - ta;
    });
  }, [tables, deliveryOrders, pickupOrders, dlvMap, pkuMap]);

  // ── Channel counts (tab badges) ───────────────────────────────────────────
  const channelCounts = useMemo(() => ({
    all:      allOrders.length,
    "dine-in":  allOrders.filter(o => o.type === "dine-in").length,
    delivery:   allOrders.filter(o => o.type === "delivery").length,
    pickup:     allOrders.filter(o => o.type === "pickup").length,
  }), [allOrders]);

  // ── Status quick-filter counts ────────────────────────────────────────────
  const statusCounts = useMemo(() => ({
    "food-ready":  allOrders.filter(o => o.currentStatus === "ready").length,
    dispatched:    allOrders.filter(o => o.currentStatus === "dispatched").length,
    delivered:     allOrders.filter(o => o.currentStatus === "delivered" || o.currentStatus === "collected").length,
  }), [allOrders]);

  // ── Apply all filters ─────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = allOrders;

    if (channelFilter !== "all") {
      list = list.filter(o => o.type === channelFilter);
    }

    if (statusFilter === "food-ready") {
      list = list.filter(o => o.currentStatus === "ready");
    } else if (statusFilter === "dispatched") {
      list = list.filter(o => o.currentStatus === "dispatched");
    } else if (statusFilter === "delivered") {
      list = list.filter(o => o.currentStatus === "delivered" || o.currentStatus === "collected");
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.orderNumber?.toLowerCase().includes(q) ||
        o.tableName?.toLowerCase().includes(q)   ||
        o.customerName?.toLowerCase().includes(q) ||
        o.items.some(i => i.name.toLowerCase().includes(q))
      );
    }

    return list;
  }, [allOrders, channelFilter, statusFilter, search]);

  // ── Stats row (for summary pills) ─────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    allOrders.length,
    dineIn:   channelCounts["dine-in"],
    delivery: channelCounts.delivery,
    pickup:   channelCounts.pickup,
    ready:    statusCounts["food-ready"],
  }), [allOrders, channelCounts, statusCounts]);

  // ── Grid columns ──────────────────────────────────────────────────────────
  const gridCols = compact
    ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Page header ────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100/80 shadow-sm">
            <Monitor className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Live View</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {allOrders.length} active order{allOrders.length !== 1 ? "s" : ""} · real-time feed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection */}
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border ${
            isConnected
              ? "bg-emerald-50 text-emerald-600 border-emerald-200"
              : "bg-gray-50 text-gray-400 border-gray-200"
          }`}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>{isConnected ? "Live" : "Reconnecting"}</span>
            {isConnected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
          </div>

          {/* Sound */}
          <button
            onClick={() => setSoundEnabled(v => !v)}
            title={soundEnabled ? "Mute" : "Sound on"}
            className={`p-2 rounded-xl transition-colors ${
              soundEnabled ? "text-emerald-600 bg-emerald-50" : "text-gray-400 hover:bg-gray-100"
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Compact */}
          <button
            onClick={() => setCompact(v => !v)}
            title={compact ? "Comfortable view" : "Compact view"}
            className={`p-2 rounded-xl transition-colors ${
              compact ? "text-indigo-600 bg-indigo-50" : "text-gray-400 hover:bg-gray-100"
            }`}
          >
            {compact ? <LayoutGrid className="w-4 h-4" /> : <Rows3 className="w-4 h-4" />}
          </button>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Stats pills ────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pb-3 flex gap-2 overflow-x-auto scrollbar-hide">
        <StatPill label="Total"    value={stats.total}    color="text-gray-700"     />
        <StatPill label="Dine-in"  value={stats.dineIn}   color="text-emerald-600"  />
        <StatPill label="Delivery" value={stats.delivery} color="text-blue-600"     />
        <StatPill label="Pickup"   value={stats.pickup}   color="text-orange-500"   />
        <StatPill label="Ready"    value={stats.ready}    color="text-green-600"    />
      </div>

      {/* ── Channel tabs ───────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-gray-200">
        <div className="flex">
          {CHANNEL_TABS.map(tab => {
            const active = channelFilter === tab.key;
            const count  = channelCounts[tab.key as ChannelFilter] ?? 0;
            return (
              <button
                key={tab.key}
                onClick={() => { setChannelFilter(tab.key); setStatusFilter("all"); }}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 px-2 relative transition-colors ${
                  active ? "text-red-500" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="text-[11px] font-semibold">{tab.label}</span>
                {count > 0 && (
                  <span className={`absolute top-1.5 right-[calc(50%-18px)] text-[8px] font-bold px-1 py-px rounded-full leading-none ${
                    active ? "bg-red-500 text-white" : "bg-gray-200 text-gray-600"
                  }`}>
                    {count}
                  </span>
                )}
                {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-500 rounded-t-full" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filter + search bar ────────────────────────────────── */}
      <div className="shrink-0 px-5 py-2.5 bg-white/60 border-b border-gray-100/60 flex items-center gap-2 flex-wrap">
        {/* Status quick filters */}
        {([
          { key: "food-ready" as StatusFilter,  label: "Food Ready",  count: statusCounts["food-ready"],  active: "bg-green-600 text-white",  inactive: "text-gray-600 bg-white"  },
          { key: "dispatched" as StatusFilter,  label: "Dispatched",  count: statusCounts.dispatched,     active: "bg-blue-600 text-white",   inactive: "text-gray-600 bg-white"  },
          { key: "delivered"  as StatusFilter,  label: "Delivered",   count: statusCounts.delivered,      active: "bg-gray-700 text-white",   inactive: "text-gray-600 bg-white"  },
        ] as const).map(sf => (
          <button
            key={sf.key}
            onClick={() => setStatusFilter(prev => prev === sf.key ? "all" : sf.key)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              statusFilter === sf.key ? sf.active + " border-transparent" : sf.inactive + " border-gray-200 hover:border-gray-300"
            }`}
          >
            {sf.label}
            <span className={`text-[10px] font-bold px-1 py-px rounded-full ${
              statusFilter === sf.key ? "bg-white/25 text-current" : "bg-gray-100 text-gray-500"
            }`}>
              {sf.count}
            </span>
          </button>
        ))}

        {/* Search */}
        <div className="relative flex-1 max-w-xs min-w-[160px] ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Table, order #, item…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-300 placeholder:text-gray-300"
          />
        </div>
      </div>

      {/* ── Order feed ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {isLoading ? (
          <div className={`grid gap-3 items-start ${gridCols}`}>
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-300">
            <Monitor className="w-14 h-14 mb-4" />
            <p className="text-sm font-semibold text-gray-400">
              {allOrders.length === 0 ? "No active orders" : "No orders match filters"}
            </p>
            <p className="text-xs mt-1 text-gray-300">
              {allOrders.length === 0
                ? "Orders will appear here in real-time"
                : "Try changing the channel or clearing filters"}
            </p>
            {(channelFilter !== "all" || statusFilter !== "all" || search) && (
              <button
                onClick={() => { setChannelFilter("all"); setStatusFilter("all"); setSearch(""); }}
                className="mt-4 text-xs text-emerald-600 hover:text-emerald-700 font-semibold underline underline-offset-2"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-400 font-medium mb-3">
              {displayed.length} order{displayed.length !== 1 ? "s" : ""}
              {channelFilter !== "all" && ` · ${CHANNEL_TABS.find(t => t.key === channelFilter)?.label}`}
              {statusFilter !== "all" && ` · ${statusFilter.replace("-", " ")}`}
            </p>
            <div className={`grid gap-3 items-start ${gridCols}`}>
              <AnimatePresence mode="popLayout">
                {displayed.map((order, i) => (
                  <OrderCard
                    key={order.key}
                    order={order}
                    index={i}
                    restaurantName={restaurantName}
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
