import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Monitor,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
  LayoutGrid,
  Rows3,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLiveTableOperations, type LiveTableState } from "@/hooks/useLiveTableOperations";
import { TableCard } from "@/components/live-tables/TableCard";

// ── Filter config ─────────────────────────────────────────────────────────────

type FilterKey = "all" | "running" | "billed" | "free";

const FILTERS: { key: FilterKey; label: string; activeColor: string }[] = [
  { key: "all",     label: "All",             activeColor: "from-emerald-500 to-green-500" },
  { key: "running", label: "Running",         activeColor: "from-amber-500 to-orange-400" },
  { key: "billed",  label: "Billing Pending", activeColor: "from-red-500 to-rose-500"     },
  { key: "free",    label: "Idle",            activeColor: "from-emerald-500 to-teal-500" },
];

// ── Smart sort ────────────────────────────────────────────────────────────────
// Priority: new items → running (longest wait first) → others

function smartSort(tables: LiveTableState[]): LiveTableState[] {
  return [...tables].sort((a, b) => {
    // 1. Tables with brand-new items come first
    if (a.hasNewItems !== b.hasNewItems) return a.hasNewItems ? -1 : 1;

    // 2. Running before billed before free
    const statusRank = { running: 0, billed: 1, free: 2 };
    const ra = statusRank[a.status as keyof typeof statusRank] ?? 2;
    const rb = statusRank[b.status as keyof typeof statusRank] ?? 2;
    if (ra !== rb) return ra - rb;

    // 3. Longest wait first (oldest startedAt)
    if (a.startedAt && b.startedAt) {
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    }
    if (a.startedAt) return -1;
    if (b.startedAt) return 1;
    return 0;
  });
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return <div className="animate-pulse rounded-2xl bg-gray-100/80 h-[100px]" />;
}

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 min-w-[58px] bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl px-2.5 py-2 text-center shadow-sm">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mt-0.5">
        {label}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LiveTablesDashboard() {
  const {
    tables,
    isLoading,
    connectionStatus,
    soundEnabled,
    setSoundEnabled,
    refresh,
  } = useLiveTableOperations();

  const [filter, setFilter]               = useState<FilterKey>("all");
  const [search, setSearch]               = useState("");
  const [compact, setCompact]             = useState(false);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [expandedTableId, setExpandedTableId] = useState<number | null>(null);

  const handleToggleTable = useCallback((tableId: number) => {
    setExpandedTableId(prev => prev === tableId ? null : tableId);
  }, []);

  // Auto-open the first active table when data loads
  useEffect(() => {
    if (expandedTableId !== null) return; // user already interacted
    const firstActive = tables.find(t => t.status !== "free" && t.items.length > 0);
    if (firstActive) setExpandedTableId(firstActive.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.length]);

  const isConnected = connectionStatus === "Open";

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  }, [refresh]);

  // Stats
  const stats = useMemo(() => ({
    total:   tables.length,
    running: tables.filter(t => t.status === "running").length,
    billed:  tables.filter(t => t.status === "billed").length,
    free:    tables.filter(t => t.status === "free").length,
  }), [tables]);

  // Filter → search → smart-sort
  const displayed = useMemo(() => {
    let result = tables;

    if (filter !== "all") result = result.filter(t => t.status === filter);

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        t =>
          t.name.toLowerCase().includes(q) ||
          t.items.some(i => i.name.toLowerCase().includes(q))
      );
    }

    return smartSort(result);
  }, [tables, filter, search]);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Page header ──────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100/80 shadow-sm">
            <Monitor className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Live Tables</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Real-time delivery operations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection badge */}
          <div
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border ${
              isConnected
                ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                : "bg-gray-50 text-gray-400 border-gray-200"
            }`}
          >
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>{isConnected ? "Live" : "Reconnecting"}</span>
            {isConnected && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </div>

          {/* Sound toggle */}
          <button
            onClick={() => setSoundEnabled(v => !v)}
            title={soundEnabled ? "Mute alerts" : "Enable alerts"}
            className={`p-2 rounded-xl transition-colors ${
              soundEnabled
                ? "text-emerald-600 bg-emerald-50 hover:bg-emerald-100"
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            }`}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
          </button>

          {/* Compact mode toggle */}
          <button
            onClick={() => setCompact(v => !v)}
            title={compact ? "Normal view" : "Compact view"}
            className={`p-2 rounded-xl transition-colors ${
              compact
                ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            }`}
          >
            {compact ? (
              <LayoutGrid className="w-4 h-4" />
            ) : (
              <Rows3 className="w-4 h-4" />
            )}
          </button>

          {/* Refresh */}
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

      {/* ── Stats row ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pb-3 flex gap-2">
        <StatPill label="Total"     value={stats.total}   color="text-gray-700" />
        <StatPill label="Running"   value={stats.running} color="text-amber-500" />
        <StatPill label="Billing"   value={stats.billed}  color="text-red-500"  />
        <StatPill label="Idle"      value={stats.free}    color="text-emerald-600" />
      </div>

      {/* ── Filter tabs + Search ──────────────────────────────────── */}
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

        {/* Search — by table name or item name */}
        <div className="relative flex-1 max-w-xs min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Table name or item…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-300 placeholder:text-gray-300"
          />
        </div>
      </div>

      {/* ── Grid ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {isLoading ? (
          <div
            className={`grid gap-3 items-start ${
              compact
                ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7"
                : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            }`}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-300">
            <Monitor className="w-14 h-14 mb-4" />
            <p className="text-sm font-semibold text-gray-400">No tables match</p>
            <p className="text-xs mt-1">Try adjusting filters or search</p>
          </div>
        ) : (
          <div
            className={`grid gap-3 items-start ${
              compact
                ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7"
                : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            }`}
          >
            <AnimatePresence mode="popLayout">
              {displayed.map((table, i) => (
                <TableCard
                  key={table.id}
                  table={table}
                  index={i}
                  compact={compact}
                  isExpanded={expandedTableId === table.id}
                  onToggle={() => handleToggleTable(table.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Legend ────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 py-2 border-t border-gray-100/60 flex items-center gap-4 flex-wrap">
        <span className="text-[10px] text-gray-400 font-medium">Urgency:</span>
        <span className="flex items-center gap-1 text-[10px] text-yellow-600 font-medium">
          <span className="w-2.5 h-2.5 rounded-sm ring-2 ring-yellow-400 inline-block" />
          &gt; 10 min
        </span>
        <span className="flex items-center gap-1 text-[10px] text-red-500 font-medium">
          <span className="w-2.5 h-2.5 rounded-sm ring-2 ring-red-500 inline-block" />
          &gt; 20 min
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-gray-500 font-medium ml-2">
          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" />
          New items
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium ml-2">
          <span className="w-2.5 h-2.5 rounded-sm ring-2 ring-emerald-400 inline-block" />
          All served
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">Tap item to mark served</span>
      </div>
    </div>
  );
}
