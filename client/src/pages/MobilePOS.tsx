/**
 * MobilePOS — Redesigned to match Stitch design reference.
 * 4-tab layout: Tables → Menu → Cart → Orders
 * All functionality preserved; only visual layer updated.
 */
import {
  useState, useMemo, useEffect, useRef, useCallback, memo,
} from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  UtensilsCrossed, ShoppingCart, ClipboardList, LayoutGrid,
  Plus, Minus, X, Search, LogOut, CheckCircle2, Loader2,
  ChevronDown, ChevronUp, Tag, Clock,
  Receipt, Banknote, CreditCard, Smartphone, ArrowLeft,
  RefreshCw, Percent, QrCode,
  MoveRight, GitMerge, Scissors, Trash2, MoreVertical,
  ChevronRight,
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

/* ─────────────────────── DESIGN TOKENS ─────────────────────── */
const C = {
  primary:      "#1e5c3f",   // dark forest green
  primaryLight: "#4a9b6e",
  runningBg:    "rgba(220,252,231,0.75)",
  runningBorder:"#86efac",
  runningText:  "#166534",
  billedBg:     "rgba(255,247,228,0.90)",
  billedBorder: "#fcd34d",
  billedText:   "#b45309",
  freeBg:       "rgba(243,244,246,0.70)",
  freeBorder:   "#e5e7eb",
  freeText:     "#6b7280",
  pageBg:       "#f5f5f2",
  white:        "#ffffff",
  cardShadow:   "0 1px 4px rgba(0,0,0,0.07)",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);

/* ── Item color palette (since no food images) ─────────────────── */
const ITEM_COLORS = [
  ["#ff6b6b","#ee5a24"], ["#feca57","#f9ca24"], ["#48dbfb","#0abde3"],
  ["#ff9ff3","#f368e0"], ["#54a0ff","#2e86de"], ["#5f27cd","#341f97"],
  ["#1dd1a1","#10ac84"], ["#ff9f43","#e67e22"], ["#c8d6e5","#8395a7"],
  ["#fd79a8","#e84393"],
];
function itemColor(name: string): [string, string] {
  const idx = name.split("").reduce((a,c) => a + c.charCodeAt(0), 0) % ITEM_COLORS.length;
  return ITEM_COLORS[idx] as [string, string];
}
function itemInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

/* ── Avatar color for user ─────────────────────────────────────── */
function avatarColor(name: string) {
  const colors = ["#10b981","#0ea5e9","#8b5cf6","#f59e0b","#ef4444","#ec4899"];
  return colors[name.split("").reduce((a,c) => a + c.charCodeAt(0), 0) % colors.length];
}

/* ──────────────────── OFFLINE CACHE ────────────────────────── */
const CACHE_KEY = "mpos_offline_cache";
function loadCache(): { menu?: MenuItem[]; categories?: Category[] } {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveCache(data: { menu?: MenuItem[]; categories?: Category[] }) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); }
  catch { /* quota exceeded */ }
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
    timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, delay);
  }, [onLongPress, delay]);
  const cancel = useCallback(() => { clearTimeout(timer.current); }, []);
  const end = useCallback(() => {
    clearTimeout(timer.current);
    if (!fired.current) onClick();
  }, [onClick]);
  return {
    onPointerDown: start, onPointerUp: end, onPointerLeave: cancel,
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
      sock.onclose = () => { setConnected(false); reconnect.current = setTimeout(connect, 4000); };
      sock.onerror = () => sock.close();
      sock.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
      ws.current = sock;
    } catch {}
  }, [onMessage]);
  useEffect(() => {
    connect();
    return () => { clearTimeout(reconnect.current); ws.current?.close(); };
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
  const isBilled  = table.status === "billed";
  const isRunning = table.status === "running";

  return (
    <motion.button
      {...lp}
      whileTap={{ scale: 0.95 }}
      className="relative flex flex-col text-left touch-manipulation select-none w-full"
      style={{
        background: isBilled ? C.billedBg : isRunning ? C.runningBg : C.freeBg,
        border: `1.5px solid ${isBilled ? C.billedBorder : isRunning ? C.runningBorder : C.freeBorder}`,
        borderRadius: 16,
        padding: "14px 16px",
        minHeight: isBilled ? 72 : 90,
        boxShadow: C.cardShadow,
      }}
    >
      {/* Timer chip — top right */}
      {isRunning && timeLabel && (
        <span style={{
          position: "absolute", top: 10, right: 10,
          background: C.runningBg,
          color: C.runningText,
          border: `1px solid ${C.runningBorder}`,
          borderRadius: 20, padding: "2px 8px",
          fontSize: 10, fontWeight: 700,
        }}>{timeLabel}</span>
      )}
      {/* Billed: chevron right */}
      {isBilled && (
        <ChevronRight size={16} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: C.billedText }} />
      )}

      {/* Table name */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 15, fontWeight: 800,
          color: isRunning ? C.runningText : isBilled ? C.billedText : C.freeText,
        }}>{table.name}</span>
        {isBilled && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
            background: "rgba(245,158,11,0.15)",
            color: C.billedText,
            borderRadius: 20, padding: "2px 8px",
            border: `1px solid ${C.billedBorder}`,
          }}>Billed</span>
        )}
      </div>

      {/* Status line */}
      {isRunning ? (
        <>
          <span style={{ fontSize: 11, color: C.runningText, fontWeight: 600, marginBottom: 4 }}>Running</span>
          {table.runningTotal != null && table.runningTotal > 0 && (
            <span style={{ fontSize: 15, fontWeight: 800, color: C.runningText }}>{fmt(table.runningTotal)}</span>
          )}
        </>
      ) : isBilled ? (
        <span style={{ fontSize: 13, fontWeight: 600, color: C.billedText }}>Awaiting payment</span>
      ) : (
        <span style={{ fontSize: 12, color: C.freeText, fontWeight: 500 }}>Free</span>
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
  const [c1, c2] = itemColor(item.name);

  return (
    <motion.button
      {...lp}
      whileTap={{ scale: 0.94 }}
      className="relative flex flex-col text-left touch-manipulation select-none w-full"
      style={{
        background: C.white,
        border: "1px solid #f0f0ee",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: C.cardShadow,
      }}
    >
      {/* Cart badge */}
      {cartQty > 0 && (
        <span style={{
          position: "absolute", top: 8, left: 8,
          width: 22, height: 22, borderRadius: "50%",
          background: C.primary, color: "white",
          fontSize: 10, fontWeight: 800,
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 2,
        }}>
          {cartQty > 9 ? "9+" : cartQty}
        </span>
      )}

      {/* Food photo placeholder (gradient) */}
      <div style={{
        width: "100%", height: 90,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 26, fontWeight: 900, color: "rgba(255,255,255,0.35)" }}>
          {itemInitials(item.name)}
        </span>
      </div>

      {/* Info row */}
      <div style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "#1f2937", lineHeight: 1.3 }}
           className="line-clamp-2">
          {item.name}
        </p>
        {hasSizes ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {item.sizes!.slice(0, 2).map(s => (
              <span key={s.size} style={{
                fontSize: 9, background: "#f3f4f6", borderRadius: 6,
                padding: "2px 6px", color: "#6b7280",
              }}>
                {s.size} ₹{s.price}
              </span>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, fontWeight: 800, color: C.primary }}>
            ₹{parseFloat(item.price).toFixed(0)}
          </p>
        )}
      </div>

      {/* Add button */}
      <div style={{ position: "absolute", bottom: 8, right: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: C.primary,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 6px rgba(30,92,63,0.35)",
        }}>
          <Plus size={13} color="white" strokeWidth={2.5} />
        </div>
      </div>
    </motion.button>
  );
});

