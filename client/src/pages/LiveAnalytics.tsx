import { apiUrl } from '@/lib/api';
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  IndianRupee, ShoppingBag, Clock, TrendingUp, AlertTriangle, Star, LayoutGrid,
} from "lucide-react";
import { serialNum } from "@/lib/orderDisplay";
import { ACTIVE_ORDER_STATUSES } from "@shared/orderStatus";
import { businessDayRange, todayBusinessDate, shiftBusinessDate } from "@shared/businessDay";
import { orderTypeStyle } from "@/lib/orderTypeColors";

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", minimumFractionDigits: 0,
  }).format(n);

const cardAnim = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: "easeOut" },
  }),
};

// Plain computed elapsed-time label ("12m", "1h 5m") — the page's own 5s poll on
// activeOrdersList keeps this fresh enough; no need for a per-second-ticking timer
// (OrderCard.tsx has one, but it isn't exported and this dense summary list doesn't
// need second-level precision the way the primary floor-management card does).
function elapsedLabel(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function LiveOrderRow({ order }: { order: any }) {
  const style = orderTypeStyle(order.orderType);
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--paper-0)] border border-border/40">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
          style={{ background: `${style.hex}1a` }}
        >
          {style.emoji}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{serialNum(order.id)}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {order.tableNumber ? `Table ${order.tableNumber}` : (order.customerName || "Walk-in")}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0 ml-2">
        <p className="text-xs font-bold text-foreground">{fmt(parseFloat(order.totalAmount || "0"))}</p>
        <div className="flex items-center gap-1.5 justify-end mt-0.5">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">
            {order.status}
          </span>
          <span className="text-[10px] text-muted-foreground">{elapsedLabel(order.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LiveAnalytics() {
  const now = new Date();

  // Stats always show today's live numbers — unaffected by anything else on this page.
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 0,
    refetchInterval: 5000,
  });

  // Rolling 2-business-day window (see getDashboardStats' activeResult in storage.ts,
  // which activeOrdersList below must stay in sync with) — wide enough to keep a real
  // order still open from yesterday evening, but excludes long-abandoned orphaned
  // orders that were simply never closed.
  const { data: allOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/orders", "active-window", todayBusinessDate()],
    queryFn: async () => {
      const start = businessDayRange(shiftBusinessDate(todayBusinessDate(), -1)).start;
      const r = await fetch(
        apiUrl(`/api/orders?startDate=${start.toISOString()}`),
        { credentials: "include" }
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    staleTime: 0,
    refetchInterval: 5000,
  });

  const activeOrdersList = allOrders.filter((o: any) => ACTIVE_ORDER_STATUSES.includes(o.status));

  const statCards = [
    {
      label: "Today's Sales",
      value: fmt(stats?.todaySales || 0),
      sub: `${stats?.todayOrders || 0} orders placed`,
      icon: IndianRupee,
      gradient: "from-[#226B43] to-[#1B4D33]",
      bg: "bg-violet-500/10",
    },
    {
      label: "Orders Today",
      value: String(stats?.todayOrders || 0),
      sub: `Avg ${fmt(stats?.avgOrderValue || 0)} / order`,
      icon: ShoppingBag,
      gradient: "from-[#34507A] to-[#243B5E]",
      bg: "bg-blue-500/10",
    },
    {
      label: "Active Orders",
      value: String(stats?.activeOrders || 0),
      sub: "Pending / preparing / ready",
      icon: Clock,
      gradient: "from-amber-500 to-orange-500",
      bg: "bg-amber-500/10",
    },
    {
      label: "Total Revenue",
      value: fmt(stats?.totalRevenue || 0),
      sub: "All time",
      icon: TrendingUp,
      gradient: "from-[#2E8B57] to-[#226B43]",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Low Stock",
      value: String(stats?.lowStockCount || 0),
      sub: stats?.lowStockCount > 0 ? "Needs attention" : "All good",
      icon: AlertTriangle,
      gradient: stats?.lowStockCount > 0 ? "from-red-500 to-rose-600" : "from-[#2E8B57] to-[#226B43]",
      bg: stats?.lowStockCount > 0 ? "bg-red-500/10" : "bg-green-500/10",
    },
    {
      label: "Top Item Today",
      value: stats?.topItem || "—",
      sub: "Best seller",
      icon: Star,
      gradient: "from-pink-500 to-rose-500",
      bg: "bg-pink-500/10",
    },
    {
      label: "Inner Running",
      value: String(stats?.innerRunning || 0),
      sub: `of ${stats?.totalTables || 0} total tables`,
      icon: LayoutGrid,
      gradient: "from-indigo-500 to-blue-500",
      bg: "bg-[var(--info-bg)]",
    },
    {
      label: "Outer Running",
      value: String(stats?.outerRunning || 0),
      sub: `of ${stats?.totalTables || 0} total tables`,
      icon: LayoutGrid,
      gradient: "from-teal-500 to-cyan-500",
      bg: "bg-teal-500/10",
    },
  ];

  return (
    <div className="h-[100dvh] w-screen flex flex-col bg-background overflow-hidden">

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 bg-card border-b border-border shadow-sm">
        <div className="flex items-center justify-between px-4 h-14 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base font-bold text-foreground tracking-tight whitespace-nowrap">
              Live Analytics
            </span>
            <span className="hidden sm:block text-[11px] text-muted-foreground bg-muted/60 px-2 py-1 rounded-lg whitespace-nowrap">
              Auto-refresh · 5s
            </span>
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5 shrink-0">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
            </span>
          </div>
        </div>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-5 pt-5 pb-28 md:pb-8 space-y-5 min-h-0 overscroll-contain">

        {/* ── Stat Cards (always today) — plain static tiles, no expand-on-click.
             Detailed breakdowns (sales chart, category, top items, low stock) now
             live on the Reports page — this page is the real-time operational glance. */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={cardAnim}
              className={`rounded-2xl p-4 border border-border/40 shadow-sm select-none ${card.bg}`}
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

        {/* ── Live Orders — the currently-active order list, same set the "Active
             Orders" stat card above already counts (ACTIVE_ORDER_STATUSES). Sourced
             from allOrders, already fetched/refetched every 5s for that stat's own
             count — this is the same data, just actually rendered as a list now. ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold">Live Orders</p>
            <span className="text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
              {activeOrdersList.length} active
            </span>
          </div>
          {activeOrdersList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--success-bg)" }}>
                <span className="text-lg font-bold" style={{ color: "var(--green-600)" }}>✓</span>
              </div>
              <p className="text-sm text-muted-foreground">No active orders right now</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {activeOrdersList.map((o: any) => (
                <LiveOrderRow key={o.id} order={o} />
              ))}
            </div>
          )}
        </motion.div>

      </main>
    </div>
  );
}
