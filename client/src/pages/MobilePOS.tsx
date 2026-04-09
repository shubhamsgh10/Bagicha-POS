/**
 * MobilePOS — High-performance waiter POS for mobile devices.
 * 4-tab layout: Tables → Menu → Cart → Orders
 * Constraints: only modifies /mobile-pos, no schema or API changes.
 */
import {
  useState, useMemo, useEffect, useRef, useCallback, memo,
} from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  UtensilsCrossed, ShoppingCart, ClipboardList, LayoutGrid,
  Plus, Minus, X, Search, LogOut, CheckCircle2, Loader2,
  ChevronDown, ChevronUp, Wifi, WifiOff, Tag, Clock,
  Receipt, Banknote, CreditCard, Smartphone, ArrowLeft,
  AlertCircle, RefreshCw, User, Phone, StickyNote, Percent,
  MoveRight, GitMerge, Scissors, MoreHorizontal, Trash2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { PinGuard } from "@/components/PinGuard";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { usePermission } from "@/hooks/usePermission";
import { useManagerAuth } from "@/hooks/useManagerAuth";

/* ─────────────────────────── TYPES ─────────────────────────── */
interface Category  { id: number; name: string; displayOrder?: number; }
interface MenuItem  {
  id: number; name: string; price: string; categoryId: number;
  isAvailable: boolean; shortCode?: string;
  sizes?: Array<{ size: string; price: number }>;
  addons?: Array<{ name: string; price: number }>;
}
interface CartItem  {
  key: string; menuItemId: number; name: string; price: number;
  quantity: number; size?: string; notes?: string;
  addons?: Array<{ name: string; price: number }>;
}
interface TableRow  {
  id: number; name: string; section: string; capacity: number;
  status: "free" | "running" | "billed"; currentOrderId?: number | null;
  runningTotal?: number;
}
interface OrderRow  {
  id: number; orderNumber: string; status: string; tableNumber?: string;
  tableId?: number; totalAmount: string; taxAmount: string;
  discountAmount?: string; paymentStatus: string; orderType: string;
  customerName?: string; createdAt: string; items?: any[];
}
type Tab       = "tables" | "menu" | "cart" | "orders";
type OrderType = "dine-in" | "delivery" | "pickup";
type OrderSubTab = "running" | "held" | "completed";

/* ─────────────────────── CONSTANTS ─────────────────────────── */
const STATUS_COLORS: Record<string, string> = {
  free:    "bg-gray-100 text-gray-500 border-gray-200",
  running: "bg-emerald-50 text-emerald-700 border-emerald-200",
  billed:  "bg-amber-50 text-amber-700 border-amber-200",
};
const STATUS_DOT: Record<string, string> = {
  free: "bg-gray-400", running: "bg-emerald-500", billed: "bg-amber-500",
};
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);

/* ──────────────────── OFFLINE CACHE ────────────────────────── */
const CACHE_KEY = "mpos_offline_cache";
function loadCache(): { menu?: MenuItem[]; categories?: Category[] } {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveCache(data: { menu?: MenuItem[]; categories?: Category[] }) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); }
  catch { /* quota exceeded — ignore */ }
}

/* ─────────────────── RUNNING TIME HOOK ─────────────────────── */
function useRunningTime(createdAt?: string) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!createdAt) { setLabel(""); return; }
    const tick = () => {
      const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
      const h = Math.floor(mins / 60), m = mins % 60;
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [createdAt]);
  return label;
}

/* ───────────────────── LONG PRESS HOOK ─────────────────────── */
function useLongPress(onLongPress: () => void, onClick: () => void, delay = 500) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fired  = useRef(false);

  const start = useCallback(() => {
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, delay);
  }, [onLongPress, delay]);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
  }, []);

  const end = useCallback(() => {
    clearTimeout(timer.current);
    if (!fired.current) onClick();
  }, [onClick]);

  return {
    onPointerDown: start,
    onPointerUp:   end,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

/* ────────────────────── WEBSOCKET HOOK ─────────────────────── */
function useWebSocket(onMessage: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const reconnect = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const sock = new WebSocket(`${proto}//${location.host}/ws`);
      sock.onopen  = () => setConnected(true);
      sock.onclose = () => {
        setConnected(false);
        reconnect.current = setTimeout(connect, 4000);
      };
      sock.onerror = () => sock.close();
      sock.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
      ws.current = sock;
    } catch {}
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnect.current);
      ws.current?.close();
    };
  }, [connect]);

  return connected;
}

