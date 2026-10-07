import { apiUrl, apiJson } from '@/lib/api';
import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, RefreshCw, ChevronDown, ChevronUp, User, Phone, ShoppingBag, Search, X, Printer } from "lucide-react";
// The standalone `toast`, deliberately NOT the useToast() hook: useToast() registers its caller
// in a module-level listener list that EVERY toast notifies, so a row calling it re-renders on
// every toast anywhere in the app. With ~300 rows on "All Dates" that was a ~1.3 s freeze each
// time a toast fired (e.g. right after saving a payment-method change).
import { toast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PrintPreviewModal, type PrintPreview } from "@/components/PrintPreviewModal";
import { billLines } from "@/lib/receiptText";
import { serialNum, avatarNum } from "@/lib/orderDisplay";
import { DayPicker } from "@/components/DayPicker";
import { todayBusinessDate, businessDayRange } from "@shared/businessDay";
import { deriveBillTotals } from "@shared/orderPricing";
import { paymentLabel, matchesPaymentFilter, paymentFilterCounts, isDueOrder, collectedBusinessDate, type PaymentFilter } from "@shared/paymentSplit";
import { PaymentTag } from "@/components/PaymentTag";
import { PaymentMethodDialog } from "@/components/PaymentMethodDialog";
import { DueSettleDialog } from "@/components/DueSettleDialog";
import { printBillFallback, BROWSER_BILL_TOAST } from "@/lib/printBill";


const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

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

