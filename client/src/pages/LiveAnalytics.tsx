import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { BagichaLogo } from "@/components/BagichaLogo";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  IndianRupee, ShoppingBag, Clock, TrendingUp, AlertTriangle,
  Star, LayoutGrid, ArrowLeft, Calendar, ChevronDown, Check,
} from "lucide-react";

// ── Date range helpers ─────────────────────────────────────────────────────────

function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function today()        { return toISO(new Date()); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return toISO(d);
}
function startOfMonth() {
  const d = new Date(); d.setDate(1); return toISO(d);
}

interface DateRange { start: string; end: string; label: string; }

const PRESETS: { label: string; range: () => { start: string; end: string } }[] = [
  { label: "Today",        range: () => ({ start: today(),        end: today() }) },
  { label: "Yesterday",    range: () => ({ start: daysAgo(1),     end: daysAgo(1) }) },
  { label: "Last 7 Days",  range: () => ({ start: daysAgo(6),     end: today() }) },
  { label: "Last 30 Days", range: () => ({ start: daysAgo(29),    end: today() }) },
  { label: "This Month",   range: () => ({ start: startOfMonth(), end: today() }) },
];

function formatRangeLabel(start: string, end: string) {
  const fmt = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

// ── DateRangePicker ────────────────────────────────────────────────────────────

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen]               = useState(false);
  const [customStart, setCustomStart] = useState(value.start);
  const [customEnd, setCustomEnd]     = useState(value.end);
  const [showCustom, setShowCustom]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function applyPreset(p: typeof PRESETS[number]) {
    const r = p.range();
    onChange({ ...r, label: p.label });
    setShowCustom(false);
    setOpen(false);
  }

  function applyCustom() {
    if (!customStart || !customEnd || customStart > customEnd) return;
    onChange({ start: customStart, end: customEnd, label: "Custom" });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                   bg-muted border border-border text-foreground
                   hover:bg-muted/80 transition-all"
      >
        <Calendar className="w-3.5 h-3.5 text-indigo-400" />
        <span>{value.label === "Custom" ? formatRangeLabel(value.start, value.end) : value.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 z-50 w-60 rounded-2xl
                       bg-card border border-border shadow-xl p-2 overflow-hidden"
          >
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-1.5">
              Quick Select
            </p>
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm
                            transition-colors text-left ${
                              value.label === p.label
                                ? "bg-indigo-500/10 text-indigo-600 font-semibold"
                                : "text-foreground hover:bg-muted"
                            }`}
              >
                {p.label}
                {value.label === p.label && <Check className="w-3.5 h-3.5 text-indigo-500" />}
              </button>
            ))}

            <div className="border-t border-border mt-1 pt-1">
              <button
                type="button"
                onClick={() => setShowCustom(s => !s)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm
                            transition-colors text-left ${
                              value.label === "Custom"
                                ? "bg-indigo-500/10 text-indigo-600 font-semibold"
                                : "text-foreground hover:bg-muted"
                            }`}
              >
                Custom Range
                {value.label === "Custom" && <Check className="w-3.5 h-3.5 text-indigo-500" />}
              </button>
              <AnimatePresence>
                {showCustom && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden px-2 pb-2 space-y-2"
                  >
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">From</label>
                      <input
                        type="date"
                        value={customStart}
                        max={customEnd || today()}
                        onChange={e => setCustomStart(e.target.value)}
                        className="w-full text-xs border border-border rounded-lg px-2 py-1.5
                                   bg-background focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">To</label>
                      <input
                        type="date"
                        value={customEnd}
                        min={customStart}
                        max={today()}
                        onChange={e => setCustomEnd(e.target.value)}
                        className="w-full text-xs border border-border rounded-lg px-2 py-1.5
                                   bg-background focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={applyCustom}
                      disabled={!customStart || !customEnd || customStart > customEnd}
                      className="w-full py-1.5 rounded-xl text-xs font-semibold bg-indigo-500
                                 text-white hover:bg-indigo-600 disabled:bg-muted
                                 disabled:text-muted-foreground transition-colors"
                    >
                      Apply
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", minimumFractionDigits: 0,
  }).format(n);

const PALETTE = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#14b8a6",
];

const cardAnim = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: "easeOut" },
  }),
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-semibold text-foreground">
          {p.name === "total" ? fmt(p.value) : `${p.value} sold`}
        </p>
      ))}
    </div>
  );
};

// ── Sliding Glass Panel ───────────────────────────────────────────────────────

