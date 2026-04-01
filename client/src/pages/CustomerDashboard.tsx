import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Users,
  Phone,
  ShoppingBag,
  TrendingUp,
  Clock,
  Star,
  AlertTriangle,
  UserCheck,
  UserPlus,
  Search,
  X,
  ChevronRight,
  Flame,
  Lightbulb,
  CalendarDays,
  BarChart2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  useCustomerIntelligence,
  useCustomerOrderDetails,
  type CustomerProfile,
  type CustomerTag,
} from "@/hooks/useCustomerIntelligence";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function relativeTime(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:00 ${suffix}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ── Tag config ────────────────────────────────────────────────────────────────

type FilterKey = "all" | CustomerTag;

const TAG_CONFIG: Record<
  CustomerTag,
  { label: string; bg: string; text: string; border: string; icon: any; cardRing: string }
> = {
  VIP: {
    label: "VIP",
    bg: "bg-amber-100",
    text: "text-amber-700",
    border: "border-amber-300",
    icon: Star,
    cardRing: "ring-1 ring-amber-300/60",
  },
  Regular: {
    label: "Regular",
    bg: "bg-indigo-100",
    text: "text-indigo-700",
    border: "border-indigo-200",
    icon: UserCheck,
    cardRing: "ring-1 ring-indigo-200/60",
  },
  New: {
    label: "New",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    border: "border-emerald-200",
    icon: UserPlus,
    cardRing: "ring-1 ring-emerald-200/60",
  },
  "At Risk": {
    label: "At Risk",
    bg: "bg-red-100",
    text: "text-red-700",
    border: "border-red-200",
    icon: AlertTriangle,
    cardRing: "ring-1 ring-red-300/60",
  },
};

const FILTERS: { key: FilterKey; label: string; color: string }[] = [
  { key: "all",      label: "All",      color: "from-gray-500 to-gray-600" },
  { key: "VIP",      label: "VIP",      color: "from-amber-500 to-yellow-500" },
  { key: "Regular",  label: "Regular",  color: "from-indigo-500 to-blue-500" },
  { key: "New",      label: "New",      color: "from-emerald-500 to-teal-500" },
  { key: "At Risk",  label: "At Risk",  color: "from-red-500 to-rose-500" },
];

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatPill({
  icon: Icon,
  label,
  value,
  color,
  sub,
}: {
  icon: any;
  label: string;
  value: number | string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="flex-1 min-w-[70px] bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Tag badge ─────────────────────────────────────────────────────────────────

function TagBadge({ tag }: { tag: CustomerTag }) {
  const c = TAG_CONFIG[tag];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      <Icon className="w-2.5 h-2.5" />
      {c.label}
    </span>
  );
}

// ── Customer card ─────────────────────────────────────────────────────────────

function CustomerCard({
  customer,
  index,
  onClick,
}: {
  customer: CustomerProfile;
  index: number;
  onClick: () => void;
}) {
  const ring = TAG_CONFIG[customer.tag].cardRing;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ delay: index * 0.02, duration: 0.18, ease: "easeOut" }}
      onClick={onClick}
      className={`bg-white/70 backdrop-blur-sm border border-white/60 rounded-2xl p-3.5 shadow-sm cursor-pointer hover:shadow-md hover:bg-white/90 transition-all duration-150 ${ring}`}
    >
      {/* Row 1: name + tag + chevron */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900 truncate leading-tight">
              {customer.name}
            </h3>
            <TagBadge tag={customer.tag} />
          </div>
          {customer.phone && (
            <div className="flex items-center gap-1 mt-0.5">
              <Phone className="w-2.5 h-2.5 text-gray-400" />
              <span className="text-[10px] text-gray-400">{customer.phone}</span>
            </div>
          )}
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />
      </div>

      {/* Row 2: metrics */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-black/5">
        <div className="text-center">
          <div className="text-sm font-bold text-gray-800">{customer.totalVisits}</div>
          <div className="text-[8px] text-gray-400 font-medium">Visits</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-gray-800">
            {formatCurrency(customer.totalSpend)}
          </div>
          <div className="text-[8px] text-gray-400 font-medium">Total Spend</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-gray-800">
            {formatCurrency(customer.avgOrderValue)}
          </div>
          <div className="text-[8px] text-gray-400 font-medium">Avg Order</div>
        </div>
      </div>

      {/* Row 3: last visit + suggestion */}
      <div className="flex items-center justify-between mt-2.5 gap-2">
        <span className="flex items-center gap-1 text-[10px] text-gray-400">
          <CalendarDays className="w-2.5 h-2.5" />
          {relativeTime(customer.lastVisit)}
        </span>
        {customer.suggestion && (
          <span className="flex items-center gap-0.5 text-[8px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full truncate max-w-[130px]">
            <Lightbulb className="w-2.5 h-2.5 shrink-0" />
            {customer.tag === "At Risk" ? "Offer discount" : customer.tag === "VIP" ? "Reward VIP" : "Upgrade soon"}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ── Customer detail drawer ────────────────────────────────────────────────────

function CustomerDrawer({
  customer,
  onClose,
}: {
  customer: CustomerProfile;
  onClose: () => void;
}) {
  const orderIds = customer.orders.map(o => o.id);
  const { favoriteItem, ordersWithItems, isLoading: loadingItems } = useCustomerOrderDetails(orderIds);
  const cfg = TAG_CONFIG[customer.tag];
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed top-14 right-0 bottom-0 w-full max-w-sm bg-white/95 backdrop-blur-xl border-l border-gray-200/60 shadow-2xl z-40 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="shrink-0 px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 leading-tight">{customer.name}</h2>
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                <Icon className="w-3 h-3" />
                {cfg.label}
              </span>
            </div>
            {customer.phone && (
              <div className="flex items-center gap-1 mt-1">
                <Phone className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-500">{customer.phone}</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Smart suggestion */}
        {customer.suggestion && (
          <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200/60 rounded-xl px-3 py-2">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700 font-medium">{customer.suggestion}</p>
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* ── Key metrics ── */}
        <section>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
            Metrics
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Visits",     value: customer.totalVisits,              icon: ShoppingBag, color: "text-indigo-600" },
              { label: "Total Spend",value: formatCurrency(customer.totalSpend), icon: TrendingUp,  color: "text-emerald-600" },
              { label: "Avg Order",  value: formatCurrency(customer.avgOrderValue), icon: BarChart2, color: "text-amber-600" },
            ].map(m => (
              <div
                key={m.label}
                className="bg-gray-50 rounded-xl p-2.5 text-center"
              >
                <m.icon className={`w-3.5 h-3.5 mx-auto mb-1 ${m.color}`} />
                <div className="text-xs font-bold text-gray-800">{m.value}</div>
                <div className="text-[8px] text-gray-400 mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Behavior ── */}
        <section>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
            Behavior
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                Peak order time
              </span>
              <span className="text-xs font-semibold text-gray-800">
                {customer.peakHour !== null ? formatHour(customer.peakHour) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600">
                <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
                First visit
              </span>
              <span className="text-xs font-semibold text-gray-800">
                {formatDate(customer.firstVisit.toISOString())}
              </span>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600">
                <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
                Last visit
              </span>
              <span className="text-xs font-semibold text-gray-800">
                {relativeTime(customer.lastVisit)}
              </span>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600">
                <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                Spending tier
              </span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                customer.spendCategory === "High"
                  ? "bg-emerald-100 text-emerald-700"
                  : customer.spendCategory === "Medium"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-600"
              }`}>
                {customer.spendCategory}
              </span>
            </div>
            {favoriteItem && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <span className="flex items-center gap-2 text-xs text-gray-600">
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  Favorite item
                </span>
                <span className="text-xs font-semibold text-amber-700 truncate max-w-[120px]">
                  {favoriteItem}
                </span>
              </div>
            )}
            {loadingItems && !favoriteItem && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />
                <span className="text-xs text-gray-400">Loading order details…</span>
              </div>
            )}
          </div>
        </section>

        {/* ── Last 5 orders ── */}
        <section>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
            Recent Orders
          </h3>
          <div className="space-y-2">
            {customer.orders.slice(0, 5).map(order => (
              <div
                key={order.id}
                className="bg-gray-50 rounded-xl px-3 py-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-800">
                    #{order.orderNumber}
                  </span>
                  <span className="text-xs font-bold text-emerald-600">
                    {formatCurrency(order.totalAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-gray-400 capitalize">{order.orderType}</span>
                  <span className="text-[9px] text-gray-400">{formatDate(order.createdAt)}</span>
                </div>
                {/* Items for this order */}
                {ordersWithItems.find((o: any) => o?.id === order.id)?.items?.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200/60 space-y-0.5">
                    {ordersWithItems
                      .find((o: any) => o?.id === order.id)
                      ?.items?.slice(0, 3)
                      .map((item: any, i: number) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="text-[8px] font-bold bg-gray-200 text-gray-600 rounded px-1 py-0.5 min-w-[18px] text-center">
                            {item.quantity}x
                          </span>
                          <span className="text-[9px] text-gray-600 truncate">
                            {item.name ?? item.menuItemName ?? "Item"}
                            {item.size && <span className="text-gray-400"> ({item.size})</span>}
                          </span>
                        </div>
                      ))}
                    {(ordersWithItems.find((o: any) => o?.id === order.id)?.items?.length ?? 0) > 3 && (
                      <p className="text-[8px] text-gray-400 mt-0.5">
                        +{(ordersWithItems.find((o: any) => o?.id === order.id)?.items?.length ?? 0) - 3} more items
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CustomerDashboard() {
  const { customers, stats, isLoading } = useCustomerIntelligence();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch]   = useState("");
  const [selected, setSelected] = useState<CustomerProfile | null>(null);

  const displayed = useMemo(() => {
    let list = customers;
    if (filter !== "all") list = list.filter(c => c.tag === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        c =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q)
      );
    }
    return list;
  }, [customers, filter, search]);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Page header ──────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-100/80 shadow-sm">
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Customers</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Intelligence &amp; retention dashboard
            </p>
          </div>
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pb-3 flex gap-2">
        <StatPill icon={Users}       label="Total"        value={stats.total}       color="text-gray-700" />
        <StatPill icon={UserCheck}   label="Active Today" value={stats.activeToday} color="text-indigo-600" />
        <StatPill icon={Star}        label="VIP"          value={stats.vip}         color="text-amber-500" />
        <StatPill icon={AlertTriangle} label="At Risk"   value={stats.atRisk}      color="text-red-500" />
      </div>

      {/* ── Filters + search ──────────────────────────────────────── */}
      <div className="shrink-0 px-5 pb-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl p-1 shadow-sm">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                filter === f.key
                  ? `bg-gradient-to-br ${f.color} text-white shadow-sm`
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Name or phone…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-300 placeholder:text-gray-300"
          />
        </div>
      </div>

      {/* ── Main area ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        {/* Customer grid */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {isLoading ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-2xl bg-gray-100/80 h-[130px]" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-300">
              <Users className="w-14 h-14 mb-4" />
              <p className="text-sm font-semibold text-gray-400">No customers found</p>
              <p className="text-xs mt-1 text-gray-300">
                {customers.length === 0
                  ? "Customers appear here once orders with names/phones are placed"
                  : "Try adjusting filters or search"}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              <AnimatePresence>
                {displayed.map((customer, i) => (
                  <CustomerCard
                    key={customer.key}
                    customer={customer}
                    index={i}
                    onClick={() =>
                      setSelected(prev =>
                        prev?.key === customer.key ? null : customer
                      )
                    }
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Overlay backdrop when drawer open (mobile) */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-30 sm:hidden"
              onClick={() => setSelected(null)}
            />
          )}
        </AnimatePresence>

        {/* Detail drawer */}
        <AnimatePresence>
          {selected && (
            <CustomerDrawer
              key={selected.key}
              customer={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Legend / count bar ─────────────────────────────────────── */}
      <div className="shrink-0 px-5 py-2 border-t border-gray-100/60 flex items-center gap-4 flex-wrap">
        {FILTERS.slice(1).map(f => {
          const count = customers.filter(c => c.tag === f.key).length;
          return (
            <span key={f.key} className="text-[10px] text-gray-500 font-medium">
              {f.label}: <span className="font-bold text-gray-700">{count}</span>
            </span>
          );
        })}
        <span className="text-[10px] text-gray-400 ml-auto">
          Showing {displayed.length} of {customers.length}
        </span>
      </div>
    </div>
  );
}