/* ═══════════════════════════════════════════════════════════════
   TABLE CARD
═══════════════════════════════════════════════════════════════ */
const TableCard = memo(function TableCard({
  table, onTap, onLongPress,
}: {
  table: TableRow & { runningOrder?: OrderRow };
  onTap: () => void;
  onLongPress: () => void;
}) {
  const timeLabel = useRunningTime(
    table.status === "running" ? table.runningOrder?.createdAt : undefined
  );
  const lp = useLongPress(onLongPress, onTap);
  const colorClass = STATUS_COLORS[table.status] || STATUS_COLORS.free;
  const dotClass   = STATUS_DOT[table.status]   || STATUS_DOT.free;

  return (
    <motion.button
      {...lp}
      whileTap={{ scale: 0.94 }}
      className={`relative flex flex-col items-start p-3 rounded-2xl border-2 min-h-[80px] w-full
                  touch-manipulation select-none transition-colors ${colorClass}`}
    >
      <div className="flex items-center justify-between w-full mb-1">
        <span className="font-bold text-sm leading-none">{table.name}</span>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-60">{table.section}</span>
      {table.status === "running" && (
        <div className="mt-auto pt-1 w-full">
          {timeLabel && (
            <div className="flex items-center gap-1 text-[11px] opacity-70">
              <Clock className="w-2.5 h-2.5" />{timeLabel}
            </div>
          )}
          {table.runningTotal != null && table.runningTotal > 0 && (
            <div className="text-[11px] font-bold mt-0.5">{fmt(table.runningTotal)}</div>
          )}
        </div>
      )}
      {table.status === "billed" && (
        <div className="mt-1 text-[10px] font-semibold">Awaiting payment</div>
      )}
    </motion.button>
  );
});