// memo: on "All Dates" this renders every order ever (~300 rows). Re-rendering all of them cost
// ~4 ms each, i.e. ~1.3 s of frozen UI on ANY parent change — a refetch after a save, a search
// keystroke, the 8-second poll finding a new order. React Query's structural sharing keeps an
// unchanged order's object identity across refetches, so memo lets only the changed row redraw.
const OrderDetailRow = memo(function OrderDetailRow({ order, onStatusChange }: { order: any; onStatusChange: (id: number, status: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editingPayment, setEditingPayment] = useState(false);
  const [settlingDue, setSettlingDue] = useState(false);

  // Only a payment RECEIVED today can be corrected — the server enforces the same three
  // conditions (shared/paymentEdit.ts); this just hides a button that would 400. "Today" is the day
  // the money arrived (paidAt), not the day the order was billed: a due settled this morning is
  // correctable until the business day ends, then locked for good. Yesterday's takings have already
  // been counted in the cash book and reported.
  const canEditPayment =
    order.paymentStatus === "paid" &&
    order.status !== "cancelled" &&
    collectedBusinessDate(order) === todayBusinessDate();

  // An open due can ALWAYS be settled, whatever day it was billed — there is no age limit on a debt.
  const canSettleDue = isDueOrder(order);

  const { data: detail } = useQuery<any>({
    queryKey: ["/api/orders", String(order.id)],
    enabled: expanded || settlingDue,
    staleTime: 0,
  });

  const items: any[] = detail?.items || [];

  // Actual discount/tax rate applied to THIS bill, not the restaurant's currently-
  // configured rate — a historical order may have been billed under a different tax
  // rate or a manually-typed discount amount, so these are derived from the order's
  // own persisted numbers. deriveBillTotals resolves subtotal correctly even for
  // legacy rows written before subtotalAmount existed (falls back to total - tax) —
  // never reconstruct subtotal as total - tax directly (see shared/orderPricing.ts).
  const billTotals = deriveBillTotals(order);
  const discountPct = billTotals.subtotal > 0 ? (billTotals.discount / billTotals.subtotal) * 100 : 0;
  const taxableBase = billTotals.subtotal - billTotals.discount;
  const taxPct = taxableBase > 0 ? (billTotals.tax / taxableBase) * 100 : 0;

  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);

  const showBillPreview = () => {
    const lines = billLines({
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber ?? null,
      customerName: order.customerName ?? null,
      orderType: order.orderType,
      totalAmount: parseFloat(order.totalAmount ?? '0'),
      taxAmount: parseFloat(order.taxAmount ?? '0'),
      discountAmount: parseFloat(order.discountAmount ?? '0'),
      paymentMethod: paymentLabel(order) || null, // real legs ("Cash ₹53 + UPI ₹10"), not the largest-leg label
      billPrintCount: order.billPrintCount ?? 0,
      createdAt: order.createdAt,
      items: items.map((i: any) => ({
        name: i.name,
        quantity: i.quantity,
        price: parseFloat(i.price ?? '0'),
        size: i.size ?? null,
        notes: i.specialInstructions ?? null,
        serviceMode: i.serviceMode ?? null,
      })),
    });
    setPrintPreview({ title: 'Bill Preview', lines });
  };

  const reprintBill = async () => {
    try {
      const res = await fetch(apiUrl('/api/print/bill'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        showBillPreview();
        return;
      }
      const { handlePrintResponse } = await import('@/lib/printGateway');
      const outcome = await handlePrintResponse(data, {
        orderId: order.id,
        ackType: 'bill',
        pendingAck: data.pendingAck,
        // The server sends the exact bill bytes; print THAT (same layout as the thermal bill).
        // The text preview is only the last resort (old server / popup blocked) — it can't be printed.
        onBrowserBill: (billData) => {
          if (!printBillFallback(billData)) showBillPreview();
        },
      });
      if (outcome === 'hardware' || outcome === 'dispatched') {
        toast({ title: 'Bill sent to printer!' });
      } else if (outcome === 'browser') {
        toast(BROWSER_BILL_TOAST);
      } else if (outcome === 'noop') {
        showBillPreview();
      }
    } catch {
      showBillPreview();
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
        background: "var(--paper-0)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* ── Summary row ── */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* avatar */}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#2E8B57] to-[#1B4D33] flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-sm">
            {avatarNum(order.id)}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-gray-800">{serialNum(order.id)}</span>
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
              {/* The amount block on the right is hidden below sm, and the tag lives with it
                  there — so on a phone it rides here instead, next to the customer line. */}
              <PaymentTag order={order} className="sm:hidden" onSettleDue={canSettleDue ? () => setSettlingDue(true) : undefined} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          {/* How it was paid, read just before the amount it refers to. */}
          <PaymentTag order={order} className="hidden sm:inline-flex" onSettleDue={canSettleDue ? () => setSettlingDue(true) : undefined} />

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
              <SelectTrigger className="h-7 text-xs w-28 rounded-xl bg-[var(--paper-0)] border-[var(--line)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["pending","preparing","ready","served","delivered","cancelled"].map(s => (
                  <SelectItem
                    key={s}
                    value={s}
                    // "cancelled" is picked from here so the item still exists (an
                    // already-cancelled order needs a matching item to display its
                    // current value correctly) — but it's unselectable, since setting
                    // it via this generic status field skips the manager PIN, the
                    // required reason, freeing the table, restoring inventory, and
                    // closing out the kitchen ticket. Use the Cancel Order button
                    // (Settlement dialog or table Actions menu) instead.
                    disabled={s === "cancelled"}
                    title={s === "cancelled" ? "Use the Cancel Order button instead — this only changes the label" : undefined}
                    className="text-xs capitalize"
                  >
                    {s}
                  </SelectItem>
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
            <div className="border-t border-[var(--line)] bg-[var(--paper-100)] px-4 py-3 space-y-3">
              {/* Info grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                {[
                  { label: "Customer",  value: order.customerName || "—" },
                  { label: "Phone",     value: order.customerPhone || "—" },
                  { label: "Table",     value: order.tableNumber ? `Table ${order.tableNumber}` : "—" },
                  { label: "Type",      value: order.orderType?.replace("-", " ") || "—" },
                  {
                    label: "Payment",
                    value: order.paymentStatus === "paid" ? (paymentLabel(order) || "Cash") : order.paymentStatus === "pending" && order.status === "served" ? "Due" : "—",
                    // A due is always one tap from "Settle due" (Cash / UPI / Part). A settled order can
                    // be corrected while its paid day is today — staff tap the wrong method more often
                    // than they miscount money, and it only surfaces when the cash book disagrees at
                    // closing. Correcting it cannot change the amount — see shared/paymentEdit.ts.
                    action: canSettleDue ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSettlingDue(true); }}
                        className="text-[10px] font-semibold text-amber-700 hover:text-amber-800 underline underline-offset-2 mt-0.5"
                      >
                        Settle due
                      </button>
                    ) : canEditPayment ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingPayment(true); }}
                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-2 mt-0.5"
                      >
                        Change
                      </button>
                    ) : null,
                  },
                  ...(order.createdByName ? [{ label: "Served By", value: order.createdByName }] : []),
                  ...(parseFloat(order.shortfallAmount || 0) > 0 ? [{ label: "Written Off", value: fmt(parseFloat(order.shortfallAmount)) }] : []),
                  ...(order.status === "cancelled" && order.cancelReason ? [{ label: "Cancel Reason", value: order.cancelReason }] : []),
                ].map(({ label, value, action }: any) => (
                  <div key={label} className={`bg-[var(--paper-100)] rounded-xl px-3 py-2 ${label === "Cancel Reason" ? "col-span-2 sm:col-span-5" : ""}`}>
                    <p className="text-gray-400 font-medium uppercase tracking-wide text-[10px] mb-0.5">{label}</p>
                    <p className={`font-semibold truncate ${label === "Cancel Reason" ? "text-red-600 normal-case" : "capitalize"} ${label === "Payment" && value === "Due" ? "text-red-500" : label === "Payment" && value !== "—" ? "text-emerald-600" : label === "Written Off" ? "text-red-600" : label === "Cancel Reason" ? "" : "text-gray-700"}`}>{value}</p>
                    {action}
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
                  <div className="rounded-xl overflow-hidden border border-[var(--line)] bg-[var(--paper-100)]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--paper-0)] border-b border-[var(--line)]">
                          <th className="text-left px-3 py-2 font-semibold text-gray-500">Item</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-500 w-12">Qty</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500 w-20">Price</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500 w-20">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: any, i: number) => (
                          <tr key={i} className="border-b border-white/20 last:border-b-0 hover:bg-[var(--paper-100)] transition-colors">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-gray-700">{item.name || "Item"}</span>
                                {item.serviceMode && item.serviceMode !== "dinein" && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                    item.serviceMode === "pickup"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-amber-100 text-amber-700"
                                  }`}>
                                    {item.serviceMode === "pickup" ? "📦 Pickup" : "🛵 Delivery"}
                                  </span>
                                )}
                              </div>
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
                <div className="text-xs space-y-1 w-48 bg-[var(--paper-100)] rounded-xl px-3 py-2">
                  {billTotals.discount > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Discount <span className="text-gray-400">({discountPct.toFixed(1)}%)</span></span>
                      <span className="text-red-500 font-medium">-{fmt(billTotals.discount)}</span>
                    </div>
                  )}
                  {billTotals.tax > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Tax <span className="text-gray-400">({taxPct.toFixed(1)}%)</span></span>
                      <span>{fmt(billTotals.tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-[var(--line)] pt-1.5 mt-1 text-sm">
                    <span className="text-gray-700">Total</span>
                    <span className="text-emerald-600">{fmt(parseFloat(order.totalAmount || "0"))}</span>
                  </div>
                </div>
              </div>

              {/* Reprint */}
              <div className="flex justify-end">
                <button
                  onClick={reprintBill}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                >
                  <Printer className="w-3 h-3" /> Reprint Bill
                </button>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {printPreview && (
        <PrintPreviewModal preview={printPreview} onClose={() => setPrintPreview(null)} />
      )}

      {/* Mounted only while open. This used to render in every row, closed, so a 293-order
          "All Dates" list carried 293 copies of the dialog — each with its own useMutation,
          useAuth query observer and a planPaymentEdit() run on every render. */}
      {editingPayment && (
        <PaymentMethodDialog open onOpenChange={setEditingPayment} order={order} />
      )}
      {settlingDue && (
        <DueSettleDialog
          order={order}
          items={items.length > 0 ? items.map((i: any) => ({
            name: i.name || "Item",
            quantity: i.quantity,
            price: parseFloat(i.price ?? "0"),
            size: i.size ?? null,
            serviceMode: i.serviceMode ?? null,
          })) : undefined}
          onClose={() => setSettlingDue(false)}
        />
      )}
    </motion.div>
  );
});

function EmptyState({ label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center py-16 text-gray-400"
    >
      <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium">{label}</p>
    </motion.div>
  );
}

// Draw the list in slices instead of all at once. "All Dates" is every order the restaurant has
// ever taken (293 today, +~20 a day); mounting that many rows cost ~4 s on its own (~14 ms per
// row — each has an animation wrapper, a dropdown and a data subscription), and every filter or
// search that widened the list paid it again. Only the rows near the viewport are ever drawn;
// the rest load as the user scrolls (sentinel below) or via the button. Filtering/searching still
// run over the FULL list, so nothing is hidden — it just isn't drawn until it's reached.
const ORDER_PAGE_SIZE = 30;

function OrderList({ orders, emptyLabel, resetKey, onStatusChange }: {
  orders: any[];
  emptyLabel: string;
  /** Changes whenever the filter/search/date changes, so a new result starts from the top. */
  resetKey: string;
  onStatusChange: (id: number, status: string) => void;
}) {
  const [limit, setLimit] = useState(ORDER_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = orders.length > limit;

  useEffect(() => { setLimit(ORDER_PAGE_SIZE); }, [resetKey]);

  // Re-created after every growth (deps include `limit`) so that a sentinel that is STILL inside
  // the margin after a batch lands fires again — it keeps loading until the page is full, then
  // stops. An observer's initial callback is what triggers that second round.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setLimit((l) => l + ORDER_PAGE_SIZE); },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, limit]);

  if (orders.length === 0) return <EmptyState label={emptyLabel} />;

  return (
    <>
      {orders.slice(0, limit).map((order: any) => (
        <OrderDetailRow key={order.id} order={order} onStatusChange={onStatusChange} />
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="flex items-center justify-center gap-3 py-4 text-xs text-gray-400">
          <span>Showing {limit} of {orders.length}</span>
          <button
            onClick={() => setLimit((l) => l + ORDER_PAGE_SIZE)}
            className="px-3 py-1 rounded-lg font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            Show more
          </button>
        </div>
      )}
    </>
  );
}

const PAYMENT_FILTERS: { key: PaymentFilter; label: string; dot: string; hint: string }[] = [
  { key: "all",  label: "All",  dot: "",              hint: "Every order" },
  { key: "cash", label: "Cash", dot: "bg-emerald-500", hint: "Paid with any cash — includes part payments" },
  { key: "upi",  label: "UPI",  dot: "bg-indigo-500",  hint: "Paid with any UPI — includes part payments" },
  { key: "due",  label: "Due",  dot: "bg-amber-500",   hint: "Served but not yet paid" },
];

export default function Orders() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [payFilter, setPayFilter] = useState<PaymentFilter>("all");
  const [businessDate, setBusinessDate] = useState(() => todayBusinessDate());
  const [showAll, setShowAll] = useState(false);
  const { data: orders, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/orders", showAll ? "all" : businessDate],
    // apiJson() checks res.ok and throws before parsing — a hand-rolled
    // fetch(...).then(r => r.json()) here used to let a non-2xx response's JSON error
    // body ({message:"..."} / {error:"..."}, not an array) flow straight into the
    // .map()/.filter() calls below as if it were the orders list, crashing the whole
    // page instead of surfacing through React Query's error state.
    queryFn: () => {
      const path = showAll
        ? "/api/orders"
        : (() => {
            const { start, end } = businessDayRange(businessDate);
            return `/api/orders?startDate=${start.toISOString()}&endDate=${end.toISOString()}`;
          })();
      return apiJson<any[]>(path);
    },
  });

  // Auto-refresh. "All Dates" is the entire order history (~240 KB today, growing ~20 orders a
  // day) and is history, not a live board — re-downloading all of it every 8 s was pure waste, so
  // it polls once a minute (the Refresh button and every save's invalidation still update it
  // immediately). A single day stays at 8 s.
  useEffect(() => {
    const id = setInterval(() => refetch(), showAll ? 60_000 : 8_000);
    return () => clearInterval(id);
  }, [refetch, showAll]);

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
  // Search AND payment filter, applied to every status tab alike. Both run over the full list —
  // OrderList only limits how many of the matches are DRAWN.
  const filterOrders = (list: any[]) => {
    if (!q && payFilter === "all") return list;
    return list.filter((o: any) =>
      matchesPaymentFilter(o, payFilter) && (
        !q ||
        o.orderNumber?.toLowerCase().includes(q) ||
        serialNum(o.id).toLowerCase().includes(q) ||
        String(o.id).includes(q.replace(/^#/, "")) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.customerPhone?.toLowerCase().includes(q) ||
        o.tableNumber?.toLowerCase().includes(q)
      )
    );
  };

  const getOrdersByStatus = (status: string) =>
    filterOrders((orders as any[])?.filter((o: any) => o.status === status) || []);

  // Chip counts over the date-scoped list (not the search or the status tab), so the numbers stay
  // put while typing and answer "how many Due / Cash / UPI orders in this range". Built on the
  // same matchesPaymentFilter the rows use — they cannot disagree.
  const payCounts = useMemo(() => paymentFilterCounts((orders as any[]) ?? []), [orders]);
  const listKey = `${q}|${payFilter}|${showAll ? "all" : businessDate}`;

  // Stable identity (mutate is stable in TanStack Query v5) — a fresh arrow every render would
  // defeat React.memo on every OrderDetailRow below and redraw all of them on any change.
  const { mutate: updateStatus } = updateStatusMutation;
  const handleStatusChange = useCallback(
    (id: number, status: string) => updateStatus({ id, status }),
    [updateStatus],
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Orders" description="Loading orders..." />
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 skeleton-glass" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Order History" description="View and manage all restaurant orders" />
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="text-center py-16 text-gray-400">
            <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Couldn't load orders</p>
            <button
              onClick={() => refetch()}
              className="mt-3 flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded-xl text-sm font-semibold
                         bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white hover:shadow-md transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "transparent" }}>
      <Header title="Order History" description="View and manage all restaurant orders" />

      {/* ── Toolbar ── */}
      <div className="px-3 sm:px-6 pt-3 sm:pt-4 flex items-center gap-2 flex-wrap">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate("/tables")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold
                     bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white
                     hover:shadow-md transition-all"
          style={{ boxShadow: "var(--shadow-green)" }}
        >
          <Plus className="w-4 h-4" /> New Order
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                     bg-[var(--paper-0)] border border-[var(--line)] text-gray-600
                     hover:bg-[var(--paper-0)] hover:shadow-sm transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </motion.button>

        <DayPicker
          value={businessDate}
          onChange={setBusinessDate}
          allDates={showAll}
          onAllDatesChange={setShowAll}
        />

        {/* Search */}
        <div className="flex items-center gap-2 bg-[var(--paper-0)] border border-[var(--line)]
                        rounded-xl px-3 py-1.5 flex-1 max-w-sm ml-1
                        focus-within:ring-2 focus-within:ring-emerald-400/50 focus-within:bg-[var(--paper-0)]
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

        {/* Payment filter — Cash / UPI / Due. A part payment is listed under BOTH Cash and UPI
            (it is both), the same way Reports → Payments counts it. */}
        <div
          role="group"
          aria-label="Filter by payment"
          className="flex items-center gap-0.5 rounded-xl p-1"
          style={{ background: "var(--paper-100)", border: "1px solid var(--line)", boxShadow: "var(--shadow-xs)" }}
        >
          {PAYMENT_FILTERS.map(({ key, label, dot, hint }) => {
            const active = payFilter === key;
            return (
              <button
                key={key}
                type="button"
                title={hint}
                aria-pressed={active}
                onClick={() => setPayFilter(key)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 min-h-[32px] text-xs font-semibold transition-all ${
                  active ? "bg-white shadow-sm text-emerald-700" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
                {label}
                <span className={`tabular-nums text-[10px] ${active ? "text-emerald-600/80" : "text-gray-400"}`}>
                  {payCounts[key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tabs + Orders ── */}
      <main className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-3 sm:px-6 pt-3 sm:pt-4 pb-6">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="flex w-full justify-start overflow-x-auto rounded-xl p-1 mb-4 gap-0.5"
            style={{
              background: "var(--paper-100)",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow-xs)",
            }}>
            {["all","pending","preparing","ready","served","delivered"].map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="rounded-lg text-xs font-semibold capitalize shrink-0 px-3 min-h-[36px]
                           data-[state=active]:bg-white data-[state=active]:shadow-sm
                           data-[state=active]:text-emerald-700 transition-all"
              >
                {t}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="all" className="mt-0 space-y-0">
            <OrderList
              orders={filterOrders((orders as any[]) || [])}
              emptyLabel="No orders found"
              resetKey={listKey}
              onStatusChange={handleStatusChange}
            />
          </TabsContent>

          {["pending","preparing","ready","served","delivered","cancelled"].map((status) => (
            <TabsContent key={status} value={status} className="mt-0 space-y-0">
              <OrderList
                orders={getOrdersByStatus(status)}
                emptyLabel={`No ${status} orders`}
                resetKey={listKey}
                onStatusChange={handleStatusChange}
              />
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
