import { apiJson } from '@/lib/api';
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  IndianRupee, TrendingUp, ShoppingCart, Users, Download, Calendar,
  Banknote, Smartphone, Clock, AlertCircle,
  ChevronDown, Check, X, Send, CheckCircle2, Wallet, AlertTriangle,
  ShieldCheck, Edit3, ArrowLeftRight, Printer, MinusCircle,
} from "lucide-react";
import { serialNum } from "@/lib/orderDisplay";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import { ORDER_TYPE_STYLES } from "@/lib/orderTypeColors";
import { actionLabel, metaSummary } from "@/lib/auditFormat";

// ── Date range helpers ─────────────────────────────────────────────────────────

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function today() {
  const d = new Date();
  return toISO(d);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  return toISO(d);
}

interface DateRange {
  start: string;   // YYYY-MM-DD
  end: string;     // YYYY-MM-DD
  label: string;
}

const PRESETS: { label: string; range: () => { start: string; end: string } }[] = [
  { label: "Today",        range: () => ({ start: today(),         end: today() }) },
  { label: "Yesterday",    range: () => ({ start: daysAgo(1),      end: daysAgo(1) }) },
  { label: "Last 7 Days",  range: () => ({ start: daysAgo(6),      end: today() }) },
  { label: "Last 30 Days", range: () => ({ start: daysAgo(29),     end: today() }) },
  { label: "This Month",   range: () => ({ start: startOfMonth(),  end: today() }) },
];

