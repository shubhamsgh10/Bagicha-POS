import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, RefreshCw, ChevronDown, ChevronUp, User, Phone, ShoppingBag, Search, X, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PrintPreviewModal, type PrintPreview } from "@/components/PrintPreviewModal";


const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);

const statusColors: Record<string, string> = {
  pending:   "bg-red-100 text-red-800",
  preparing: "bg-yellow-100 text-yellow-800",
  ready:     "bg-blue-100 text-blue-800",
  served:    "bg-green-100 text-green-800",
  delivered: "bg-purple-100 text-purple-800",
  cancelled: "bg-gray-100 text-gray-800",
};

const neonDot: Record<string, string> = {
  pending:   "bg-red-400",
  preparing: "bg-yellow-400",
  ready:     "bg-blue-400",
  served:    "bg-emerald-400",
  delivered: "bg-purple-400",
  cancelled: "bg-gray-400",
};

function OrderDetailRow({ order, onStatusChange }: { order: any; onStatusChange: (id: number, status: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const { data: detail } = useQuery<any>({
    queryKey: ["/api/orders", String(order.id)],
    enabled: expanded,
    staleTime: 0,
  });

  const items: any[] = detail?.items || [];
  const { toast } = useToast();
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);

  const reprintBill = async () => {
    try {
      const res = await fetch('/api/print/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        const pv = await fetch('/api/print/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'bill', orderId: order.id }), credentials: 'include' });
        if (pv.ok) { const d = await pv.json(); setPrintPreview({ title: 'Bill Preview', lines: d.lines, width: d.width }); }
        else toast({ title: 'Print failed', description: data.message, variant: 'destructive' });
      } else {
        toast({ title: 'Bill sent to printer!' });
      }
    } catch {
      const pv = await fetch('/api/print/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'bill', orderId: order.id }), credentials: 'include' }).catch(() => null);
      if (pv?.ok) { const d = await pv.json(); setPrintPreview({ title: 'Bill Preview', lines: d.lines, width: d.width }); }
      else toast({ title: 'Print failed', description: 'Could not reach printer', variant: 'destructive' });
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-2xl overflow-hidden transition-all duration-200 hover:scale-[1.005]"
      style={{
        background: "rgba(255,255,255,0.52)",
        backdropFilter: "blur(18px) saturate(1.8)",
        WebkitBackdropFilter: "blur(18px) saturate(1.8)",
        border: "1px solid rgba(255,255,255,0.75)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.07), 0 1px 0 rgba(255,255,255,0.92) inset",
      }}
    >
      {/* ── Summary row ── */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* avatar */}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
            {order.orderNumber?.slice(-2)}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-gray-800">{order.orderNumber}</span>
              {order.tableNumber && (
                <span className="text-[11px] bg-emerald-100/80 text-emerald-700 px-2 py-0.5 rounded-lg font-semibold">
                  Table {order.tableNumber}
                </span>
              )}
              <span className="text-[11px] text-gray-500 capitalize">{order.orderType?.replace("-", " ")}</span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {order.customerName ? (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <User className="w-3 h-3" /> {order.customerName}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Walk-in</span>
              )}
              {order.customerPhone && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {order.customerPhone}
                </span>
              )}
              <span className="text-xs text-gray-400">
                {new Date(order.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          {/* amount */}
          <div className="text-right hidden sm:block mr-1">
            <p className="font-bold text-sm text-gray-800">{fmt(parseFloat(order.totalAmount || "0"))}</p>
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${neonDot[order.status] || "bg-gray-400"}`} />
            </div>
          </div>

          {/* status select */}
          <div onClick={(e) => e.stopPropagation()}>
            <Select value={order.status} onValueChange={(v) => onStatusChange(order.id, v)}>
              <SelectTrigger className="h-7 text-xs w-28 rounded-xl bg-white/50 border-white/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["pending","preparing","ready","served","delivered","cancelled"].map(s => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <motion.div whileTap={{ scale: 0.85 }}>
            {expanded
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </motion.div>
        </div>
      </div>

      {/* ── Expanded detail ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/30 bg-white/20 px-4 py-3 space-y-3">
              {/* Info grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                {[
                  { label: "Customer", value: order.customerName || "—" },
                  { label: "Phone",    value: order.customerPhone || "—" },
                  { label: "Table",    value: order.tableNumber ? `Table ${order.tableNumber}` : "—" },
                  { label: "Type",     value: order.orderType?.replace("-", " ") || "—" },
                  { label: "Payment",  value: order.paymentStatus === "paid" ? (order.paymentMethod || "cash") : order.paymentStatus === "pending" && order.status === "served" ? "Due" : "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white/30 rounded-xl px-3 py-2">
                    <p className="text-gray-400 font-medium uppercase tracking-wide text-[10px] mb-0.5">{label}</p>
                    <p className={`font-semibold capitalize truncate ${label === "Payment" && value === "Due" ? "text-red-500" : label === "Payment" && value !== "—" ? "text-emerald-600" : "text-gray-700"}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Items table */}
              <div>
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2 flex items-center gap-1">
                  <ShoppingBag className="w-3 h-3" /> Items
                </p>
                {items.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 italic py-2">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                      <RefreshCw className="w-3 h-3" />
                    </motion.div>
                    Loading…
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden border border-white/30 bg-white/40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-white/50 border-b border-white/30">
                          <th className="text-left px-3 py-2 font-semibold text-gray-500">Item</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-500 w-12">Qty</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500 w-20">Price</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500 w-20">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: any, i: number) => (
                          <tr key={i} className="border-b border-white/20 last:border-b-0 hover:bg-white/30 transition-colors">
                            <td className="px-3 py-2">
                              <span className="font-medium text-gray-700">{item.name || "Item"}</span>
                              {item.specialInstructions && (
                                <span className="block text-gray-400 italic text-[11px]">{item.specialInstructions}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center text-gray-600">{item.quantity}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{fmt(parseFloat(item.price || "0"))}</td>
                            <td className="px-3 py-2 text-right font-semibold text-gray-700">{fmt(parseFloat(item.price || "0") * item.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="text-xs space-y-1 w-48 bg-white/30 rounded-xl px-3 py-2">
                  {parseFloat(order.discountAmount || "0") > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Discount</span>
                      <span className="text-red-500 font-medium">-{fmt(parseFloat(order.discountAmount))}</span>
                    </div>
                  )}
                  {parseFloat(order.taxAmount || "0") > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Tax</span>
                      <span>{fmt(parseFloat(order.taxAmount))}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-white/40 pt-1.5 mt-1 text-sm">
                    <span className="text-gray-700">Total</span>
                    <span className="text-emerald-600">{fmt(parseFloat(order.totalAmount || "0"))}</span>
                  </div>
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {expanded && (
        <div className="flex justify-end px-4 pb-3">
          <button
            onClick={reprintBill}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
          >
            <Printer className="w-3 h-3" /> Reprint Bill
          </button>
        </div>
      )}

      {printPreview && (
        <PrintPreviewModal preview={printPreview} onClose={() => setPrintPreview(null)} />
      )}
    </motion.div>
  );
}

export default function Orders() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const { data: orders, isLoading, refetch } = useQuery({ queryKey: ["/api/orders"] });

  // Auto-refresh every 8 seconds
  useEffect(() => {
    const id = setInterval(() => refetch(), 8000);
    return () => clearInterval(id);
  }, [refetch]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/orders/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

const q = search.trim().toLowerCase();
  const filterOrders = (list: any[]) => {
    if (!q) return list;
    return list.filter((o: any) =>
      o.orderNumber?.toLowerCase().includes(q) ||
      o.customerName?.toLowerCase().includes(q) ||
      o.customerPhone?.toLowerCase().includes(q) ||
      o.tableNumber?.toLowerCase().includes(q)
    );
  };

  const getOrdersByStatus = (status: string) =>
    filterOrders((orders as any[])?.filter((o: any) => o.status === status) || []);

  const handleStatusChange = (id: number, status: string) =>
    updateStatusMutation.mutate({ id, status });

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Orders" description="Loading orders..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 skeleton-glass" />
          ))}
        </div>
      </div>
    );
  }

  const EmptyState = ({ label }: { label: string }) => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center py-16 text-gray-400"
    >
      <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium">{label}</p>
    </motion.div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "transparent" }}>
      <Header title="Order History" description="View and manage all restaurant orders" />

      {/* ── Toolbar ── */}
      <div className="px-6 pt-4 flex items-center gap-2 flex-wrap">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate("/tables")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold
                     bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm
                     hover:shadow-emerald-400/40 hover:shadow-md transition-all"
        >
          <Plus className="w-4 h-4" /> New Order
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                     bg-white/60 border border-white/40 text-gray-600
                     hover:bg-white/80 hover:shadow-sm transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </motion.button>

        {/* Search */}
        <div className="flex items-center gap-2 bg-white/60 border border-white/40
                        rounded-xl px-3 py-1.5 flex-1 max-w-sm ml-1
                        focus-within:ring-2 focus-within:ring-emerald-400/50 focus-within:bg-white/80
                        transition-all">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, customer, phone, table…"
            className="bg-transparent text-sm outline-none w-full text-gray-700 placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 transition-colors" />
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs + Orders ── */}
      <main className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-6 rounded-xl p-1 mb-4"
            style={{
              background: "rgba(255,255,255,0.50)",
              backdropFilter: "blur(16px) saturate(1.8)",
              WebkitBackdropFilter: "blur(16px) saturate(1.8)",
              border: "1px solid rgba(255,255,255,0.70)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.05), 0 1px 0 rgba(255,255,255,0.9) inset",
            }}>
            {["all","pending","preparing","ready","served","delivered"].map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="rounded-lg text-xs font-semibold capitalize
                           data-[state=active]:bg-white data-[state=active]:shadow-sm
                           data-[state=active]:text-emerald-700 transition-all"
              >
                {t}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="all" className="mt-0 space-y-0">
            {filterOrders((orders as any[]) || []).length === 0
              ? <EmptyState label="No orders found" />
              : filterOrders((orders as any[]) || []).map((order: any) => (
                  <OrderDetailRow key={order.id} order={order} onStatusChange={handleStatusChange} />
                ))}
          </TabsContent>

          {["pending","preparing","ready","served","delivered","cancelled"].map((status) => (
            <TabsContent key={status} value={status} className="mt-0 space-y-0">
              {getOrdersByStatus(status).length === 0
                ? <EmptyState label={`No ${status} orders`} />
                : getOrdersByStatus(status).map((order: any) => (
                    <OrderDetailRow key={order.id} order={order} onStatusChange={handleStatusChange} />
                  ))}
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