function SlidingGlassPanel({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0, y: -10 }}
          animate={{ height: "auto", opacity: 1, y: 0 }}
          exit={{ height: 0, opacity: 0, y: -10 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="overflow-hidden"
        >
          <div className="backdrop-blur-md bg-white/60 dark:bg-black/40 border border-white/30 shadow-lg rounded-2xl p-4 mt-2">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LiveAnalytics() {
  const [, navigate] = useLocation();
  const [openCard, setOpenCard] = useState<string | null>(null);
  const toggleCard = (id: string) => setOpenCard(prev => (prev === id ? null : id));
  const now = new Date();

  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    start: daysAgo(6),
    end:   today(),
    label: "Last 7 Days",
  }));

  const params = `?startDate=${dateRange.start}&endDate=${dateRange.end}`;

  // Stats always show today's live numbers
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 0,
    refetchInterval: 5000,
  });

  // Charts are date-range aware
  const { data: salesChart = [], isFetching: chartFetching } = useQuery<any[]>({
    queryKey: ["/api/dashboard/sales-chart", dateRange.start, dateRange.end],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard/sales-chart${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });

  const { data: categorySales = [], isFetching: catFetching } = useQuery<any[]>({
    queryKey: ["/api/dashboard/category-sales", dateRange.start, dateRange.end],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard/category-sales${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });

  const { data: topItems = [], isFetching: topFetching } = useQuery<any[]>({
    queryKey: ["/api/dashboard/top-items", dateRange.start, dateRange.end],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard/top-items${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });

  const { data: lowStockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/inventory/low-stock"],
    staleTime: 0,
    refetchInterval: 10000,
  });

  const { data: allOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/orders"],
    staleTime: 0,
    refetchInterval: 5000,
  });

  const { data: allTables = [] } = useQuery<any[]>({
    queryKey: ["/api/tables"],
    staleTime: 0,
    refetchInterval: 5000,
  });

  const todayStr = now.toDateString();
  const todayOrders    = allOrders.filter((o: any) => new Date(o.createdAt).toDateString() === todayStr);
  const activeOrdersList = allOrders.filter((o: any) => o.status === "pending" || o.status === "preparing");
  const innerTables    = allTables.filter((t: any) => t.section?.toLowerCase() === "inner" && t.status === "occupied");
  const outerTables    = allTables.filter((t: any) => t.section?.toLowerCase() === "outer" && t.status === "occupied");

  const statCards = [
    {
      id: "today-sales",
      label: "Today's Sales",
      value: fmt(stats?.todaySales || 0),
      sub: `${stats?.todayOrders || 0} orders placed`,
      icon: IndianRupee,
      gradient: "from-violet-500 to-purple-600",
      bg: "bg-violet-500/10",
    },
    {
      id: "orders-today",
      label: "Orders Today",
      value: String(stats?.todayOrders || 0),
      sub: `Avg ${fmt(stats?.avgOrderValue || 0)} / order`,
      icon: ShoppingBag,
      gradient: "from-blue-500 to-cyan-500",
      bg: "bg-blue-500/10",
    },
    {
      id: "active-orders",
      label: "Active Orders",
      value: String(stats?.activeOrders || 0),
      sub: "Pending / preparing",
      icon: Clock,
      gradient: "from-amber-500 to-orange-500",
      bg: "bg-amber-500/10",
    },
    {
      id: "total-revenue",
      label: "Total Revenue",
      value: fmt(stats?.totalRevenue || 0),
      sub: "All time",
      icon: TrendingUp,
      gradient: "from-emerald-500 to-green-500",
      bg: "bg-emerald-500/10",
    },
    {
      id: "low-stock",
      label: "Low Stock",
      value: String(stats?.lowStockCount || 0),
      sub: stats?.lowStockCount > 0 ? "Needs attention" : "All good",
      icon: AlertTriangle,
      gradient: stats?.lowStockCount > 0 ? "from-red-500 to-rose-600" : "from-green-500 to-emerald-500",
      bg: stats?.lowStockCount > 0 ? "bg-red-500/10" : "bg-green-500/10",
    },
    {
      id: "top-item",
      label: "Top Item Today",
      value: stats?.topItem || "—",
      sub: "Best seller",
      icon: Star,
      gradient: "from-pink-500 to-rose-500",
      bg: "bg-pink-500/10",
    },
    {
      id: "inner-running",
      label: "Inner Running",
      value: String(stats?.innerRunning || 0),
      sub: `of ${stats?.totalTables || 0} total tables`,
      icon: LayoutGrid,
      gradient: "from-indigo-500 to-blue-500",
      bg: "bg-indigo-500/10",
    },
    {
      id: "outer-running",
      label: "Outer Running",
      value: String(stats?.outerRunning || 0),
      sub: `of ${stats?.totalTables || 0} total tables`,
      icon: LayoutGrid,
      gradient: "from-teal-500 to-cyan-500",
      bg: "bg-teal-500/10",
    },
  ];

  const chartTitle =
    dateRange.label === "Custom"
      ? `Sales — ${formatRangeLabel(dateRange.start, dateRange.end)}`
      : `Sales — ${dateRange.label}`;

  const topItemsTitle =
    dateRange.label === "Custom"
      ? `Top Items — ${formatRangeLabel(dateRange.start, dateRange.end)}`
      : `Top Items — ${dateRange.label}`;

  const catTitle =
    dateRange.label === "Custom"
      ? `Category Sales — ${formatRangeLabel(dateRange.start, dateRange.end)}`
      : `Sales by Category — ${dateRange.label}`;

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 h-14 bg-card border-b border-border flex items-center px-4 gap-3 shadow-sm">
        <button
          onClick={() => navigate("/tables")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground
                     transition-colors px-2 py-1.5 rounded-lg hover:bg-muted"
        >
          <ArrowLeft className="w-4 h-4" />
          Table View
        </button>

        <div className="w-px h-6 bg-border shrink-0" />
        <BagichaLogo size="sm" />
        <div className="w-px h-6 bg-border shrink-0" />

        <span className="text-base font-bold text-foreground tracking-tight">
          Live Analytics
        </span>

        <div className="flex-1" />

        {/* Date Range Picker */}
        <DateRangePicker value={dateRange} onChange={setDateRange} />

        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">
            {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
          </span>
        </div>

        <span className="text-[11px] text-muted-foreground bg-muted/60 px-2 py-1 rounded-lg">
          Auto-refresh · 5s
        </span>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">

        {/* ── Stat Cards (always today) ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={cardAnim}
              whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
              onClick={() => toggleCard(card.id)}
              className={`rounded-2xl p-4 border shadow-sm cursor-pointer transition-shadow select-none
                ${card.bg}
                ${openCard === card.id
                  ? "border-white/50 shadow-md ring-2 ring-white/30"
                  : "border-border/40 hover:shadow-md"
                }`}
            >
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-3 shadow-sm`}>
                <card.icon className="w-4 h-4 text-white" />
              </div>
              <p className="text-[11px] font-medium text-muted-foreground mb-0.5">{card.label}</p>
              <p className="text-lg font-bold text-foreground leading-tight truncate">{card.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{card.sub}</p>
            </motion.div>
          ))}
        </div>

        {/* ── Sliding Glass Panel ── */}
        <SlidingGlassPanel isOpen={openCard !== null}>
          {openCard === "today-sales" || openCard === "orders-today" ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {openCard === "today-sales" ? "Today's Orders" : "Orders Today"}
              </p>
              {todayOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders today yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {todayOrders.map((o: any) => (
                    <div key={o.id} className="flex items-center justify-between bg-white/50 rounded-xl px-3 py-2 border border-white/40">
                      <div>
                        <p className="text-xs font-semibold">{o.orderNumber}</p>
                        <p className="text-[11px] text-muted-foreground capitalize">{o.orderType?.replace("-", " ")} {o.tableNumber ? `· Table ${o.tableNumber}` : ""}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-green-700">{fmt(parseFloat(o.totalAmount || "0"))}</p>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          o.status === "served" || o.status === "delivered" ? "bg-green-100 text-green-700" :
                          o.status === "cancelled" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700"
                        }`}>{o.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : openCard === "active-orders" ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Active Orders — Pending &amp; Preparing</p>
              {activeOrdersList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active orders right now.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {activeOrdersList.map((o: any) => (
                    <div key={o.id} className="flex items-center justify-between bg-amber-50/60 rounded-xl px-3 py-2 border border-amber-200/50">
                      <div>
                        <p className="text-xs font-semibold">{o.orderNumber}</p>
                        <p className="text-[11px] text-muted-foreground">{o.tableNumber ? `Table ${o.tableNumber}` : o.orderType}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold">{fmt(parseFloat(o.totalAmount || "0"))}</p>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">{o.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : openCard === "total-revenue" ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Revenue by Category</p>
              {categorySales.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales data available.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {categorySales.map((c: any, idx: number) => (
                    <div key={c.category} className="bg-white/50 rounded-xl px-3 py-2 border border-white/40">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: PALETTE[idx % PALETTE.length] }} />
                        <p className="text-[11px] font-medium text-muted-foreground truncate">{c.category}</p>
                      </div>
                      <p className="text-sm font-bold text-foreground">{fmt(c.total)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : openCard === "low-stock" ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Low Stock Items</p>
              {lowStockItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">All items are well stocked.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {lowStockItems.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between bg-red-50/60 rounded-xl px-3 py-2 border border-red-200/50">
                      <div>
                        <p className="text-xs font-semibold">{item.itemName}</p>
                        <p className="text-[11px] text-muted-foreground">Min: {item.minStock} {item.unit}</p>
                      </div>
                      <span className="text-sm font-bold text-red-500">{item.currentStock} {item.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : openCard === "top-item" ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top Items Today</p>
              {topItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales data today.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {topItems.map((item: any, idx: number) => (
                    <div key={item.name} className="bg-white/50 rounded-xl px-3 py-2 border border-white/40">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: PALETTE[idx % PALETTE.length] }}>{idx + 1}</span>
                        <p className="text-[11px] font-medium truncate">{item.name}</p>
                      </div>
                      <p className="text-sm font-bold">{item.qty} <span className="text-[11px] font-normal text-muted-foreground">sold</span></p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : openCard === "inner-running" || openCard === "outer-running" ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {openCard === "inner-running" ? "Inner" : "Outer"} — Occupied Tables
              </p>
              {(openCard === "inner-running" ? innerTables : outerTables).length === 0 ? (
                <p className="text-sm text-muted-foreground">No occupied tables in this section.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(openCard === "inner-running" ? innerTables : outerTables).map((t: any) => (
                    <div key={t.id} className="bg-white/50 rounded-xl px-3 py-2 border border-white/40 min-w-[100px]">
                      <p className="text-xs font-bold">Table {t.tableNumber}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">{t.status}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </SlidingGlassPanel>

        {/* ── Sales Line + Category Pie ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="lg:col-span-2 rounded-2xl border border-border/40 bg-card p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">{chartTitle}</p>
              {chartFetching && <span className="text-[11px] text-muted-foreground animate-pulse">Updating…</span>}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={salesChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.6} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                  width={55}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={{ fill: "#6366f1", r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.4 }}
            className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">{catTitle}</p>
              {catFetching && <span className="text-[11px] text-muted-foreground animate-pulse">Updating…</span>}
            </div>
            {catFetching && categorySales.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : categorySales.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                No sales in range
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie
                      data={categorySales}
                      dataKey="total"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      outerRadius={65}
                      innerRadius={32}
                      paddingAngle={3}
                    >
                      {categorySales.map((_: any, idx: number) => (
                        <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-3">
                  {categorySales.slice(0, 5).map((c: any, idx: number) => (
                    <div key={c.category} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[idx % PALETTE.length] }} />
                        <span className="text-muted-foreground truncate">{c.category}</span>
                      </span>
                      <span className="font-semibold ml-2 flex-shrink-0">{fmt(c.total)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </div>

        {/* ── Top Items Bar + Low Stock ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.4 }}
            className="lg:col-span-2 rounded-2xl border border-border/40 bg-card p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">{topItemsTitle}</p>
              {topFetching && <span className="text-[11px] text-muted-foreground animate-pulse">Updating…</span>}
            </div>
            {topFetching && topItems.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : topItems.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                No sales in range
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topItems} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.6} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    angle={-25}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="qty" name="qty" radius={[6, 6, 0, 0]} maxBarSize={40}>
                    {topItems.map((_: any, idx: number) => (
                      <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.4 }}
            className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Low Stock Alerts</p>
              {lowStockItems.length > 0 && (
                <span className="text-[11px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-medium">
                  {lowStockItems.length} items
                </span>
              )}
            </div>
            {lowStockItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[170px] text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <span className="text-emerald-500 text-xl font-bold">✓</span>
                </div>
                <p className="text-sm text-muted-foreground">All items in stock</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {lowStockItems.map((item: any) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-red-500/5 border border-red-500/15"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{item.itemName}</p>
                      <p className="text-[11px] text-muted-foreground">Min: {item.minStock} {item.unit}</p>
                    </div>
                    <span className="text-sm font-bold text-red-500 ml-2 flex-shrink-0">
                      {item.currentStock} {item.unit}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </div>

      </main>
    </div>
  );
}