/* ═══════════════════════════════════════════════════════════════
   MENU ITEM CARD
═══════════════════════════════════════════════════════════════ */
const MenuItemCard = memo(function MenuItemCard({
  item, cartQty, onTap, onLongPress,
}: {
  item: MenuItem;
  cartQty: number;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const hasSizes  = !!item.sizes?.length;
  const hasAddons = !!item.addons?.length;
  const needsSheet = hasSizes || hasAddons;
  const lp = useLongPress(onLongPress, needsSheet ? onLongPress : onTap);

  return (
    <motion.button
      {...lp}
      whileTap={{ scale: 0.93 }}
      className="relative flex flex-col items-start bg-gray-50 rounded-2xl p-3 text-left
                 active:bg-emerald-50 transition-colors touch-manipulation select-none w-full"
    >
      {cartQty > 0 && (
        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 text-white
                         text-[10px] font-bold flex items-center justify-center z-10">
          {cartQty > 9 ? "9+" : cartQty}
        </span>
      )}
      <p className="text-sm font-semibold text-gray-800 leading-snug pr-6 mb-2 line-clamp-2">
        {item.name}
      </p>
      {hasSizes ? (
        <div className="flex flex-wrap gap-1 mt-auto">
          {item.sizes!.slice(0, 2).map(s => (
            <span key={s.size} className="text-[10px] bg-white rounded-lg px-1.5 py-0.5
                                           text-gray-500 border border-gray-200">
              {s.size} ₹{s.price}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm font-bold text-emerald-600 mt-auto">
          ₹{parseFloat(item.price).toFixed(0)}
        </p>
      )}
      <div className="absolute bottom-2.5 right-2.5">
        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
          <Plus className="w-3 h-3 text-white" />
        </div>
      </div>
    </motion.button>
  );
});

/* ═══════════════════════════════════════════════════════════════
   ITEM CUSTOMIZATION SHEET (sizes, addons)
═══════════════════════════════════════════════════════════════ */
function ItemSheet({
  item, onAdd, onClose,
}: {
  item: MenuItem;
  onAdd: (item: MenuItem, size?: { size: string; price: number }, addons?: Array<{ name: string; price: number }>, notes?: string) => void;
  onClose: () => void;
}) {
  const [selectedSize, setSelectedSize] = useState<{ size: string; price: number } | null>(
    item.sizes?.[0] ?? null
  );
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const hasSizes  = !!item.sizes?.length;
  const hasAddons = !!item.addons?.length;

  const basePrice = selectedSize?.price ?? parseFloat(item.price);
  const addonTotal = Array.from(selectedAddons).reduce((s, name) => {
    return s + (item.addons?.find(a => a.name === name)?.price ?? 0);
  }, 0);
  const total = basePrice + addonTotal;

  const handleAdd = () => {
    const addons = Array.from(selectedAddons).map(name => ({
      name, price: item.addons?.find(a => a.name === name)?.price ?? 0,
    }));
    onAdd(item, selectedSize ?? undefined, addons.length ? addons : undefined, notes || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative w-full max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl pb-safe"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mt-3 mb-4" />
        <div className="px-4 pb-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-base">{item.name}</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          {hasSizes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Size</p>
              <div className="space-y-2">
                {item.sizes!.map(s => (
                  <button
                    key={s.size}
                    onClick={() => setSelectedSize(s)}
                    className={`w-full flex items-center justify-between py-3 px-4 rounded-xl border-2
                                transition-colors ${
                      selectedSize?.size === s.size
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-gray-100 bg-gray-50"
                    }`}
                  >
                    <span className="font-medium text-gray-700">{s.size}</span>
                    <span className="font-bold text-emerald-600">₹{s.price}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasAddons && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add-ons</p>
              <div className="space-y-2">
                {item.addons!.map(a => {
                  const checked = selectedAddons.has(a.name);
                  return (
                    <button
                      key={a.name}
                      onClick={() => setSelectedAddons(prev => {
                        const next = new Set(prev);
                        checked ? next.delete(a.name) : next.add(a.name);
                        return next;
                      })}
                      className={`w-full flex items-center justify-between py-3 px-4 rounded-xl border-2
                                  transition-colors ${
                        checked ? "border-emerald-500 bg-emerald-50" : "border-gray-100 bg-gray-50"
                      }`}
                    >
                      <span className="font-medium text-gray-700">{a.name}</span>
                      <span className="text-sm text-gray-500">+₹{a.price}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</p>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Special instructions…"
              className="w-full rounded-xl bg-gray-100 border-0 px-3 py-2.5 text-sm outline-none
                         focus:ring-2 focus:ring-emerald-400 transition-all"
            />
          </div>

          <button
            onClick={handleAdd}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-500
                       text-white font-bold text-base shadow-md active:scale-[0.98] transition-transform"
          >
            Add to Cart · {fmt(total)}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TABLE QUICK-ACTION SHEET
═══════════════════════════════════════════════════════════════ */
function TableActionSheet({
  table, allTables, activeOrderId, onClose, onTableAction,
  canAction, requirePin,
}: {
  table: TableRow;
  allTables: TableRow[];
  activeOrderId: number | null;
  onClose: () => void;
  onTableAction: (action: "move" | "merge" | "split", targetId?: number) => void;
  canAction: (a: any) => boolean;
  requirePin: (label: string, fn: () => void) => void;
}) {
  const [mode, setMode] = useState<"menu" | "move" | "merge">("menu");
  const freeTables = allTables.filter(t => t.id !== table.id && t.status === "free");

  const doAction = (action: "move" | "merge" | "split", targetId?: number) => {
    const label = action === "move" ? "Move Table" : action === "merge" ? "Merge Table" : "Split Bill";
    const fn = () => { onTableAction(action, targetId); onClose(); };
    if (canAction("moveTable")) { fn(); } else { requirePin(label, fn); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative w-full max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mt-3 mb-4" />
        <div className="px-4 pb-8">
          <p className="font-bold text-gray-900 mb-4 text-center">Table {table.name}</p>

          {mode === "menu" && (
            <div className="space-y-2">
              <button onClick={() => setMode("move")} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-gray-50 active:bg-gray-100 transition-colors">
                <MoveRight className="w-5 h-5 text-blue-500" /><span className="font-medium">Move Table</span>
              </button>
              {table.status === "running" && activeOrderId && (
                <button onClick={() => setMode("merge")} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-gray-50 active:bg-gray-100 transition-colors">
                  <GitMerge className="w-5 h-5 text-purple-500" /><span className="font-medium">Merge Table</span>
                </button>
              )}
              {table.status === "running" && activeOrderId && (
                <button onClick={() => doAction("split")} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-gray-50 active:bg-gray-100 transition-colors">
                  <Scissors className="w-5 h-5 text-orange-500" /><span className="font-medium">Split Bill</span>
                </button>
              )}
              <button onClick={onClose} className="w-full py-3 text-sm text-gray-400">Cancel</button>
            </div>
          )}

          {(mode === "move" || mode === "merge") && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500 mb-3">
                Select destination table ({mode === "move" ? "must be free" : "must be free"})
              </p>
              {freeTables.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">No free tables available</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-52 overflow-y-auto">
                  {freeTables.map(t => (
                    <button
                      key={t.id}
                      onClick={() => doAction(mode as "move" | "merge", t.id)}
                      className="py-3 px-2 rounded-xl bg-gray-50 border border-gray-200
                                 text-sm font-medium active:bg-emerald-50 transition-colors"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setMode("menu")} className="w-full py-3 text-sm text-gray-400">← Back</button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAYMENT SHEET
═══════════════════════════════════════════════════════════════ */
function PaymentSheet({
  total, onPay, onClose, isPending,
}: {
  total: number; onPay: (method: string) => void;
  onClose: () => void; isPending: boolean;
}) {
  const [method, setMethod] = useState("cash");
  const methods = [
    { id: "cash",  icon: Banknote,    label: "Cash" },
    { id: "card",  icon: CreditCard,  label: "Card" },
    { id: "upi",   icon: Smartphone,  label: "UPI" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative w-full max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mt-3 mb-4" />
        <div className="px-4 pb-8 space-y-5">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Amount Due</p>
            <p className="text-3xl font-black text-gray-900 mt-1">{fmt(total)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Payment Method</p>
            <div className="grid grid-cols-3 gap-3">
              {methods.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setMethod(id)}
                  className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition-all ${
                    method === id
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-100 bg-gray-50 text-gray-600"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => onPay(method)}
            disabled={isPending}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-500
                       text-white font-bold text-base shadow-md active:scale-[0.98] transition-transform
                       disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isPending
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
              : <><Receipt className="w-5 h-5" /> Collect {fmt(total)}</>
            }
          </button>
          <button onClick={onClose} className="w-full py-2 text-sm text-gray-400">Cancel</button>
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ORDER CARD
═══════════════════════════════════════════════════════════════ */
function OrderCard({ order, onTap }: { order: OrderRow; onTap: () => void }) {
  const elapsed = useMemo(() => {
    const mins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
    return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  }, [order.createdAt]);
  const statusColor =
    order.status === "pending" || order.status === "running" ? "text-emerald-600" :
    order.status === "hold" ? "text-blue-600" :
    order.status === "served" ? "text-gray-500" : "text-gray-400";

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onTap}
      className="w-full flex items-center gap-3 bg-white border border-gray-100
                 rounded-2xl p-3 shadow-sm active:bg-gray-50 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-bold text-gray-900">{order.orderNumber}</span>
          <span className="text-xs text-gray-400">{elapsed}</span>
        </div>
        {order.tableNumber && (
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <LayoutGrid className="w-3 h-3" /> Table {order.tableNumber}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className={`text-xs font-semibold capitalize ${statusColor}`}>{order.status}</span>
          <span className="text-sm font-bold text-gray-800">{fmt(parseFloat(order.totalAmount))}</span>
        </div>
      </div>
    </motion.button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN MobilePOS
═══════════════════════════════════════════════════════════════ */
export default function MobilePOS() {
  const { toast }  = useToast();
  const { user, logout } = useAuth();
  const { activeRole } = useActiveRoleContext();
  const managerAuth = useManagerAuth();
  const { can, requirePin } = usePermission(activeRole);

  /* ── URL params ── */
  const urlParams  = useMemo(() => new URLSearchParams(window.location.search), []);
  const lockedMode = urlParams.get("mode") as OrderType | null;

  /* ── Tab state ── */
  const [tab, setTab]            = useState<Tab>("tables");
  const [orderSubTab, setOrderSubTab] = useState<OrderSubTab>("running");

  /* ── Active context ── */
  const [activeTableId, setActiveTableId]     = useState<number | null>(null);
  const [activeOrderId, setActiveOrderId]     = useState<number | null>(null);
  const [orderType, setOrderType]             = useState<OrderType>(lockedMode ?? "dine-in");

  /* ── Cart state ── */
  const [cart, setCart] = useState<CartItem[]>([]);

  /* ── Order details ── */
  const [customerName, setCustomerName]   = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes]                 = useState("");
  const [discountPct, setDiscountPct]     = useState(0);
  const [discountUnlocked, setDiscountUnlocked] = useState(false);

  /* ── UI state ── */
  const [activeCatId, setActiveCatId]   = useState<number | null>(null);
  const [search, setSearch]             = useState("");
  const [customizeItem, setCustomizeItem] = useState<MenuItem | null>(null);
  const [tableActionFor, setTableActionFor] = useState<TableRow | null>(null);
  const [showPaySheet, setShowPaySheet] = useState(false);
  const [showDetails, setShowDetails]   = useState(false);
  const [kotDone, setKotDone]           = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ── Data ── */
  const cache = useMemo(loadCache, []);

  const { data: categories = cache.categories ?? [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
    onSuccess: (d: Category[]) => saveCache({ ...loadCache(), categories: d }),
  } as any);

  const { data: menuItems = cache.menu ?? [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu"],
    onSuccess: (d: MenuItem[]) => saveCache({ ...loadCache(), menu: d }),
  } as any);

  const { data: rawTables = [] } = useQuery<TableRow[]>({
    queryKey: ["/api/tables"], staleTime: 0,
  });

  const { data: allOrders = [] } = useQuery<OrderRow[]>({
    queryKey: ["/api/orders"], staleTime: 0,
  });

  const { data: settings } = useQuery<{ taxRate: number }>({
    queryKey: ["/api/settings"],
  });

  const taxRate = settings?.taxRate ?? 5;

  /* ── WebSocket ── */
  const wsConnected = useWebSocket(useCallback((data: any) => {
    if (["TABLE_UPDATE", "NEW_ORDER", "KOT_UPDATE"].includes(data.type)) {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    }
  }, []));

  /* ── Enrich tables with running order data ── */
  const tables = useMemo(() => {
    return rawTables.map(t => {
      const runningOrder = allOrders.find(
        o => o.tableId === t.id && (o.status === "running" || o.status === "pending")
      );
      return {
        ...t,
        runningOrder,
        runningTotal: runningOrder ? parseFloat(runningOrder.totalAmount) : undefined,
      };
    });
  }, [rawTables, allOrders]);

  /* ── Filtered menu ── */
  const filteredItems = useMemo(() => {
    let list = menuItems.filter(i => i.isAvailable);
    if (activeCatId) list = list.filter(i => i.categoryId === activeCatId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.shortCode && i.shortCode.toLowerCase().includes(q))
      );
    }
    return list;
  }, [menuItems, activeCatId, search]);

  /* ── Cart helpers ── */
  const cartCount    = cart.reduce((s, i) => s + i.quantity, 0);
  const subtotal     = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const discountAmt  = subtotal * (discountPct / 100);
  const taxable      = subtotal - discountAmt;
  const taxAmt       = taxable * (taxRate / 100);
  const total        = taxable + taxAmt;

  const getCartQty = useCallback((itemId: number) => {
    return cart.filter(c => c.menuItemId === itemId).reduce((s, c) => s + c.quantity, 0);
  }, [cart]);

  const addToCart = useCallback((
    item: MenuItem,
    size?: { size: string; price: number },
    addons?: Array<{ name: string; price: number }>,
    itemNotes?: string,
  ) => {
    const price = size ? size.price : parseFloat(item.price);
    const addonTotal = (addons ?? []).reduce((s, a) => s + a.price, 0);
    const finalPrice = price + addonTotal;
    const key = `${item.id}-${size?.size ?? ""}-${(addons ?? []).map(a => a.name).join(",")}`;
    setCart(prev => {
      const existing = prev.find(c => c.key === key && c.notes === (itemNotes ?? ""));
      if (existing && !itemNotes && !(addons?.length)) {
        return prev.map(c => c.key === key ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, {
        key, menuItemId: item.id, name: item.name, price: finalPrice,
        quantity: 1, size: size?.size, addons, notes: itemNotes,
      }];
    });
  }, []);

  const changeQty = useCallback((key: string, delta: number) => {
    setCart(prev =>
      prev.map(c => c.key === key ? { ...c, quantity: c.quantity + delta } : c)
          .filter(c => c.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((key: string) => {
    setCart(prev => prev.filter(c => c.key !== key));
  }, []);

  /* ── Orders filter ── */
  const runningOrders  = allOrders.filter(o => o.status === "running" || o.status === "pending");
  const heldOrders     = allOrders.filter(o => o.status === "hold");
  const completedOrders = allOrders.filter(o => o.status === "served" || o.status === "cancelled").slice(0, 30);

  /* ── Table selection ── */
  const handleTableTap = (table: typeof tables[0]) => {
    setActiveTableId(table.id);
    if (table.runningOrder) {
      setActiveOrderId(table.runningOrder.id);
      // Load existing order into cart if empty
      if (cart.length === 0) {
        const items = table.runningOrder.items ?? [];
        const loaded: CartItem[] = items.map((it: any) => ({
          key: `${it.menuItemId}-${it.size ?? ""}-`,
          menuItemId: it.menuItemId, name: it.name,
          price: parseFloat(it.price), quantity: it.quantity, size: it.size,
        }));
        if (loaded.length > 0) setCart(loaded);
      }
    } else {
      setActiveOrderId(null);
    }
    setOrderType("dine-in");
    setTab("menu");
  };

  /* ── Fetch order items when resuming ── */
  const resumeOrder = useCallback(async (order: OrderRow) => {
    try {
      const res = await fetch(`/api/orders/${order.id}`, { credentials: "include" });
      const data = await res.json();
      const loaded: CartItem[] = (data.items ?? []).map((it: any) => ({
        key: `${it.menuItemId}-${it.size ?? ""}-`,
        menuItemId: it.menuItemId, name: it.name ?? "Item",
        price: parseFloat(it.price), quantity: it.quantity, size: it.size,
      }));
      setCart(loaded);
      setActiveOrderId(order.id);
      setActiveTableId(order.tableId ?? null);
      setOrderType((order.orderType as OrderType) ?? "dine-in");
      setCustomerName(order.customerName ?? "");
      setTab("cart");
    } catch {
      toast({ title: "Failed to load order", variant: "destructive" });
    }
  }, [toast]);

  /* ── Table actions ── */
  const handleTableAction = useCallback(async (
    action: "move" | "merge" | "split", targetId?: number
  ) => {
    if (!tableActionFor) return;
    try {
      if (action === "move" && targetId && tableActionFor.currentOrderId) {
        await apiRequest("POST", `/api/tables/${tableActionFor.id}/shift`, { toTableId: targetId });
        toast({ title: "Table moved" });
        queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      } else if (action === "split") {
        toast({ title: "Split bill — use desktop POS for full split functionality" });
      } else if (action === "merge") {
        toast({ title: "Merge — use desktop POS for full merge functionality" });
      }
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    }
    setTableActionFor(null);
  }, [tableActionFor, toast]);

  /* ── KOT Mutation ── */
  const kotMutation = useMutation({
    mutationFn: async ({ paymentMethod, markPaid }: { paymentMethod?: string; markPaid?: boolean } = {}) => {
      if (cart.length === 0) throw new Error("Cart is empty");
      const activeTable = tables.find(t => t.id === activeTableId);
      const payload: any = {
        orderType,
        customerName:   customerName.trim() || null,
        customerPhone:  customerPhone.trim() || null,
        tableId:        orderType === "dine-in" && activeTableId ? activeTableId : null,
        tableNumber:    orderType === "dine-in" && activeTable   ? activeTable.name : null,
        status:         "pending",
        totalAmount:    total.toFixed(2),
        taxAmount:      taxAmt.toFixed(2),
        discountAmount: discountAmt.toFixed(2),
        paymentStatus:  markPaid ? "paid" : "pending",
        paymentMethod:  paymentMethod || null,
        source:         "mobile-pos",
        notes:          notes.trim() || null,
        items: cart.map(c => ({
          menuItemId: c.menuItemId, name: c.name, quantity: c.quantity,
          price: c.price.toFixed(2), size: c.size ?? null,
          specialInstructions: c.notes ?? null,
        })),
      };

      if (activeOrderId) {
        // Update existing order
        return apiRequest("PUT", `/api/orders/${activeOrderId}/items`, {
          items: payload.items,
          discountAmount: payload.discountAmount,
          customerName: payload.customerName,
          customerPhone: payload.customerPhone,
        });
      }
      return apiRequest("POST", "/api/orders", payload);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      if (vars?.markPaid) {
        setShowPaySheet(false);
        setKotDone(true);
        setTimeout(() => {
          setKotDone(false);
          resetCart();
          setTab("tables");
        }, 2000);
      } else {
        toast({ title: activeOrderId ? "Order updated" : "KOT sent to kitchen" });
        setKotDone(true);
        setTimeout(() => setKotDone(false), 1500);
        if (!activeOrderId) {
          resetCart();
          setTab("tables");
        }
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const resetCart = () => {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setNotes("");
    setDiscountPct(0);
    setDiscountUnlocked(false);
    setActiveOrderId(null);
    setActiveTableId(null);
  };

  /* ── Search auto-focus when switching to menu ── */
  useEffect(() => {
    if (tab === "menu") setTimeout(() => searchRef.current?.focus(), 150);
  }, [tab]);

  /* ── KOT success animation ── */
  if (kotDone && !showPaySheet) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center bg-white">
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center"
        >
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
        </motion.div>
        <h2 className="text-xl font-bold text-gray-800">Done!</h2>
      </div>
    );
  }

  /* ── Sort categories by displayOrder ── */
  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    [categories]
  );

  /* ─────────────────────── RENDER ─────────────────────────── */
  return (
    <div className="flex flex-col h-full max-w-md mx-auto bg-gray-50 overflow-hidden relative">

      {/* PIN Guard overlay */}
      {managerAuth.pinRequest && (
        <PinGuard
          actionLabel={managerAuth.pinRequest.label}
          requiredRole={managerAuth.pinRequest.requiredRole}
          onSuccess={managerAuth.resolvePinSuccess}
          onCancel={managerAuth.resolvePinCancel}
        />
      )}

      {/* Item customization sheet */}
      <AnimatePresence>
        {customizeItem && (
          <ItemSheet
            item={customizeItem}
            onAdd={addToCart}
            onClose={() => setCustomizeItem(null)}
          />
        )}
      </AnimatePresence>

      {/* Table action sheet */}
      <AnimatePresence>
        {tableActionFor && (
          <TableActionSheet
            table={tableActionFor}
            allTables={rawTables}
            activeOrderId={activeOrderId}
            onClose={() => setTableActionFor(null)}
            onTableAction={handleTableAction}
            canAction={can}
            requirePin={requirePin}
          />
        )}
      </AnimatePresence>

      {/* Payment sheet */}
      <AnimatePresence>
        {showPaySheet && (
          <PaymentSheet
            total={total}
            onPay={(method) => kotMutation.mutate({ paymentMethod: method, markPaid: true })}
            onClose={() => setShowPaySheet(false)}
            isPending={kotMutation.isPending}
          />
        )}
      </AnimatePresence>

      {/* ── Top Bar ── */}
      <header className="shrink-0 flex items-center justify-between px-4 py-3
                         bg-white border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-2">
          {(tab === "menu" || tab === "cart") && (
            <button
              onClick={() => setTab("tables")}
              className="p-1.5 -ml-1.5 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-gray-800 capitalize">{user?.username ?? "Waiter"}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase
                ${activeRole === "admin" ? "bg-purple-100 text-purple-700" :
                  activeRole === "manager" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>
                {activeRole}
              </span>
            </div>
            {activeTableId && tab !== "tables" && (
              <p className="text-xs text-emerald-600 font-semibold leading-none mt-0.5">
                {tables.find(t => t.id === activeTableId)?.name ?? "Table"}
                {activeOrderId ? " · Editing" : " · New order"}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-emerald-400" : "bg-red-400"}`}
               title={wsConnected ? "Live" : "Offline"} />
          <button
            onClick={logout}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Tab Content ── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* ═══════════════ TABLES TAB ═══════════════ */}
        {tab === "tables" && (
          <div className="h-full overflow-y-auto px-3 py-3 pb-24">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-gray-800">
                Tables
                <span className="text-xs font-normal text-gray-400 ml-2">
                  {tables.filter(t => t.status === "running").length} running
                </span>
              </h2>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/tables"] })}
                className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Table status legend */}
            <div className="flex items-center gap-3 mb-4 text-xs text-gray-400">
              {[["free", "bg-gray-400", "Free"], ["running", "bg-emerald-500", "Running"], ["billed", "bg-amber-500", "Billed"]]
                .map(([, dot, label]) => (
                  <div key={label} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${dot}`} />
                    {label}
                  </div>
                ))}
            </div>

            {/* Sections */}
            {Object.entries(
              tables.reduce((acc: Record<string, typeof tables>, t) => {
                (acc[t.section] = acc[t.section] ?? []).push(t);
                return acc;
              }, {})
            ).map(([section, sectionTables]) => (
              <div key={section} className="mb-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  {section}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {sectionTables.map(table => (
                    <TableCard
                      key={table.id}
                      table={table}
                      onTap={() => handleTableTap(table)}
                      onLongPress={() => setTableActionFor(table)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Quick-start delivery/pickup */}
            {!lockedMode && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                {(["delivery", "pickup"] as OrderType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => { setOrderType(type); setActiveTableId(null); setTab("menu"); }}
                    className="py-4 rounded-2xl bg-white border border-gray-200 text-sm font-semibold
                               text-gray-600 capitalize active:bg-gray-50 transition-colors shadow-sm"
                  >
                    {type === "delivery" ? "🛵 Delivery" : "🥡 Pickup"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ MENU TAB ═══════════════ */}
        {tab === "menu" && (
          <div className="flex flex-col h-full">
            {/* Sticky: search + categories */}
            <div className="shrink-0 bg-gray-50 border-b border-gray-100">
              {/* Search */}
              <div className="px-3 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search items…"
                    className="w-full rounded-xl bg-white border border-gray-200 pl-9 pr-9
                               py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {/* Category chips */}
              <div className="flex gap-2 px-3 pb-2.5 overflow-x-auto scrollbar-hide">
                <button
                  onClick={() => setActiveCatId(null)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    !activeCatId
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-white text-gray-600 border border-gray-200"
                  }`}
                >All</button>
                {sortedCats.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCatId(cat.id === activeCatId ? null : cat.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      activeCatId === cat.id
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "bg-white text-gray-600 border border-gray-200"
                    }`}
                  >{cat.name}</button>
                ))}
              </div>
            </div>

            {/* Items grid */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="grid grid-cols-2 gap-3 px-3 py-3 pb-28">
                {filteredItems.map(item => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    cartQty={getCartQty(item.id)}
                    onTap={() => {
                      if (item.sizes?.length || item.addons?.length) {
                        setCustomizeItem(item);
                      } else {
                        addToCart(item);
                        // Brief visual feedback via toast is too slow — cart badge updates instantly
                      }
                    }}
                    onLongPress={() => setCustomizeItem(item)}
                  />
                ))}
                {filteredItems.length === 0 && (
                  <p className="col-span-2 text-center text-sm text-gray-400 py-12">No items found</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ CART TAB ═══════════════ */}
        {tab === "cart" && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-40 space-y-3">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <ShoppingCart className="w-12 h-12 text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400">Cart is empty</p>
                  <button
                    onClick={() => setTab("menu")}
                    className="mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold"
                  >
                    Browse Menu
                  </button>
                </div>
              ) : (
                <>
                  {/* Cart items */}
                  <div className="space-y-2">
                    {cart.map(c => (
                      <motion.div
                        key={c.key}
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="flex items-center gap-3 bg-white rounded-2xl p-3 shadow-sm border border-gray-100"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                          {c.size && <p className="text-xs text-gray-400">{c.size}</p>}
                          {c.addons?.length
                            ? <p className="text-xs text-gray-400 truncate">
                                + {c.addons.map(a => a.name).join(", ")}
                              </p>
                            : null}
                          {c.notes && <p className="text-xs text-gray-400 italic truncate">📝 {c.notes}</p>}
                          <p className="text-sm font-bold text-emerald-600 mt-0.5">{fmt(c.price * c.quantity)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => changeQty(c.key, -1)}
                            className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center
                                       active:bg-gray-200 transition-colors"
                          >
                            <Minus className="w-3.5 h-3.5 text-gray-600" />
                          </button>
                          <span className="w-6 text-center text-sm font-bold">{c.quantity}</span>
                          <button
                            onClick={() => changeQty(c.key, 1)}
                            className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center
                                       active:bg-emerald-600 transition-colors shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5 text-white" />
                          </button>
                          <button
                            onClick={() => removeItem(c.key)}
                            className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center
                                       active:bg-red-100 transition-colors ml-1"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Order type (lock if URL param set) */}
                  {!lockedMode && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Order Type</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(["dine-in", "delivery", "pickup"] as OrderType[]).map(t => (
                          <button
                            key={t}
                            onClick={() => setOrderType(t)}
                            className={`py-2.5 rounded-xl text-xs font-semibold transition-all capitalize ${
                              orderType === t
                                ? "bg-emerald-500 text-white shadow-sm"
                                : "bg-white text-gray-600 border border-gray-200"
                            }`}
                          >
                            {t === "dine-in" ? "Dine In" : t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Table selector for dine-in */}
                  {orderType === "dine-in" && !activeTableId && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Table</p>
                      <div className="grid grid-cols-4 gap-2">
                        {rawTables.filter(t => t.status === "free").map(t => (
                          <button
                            key={t.id}
                            onClick={() => setActiveTableId(t.id)}
                            className="py-2.5 rounded-xl text-xs font-semibold bg-white border
                                       border-gray-200 text-gray-600 active:bg-emerald-50 transition-colors"
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Collapsible details */}
                  <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                    <button
                      onClick={() => setShowDetails(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3
                                 text-sm font-semibold text-gray-700"
                    >
                      <span className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" /> Customer & Notes
                      </span>
                      {showDetails
                        ? <ChevronUp className="w-4 h-4 text-gray-400" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </button>
                    {showDetails && (
                      <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                        <input
                          value={customerName}
                          onChange={e => setCustomerName(e.target.value)}
                          placeholder="Customer name (optional)"
                          className="w-full rounded-xl bg-gray-50 border-0 px-3 py-2.5 text-sm
                                     outline-none focus:ring-2 focus:ring-emerald-400 transition-all mt-3"
                        />
                        <input
                          value={customerPhone}
                          onChange={e => setCustomerPhone(e.target.value)}
                          placeholder="Phone (optional)"
                          type="tel" inputMode="numeric"
                          className="w-full rounded-xl bg-gray-50 border-0 px-3 py-2.5 text-sm
                                     outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
                        />
                        <textarea
                          value={notes}
                          onChange={e => setNotes(e.target.value)}
                          placeholder="Special instructions…"
                          rows={2}
                          className="w-full rounded-xl bg-gray-50 border-0 px-3 py-2.5 text-sm
                                     outline-none focus:ring-2 focus:ring-emerald-400 resize-none transition-all"
                        />
                      </div>
                    )}
                  </div>

                  {/* Discount (PIN gated for non-admin) */}
                  <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Percent className="w-4 h-4 text-gray-400" /> Discount
                      </label>
                      {!can("discount") && !discountUnlocked ? (
                        <button
                          onClick={() => requirePin("Apply Discount", () => setDiscountUnlocked(true))}
                          className="flex items-center gap-1 text-xs text-amber-600 font-semibold
                                     bg-amber-50 px-2.5 py-1.5 rounded-lg"
                        >
                          <Tag className="w-3 h-3" /> Unlock
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          {[0, 5, 10, 15, 20].map(p => (
                            <button
                              key={p}
                              onClick={() => setDiscountPct(p)}
                              className={`px-2 py-1 rounded-lg text-xs font-bold transition-colors ${
                                discountPct === p
                                  ? "bg-emerald-500 text-white"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {p === 0 ? "None" : `${p}%`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {discountPct > 0 && (
                      <p className="text-xs text-emerald-600 font-medium mt-2">
                        Saving {fmt(discountAmt)} ({discountPct}%)
                      </p>
                    )}
                  </div>

                  {/* Summary */}
                  <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 shadow-sm space-y-1.5">
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Subtotal</span><span>{fmt(subtotal)}</span>
                    </div>
                    {discountAmt > 0 && (
                      <div className="flex justify-between text-sm text-emerald-600">
                        <span>Discount ({discountPct}%)</span><span>−{fmt(discountAmt)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>Tax ({taxRate}%)</span><span>{fmt(taxAmt)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-gray-900
                                    border-t border-gray-100 pt-1.5">
                      <span>Total</span><span className="text-emerald-600">{fmt(total)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── Sticky bottom actions ── */}
            {cart.length > 0 && (
              <div className="shrink-0 bg-white border-t border-gray-100 px-3 py-3 pb-safe shadow-lg">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => kotMutation.mutate({})}
                    disabled={kotMutation.isPending}
                    className="flex items-center justify-center gap-2 py-4 rounded-2xl
                               bg-gray-900 text-white font-bold text-sm shadow-md
                               active:scale-[0.97] transition-transform disabled:opacity-60"
                  >
                    {kotMutation.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <ClipboardList className="w-4 h-4" />}
                    KOT
                  </button>
                  <button
                    onClick={() => setShowPaySheet(true)}
                    disabled={kotMutation.isPending}
                    className="flex items-center justify-center gap-2 py-4 rounded-2xl
                               bg-gradient-to-r from-emerald-500 to-green-500 text-white
                               font-bold text-sm shadow-md active:scale-[0.97] transition-transform
                               disabled:opacity-60"
                  >
                    <Receipt className="w-4 h-4" />
                    Pay · {fmt(total)}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ ORDERS TAB ═══════════════ */}
        {tab === "orders" && (
          <div className="flex flex-col h-full">
            {/* Sub-tabs */}
            <div className="shrink-0 flex gap-1 px-3 pt-3 pb-2">
              {(["running", "held", "completed"] as OrderSubTab[]).map(st => {
                const count = st === "running" ? runningOrders.length
                  : st === "held" ? heldOrders.length : completedOrders.length;
                return (
                  <button
                    key={st}
                    onClick={() => setOrderSubTab(st)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all capitalize
                      relative ${
                        orderSubTab === st
                          ? "bg-emerald-500 text-white shadow-sm"
                          : "bg-white text-gray-500 border border-gray-200"
                      }`}
                  >
                    {st}
                    {count > 0 && (
                      <span className={`ml-1 text-[10px] font-bold ${
                        orderSubTab === st ? "text-emerald-100" : "text-gray-400"
                      }`}>({count})</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Order list */}
            <div className="flex-1 overflow-y-auto px-3 pb-24 space-y-2">
              {(orderSubTab === "running" ? runningOrders
                : orderSubTab === "held" ? heldOrders
                : completedOrders
              ).map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onTap={() => {
                    if (orderSubTab === "running" || orderSubTab === "held") {
                      resumeOrder(order);
                    }
                  }}
                />
              ))}
              {(orderSubTab === "running" ? runningOrders
                : orderSubTab === "held" ? heldOrders
                : completedOrders
              ).length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <ClipboardList className="w-10 h-10 text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">No {orderSubTab} orders</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── Bottom Navigation ── */}
      <nav className="shrink-0 absolute bottom-0 left-0 right-0
                      bg-white/95 backdrop-blur-xl border-t border-gray-100 px-2 pt-1 pb-2 z-10">
        <div className="grid grid-cols-4 gap-0.5">
          {([
            { id: "tables", icon: LayoutGrid,   label: "Tables",  badge: 0 },
            { id: "menu",   icon: UtensilsCrossed, label: "Menu", badge: 0 },
            { id: "cart",   icon: ShoppingCart,  label: "Cart",   badge: cartCount },
            { id: "orders", icon: ClipboardList, label: "Orders", badge: runningOrders.length },
          ] as const).map(({ id, icon: Icon, label, badge }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative flex flex-col items-center justify-center py-2 rounded-xl
                          transition-all min-h-[56px] ${
                tab === id ? "bg-emerald-50 text-emerald-600" : "text-gray-400"
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full
                                   bg-emerald-500 text-white text-[9px] font-bold
                                   flex items-center justify-center leading-none">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold mt-0.5">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