function formatRangeLabel(start: string, end: string) {
  const fmt = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString("en-IN", {
      day: "numeric", month: "short",
    });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

// ── DateRangePicker component ──────────────────────────────────────────────────

function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const [open, setOpen]           = useState(false);
  const [customStart, setCustomStart] = useState(value.start);
  const [customEnd, setCustomEnd]     = useState(value.end);
  const [showCustom, setShowCustom]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function applyPreset(preset: typeof PRESETS[number]) {
    const r = preset.range();
    onChange({ ...r, label: preset.label });
    setShowCustom(false);
    setOpen(false);
  }

  function applyCustom() {
    if (!customStart || !customEnd) return;
    if (customStart > customEnd) return;
    onChange({ start: customStart, end: customEnd, label: "Custom" });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
                   bg-[var(--paper-0)] border border-[var(--line)] text-gray-700
                   hover:bg-[var(--paper-0)] transition-all shadow-sm"
      >
        <Calendar className="w-4 h-4 text-emerald-500" />
        <span>{value.label === "Custom" ? formatRangeLabel(value.start, value.end) : value.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </motion.button>

      {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl
                       bg-[var(--paper-0)] border border-[var(--line)]
                       shadow-xl shadow-black/10 p-2 overflow-hidden"
          >
            {/* Presets */}
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 py-1.5">
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
                                ? "bg-emerald-50 text-emerald-700 font-semibold"
                                : "text-gray-700 hover:bg-gray-50"
                            }`}
              >
                {p.label}
                {value.label === p.label && <Check className="w-3.5 h-3.5 text-emerald-500" />}
              </button>
            ))}

            {/* Custom range */}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                type="button"
                onClick={() => setShowCustom(s => !s)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm
                            transition-colors text-left ${
                              value.label === "Custom"
                                ? "bg-emerald-50 text-emerald-700 font-semibold"
                                : "text-gray-700 hover:bg-gray-50"
                            }`}
              >
                Custom Range
                {value.label === "Custom" && <Check className="w-3.5 h-3.5 text-emerald-500" />}
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
                      <label className="block text-[10px] text-gray-500 mb-1">From</label>
                      <input
                        type="date"
                        value={customStart}
                        max={customEnd || today()}
                        onChange={e => setCustomStart(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5
                                   focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">To</label>
                      <input
                        type="date"
                        value={customEnd}
                        min={customStart}
                        max={today()}
                        onChange={e => setCustomEnd(e.target.value)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5
                                   focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={applyCustom}
                      disabled={!customStart || !customEnd || customStart > customEnd}
                      className="w-full py-1.5 rounded-xl text-xs font-semibold bg-emerald-500
                                 text-white hover:bg-emerald-600 disabled:bg-gray-200
                                 disabled:text-gray-400 transition-colors"
                    >
                      Apply
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", minimumFractionDigits: 0,
  }).format(amount);

function buildParams(range: DateRange) {
  return `?startDate=${range.start}&endDate=${range.end}`;
}

// Category-slice colors for the Sales-by-Category donut — same literal hex array
// LiveAnalytics.tsx's own PALETTE uses (that file independently duplicates its own
// copy too — tolerated small-helper duplication, same as this page's already-duplicated
// DateRangePicker). Unrelated to ORDER_TYPE_STYLES above, which colors the 3-series
// dine-in/pickup/delivery chart, not the category breakdown.
const CATEGORY_PALETTE = [
  "#1B4D33", "#34507A", "#B85C38", "#D89A3E",
  "#2E8B57", "#9E4A28", "#6FBF73", "#243B5E",
];

// ── Dues: one customer's open tabs (expandable), with e-bill + settle-all actions ──
function DuesCustomerCard({ c, onEbill, onSettle, ebillPending, settlePending }: {
  c: any;
  onEbill: (key: string) => void;
  onSettle: (key: string, paymentMethod: "cash" | "upi") => void;
  ebillPending: boolean;
  settlePending: boolean;
}) {
  const [open, setOpen] = useState(false);
  // "Mark all paid" used to settle immediately on a plain window.confirm, with no way
  // to record which method the money actually came in via — it silently defaulted to
  // "cash" server-side (and even that default was unreliable, see settleCustomerTabs'
  // fix). Clicking now reveals this inline Cash/UPI choice instead; picking one both
  // confirms AND records the real method in one step.
  const [pickingMethod, setPickingMethod] = useState(false);
  const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);
  return (
    <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-3 min-w-0 text-left flex-1">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-sm font-bold text-red-600 shrink-0">
            {(c.name || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-800 truncate">{c.name || "Walk-in"}</p>
            <p className="text-xs text-gray-500">{c.phone || "no phone"} · {c.orderCount} order{c.orderCount !== 1 ? "s" : ""}</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <div className="text-right shrink-0">
          <p className="font-bold text-red-600">{inr(c.totalDue)}</p>
          <span className="text-[10px] text-red-400">outstanding</span>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-[var(--line)] pt-3">
          {c.orders.map((o: any) => (
            <div key={o.id} className="rounded-xl bg-red-50/40 border border-red-200/40 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-700">{serialNum(o.id)} · {o.orderNumber}</span>
                <span className="text-xs font-bold text-red-600">{inr(o.total)}</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-1">{new Date(o.createdAt).toLocaleString("en-IN")}</p>
              <div className="space-y-0.5">
                {o.items.map((it: any, i: number) => (
                  <div key={i} className="flex justify-between text-[11px] text-gray-600">
                    <span>{it.name} × {it.quantity}</span>
                    <span>{inr(it.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 px-4 pb-4">
        <button
          onClick={() => onEbill(c.key)}
          disabled={!c.phone || ebillPending}
          title={c.phone ? "Send a consolidated bill via WhatsApp" : "No phone number on file"}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-3.5 h-3.5" /> Send e-bill
        </button>
        {pickingMethod ? (
          <div className="flex-1 flex items-center gap-1.5">
            <span className="text-[11px] text-gray-500 shrink-0">Paid via</span>
            <button
              onClick={() => { onSettle(c.key, "cash"); setPickingMethod(false); }}
              disabled={settlePending}
              className="flex-1 h-9 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              Cash
            </button>
            <button
              onClick={() => { onSettle(c.key, "upi"); setPickingMethod(false); }}
              disabled={settlePending}
              className="flex-1 h-9 rounded-xl text-xs font-semibold bg-[var(--paper-0)] border border-[var(--line)] text-gray-700 hover:bg-[var(--paper-100)] disabled:opacity-40 transition-colors"
            >
              UPI
            </button>
            <button
              onClick={() => setPickingMethod(false)}
              disabled={settlePending}
              title="Cancel"
              className="w-9 h-9 shrink-0 rounded-xl border border-[var(--line)] text-gray-400 hover:bg-gray-50 disabled:opacity-40 transition-colors flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPickingMethod(true)}
            disabled={settlePending}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-semibold bg-[var(--paper-0)] border border-[var(--line)] text-gray-700 hover:bg-[var(--paper-100)] disabled:opacity-40 transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Mark all paid
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Reports() {
  const [activeTab, setActiveTab] = useState("sales");
  // Cost/margin is sensitive business data (same tier as payroll) — never shown to staff.
  const role = useRole();
  const canSeeCost = role === "admin" || role === "manager";
  // The KOT & Bill Activity tab reveals who cancelled/modified/waived off money — same
  // access tier as cost/margin. /reports itself is currently hardcoded admin-only at the
  // route-permission layer (client/src/lib/routePermissions.ts), so in practice only an
  // admin session reaches this today — this is forward-compatible defense-in-depth for if
  // that ever opens to managers, matching the server route's own requireManagerOrAdmin gate.
  const canSeeKotBillActivity = role === "admin" || role === "manager";

  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    start: today(),
    end:   today(),
    label: "Today",
  }));

  const params = buildParams(dateRange);

  // apiJson() checks res.ok and throws before parsing — a hand-rolled
  // fetch(...).then(r => r.json()) here used to let a non-2xx response's JSON error
  // body flow straight into downstream .map()/.reduce() calls as if it were real report
  // data, crashing the page instead of surfacing through React Query's error state.
  const { data: salesReport, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/sales", dateRange.start, dateRange.end],
    queryFn: () => apiJson(`/api/reports/sales${params}`),
  });

  // Petpooja-style channel-stacked sales chart — replaces the old single-series
  // /api/reports/weekly consumption (that endpoint is left in place, untouched, in case
  // of another/future caller — see CLAUDE.md-style history). Reconciles with the
  // "Total Sales" stat card above (cancelled orders excluded, shortfall netted out).
  const { data: salesByTypeData = [] } = useQuery<any[]>({
    queryKey: ["/api/reports/sales-by-type", dateRange.start, dateRange.end],
    queryFn: () => apiJson<any[]>(`/api/reports/sales-by-type${params}`),
  });

  // Already-existing endpoint (LiveAnalytics.tsx's own dashboard used to consume this) —
  // no backend change, just a new consumer, ported here alongside the sales chart.
  const { data: categorySalesData = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/category-sales", dateRange.start, dateRange.end],
    queryFn: () => apiJson<any[]>(`/api/dashboard/category-sales${params}`),
  });

  // Not date-range scoped, matching how this worked on LiveAnalytics.tsx before.
  const { data: lowStockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/inventory/low-stock"],
    queryFn: () => apiJson<any[]>(`/api/inventory/low-stock`),
    refetchInterval: 10000,
  });

  // Manager+admin only — see canSeeKotBillActivity above. `enabled` so a bare staff
  // session never fires a request the server would just 403 anyway.
  const { data: kotBillActivity } = useQuery<any>({
    queryKey: ["/api/reports/kot-bill-activity", dateRange.start, dateRange.end],
    queryFn: () => apiJson(`/api/reports/kot-bill-activity${params}`),
    enabled: canSeeKotBillActivity,
  });

  const { data: topItemsData = [] } = useQuery<any[]>({
    queryKey: ["/api/reports/top-items", dateRange.start, dateRange.end],
    queryFn: () => apiJson<any[]>(`/api/reports/top-items${params}`),
  });

  const { data: paymentSummary } = useQuery<any>({
    queryKey: ["/api/reports/payment-summary", dateRange.start, dateRange.end],
    queryFn: () => apiJson(`/api/reports/payment-summary${params}`),
  });

  const { data: staffTableReport = [] } = useQuery<Array<{
    date: string; staff: string; tables: string[]; orderCount: number; revenue: number;
  }>>({
    queryKey: ["/api/reports/staff-tables", dateRange.start, dateRange.end],
    queryFn: () => apiJson(`/api/reports/staff-tables${params}`),
  });

  const { data: cancelledReport } = useQuery<any>({
    queryKey: ["/api/reports/cancelled", dateRange.start, dateRange.end],
    queryFn: () => apiJson(`/api/reports/cancelled${params}`),
  });
  const [cancelledModeFilter, setCancelledModeFilter] = useState<"all" | "dine-in" | "takeaway" | "delivery">("all");

  const { toast } = useToast();
  // Outstanding tabs are "current," not date-bound — no date params.
  const { data: dues } = useQuery<any>({
    queryKey: ["/api/reports/tabs"],
    queryFn: () => apiJson(`/api/reports/tabs`),
  });

  const invalidateDues = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/reports/tabs"] });
    queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").startsWith("/api/reports/payment-summary") });
  };

  const ebillMutation = useMutation({
    mutationFn: async (key: string) => apiRequest("POST", "/api/dues/send-ebill", { key }),
    onSuccess: async (res: any) => {
      const data = await res.json().catch(() => ({}));
      if (data?.mode === "driver") toast({ title: "E-bill sent via WhatsApp" });
      else { if (data?.waUrl) window.open(data.waUrl, "_blank"); toast({ title: "Opening WhatsApp…" }); }
    },
    onError: (err: any) => toast({ title: "Failed to send e-bill", description: err.message, variant: "destructive" }),
  });

  const settleCustomerMutation = useMutation({
    mutationFn: async ({ key, paymentMethod }: { key: string; paymentMethod: "cash" | "upi" }) =>
      apiRequest("POST", "/api/dues/settle-customer", { key, paymentMethod }),
    onSuccess: (_res, vars) => {
      toast({ title: `Tabs marked paid via ${vars.paymentMethod === "cash" ? "Cash" : "UPI"}` });
      invalidateDues();
    },
    onError: (err: any) => toast({ title: "Failed to settle", description: err.message, variant: "destructive" }),
  });

  const topItems  = topItemsData.map((d: any) => ({
    name: d.name, sold: d.totalSold, revenue: d.revenue,
    cost: d.cost, margin: d.margin, costCoverageQty: d.costCoverageQty ?? 0,
  }));
  // Total per day-bar, for the stacked chart's implicit "sum of the 3 series" reading —
  // used only by handleExport's CSV (the chart itself renders the 3 series directly).
  const salesByType = salesByTypeData.map((d: any) => ({
    name: d.date, dineIn: d.dineIn ?? 0, takeaway: d.takeaway ?? 0, delivery: d.delivery ?? 0,
  }));

  const tabs = [
    { id: "sales",     label: "Sales Chart" },
    { id: "items",     label: "Top Items" },
    { id: "orders",    label: "Order Details" },
    { id: "payments",  label: "Payments" },
    { id: "staff",     label: "Staff & Tables" },
    { id: "cancelled", label: "Cancelled Orders" },
    { id: "lowstock",  label: "Low Stock" },
    ...(canSeeKotBillActivity ? [{ id: "kotbill", label: "KOT & Bill Activity" }] : []),
  ];

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-[var(--paper-50)]">
        <Header title="Reports" description="Loading reports..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      label: "Total Sales",
      value: formatCurrency(salesReport?.totalSales || 0),
      sub: `${salesReport?.totalOrders || 0} orders in range`,
      icon: <IndianRupee className="w-7 h-7 text-emerald-500" />,
      subColor: "text-emerald-600",
    },
    {
      label: "Total Orders",
      value: salesReport?.totalOrders || 0,
      sub: formatRangeLabel(dateRange.start, dateRange.end),
      icon: <ShoppingCart className="w-7 h-7 text-blue-500" />,
      subColor: "text-blue-500",
    },
    {
      label: "Avg Order Value",
      value: formatCurrency(salesReport?.avgOrderValue || 0),
      sub: "per order",
      icon: <TrendingUp className="w-7 h-7 text-orange-500" />,
      subColor: "text-orange-500",
    },
    {
      label: "Unique Customers",
      value: salesReport?.uniqueCustomers ??
        new Set((salesReport?.orders ?? []).map((o: any) => o.customerPhone || o.customerName).filter(Boolean)).size,
      sub: "with identifiable data",
      icon: <Users className="w-7 h-7 text-purple-500" />,
      subColor: "text-purple-500",
    },
    // Only shown when a short settle actually happened in range — a restaurant that never
    // writes off a balance sees the same 4-card dashboard as before this feature existed.
    ...((salesReport?.totalShortfall || 0) > 0 ? [{
      label: "Shortfall / Loss",
      value: formatCurrency(salesReport.totalShortfall),
      sub: "written off on short-settled bills",
      icon: <IndianRupee className="w-7 h-7 text-red-500" />,
      subColor: "text-red-600",
    }] : []),
  ];

  // Export the currently-active tab's data as a CSV for the selected date range.
  function handleExport() {
    const range = `${dateRange.start}_to_${dateRange.end}`;
    let filename = "report";
    let header: string[] = [];
    let rows: (string | number)[][] = [];

    if (activeTab === "items") {
      filename = `top-items_${range}`;
      header = ["Item", "Qty Sold", "Revenue"];
      rows = topItems.map((t: any) => [t.name, t.sold ?? 0, t.revenue ?? 0]);
    } else if (activeTab === "payments") {
      filename = `payments_${range}`;
      header = ["Method", "Count", "Amount"];
      rows = ["cash", "upi"].map((k) => {
        const d = paymentSummary?.breakdown?.[k] || { count: 0, amount: 0 };
        return [k, d.count ?? 0, d.amount ?? 0];
      });
    } else if (activeTab === "staff") {
      filename = `staff-tables_${range}`;
      header = ["Date", "Staff", "Tables", "Orders", "Revenue"];
      rows = staffTableReport.map((s) => [s.date, s.staff, (s.tables ?? []).join(" "), s.orderCount ?? 0, s.revenue ?? 0]);
    } else if (activeTab === "sales") {
      filename = `sales-by-type_${range}`;
      header = ["Period", "Dine-in", "Pickup", "Delivery", "Total"];
      rows = salesByType.map((d: any) => [d.name, d.dineIn, d.takeaway, d.delivery, d.dineIn + d.takeaway + d.delivery]);
    } else if (activeTab === "lowstock") {
      filename = `low-stock_${range}`;
      header = ["Item", "Current Stock", "Min Stock", "Unit"];
      rows = lowStockItems.map((i: any) => [i.itemName, i.currentStock, i.minStock, i.unit]);
    } else if (activeTab === "kotbill") {
      filename = `kot-bill-activity_${range}`;
      header = ["Time", "Actor", "Action", "Details"];
      rows = (kotBillActivity?.recentEvents ?? []).map((e: any) => [
        new Date(e.createdAt).toLocaleString("en-IN"),
        e.actorName ?? "",
        actionLabel(e.action).label,
        metaSummary(e.action, e.metadata),
      ]);
    } else if (activeTab === "cancelled") {
      filename = `cancelled-orders_${range}`;
      header = ["Order #", "Date", "Customer", "Mode", "Amount", "Reason"];
      const cancelledOrders: any[] = cancelledReport?.orders ?? [];
      const filtered = cancelledModeFilter === "all"
        ? cancelledOrders
        : cancelledOrders.filter((o: any) => o.orderType === cancelledModeFilter);
      rows = filtered.map((o: any) => [
        serialNum(o.id),
        new Date(o.createdAt).toLocaleString("en-IN"),
        o.customerName || "Walk-in",
        o.orderType || "",
        parseFloat(o.totalAmount || 0).toFixed(2),
        o.cancelReason || "",
      ]);
    } else {
      filename = `orders_${range}`;
      header = ["Order #", "Date", "Customer", "Phone", "Type", "Payment", "Amount", "Short"];
      rows = (salesReport?.orders ?? []).map((o: any) => [
        serialNum(o.id),
        new Date(o.createdAt).toLocaleString("en-IN"),
        o.customerName || "Walk-in",
        o.customerPhone || "",
        o.orderType || "",
        o.paymentMethod || "",
        parseFloat(o.totalAmount || 0).toFixed(2),
        parseFloat(o.shortfallAmount || 0).toFixed(2),
      ]);
    }

    if (rows.length === 0) { alert("No data to export for this period."); return; }

    const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    // BOM so Excel reads UTF-8 (₹ etc.) correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--paper-50)]">
      <Header title="Reports" description="Analytics and insights for your restaurant performance" />

      <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
        {/* Toolbar */}
        <div className="mb-6 flex justify-between items-center flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Sales Analytics</h2>
            <p className="text-sm text-gray-500">{formatRangeLabel(dateRange.start, dateRange.end)}</p>
          </div>
          <div className="flex gap-2 items-center">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
                         bg-[var(--paper-0)] border border-[var(--line)] text-gray-600
                         hover:bg-[var(--paper-0)] transition-all"
            >
              <Download className="w-4 h-4" /> Export
            </motion.button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5
                         hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 hover:bg-[var(--paper-0)]
                         transition-all duration-200"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-800 mt-0.5">{card.value}</p>
                  <p className={`text-xs mt-1 ${card.subColor}`}>{card.sub}</p>
                </div>
                {card.icon}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tabs */}
        <div className="rounded-xl bg-[var(--paper-100)] border border-[var(--line)] p-1 flex gap-1 mb-5 w-fit max-w-full overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm"
                  : "text-gray-600 hover:bg-[var(--paper-0)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Sales Chart (Petpooja-style: channel-stacked dine-in/pickup/delivery) ── */}
        {activeTab === "sales" && (() => {
          const hasSales = salesByType.some((d: any) => d.dineIn + d.takeaway + d.delivery > 0);
          return (
          <motion.div
            key={`sales-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold text-gray-800">Sales Performance</h3>
                <span className="text-xs text-gray-400">{formatRangeLabel(dateRange.start, dateRange.end)}</span>
              </div>
              {/* Manual 3-swatch legend — matches the category donut's own manual legend
                  style below, rather than recharts' built-in <Legend>. */}
              <div className="flex items-center gap-4 mb-3">
                {(["dine-in", "takeaway", "delivery"] as const).map((k) => (
                  <span key={k} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: ORDER_TYPE_STYLES[k].hex }} />
                    {ORDER_TYPE_STYLES[k].label}
                  </span>
                ))}
              </div>
              {!hasSales ? (
                <div className="h-80 flex items-center justify-center text-gray-400 text-sm">
                  No sales data for this period
                </div>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesByType} margin={{ right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: salesByType.length > 14 ? 9 : 11 }}
                        interval={salesByType.length > 20 ? Math.floor(salesByType.length / 10) : 0}
                      />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        formatter={(value, name) => [
                          formatCurrency(value as number),
                          name === "dineIn" ? ORDER_TYPE_STYLES["dine-in"].label
                            : name === "takeaway" ? ORDER_TYPE_STYLES["takeaway"].label
                            : ORDER_TYPE_STYLES["delivery"].label,
                        ]}
                      />
                      {/* stackId shared across all 3 series — each day-group's total bar
                          height reconciles with the "Total Sales" stat card above. */}
                      <Bar dataKey="dineIn" name="dineIn" stackId="a" fill={ORDER_TYPE_STYLES["dine-in"].hex} />
                      <Bar dataKey="takeaway" name="takeaway" stackId="a" fill={ORDER_TYPE_STYLES["takeaway"].hex} />
                      <Bar dataKey="delivery" name="delivery" stackId="a" fill={ORDER_TYPE_STYLES["delivery"].hex} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Sales by Category — ported from LiveAnalytics.tsx's own donut chart, same
                data (/api/dashboard/category-sales), no backend change. */}
            <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-gray-800">Sales by Category</h3>
                <span className="text-xs text-gray-400">{formatRangeLabel(dateRange.start, dateRange.end)}</span>
              </div>
              {categorySalesData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
                  No sales in range
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={categorySalesData}
                        dataKey="total"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        paddingAngle={3}
                      >
                        {categorySalesData.map((_: any, idx: number) => (
                          <Cell key={idx} fill={CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(value as number)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5">
                    {categorySalesData.slice(0, 5).map((c: any, idx: number) => (
                      <div key={c.category} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length] }} />
                          <span className="text-gray-500 truncate">{c.category}</span>
                        </span>
                        <span className="font-semibold text-gray-700 ml-2 flex-shrink-0">{formatCurrency(c.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
          );
        })()}

        {/* ── Top Items ── */}
        {activeTab === "items" && (
          <motion.div
            key={`items-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">Top Selling Items</h3>
              <span className="text-xs text-gray-400">{formatRangeLabel(dateRange.start, dateRange.end)}</span>
            </div>
            <div className="space-y-3">
              {topItems.map((item, index) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#226B43] to-[#1B4D33] flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.sold} units sold</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-gray-800">{formatCurrency(item.revenue)}</p>
                    {(salesReport?.totalSales ?? 0) > 0 && (
                      <span className="text-[11px] font-medium bg-emerald-100/80 text-emerald-700 px-2 py-0.5 rounded-lg">
                        {((item.revenue / salesReport.totalSales) * 100).toFixed(1)}%
                      </span>
                    )}
                    {canSeeCost && (
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {item.margin != null ? (
                          <>
                            Margin: <span className="font-medium text-gray-600">{item.margin.toFixed(0)}%</span>
                            {item.costCoverageQty < item.sold && (
                              <span className="text-amber-600"> (based on {item.costCoverageQty}/{item.sold} sold)</span>
                            )}
                          </>
                        ) : (
                          "Cost data unavailable"
                        )}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {topItems.length === 0 && (
                <p className="text-center text-gray-400 py-8">No data for this period</p>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Order Details ── */}
        {activeTab === "orders" && (
          <motion.div
            key={`orders-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">
                Orders
                <span className="ml-2 text-xs font-normal text-gray-400">
                  ({salesReport?.orders?.length ?? 0} total)
                </span>
              </h3>
              <span className="text-xs text-gray-400">{formatRangeLabel(dateRange.start, dateRange.end)}</span>
            </div>
            <div className="space-y-3 max-h-[28rem] overflow-y-auto">
              {salesReport?.orders?.map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]"
                >
                  <div>
                    <p className="font-medium text-sm text-gray-800">{serialNum(order.id)}</p>
                    <p className="text-xs text-gray-500">{order.customerName || "Walk-in"} · {order.orderType}</p>
                    <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleString("en-IN")}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-gray-800">{formatCurrency(parseFloat(order.totalAmount))}</p>
                    <span className="text-[11px] font-medium bg-[var(--paper-0)] border border-[var(--line)] text-gray-600 px-2 py-0.5 rounded-lg">
                      {order.paymentMethod}
                    </span>
                    {parseFloat(order.shortfallAmount || 0) > 0 && (
                      <p className="text-[11px] font-medium text-red-600 mt-0.5">
                        {formatCurrency(parseFloat(order.shortfallAmount))} short
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {(!salesReport?.orders || salesReport.orders.length === 0) && (
                <p className="text-center text-gray-400 py-8">No orders in this period</p>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Payments ── */}
        {activeTab === "payments" && (
          <motion.div
            key={`payments-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-gray-800">Payment Summary</h3>
                <span className="text-xs text-gray-400">{formatRangeLabel(dateRange.start, dateRange.end)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {/* Only Cash and UPI are real payment modes at this restaurant — the
                    backend breakdown is keyed by whatever orders.paymentMethod values
                    exist (Billing.tsx's legacy "Mark as Paid" dropdown still technically
                    offers Card/Online too), but any such stray amount still counts
                    toward "Total Collected" below, so nothing is silently hidden from
                    the actual total, just not broken out into its own tile here. */}
                {[
                  { key: "cash", label: "Cash", icon: <Banknote className="w-5 h-5" />, color: "from-[#226B43] to-[#1B4D33]", bg: "bg-emerald-50/60", text: "text-emerald-700" },
                  { key: "upi",  label: "UPI",  icon: <Smartphone className="w-5 h-5" />, color: "from-[#CD6E3E] to-[#B85C38]", bg: "bg-purple-50/60", text: "text-purple-700" },
                ].map(({ key, label, icon, color, bg, text }) => {
                  const d = paymentSummary?.breakdown?.[key] || { count: 0, amount: 0 };
                  return (
                    <div key={key} className={`rounded-xl ${bg} border border-[var(--line)] p-4`}>
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white mb-3`}>
                        {icon}
                      </div>
                      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                      <p className={`text-lg font-bold ${text}`}>{formatCurrency(d.amount)}</p>
                      <p className="text-xs text-gray-400">{d.count} order{d.count !== 1 ? "s" : ""}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 pt-4 border-t border-[var(--line)]">
                <div className="flex-1 min-w-[140px] rounded-xl bg-emerald-50/60 border border-emerald-200/40 p-3">
                  <p className="text-xs text-gray-500">Total Collected</p>
                  <p className="text-xl font-bold text-emerald-700">{formatCurrency(paymentSummary?.totalPaid || 0)}</p>
                </div>
                <div className="flex-1 min-w-[140px] rounded-xl bg-red-50/60 border border-red-200/40 p-3">
                  <p className="text-xs text-gray-500">Total Due</p>
                  <p className="text-xl font-bold text-red-600">{formatCurrency(paymentSummary?.totalDue || 0)}</p>
                  <p className="text-xs text-red-400">
                    {paymentSummary?.dueCount || 0} unpaid order{paymentSummary?.dueCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            </div>

            {(paymentSummary?.dueOrders?.length > 0) && (
              <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5">
                <div className="flex items-center gap-2 mb-4">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  <h3 className="text-base font-semibold text-gray-800">Unpaid / Due Orders</h3>
                  <span className="ml-auto text-xs font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                    {paymentSummary.dueOrders.length} pending
                  </span>
                </div>
                <div className="space-y-2">
                  {paymentSummary.dueOrders.map((order: any) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-red-50/50 border border-red-200/40"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-red-500" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-gray-800">
                            {order.tableNumber ? `Table ${order.tableNumber}` : serialNum(order.id)}
                          </p>
                          <p className="text-xs text-gray-500">{order.customerName || "Walk-in"} · {order.orderType}</p>
                          <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleString("en-IN")}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm text-red-600">{formatCurrency(parseFloat(order.totalAmount))}</p>
                        <span className="text-[11px] font-medium bg-red-100 text-red-600 px-2 py-0.5 rounded-lg">Due</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(paymentSummary?.dueCount === 0) && (
              <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                  <IndianRupee className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-gray-600 font-medium">No pending payments</p>
                <p className="text-sm text-gray-400">All orders have been settled</p>
              </div>
            )}

            {/* ── Dues / Pay-Later — merged into this tab (was its own tab) so the
                 customer-grouped view of the same due orders above lives right next to
                 them, instead of behind a separate click. ── */}
            <div className="pt-2">
              <h3 className="text-base font-semibold text-gray-800 mb-3">Dues / Pay-Later — by Customer</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                <div className="rounded-xl bg-red-50/60 border border-red-200/40 p-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white mb-2">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <p className="text-xs text-gray-500">Total Outstanding</p>
                  <p className="text-xl font-bold text-red-600">{formatCurrency(dues?.totalOutstanding || 0)}</p>
                </div>
                <div className="rounded-xl bg-amber-50/60 border border-amber-200/40 p-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white mb-2">
                    <ShoppingCart className="w-5 h-5" />
                  </div>
                  <p className="text-xs text-gray-500">Open Tabs (orders)</p>
                  <p className="text-xl font-bold text-amber-700">{dues?.orderCount || 0}</p>
                </div>
                <div className="rounded-xl bg-blue-50/60 border border-blue-200/40 p-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white mb-2">
                    <Users className="w-5 h-5" />
                  </div>
                  <p className="text-xs text-gray-500">Customers with Dues</p>
                  <p className="text-xl font-bold text-blue-700">{dues?.customerCount || 0}</p>
                </div>
              </div>

              {(dues?.customers?.length > 0) ? (
                <div className="space-y-3">
                  {dues.customers.map((c: any) => (
                    <DuesCustomerCard
                      key={c.key}
                      c={c}
                      onEbill={(key) => ebillMutation.mutate(key)}
                      onSettle={(key, paymentMethod) => settleCustomerMutation.mutate({ key, paymentMethod })}
                      ebillPending={ebillMutation.isPending}
                      settlePending={settleCustomerMutation.isPending}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  </div>
                  <p className="text-gray-600 font-medium">No open tabs</p>
                  <p className="text-sm text-gray-400">Everyone's settled up</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Staff & Tables ── */}
        {activeTab === "staff" && (
          <motion.div
            key={`staff-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800">Staff Table Assignments</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Which staff member served which table, per day</p>
                </div>
                <span className="text-sm font-medium text-emerald-600">{staffTableReport.length} entries</span>
              </div>
              {staffTableReport.length === 0 ? (
                <div className="p-10 text-center">
                  <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No data for this period</p>
                  <p className="text-sm text-gray-400 mt-1">Orders must be placed while staff are logged in</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--paper-100)] text-left">
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Staff</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tables Served</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Orders</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/20">
                      {staffTableReport.map((row, i) => (
                        <tr key={i} className="hover:bg-[var(--paper-100)] transition-colors">
                          <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                            {new Date(row.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 shrink-0">
                                {row.staff.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-medium text-gray-800">{row.staff}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.tables.map(t => (
                                <span key={t} className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-100">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-gray-700">{row.orderCount}</td>
                          <td className="px-5 py-3 text-right font-semibold text-emerald-700">₹{row.revenue.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Cancelled Orders ── */}
        {activeTab === "cancelled" && (() => {
          const modeFilters: { id: "all" | "dine-in" | "takeaway" | "delivery"; label: string }[] = [
            { id: "all", label: "All" },
            { id: "dine-in", label: "Dine-in" },
            { id: "takeaway", label: "Pickup" },
            { id: "delivery", label: "Delivery" },
          ];
          const cancelledOrders: any[] = cancelledReport?.orders ?? [];
          const filtered = cancelledModeFilter === "all"
            ? cancelledOrders
            : cancelledOrders.filter(o => o.orderType === cancelledModeFilter);
          const filteredTotal = filtered.reduce((s, o) => s + parseFloat(o.totalAmount || "0"), 0);
          return (
          <motion.div
            key={`cancelled-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5 flex items-center gap-4">
                <X className="w-7 h-7 text-red-500 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-gray-800">{cancelledReport?.totalCancelled ?? 0}</p>
                  <p className="text-xs text-gray-400">Cancelled orders in range</p>
                </div>
              </div>
              <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5 flex items-center gap-4">
                <IndianRupee className="w-7 h-7 text-red-500 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-gray-800">{formatCurrency(cancelledReport?.wouldBeTotal ?? 0)}</p>
                  <p className="text-xs text-gray-400">Would-be revenue lost</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="font-semibold text-gray-800">
                    Cancelled Orders
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      ({filtered.length} shown{cancelledModeFilter !== "all" ? ` · ${formatCurrency(filteredTotal)}` : ""})
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">{formatRangeLabel(dateRange.start, dateRange.end)}</p>
                </div>
                <div className="flex gap-1.5">
                  {modeFilters.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setCancelledModeFilter(m.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        cancelledModeFilter === m.id
                          ? "bg-red-500 text-white border-red-500"
                          : "bg-[var(--paper-0)] text-gray-600 border-[var(--line)] hover:bg-red-50"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {filtered.length === 0 ? (
                <div className="p-10 text-center">
                  <X className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No cancelled orders</p>
                  <p className="text-sm text-gray-400 mt-1">Nothing was cancelled in this period{cancelledModeFilter !== "all" ? " for this mode" : ""}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--paper-100)] text-left">
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Order</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Time</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Mode</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Amount</th>
                        <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/20">
                      {filtered.map((order: any) => (
                        <tr key={order.id} className="hover:bg-[var(--paper-100)] transition-colors">
                          <td className="px-5 py-3 font-medium text-gray-800 whitespace-nowrap">{serialNum(order.id)}</td>
                          <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                            {new Date(order.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-5 py-3 text-gray-600">{order.customerName || "Walk-in"}</td>
                          <td className="px-5 py-3">
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-medium capitalize">
                              {order.orderType?.replace("-", " ") || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-gray-700">{formatCurrency(parseFloat(order.totalAmount || "0"))}</td>
                          <td className="px-5 py-3 text-gray-600 max-w-xs truncate" title={order.cancelReason || ""}>
                            {order.cancelReason || <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
          );
        })()}

        {/* ── Low Stock — ported from LiveAnalytics.tsx's own Low Stock Alerts card,
             same data (/api/inventory/low-stock), no backend change, not date-scoped
             (matches how this worked there). ── */}
        {activeTab === "lowstock" && (
          <motion.div
            key="lowstock"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                {lowStockItems.length > 0 && <AlertTriangle className="w-4 h-4 text-red-500" />}
                Low Stock Alerts
              </h3>
              {lowStockItems.length > 0 && (
                <span className="text-[11px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                  {lowStockItems.length} item{lowStockItems.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {lowStockItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-gray-600 font-medium">All items in stock</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {lowStockItems.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-red-50/60 border border-red-200/50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.itemName}</p>
                      <p className="text-xs text-gray-500">Min: {item.minStock} {item.unit}</p>
                    </div>
                    <span className="text-sm font-bold text-red-500 ml-2 shrink-0">{item.currentStock} {item.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── KOT & Bill Activity (Petpooja's "Leakage Alert") — manager+admin only ── */}
        {activeTab === "kotbill" && canSeeKotBillActivity && (
          <motion.div
            key={`kotbill-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="w-5 h-5 text-gray-500" />
                <h3 className="text-base font-semibold text-gray-800">KOT & Bill Activity</h3>
                <span className="text-xs text-gray-400 ml-auto">{formatRangeLabel(dateRange.start, dateRange.end)}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">KOTs</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><X className="w-4 h-4 text-red-500" /> Cancelled</span>
                      <span className="font-bold text-gray-800">{kotBillActivity?.kotCancelled ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><Edit3 className="w-4 h-4 text-amber-500" /> Modified</span>
                      <span className="font-bold text-gray-800">{kotBillActivity?.kotModified ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><ArrowLeftRight className="w-4 h-4 text-blue-500" /> Shifted</span>
                      <span className="font-bold text-gray-800">{kotBillActivity?.kotShifted ?? 0}</span>
                    </div>
                    {/* One line item removed after its KOT was already sent — distinct from
                        "Cancelled" above, which is the whole order voided (order.cancel). */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><AlertTriangle className="w-4 h-4 text-orange-500" /> Item Cancelled</span>
                      <span className="font-bold text-gray-800">{kotBillActivity?.kotItemCancelled ?? 0}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Bills</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><Edit3 className="w-4 h-4 text-amber-500" /> Modified</span>
                      <span className="font-bold text-gray-800">{kotBillActivity?.billModified ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><Printer className="w-4 h-4 text-sky-500" /> Re-printed</span>
                      <span className="font-bold text-gray-800">{kotBillActivity?.billReprinted ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--paper-0)] border border-[var(--line)]">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><MinusCircle className="w-4 h-4 text-red-500" /> Waived off</span>
                      <span className="font-bold text-gray-800">{kotBillActivity?.billWaivedOff ?? 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--line)]">
                <h3 className="font-semibold text-gray-800">Recent Activity</h3>
                <p className="text-xs text-gray-400 mt-0.5">Most recent 20 events in range</p>
              </div>
              {(kotBillActivity?.recentEvents?.length ?? 0) === 0 ? (
                <div className="p-10 text-center">
                  <ShieldCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No activity in this period</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--line)]">
                  {kotBillActivity.recentEvents.map((e: any) => {
                    const badge = actionLabel(e.action);
                    return (
                      <div key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.label}</span>
                            <span className="text-gray-500 text-xs">{e.actorName}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{metaSummary(e.action, e.metadata)}</p>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0 ml-3">
                          {new Date(e.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
