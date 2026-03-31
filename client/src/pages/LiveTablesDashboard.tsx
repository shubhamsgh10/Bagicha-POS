import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Monitor, RefreshCw, Search, Wifi, WifiOff } from "lucide-react";
import { useLiveTables, type EnrichedTable } from "@/hooks/useLiveTables";
import { TableCard } from "@/components/live-tables/TableCard";
import { TableDrawer } from "@/components/live-tables/TableDrawer";

// ── Filter config ─────────────────────────────────────────────────────────────

type FilterKey = "all" | "running" | "billed" | "free";

const FILTERS: { key: FilterKey; label: string; activeColor: string }[] = [
  { key: "all",     label: "All",             activeColor: "from-emerald-500 to-green-500" },
  { key: "running", label: "Running",         activeColor: "from-amber-500 to-orange-400" },
  { key: "billed",  label: "Billing Pending", activeColor: "from-red-500 to-rose-500" },
  { key: "free",    label: "Available",       activeColor: "from-emerald-500 to-teal-500" },
];

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl bg-gray-100/80 h-[110px]" />
  );
}

// ── Stats pill ────────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex-1 min-w-[60px] bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl px-3 py-2 text-center shadow-sm">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mt-0.5">
        {label}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LiveTablesDashboard() {
  const { tables, isLoading, connectionStatus, refresh } = useLiveTables();

  const [filter, setFilter]               = useState<FilterKey>("all");
  const [search, setSearch]               = useState("");
  const [selectedId, setSelectedId]       = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing]   = useState(false);

  const isConnected = connectionStatus === "Open";

  // Always get the live version of the selected table from WS-patched state
  const selectedTable = useMemo(
    () => (selectedId !== null ? (tables.find(t => t.id === selectedId) ?? null) : null),
    [tables, selectedId]
  );

  const handleSelect = useCallback((t: EnrichedTable) => setSelectedId(t.id), []);
  const handleClose  = useCallback(() => setSelectedId(null), []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }, [refresh]);

  // Stats
  const stats = useMemo(
    () => ({
      total:   tables.length,
      running: tables.filter(t => t.status === "running").length,
      billed:  tables.filter(t => t.status === "billed").length,
      free:    tables.filter(t => t.status === "free").length,
    }),
    [tables]
  );

  // Filtered + searched list
  const filtered = useMemo(() => {
    let result = tables;
    if (filter !== "all") result = result.filter(t => t.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        t =>
          t.name.toLowerCase().includes(q) ||
          t.order?.customerName?.toLowerCase().includes(q) ||
          t.order?.orderNumber?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [tables, filter, search]);

  const activeCfg = FILTERS.find(f => f.key === filter) ?? FILTERS[0];

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100/80 shadow-sm">
            <Monitor className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Live Tables</h1>
            <p className="text-xs text-gray-400 mt-0.5">Real-time table &amp; order monitoring</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection status */}
          <div
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
              isConnected
                ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                : "bg-gray-50 text-gray-400 border-gray-200"
            }`}
          >
            {isConnected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            <span>{isConnected ? "Live" : "Reconnecting"}</span>
            {isConnected && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </div>

          {/* Manual refresh */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh"
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pb-3 flex gap-2">
        <StatPill label="Total"     value={stats.total}   color="text-gray-700" />
        <StatPill label="Running"   value={stats.running} color="text-amber-500" />
        <StatPill label="Billing"   value={stats.billed}  color="text-red-500" />
        <StatPill label="Available" value={stats.free}    color="text-emerald-600" />
      </div>

      {/* ── Filter tabs + Search ─────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pb-3 flex items-center gap-3 flex-wrap">
        {/* Filter pills */}
        <div className="flex items-center gap-1 bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl p-1 shadow-sm">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                filter === f.key
                  ? `bg-gradient-to-br ${f.activeColor} text-white shadow-sm`
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search table or customer…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-300 placeholder:text-gray-300"
          />
        </div>
      </div>

      {/* ── Table grid ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-300">
            <Monitor className="w-14 h-14 mb-4" />
            <p className="text-sm font-semibold text-gray-400">No tables match</p>
            <p className="text-xs mt-1">Try adjusting filters or search</p>
          </div>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
          >
            <AnimatePresence mode="popLayout">
              {filtered.map((table, i) => (
                <TableCard
                  key={table.id}
                  table={table}
                  index={i}
                  onSelect={handleSelect}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* ── Drawer overlay ──────────────────────────────────────────────── */}
      <TableDrawer table={selectedTable} onClose={handleClose} />
    </div>
  );
}