/* ═══════════════════════════════════════════════════════════════
   ITEM CUSTOMIZATION SHEET
═══════════════════════════════════════════════════════════════ */
function ItemSheet({
  item, onAdd, onClose,
}: {
  item: MenuItem;
  onAdd: (item: MenuItem, size?: { size: string; price: number }, addons?: Array<{ name: string; price: number }>, notes?: string) => void;
  onClose: () => void;
}) {
  const [selectedSize, setSelectedSize] = useState<{ size: string; price: number } | null>(item.sizes?.[0] ?? null);
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const hasSizes  = !!item.sizes?.length;
  const hasAddons = !!item.addons?.length;
  const basePrice = selectedSize?.price ?? parseFloat(item.price);
  const addonTotal = Array.from(selectedAddons).reduce((s, name) =>
    s + (item.addons?.find(a => a.name === name)?.price ?? 0), 0);
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
      <div className="absolute inset-0 bg-black/40" />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative w-full max-w-md mx-auto rounded-t-3xl shadow-2xl pb-safe"
        style={{ background: C.white }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e5e7eb", margin: "12px auto 16px" }} />
        <div className="px-4 pb-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-base">{item.name}</h3>
            <button onClick={onClose} className="p-1 text-gray-400"><X size={20} /></button>
          </div>

          {hasSizes && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Size</p>
              <div className="space-y-2">
                {item.sizes!.map(s => (
                  <button key={s.size} onClick={() => setSelectedSize(s)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 16px", borderRadius: 12,
                      border: `2px solid ${selectedSize?.size === s.size ? C.primary : "#f0f0ee"}`,
                      background: selectedSize?.size === s.size ? "rgba(30,92,63,0.06)" : "#f9fafb",
                    }}>
                    <span style={{ fontWeight: 600, color: "#374151" }}>{s.size}</span>
                    <span style={{ fontWeight: 700, color: C.primary }}>₹{s.price}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasAddons && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Add-ons</p>
              <div className="space-y-2">
                {item.addons!.map(a => {
                  const checked = selectedAddons.has(a.name);
                  return (
                    <button key={a.name} onClick={() => setSelectedAddons(prev => {
                      const next = new Set(prev);
                      checked ? next.delete(a.name) : next.add(a.name);
                      return next;
                    })}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 16px", borderRadius: 12,
                      border: `2px solid ${checked ? C.primary : "#f0f0ee"}`,
                      background: checked ? "rgba(30,92,63,0.06)" : "#f9fafb",
                    }}>
                      <span style={{ fontWeight: 600, color: "#374151" }}>{a.name}</span>
                      <span style={{ color: "#6b7280" }}>+₹{a.price}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Notes</p>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Special instructions…"
              style={{
                width: "100%", borderRadius: 12, background: "#f3f4f6",
                border: "none", padding: "10px 14px", fontSize: 14, outline: "none",
              }} />
          </div>

          <button onClick={handleAdd}
            style={{
              width: "100%", padding: "16px", borderRadius: 16,
              background: C.primary, color: "white",
              fontWeight: 800, fontSize: 15, border: "none", cursor: "pointer",
            }}>
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
  table, allTables, activeOrderId, onClose, onTableAction, canAction, requirePin,
}: {
  table: TableRow; allTables: TableRow[]; activeOrderId: number | null;
  onClose: () => void;
  onTableAction: (action: "move" | "merge" | "split", targetId?: number) => void;
  canAction: (a: any) => boolean; requirePin: (label: string, fn: () => void) => void;
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
      <div className="absolute inset-0 bg-black/40" />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative w-full max-w-md mx-auto rounded-t-3xl shadow-2xl"
        style={{ background: C.white }}
        onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e5e7eb", margin: "12px auto 16px" }} />
        <div className="px-4 pb-8">
          <p style={{ fontWeight: 700, color: "#111827", textAlign: "center", marginBottom: 16 }}>Table {table.name}</p>
          {mode === "menu" && (
            <div className="space-y-2">
              {[
                { icon: MoveRight, label: "Move Table", color: "#3b82f6", action: () => setMode("move") },
                ...(table.status === "running" && activeOrderId
                  ? [{ icon: GitMerge, label: "Merge Table", color: "#8b5cf6", action: () => setMode("merge") },
                     { icon: Scissors, label: "Split Bill", color: "#f59e0b", action: () => doAction("split") }]
                  : []),
              ].map(({ icon: Icon, label, color, action }) => (
                <button key={label} onClick={action}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 16px", borderRadius: 14,
                    background: "#f9fafb", border: "none", cursor: "pointer",
                  }}>
                  <Icon size={18} color={color} />
                  <span style={{ fontWeight: 600, color: "#374151" }}>{label}</span>
                </button>
              ))}
              <button onClick={onClose} style={{ width: "100%", padding: "12px", fontSize: 13, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
            </div>
          )}
          {(mode === "move" || mode === "merge") && (
            <div className="space-y-3">
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Select a free table</p>
              {freeTables.length === 0 ? (
                <p style={{ textAlign: "center", color: "#9ca3af", padding: "16px 0" }}>No free tables available</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                  {freeTables.map(t => (
                    <button key={t.id} onClick={() => doAction(mode as "move" | "merge", t.id)}
                      style={{
                        padding: "12px 8px", borderRadius: 12,
                        background: "#f3f4f6", border: "1px solid #e5e7eb",
                        fontSize: 13, fontWeight: 700, cursor: "pointer",
                      }}>
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setMode("menu")} style={{ width: "100%", padding: "12px", fontSize: 13, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>← Back</button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAYMENT SHEET  — matches Stitch "Payment Collection" design
═══════════════════════════════════════════════════════════════ */
function PaymentSheet({
  total, onPay, onClose, isPending,
}: {
  total: number; onPay: (method: string) => void;
  onClose: () => void; isPending: boolean;
}) {
  const [method, setMethod] = useState("cash");
  const methods = [
    { id: "cash",  icon: Banknote,  label: "Cash" },
    { id: "card",  icon: CreditCard, label: "Card" },
    { id: "upi",   icon: QrCode,    label: "UPI" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative w-full max-w-md mx-auto rounded-t-3xl shadow-2xl"
        style={{ background: C.white }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e5e7eb", margin: "12px auto 0" }} />
        <div style={{ padding: "20px 20px 32px" }}>
          {/* Amount */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
              AMOUNT DUE
            </p>
            <p style={{ fontSize: 44, fontWeight: 900, color: "#111827", letterSpacing: "-1px" }}>
              {fmt(total)}
            </p>
          </div>

          {/* Payment methods — square cards like Stitch */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
            {methods.map(({ id, icon: Icon, label }) => {
              const active = method === id;
              return (
                <button
                  key={id}
                  onClick={() => setMethod(id)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 10,
                    padding: "18px 8px",
                    borderRadius: 16,
                    border: `2px solid ${active ? C.primary : "#e5e7eb"}`,
                    background: active ? "rgba(30,92,63,0.07)" : "#f9fafb",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: active ? "rgba(30,92,63,0.12)" : "#f0f0ee",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon size={20} color={active ? C.primary : "#9ca3af"} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: active ? C.primary : "#6b7280" }}>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Collect button */}
          <button
            onClick={() => onPay(method)}
            disabled={isPending}
            style={{
              width: "100%", padding: "18px",
              borderRadius: 16,
              background: C.primary,
              color: "white",
              fontWeight: 800, fontSize: 16,
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending
              ? <><Loader2 size={18} className="animate-spin" /> Processing…</>
              : <><Receipt size={18} /> Collect {fmt(total)}</>
            }
          </button>
          <button onClick={onClose} style={{ width: "100%", marginTop: 12, padding: "10px", fontSize: 14, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ORDER CARD — matches Stitch "Orders Tracking" design
═══════════════════════════════════════════════════════════════ */
function OrderCard({ order, onTap }: { order: OrderRow; onTap: () => void }) {
  const elapsed = useMemo(() => {
    const mins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
    return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  }, [order.createdAt]);

  const statusMeta =
    order.status === "pending" || order.status === "running"
      ? { label: "Running", bg: "rgba(220,252,231,0.8)", color: "#166534", dot: "#16a34a" }
      : order.status === "hold"
      ? { label: "On Hold", bg: "rgba(219,234,254,0.8)", color: "#1e40af", dot: "#3b82f6" }
      : order.status === "served"
      ? { label: "Served", bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" }
      : { label: order.status, bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" };

  // Build item initials bubbles
  const itemBubbles = useMemo(() => {
    const items = order.items ?? [];
    const first2 = items.slice(0, 2).map((it: any) => itemInitials(it.name ?? "?"));
    const extra = items.length > 2 ? `+${items.length - 2}` : null;
    return { first2, extra };
  }, [order.items]);

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onTap}
      style={{
        width: "100%", textAlign: "left",
        background: C.white,
        border: "1px solid #f0f0ee",
        borderRadius: 16,
        padding: "14px 16px",
        boxShadow: C.cardShadow,
      }}
    >
      {/* Row 1: order # + status badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          ORDER #{order.orderNumber}
        </span>
        <span style={{
          display: "flex", alignItems: "center", gap: 4,
          background: statusMeta.bg, color: statusMeta.color,
          borderRadius: 20, padding: "3px 10px",
          fontSize: 11, fontWeight: 700,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.dot }} />
          {statusMeta.label}
        </span>
      </div>

      {/* Row 2: Table name + time badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>
          {order.tableNumber ? `Table ${order.tableNumber}` : order.orderNumber}
        </span>
        <span style={{
          background: "rgba(220,252,231,0.8)", color: C.runningText,
          borderRadius: 20, padding: "2px 8px",
          fontSize: 11, fontWeight: 700,
          border: `1px solid ${C.runningBorder}`,
        }}>{elapsed}</span>
      </div>

      {/* Row 3: Item bubbles + total */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {itemBubbles.first2.map((init, i) => (
            <span key={i} style={{
              background: "#f3f4f6", color: "#374151",
              borderRadius: 20, padding: "3px 8px",
              fontSize: 11, fontWeight: 700,
            }}>{init}</span>
          ))}
          {itemBubbles.extra && (
            <span style={{
              background: "#f3f4f6", color: "#374151",
              borderRadius: 20, padding: "3px 8px",
              fontSize: 11, fontWeight: 700,
            }}>{itemBubbles.extra}</span>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 10, color: "#9ca3af", fontWeight: 500, marginBottom: 1 }}>Total Amount</p>
          <p style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>
            {fmt(parseFloat(order.totalAmount))}
          </p>
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

  const urlParams  = useMemo(() => new URLSearchParams(window.location.search), []);
  const lockedMode = urlParams.get("mode") as OrderType | null;

  const [tab, setTab]                       = useState<Tab>("tables");
  const [orderSubTab, setOrderSubTab]       = useState<OrderSubTab>("running");
  const [activeTableId, setActiveTableId]   = useState<number | null>(null);
  const [activeOrderId, setActiveOrderId]   = useState<number | null>(null);
  const [orderType, setOrderType]           = useState<OrderType>(lockedMode ?? "dine-in");
  const [cart, setCart]                     = useState<CartItem[]>([]);
  const [customerName, setCustomerName]     = useState("");
  const [customerPhone, setCustomerPhone]   = useState("");
  const [notes, setNotes]                   = useState("");
  const [discountPct, setDiscountPct]       = useState(0);
  const [discountUnlocked, setDiscountUnlocked] = useState(false);
  const [activeCatId, setActiveCatId]       = useState<number | null>(null);
  const [search, setSearch]                 = useState("");
  const [customizeItem, setCustomizeItem]   = useState<MenuItem | null>(null);
  const [tableActionFor, setTableActionFor] = useState<TableRow | null>(null);
  const [showPaySheet, setShowPaySheet]     = useState(false);
  const [showDetails, setShowDetails]       = useState(false);
  const [kotDone, setKotDone]               = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const cache = useMemo(loadCache, []);

  const { data: categories = cache.categories ?? [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
    onSuccess: (d: Category[]) => saveCache({ ...loadCache(), categories: d }),
  } as any);

  const { data: menuItems = cache.menu ?? [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu"],
    onSuccess: (d: MenuItem[]) => saveCache({ ...loadCache(), menu: d }),
  } as any);

  const { data: rawTables = [] } = useQuery<TableRow[]>({ queryKey: ["/api/tables"], staleTime: 0 });
  const { data: allOrders = [] } = useQuery<OrderRow[]>({ queryKey: ["/api/orders"], staleTime: 0 });
  const { data: settings } = useQuery<{ taxRate: number }>({ queryKey: ["/api/settings"] });
  const taxRate = settings?.taxRate ?? 5;

  const wsConnected = useWebSocket(useCallback((data: any) => {
    if (["TABLE_UPDATE", "NEW_ORDER", "KOT_UPDATE"].includes(data.type)) {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    }
  }, []));

  const tables = useMemo(() => rawTables.map(t => {
    const runningOrder = allOrders.find(
      o => o.tableId === t.id && (o.status === "running" || o.status === "pending")
    );
    return { ...t, runningOrder, runningTotal: runningOrder ? parseFloat(runningOrder.totalAmount) : undefined };
  }), [rawTables, allOrders]);

  const filteredItems = useMemo(() => {
    let list = menuItems.filter(i => i.isAvailable);
    if (activeCatId) list = list.filter(i => i.categoryId === activeCatId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q) || (i.shortCode && i.shortCode.toLowerCase().includes(q)));
    }
    return list;
  }, [menuItems, activeCatId, search]);

  const cartCount   = cart.reduce((s, i) => s + i.quantity, 0);
  const subtotal    = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const discountAmt = subtotal * (discountPct / 100);
  const taxable     = subtotal - discountAmt;
  const taxAmt      = taxable * (taxRate / 100);
  const total       = taxable + taxAmt;

  const getCartQty = useCallback((itemId: number) =>
    cart.filter(c => c.menuItemId === itemId).reduce((s, c) => s + c.quantity, 0), [cart]);

  const addToCart = useCallback((
    item: MenuItem, size?: { size: string; price: number },
    addons?: Array<{ name: string; price: number }>, itemNotes?: string,
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
      return [...prev, { key, menuItemId: item.id, name: item.name, price: finalPrice, quantity: 1, size: size?.size, addons, notes: itemNotes }];
    });
  }, []);

  const changeQty = useCallback((key: string, delta: number) => {
    setCart(prev => prev.map(c => c.key === key ? { ...c, quantity: c.quantity + delta } : c).filter(c => c.quantity > 0));
  }, []);

  const removeItem = useCallback((key: string) => { setCart(prev => prev.filter(c => c.key !== key)); }, []);

  const runningOrders  = allOrders.filter(o => o.status === "running" || o.status === "pending");
  const heldOrders     = allOrders.filter(o => o.status === "hold");
  const completedOrders = allOrders.filter(o => o.status === "served" || o.status === "cancelled").slice(0, 30);

  const handleTableTap = (table: typeof tables[0]) => {
    setActiveTableId(table.id);
    if (table.runningOrder) {
      setActiveOrderId(table.runningOrder.id);
      if (cart.length === 0) {
        const items = table.runningOrder.items ?? [];
        const loaded: CartItem[] = items.map((it: any) => ({
          key: `${it.menuItemId}-${it.size ?? ""}-`,
          menuItemId: it.menuItemId, name: it.name,
          price: parseFloat(it.price), quantity: it.quantity, size: it.size,
        }));
        if (loaded.length > 0) setCart(loaded);
      }
    } else { setActiveOrderId(null); }
    setOrderType("dine-in");
    setTab("menu");
  };

  const resumeOrder = useCallback(async (order: OrderRow) => {
    try {
      const res = await fetch(`/api/orders/${order.id}`, { credentials: "include" });
      const data = await res.json();
      const loaded: CartItem[] = (data.items ?? []).map((it: any) => ({
        key: `${it.menuItemId}-${it.size ?? ""}-`,
        menuItemId: it.menuItemId, name: it.name ?? "Item",
        price: parseFloat(it.price), quantity: it.quantity, size: it.size,
      }));
      setCart(loaded); setActiveOrderId(order.id);
      setActiveTableId(order.tableId ?? null);
      setOrderType((order.orderType as OrderType) ?? "dine-in");
      setCustomerName(order.customerName ?? "");
      setTab("cart");
    } catch { toast({ title: "Failed to load order", variant: "destructive" }); }
  }, [toast]);

  const handleTableAction = useCallback(async (action: "move" | "merge" | "split", targetId?: number) => {
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
    } catch { toast({ title: "Action failed", variant: "destructive" }); }
    setTableActionFor(null);
  }, [tableActionFor, toast]);

  const kotMutation = useMutation({
    mutationFn: async ({ paymentMethod, markPaid }: { paymentMethod?: string; markPaid?: boolean } = {}) => {
      if (cart.length === 0) throw new Error("Cart is empty");
      const activeTable = tables.find(t => t.id === activeTableId);
      const payload: any = {
        orderType, customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        tableId:      orderType === "dine-in" && activeTableId ? activeTableId : null,
        tableNumber:  orderType === "dine-in" && activeTable ? activeTable.name : null,
        status: "pending", totalAmount: total.toFixed(2), taxAmount: taxAmt.toFixed(2),
        discountAmount: discountAmt.toFixed(2),
        paymentStatus: markPaid ? "paid" : "pending",
        paymentMethod: paymentMethod || null,
        source: "mobile-pos", notes: notes.trim() || null,
        items: cart.map(c => ({
          menuItemId: c.menuItemId, name: c.name, quantity: c.quantity,
          price: c.price.toFixed(2), size: c.size ?? null,
          specialInstructions: c.notes ?? null,
        })),
      };
      if (activeOrderId) {
        return apiRequest("PUT", `/api/orders/${activeOrderId}/items`, {
          items: payload.items, discountAmount: payload.discountAmount,
          customerName: payload.customerName, customerPhone: payload.customerPhone,
        });
      }
      return apiRequest("POST", "/api/orders", payload);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      if (vars?.markPaid) {
        setShowPaySheet(false); setKotDone(true);
        setTimeout(() => { setKotDone(false); resetCart(); setTab("tables"); }, 2000);
      } else {
        toast({ title: activeOrderId ? "Order updated" : "KOT sent to kitchen" });
        setKotDone(true);
        setTimeout(() => setKotDone(false), 1500);
        if (!activeOrderId) { resetCart(); setTab("tables"); }
      }
    },
    onError: (err: any) => { toast({ title: "Failed", description: err.message, variant: "destructive" }); },
  });

  const resetCart = () => {
    setCart([]); setCustomerName(""); setCustomerPhone(""); setNotes("");
    setDiscountPct(0); setDiscountUnlocked(false); setActiveOrderId(null); setActiveTableId(null);
  };

  useEffect(() => {
    if (tab === "menu") setTimeout(() => searchRef.current?.focus(), 150);
  }, [tab]);

  /* KOT success screen */
  if (kotDone && !showPaySheet) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center"
           style={{ background: C.pageBg }}>
        <motion.div
          initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 14 }}
          style={{
            width: 88, height: 88, borderRadius: "50%",
            background: `linear-gradient(135deg, ${C.primaryLight}, ${C.primary})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 12px 36px rgba(30,92,63,0.40)`,
          }}
        >
          <CheckCircle2 size={44} color="white" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: "#111827" }}>Done!</h2>
          <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>Order sent to kitchen</p>
        </motion.div>
      </div>
    );
  }

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    [categories]
  );

  const activeTable = tables.find(t => t.id === activeTableId);
  const userInitials = (user?.username ?? "W").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const userColor = avatarColor(user?.username ?? "");

  /* ─────────────────────── RENDER ─────────────────────────── */
  return (
    <div className="flex flex-col h-full max-w-md mx-auto overflow-hidden relative"
         style={{ background: C.pageBg }}>

      {/* Overlays */}
      {managerAuth.pinRequest && (
        <PinGuard actionLabel={managerAuth.pinRequest.label} requiredRole={managerAuth.pinRequest.requiredRole}
          onSuccess={managerAuth.resolvePinSuccess} onCancel={managerAuth.resolvePinCancel} />
      )}
      <AnimatePresence>
        {customizeItem && <ItemSheet item={customizeItem} onAdd={addToCart} onClose={() => setCustomizeItem(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {tableActionFor && (
          <TableActionSheet table={tableActionFor} allTables={rawTables} activeOrderId={activeOrderId}
            onClose={() => setTableActionFor(null)} onTableAction={handleTableAction}
            canAction={can} requirePin={requirePin} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showPaySheet && (
          <PaymentSheet total={total}
            onPay={(method) => kotMutation.mutate({ paymentMethod: method, markPaid: true })}
            onClose={() => setShowPaySheet(false)} isPending={kotMutation.isPending} />
        )}
      </AnimatePresence>

      {/* ── TOP BAR ── */}
      <header style={{
        flexShrink: 0, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "12px 16px",
        background: C.white, borderBottom: "1px solid #f0f0ee",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {(tab === "menu" || tab === "cart") ? (
            <button onClick={() => setTab("tables")}
              style={{ padding: "6px", borderRadius: 10, background: "none", border: "none", cursor: "pointer", color: C.primary }}>
              <ArrowLeft size={18} color={C.primary} />
            </button>
          ) : (
            /* Avatar */
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: userColor, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 800, color: "white",
            }}>
              {userInitials}
            </div>
          )}

          {(tab === "tables" || tab === "orders") ? (
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{user?.username ?? "Waiter"}</span>
              <span style={{
                marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                padding: "2px 6px", borderRadius: 6, textTransform: "uppercase",
                ...(activeRole === "admin"
                  ? { background: "rgba(139,92,246,0.12)", color: "#6d28d9" }
                  : activeRole === "manager"
                  ? { background: "rgba(59,130,246,0.12)", color: "#1d4ed8" }
                  : { background: "#f3f4f6", color: "#6b7280" }),
              }}>{activeRole}</span>
            </div>
          ) : (
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.primary }}>
                {activeTable ? activeTable.name : (orderType === "delivery" ? "Delivery" : orderType === "pickup" ? "Pickup" : "New Order")}
              </span>
              {activeTable && (
                <p style={{ fontSize: 11, color: C.primaryLight, fontWeight: 600, marginTop: 1 }}>
                  {activeOrderId ? "Editing order" : "New order"}
                  <span style={{
                    display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                    background: wsConnected ? "#16a34a" : "#ef4444",
                    marginLeft: 6, verticalAlign: "middle",
                  }} />
                </p>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {(tab === "tables") && (
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: wsConnected ? "#16a34a" : "#ef4444",
            }} title={wsConnected ? "Live" : "Offline"} />
          )}
          <button onClick={logout}
            style={{ padding: "8px", borderRadius: 10, background: "none", border: "none", cursor: "pointer" }}>
            <LogOut size={18} color="#9ca3af" />
          </button>
        </div>
      </header>

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* ══════════════ TABLES TAB ══════════════ */}
        {tab === "tables" && (
          <div className="h-full overflow-y-auto" style={{ paddingBottom: 80 }}>
            {/* Page header */}
            <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h1 style={{ fontSize: 26, fontWeight: 900, color: "#111827" }}>Tables</h1>
              <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
                {tables.filter(t => t.status === "running").length} running
              </span>
            </div>

            {/* Status legend */}
            <div style={{
              margin: "0 16px 16px",
              background: C.white, borderRadius: 12, padding: "10px 14px",
              display: "flex", alignItems: "center", gap: 16,
              border: "1px solid #f0f0ee",
            }}>
              {[["#d1d5db", "Free"], ["#16a34a", "Running"], ["#f59e0b", "Billed"]].map(([dot, label]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "block" }} />
                  <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{label}</span>
                </div>
              ))}
              <button onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/tables"] })}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                <RefreshCw size={14} color="#9ca3af" />
              </button>
            </div>

            {/* Sections */}
            {Object.entries(
              tables.reduce((acc: Record<string, typeof tables>, t) => {
                (acc[t.section] = acc[t.section] ?? []).push(t);
                return acc;
              }, {})
            ).map(([section, sectionTables]) => (
              <div key={section} style={{ marginBottom: 20, padding: "0 16px" }}>
                <p style={{ fontSize: 16, fontWeight: 800, color: "#111827", marginBottom: 10 }}>{section}</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {sectionTables.map(table => (
                    <div key={table.id}
                         style={{ gridColumn: table.status === "billed" ? "1 / -1" : "auto" }}>
                      <TableCard
                        table={table}
                        onTap={() => handleTableTap(table)}
                        onLongPress={() => setTableActionFor(table)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Delivery / Pickup */}
            {!lockedMode && (
              <div style={{ padding: "0 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {(["delivery", "pickup"] as OrderType[]).map(type => (
                  <button key={type}
                    onClick={() => { setOrderType(type); setActiveTableId(null); setTab("menu"); }}
                    style={{
                      padding: "16px", borderRadius: 14,
                      background: C.white, border: "1.5px solid #e5e7eb",
                      fontSize: 14, fontWeight: 700, color: "#374151",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      boxShadow: C.cardShadow,
                    }}>
                    {type === "delivery" ? "🛵" : "🥡"}
                    {type === "delivery" ? "Delivery" : "Pickup"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ MENU TAB ══════════════ */}
        {tab === "menu" && (
          <div className="flex flex-col h-full">
            {/* Search + categories */}
            <div style={{
              flexShrink: 0, background: C.white,
              borderBottom: "1px solid #f0f0ee",
            }}>
              {/* Search */}
              <div style={{ padding: "10px 14px 8px" }}>
                <div style={{ position: "relative" }}>
                  <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search menu items…"
                    style={{
                      width: "100%", borderRadius: 12,
                      background: "#f5f5f2",
                      border: "1px solid #e5e7eb",
                      paddingLeft: 36, paddingRight: search ? 34 : 14,
                      paddingTop: 10, paddingBottom: 10,
                      fontSize: 13, outline: "none",
                    }}
                  />
                  {search && (
                    <button onClick={() => setSearch("")}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer" }}>
                      <X size={14} color="#9ca3af" />
                    </button>
                  )}
                </div>
              </div>
              {/* Category chips */}
              <div style={{ display: "flex", gap: 6, padding: "0 14px 12px", overflowX: "auto" }}
                   className="scrollbar-hide">
                {[{ id: null, name: "All" }, ...sortedCats].map(cat => {
                  const active = activeCatId === cat.id;
                  return (
                    <button key={cat.id ?? "all"}
                      onClick={() => setActiveCatId(cat.id === activeCatId ? null : cat.id)}
                      style={{
                        flexShrink: 0, padding: "6px 14px", borderRadius: 20,
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                        border: "none",
                        background: active ? C.primary : C.white,
                        color: active ? "white" : "#374151",
                        boxShadow: active ? `0 2px 8px rgba(30,92,63,0.30)` : `0 0 0 1px #e5e7eb`,
                        transition: "all 0.15s",
                      }}>
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Items grid */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: 10, padding: "12px 14px 90px",
              }}>
                {filteredItems.map(item => (
                  <MenuItemCard
                    key={item.id} item={item} cartQty={getCartQty(item.id)}
                    onTap={() => {
                      if (item.sizes?.length || item.addons?.length) setCustomizeItem(item);
                      else addToCart(item);
                    }}
                    onLongPress={() => setCustomizeItem(item)}
                  />
                ))}
                {filteredItems.length === 0 && (
                  <p style={{ gridColumn: "1/-1", textAlign: "center", color: "#9ca3af", padding: "48px 0", fontSize: 13 }}>
                    No items found
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ CART TAB ══════════════ */}
        {tab === "cart" && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto overscroll-contain"
                 style={{ padding: "12px 14px 160px" }}>
              {cart.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", textAlign: "center" }}>
                  <ShoppingCart size={48} color="#e5e7eb" style={{ marginBottom: 12 }} />
                  <p style={{ fontSize: 14, color: "#9ca3af" }}>Cart is empty</p>
                  <button onClick={() => setTab("menu")}
                    style={{
                      marginTop: 16, padding: "10px 24px", borderRadius: 12,
                      background: C.primary, color: "white",
                      fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer",
                    }}>Browse Menu</button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Order type selector */}
                  {!lockedMode && (
                    <div style={{
                      display: "flex", background: "#f0f0ee",
                      borderRadius: 12, padding: 4, gap: 2, marginBottom: 4,
                    }}>
                      {(["dine-in", "delivery", "pickup"] as OrderType[]).map(t => (
                        <button key={t} onClick={() => setOrderType(t)}
                          style={{
                            flex: 1, padding: "8px", borderRadius: 10,
                            fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                            transition: "all 0.15s",
                            background: orderType === t ? C.primary : "transparent",
                            color: orderType === t ? "white" : "#6b7280",
                            boxShadow: orderType === t ? "0 2px 6px rgba(30,92,63,0.25)" : "none",
                          }}>
                          {t === "dine-in" ? "Dine In" : t === "delivery" ? "Delivery" : "Pickup"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Cart items — matching Stitch cart design */}
                  {cart.map(c => {
                    const [ci1, ci2] = itemColor(c.name);
                    return (
                      <motion.div key={c.key} layout
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        style={{
                          background: C.white, borderRadius: 16,
                          border: "1px solid #f0f0ee",
                          padding: "12px 14px",
                          boxShadow: C.cardShadow,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          {/* Thumbnail */}
                          <div style={{
                            width: 52, height: 52, borderRadius: 10, flexShrink: 0,
                            background: `linear-gradient(135deg, ${ci1}, ${ci2})`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, fontWeight: 900, color: "rgba(255,255,255,0.4)",
                          }}>
                            {itemInitials(c.name)}
                          </div>
                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 14, fontWeight: 700, color: "#111827" }} className="truncate">{c.name}</p>
                            {c.size && <p style={{ fontSize: 11, color: "#9ca3af" }}>{c.size}</p>}
                            {c.addons?.length ? <p style={{ fontSize: 11, color: "#9ca3af" }} className="truncate">+ {c.addons.map(a => a.name).join(", ")}</p> : null}
                            {c.notes && <p style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }} className="truncate">📝 {c.notes}</p>}
                            <p style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginTop: 2 }}>{fmt(c.price * c.quantity)}</p>
                          </div>
                          {/* Trash */}
                          <button onClick={() => removeItem(c.key)}
                            style={{ padding: 4, background: "none", border: "none", cursor: "pointer" }}>
                            <Trash2 size={16} color="#ef4444" />
                          </button>
                        </div>
                        {/* Qty controls */}
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                          <div style={{
                            display: "flex", alignItems: "center", gap: 0,
                            background: "#f3f4f6", borderRadius: 10, overflow: "hidden",
                          }}>
                            <button onClick={() => changeQty(c.key, -1)}
                              style={{ width: 36, height: 34, background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#374151" }}>
                              −
                            </button>
                            <span style={{ width: 30, textAlign: "center", fontSize: 14, fontWeight: 800, color: "#111827" }}>{c.quantity}</span>
                            <button onClick={() => changeQty(c.key, 1)}
                              style={{ width: 36, height: 34, background: "none", border: "none", cursor: "pointer", fontSize: 16, color: C.primary }}>
                              +
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}

                  {/* Table selector for dine-in */}
                  {orderType === "dine-in" && !activeTableId && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Select Table</p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                        {rawTables.filter(t => t.status === "free").map(t => (
                          <button key={t.id} onClick={() => setActiveTableId(t.id)}
                            style={{
                              padding: "10px", borderRadius: 10,
                              background: C.white, border: "1.5px solid #e5e7eb",
                              fontSize: 12, fontWeight: 700, color: "#374151", cursor: "pointer",
                            }}>{t.name}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Customer & Notes */}
                  <div style={{ background: C.white, borderRadius: 16, border: "1px solid #f0f0ee", overflow: "hidden", boxShadow: C.cardShadow }}>
                    <button onClick={() => setShowDetails(v => !v)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "13px 16px", background: "none", border: "none", cursor: "pointer",
                        fontSize: 13, fontWeight: 700, color: "#374151",
                      }}>
                      <span>Customer & Notes</span>
                      {showDetails ? <ChevronUp size={15} color="#9ca3af" /> : <ChevronDown size={15} color="#9ca3af" />}
                    </button>
                    {showDetails && (
                      <div style={{ padding: "0 16px 16px", borderTop: "1px solid #f0f0ee", display: "flex", flexDirection: "column", gap: 8 }}>
                        {[
                          { value: customerName, setter: setCustomerName, placeholder: "Customer name (optional)", type: "text" },
                          { value: customerPhone, setter: setCustomerPhone, placeholder: "Phone (optional)", type: "tel" },
                        ].map(({ value, setter, placeholder, type }) => (
                          <input key={placeholder} value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} type={type}
                            style={{ background: "#f5f5f2", border: "none", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", marginTop: 8 }} />
                        ))}
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Special instructions…" rows={2}
                          style={{ background: "#f5f5f2", border: "none", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", resize: "none" }} />
                      </div>
                    )}
                  </div>

                  {/* Discount */}
                  <div style={{ background: C.white, borderRadius: 16, border: "1px solid #f0f0ee", padding: "13px 16px", boxShadow: C.cardShadow }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
                        <Percent size={14} color="#9ca3af" /> Discount
                      </span>
                      {!can("discount") && !discountUnlocked ? (
                        <button onClick={() => requirePin("Apply Discount", () => setDiscountUnlocked(true))}
                          style={{
                            display: "flex", alignItems: "center", gap: 4,
                            background: "rgba(245,158,11,0.10)", color: "#d97706",
                            border: "none", borderRadius: 8, padding: "6px 10px",
                            fontSize: 11, fontWeight: 700, cursor: "pointer",
                          }}>
                          <Tag size={11} /> Unlock
                        </button>
                      ) : (
                        <div style={{ display: "flex", gap: 4 }}>
                          {[0, 5, 10, 15, 20].map(p => (
                            <button key={p} onClick={() => setDiscountPct(p)}
                              style={{
                                padding: "4px 8px", borderRadius: 8, border: "none", cursor: "pointer",
                                fontSize: 11, fontWeight: 800,
                                background: discountPct === p ? C.primary : "#f3f4f6",
                                color: discountPct === p ? "white" : "#374151",
                              }}>
                              {p === 0 ? "None" : `${p}%`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {discountPct > 0 && (
                      <p style={{ fontSize: 11, color: C.primaryLight, fontWeight: 600, marginTop: 6 }}>
                        Saving {fmt(discountAmt)} ({discountPct}%)
                      </p>
                    )}
                  </div>

                  {/* Order Summary — light green box like Stitch */}
                  <div style={{
                    background: "rgba(220,252,231,0.4)",
                    border: "1px solid #bbf7d0",
                    borderRadius: 16, padding: "14px 16px",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginBottom: 4 }}>Order Summary</p>
                    {[
                      { label: "Subtotal", value: fmt(subtotal), color: "#374151" },
                      ...(discountAmt > 0 ? [{ label: `Discount (${discountPct}%)`, value: `−${fmt(discountAmt)}`, color: C.primaryLight }] : []),
                      { label: `Tax (${taxRate}%)`, value: fmt(taxAmt), color: "#374151" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: "#6b7280" }}>{label}</span>
                        <span style={{ fontSize: 13, color, fontWeight: 600 }}>{value}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid #bbf7d0", paddingTop: 8, marginTop: 2, display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>Total</span>
                      <span style={{ fontSize: 18, fontWeight: 900, color: C.primary }}>{fmt(total)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky bottom buttons — KOT + Pay like Stitch */}
            {cart.length > 0 && (
              <div style={{
                flexShrink: 0, padding: "12px 14px 16px",
                background: C.white, borderTop: "1px solid #f0f0ee",
                boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 10 }}>
                  <button onClick={() => kotMutation.mutate({})} disabled={kotMutation.isPending}
                    style={{
                      padding: "16px", borderRadius: 14,
                      background: "#111827", color: "white",
                      fontWeight: 800, fontSize: 15, border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      opacity: kotMutation.isPending ? 0.6 : 1,
                    }}>
                    {kotMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />}
                    KOT
                  </button>
                  <button onClick={() => setShowPaySheet(true)} disabled={kotMutation.isPending}
                    style={{
                      padding: "16px", borderRadius: 14,
                      background: C.primary, color: "white",
                      fontWeight: 800, fontSize: 15, border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      boxShadow: "0 4px 14px rgba(30,92,63,0.35)",
                      opacity: kotMutation.isPending ? 0.6 : 1,
                    }}>
                    Pay {fmt(total)}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ ORDERS TAB ══════════════ */}
        {tab === "orders" && (
          <div className="flex flex-col h-full">
            {/* Sub-tabs */}
            <div style={{ flexShrink: 0, padding: "12px 14px 8px", display: "flex", gap: 8 }}>
              {(["running", "held", "completed"] as OrderSubTab[]).map(st => {
                const count = st === "running" ? runningOrders.length : st === "held" ? heldOrders.length : completedOrders.length;
                const active = orderSubTab === st;
                return (
                  <button key={st} onClick={() => setOrderSubTab(st)}
                    style={{
                      padding: "8px 16px", borderRadius: 20,
                      fontSize: 12, fontWeight: 700,
                      border: "none", cursor: "pointer",
                      transition: "all 0.15s",
                      background: active ? C.primary : C.white,
                      color: active ? "white" : "#6b7280",
                      boxShadow: active
                        ? `0 2px 8px rgba(30,92,63,0.30)`
                        : "0 0 0 1px #e5e7eb",
                    }}>
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                    {count > 0 && (
                      <span style={{
                        marginLeft: 5, fontSize: 10, fontWeight: 800,
                        color: active ? "rgba(255,255,255,0.75)" : "#9ca3af",
                      }}>({count})</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Order list */}
            <div className="flex-1 overflow-y-auto" style={{ padding: "4px 14px 90px", display: "flex", flexDirection: "column", gap: 10 }}>
              {(orderSubTab === "running" ? runningOrders : orderSubTab === "held" ? heldOrders : completedOrders)
                .map(order => (
                  <OrderCard key={order.id} order={order}
                    onTap={() => { if (orderSubTab !== "completed") resumeOrder(order); }} />
                ))}
              {(orderSubTab === "running" ? runningOrders : orderSubTab === "held" ? heldOrders : completedOrders).length === 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", textAlign: "center" }}>
                  <ClipboardList size={40} color="#e5e7eb" style={{ marginBottom: 10 }} />
                  <p style={{ fontSize: 13, color: "#9ca3af" }}>No {orderSubTab} orders</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM NAVIGATION — matches Stitch exactly ── */}
      <nav style={{
        flexShrink: 0, position: "absolute", bottom: 0, left: 0, right: 0,
        background: C.white,
        borderTop: "1px solid #f0f0ee",
        padding: "6px 8px 8px",
        zIndex: 10,
        boxShadow: "0 -2px 12px rgba(0,0,0,0.06)",
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 2 }}>
          {([
            { id: "tables", icon: LayoutGrid,    label: "Tables",  badge: 0 },
            { id: "menu",   icon: UtensilsCrossed, label: "Menu",  badge: 0 },
            { id: "cart",   icon: ShoppingCart,   label: "Cart",   badge: cartCount },
            { id: "orders", icon: ClipboardList,  label: "Orders", badge: runningOrders.length },
          ] as const).map(({ id, icon: Icon, label, badge }) => {
            const active = tab === id;
            return (
              <motion.button
                key={id}
                onClick={() => setTab(id)}
                whileTap={{ scale: 0.88 }}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  padding: "6px 0 4px",
                  borderRadius: 12, border: "none", background: "none", cursor: "pointer",
                  color: active ? C.primary : "#9ca3af",
                  minHeight: 52,
                }}
              >
                <div style={{ position: "relative" }}>
                  <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                  {badge > 0 && (
                    <span style={{
                      position: "absolute", top: -6, right: -8,
                      minWidth: 16, height: 16, borderRadius: 8,
                      background: "#ef4444", color: "white",
                      fontSize: 9, fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "0 3px",
                    }}>
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10, fontWeight: active ? 800 : 600, marginTop: 3 }}>{label}</span>
              </motion.button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
