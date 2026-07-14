import { apiUrl } from '@/lib/api';
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  DollarSign, TrendingUp, ShoppingCart, Users, Download, Calendar,
  Banknote, CreditCard, Smartphone, Clock, AlertCircle, Wifi,
  ChevronDown, Check, X, Send, CheckCircle2, Wallet,
} from "lucide-react";
import { serialNum } from "@/lib/orderDisplay";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
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
      </AnimatePresence>
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

// ── Dues: one customer's open tabs (expandable), with e-bill + settle-all actions ──
function DuesCustomerCard({ c, onEbill, onSettle, ebillPending, settlePending }: {
  c: any;
  onEbill: (key: string) => void;
  onSettle: (key: string) => void;
  ebillPending: boolean;
  settlePending: boolean;
}) {
  const [open, setOpen] = useState(false);
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
        <button
          onClick={() => { if (window.confirm(`Mark all ${c.orderCount} order(s) for ${c.name || "this customer"} as PAID?`)) onSettle(c.key); }}
          disabled={settlePending}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-semibold bg-[var(--paper-0)] border border-[var(--line)] text-gray-700 hover:bg-[var(--paper-100)] disabled:opacity-40 transition-colors"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Mark all paid
        </button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Reports() {
  const [activeTab, setActiveTab] = useState("sales");

  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    start: daysAgo(6),
    end:   today(),
    label: "Last 7 Days",
  }));

  const params = buildParams(dateRange);

  const { data: salesReport, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/sales", dateRange.start, dateRange.end],
    queryFn: () => fetch(apiUrl(`/api/reports/sales${params}`), { credentials: "include" }).then(r => r.json()),
  });

  const { data: weeklyData = [] } = useQuery<any[]>({
    queryKey: ["/api/reports/weekly", dateRange.start, dateRange.end],
    queryFn: () => fetch(apiUrl(`/api/reports/weekly${params}`), { credentials: "include" }).then(r => r.json()),
  });

  const { data: topItemsData = [] } = useQuery<any[]>({
    queryKey: ["/api/reports/top-items", dateRange.start, dateRange.end],
    queryFn: () => fetch(apiUrl(`/api/reports/top-items${params}`), { credentials: "include" }).then(r => r.json()),
  });

  const { data: paymentSummary } = useQuery<any>({
    queryKey: ["/api/reports/payment-summary", dateRange.start, dateRange.end],
    queryFn: () => fetch(apiUrl(`/api/reports/payment-summary${params}`), { credentials: "include" }).then(r => r.json()),
  });

  const { data: staffTableReport = [] } = useQuery<Array<{
    date: string; staff: string; tables: string[]; orderCount: number; revenue: number;
  }>>({
    queryKey: ["/api/reports/staff-tables", dateRange.start, dateRange.end],
    queryFn: () => fetch(apiUrl(`/api/reports/staff-tables${params}`), { credentials: "include" }).then(r => r.json()),
  });

  const { toast } = useToast();
  // Outstanding tabs are "current," not date-bound — no date params.
  const { data: dues } = useQuery<any>({
    queryKey: ["/api/reports/tabs"],
    queryFn: () => fetch(apiUrl(`/api/reports/tabs`), { credentials: "include" }).then(r => r.json()),
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
    mutationFn: async (key: string) => apiRequest("POST", "/api/dues/settle-customer", { key }),
    onSuccess: (_res, _key) => { toast({ title: "Tabs marked paid" }); invalidateDues(); },
    onError: (err: any) => toast({ title: "Failed to settle", description: err.message, variant: "destructive" }),
  });

  const salesData = weeklyData.map((d: any) => ({ name: d.name, sales: d.sales, orders: d.orders ?? 0 }));
  const topItems  = topItemsData.map((d: any) => ({ name: d.name, sold: d.totalSold, revenue: d.revenue }));

  const tabs = [
    { id: "sales",    label: "Sales Chart" },
    { id: "items",    label: "Top Items" },
    { id: "orders",   label: "Order Details" },
    { id: "payments", label: "Payments" },
    { id: "staff",    label: "Staff & Tables" },
    { id: "dues",     label: "Dues / Pay-Later" },
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
      icon: <DollarSign className="w-7 h-7 text-emerald-500" />,
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
      rows = ["cash", "card", "upi", "online", "other"].map((k) => {
        const d = paymentSummary?.breakdown?.[k] || { count: 0, amount: 0 };
        return [k, d.count ?? 0, d.amount ?? 0];
      });
    } else if (activeTab === "staff") {
      filename = `staff-tables_${range}`;
      header = ["Date", "Staff", "Tables", "Orders", "Revenue"];
      rows = staffTableReport.map((s) => [s.date, s.staff, (s.tables ?? []).join(" "), s.orderCount ?? 0, s.revenue ?? 0]);
    } else if (activeTab === "sales") {
      filename = `sales-chart_${range}`;
      header = ["Period", "Sales", "Orders"];
      rows = salesData.map((d: any) => [d.name, d.sales ?? 0, d.orders ?? 0]);
    } else {
      filename = `orders_${range}`;
      header = ["Order #", "Date", "Customer", "Phone", "Type", "Payment", "Amount"];
      rows = (salesReport?.orders ?? []).map((o: any) => [
        serialNum(o.id),
        new Date(o.createdAt).toLocaleString("en-IN"),
        o.customerName || "Walk-in",
        o.customerPhone || "",
        o.orderType || "",
        o.paymentMethod || "",
        parseFloat(o.totalAmount || 0).toFixed(2),
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
        <div className="rounded-xl bg-[var(--paper-100)] border border-[var(--line)] p-1 flex gap-1 mb-5 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm"
                  : "text-gray-600 hover:bg-[var(--paper-0)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Sales Chart ── */}
        {activeTab === "sales" && (
          <motion.div
            key={`sales-${dateRange.start}-${dateRange.end}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">Sales Performance</h3>
              <span className="text-xs text-gray-400">{formatRangeLabel(dateRange.start, dateRange.end)}</span>
            </div>
            {salesData.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-gray-400 text-sm">
                No sales data for this period
              </div>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesData} margin={{ right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: salesData.length > 14 ? 9 : 11 }}
                      interval={salesData.length > 20 ? Math.floor(salesData.length / 10) : 0}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value, name) => [
                        name === "sales" ? formatCurrency(value as number) : value,
                        name === "sales" ? "Revenue" : "Orders",
                      ]}
                    />
                    <Bar dataKey="sales" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2E8B57" />
                        <stop offset="100%" stopColor="#22c55e" />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </motion.div>
        )}

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
                    <span className="text-[11px] font-medium bg-emerald-100/80 text-emerald-700 px-2 py-0.5 rounded-lg">
                      {((item.revenue / (salesReport?.totalSales || 1)) * 100).toFixed(1)}%
                    </span>
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
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
                {[
                  { key: "cash",   label: "Cash",   icon: <Banknote className="w-5 h-5" />,   color: "from-[#226B43] to-[#1B4D33]", bg: "bg-emerald-50/60",  text: "text-emerald-700" },
                  { key: "card",   label: "Card",   icon: <CreditCard className="w-5 h-5" />, color: "from-[#34507A] to-[#243B5E]",     bg: "bg-blue-50/60",     text: "text-blue-700" },
                  { key: "upi",    label: "UPI",    icon: <Smartphone className="w-5 h-5" />, color: "from-[#CD6E3E] to-[#B85C38]", bg: "bg-purple-50/60",   text: "text-purple-700" },
                  { key: "online", label: "Online", icon: <Wifi className="w-5 h-5" />,       color: "from-orange-500 to-amber-500",  bg: "bg-orange-50/60",   text: "text-orange-700" },
                  { key: "other",  label: "Other",  icon: <DollarSign className="w-5 h-5" />, color: "from-gray-500 to-slate-500",    bg: "bg-gray-50/60",     text: "text-gray-700" },
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
                  <DollarSign className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-gray-600 font-medium">No pending payments</p>
                <p className="text-sm text-gray-400">All orders have been settled</p>
              </div>
            )}
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

        {/* ── Dues / Pay-Later ── */}
        {activeTab === "dues" && (
          <motion.div
            key="dues"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    onSettle={(key) => settleCustomerMutation.mutate(key)}
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
          </motion.div>
        )}
      </main>
    </div>
  );
}
