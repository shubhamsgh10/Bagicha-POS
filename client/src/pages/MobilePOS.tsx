import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UtensilsCrossed, ShoppingCart, ClipboardCheck, Plus, Minus, X, ChevronRight, Loader2, LogOut, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

/* ── Types ─────────────────────────────────────────────────── */
interface Category { id: number; name: string; }
interface MenuItem {
  id: number; name: string; price: string; categoryId: number;
  isAvailable: boolean; sizes?: Array<{ size: string; price: number }>;
}
interface CartItem {
  menuItemId: number; name: string; price: number;
  quantity: number; size?: string;
}
interface Settings { taxRate: number; }

type Tab       = "menu" | "cart" | "order";
type OrderType = "dine-in" | "delivery" | "pickup";

/* ── Helpers ───────────────────────────────────────────────── */
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);

/* ─────────────────────────────────────────────────────────────
   MOBILE POS
   ───────────────────────────────────────────────────────────── */
export default function MobilePOS() {
  const { toast } = useToast();
  const { user, logout } = useAuth();

  /* ── Tab state ── */
  const [tab, setTab] = useState<Tab>("menu");

  /* ── Menu filters ── */
  const [activeCatId, setActiveCatId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  /* ── Cart ── */
  const [cart, setCart] = useState<CartItem[]>([]);

  /* ── Order form ── */
  const [orderType, setOrderType]     = useState<OrderType>("dine-in");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [tableId, setTableId]         = useState<number | "">("");
  const [tableName, setTableName]     = useState("");
  const [notes, setNotes]             = useState("");
  const [success, setSuccess]         = useState(false);

  /* ── Data queries ── */
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: menuItems   = [] } = useQuery<MenuItem[]>({ queryKey: ["/api/menu"] });
  const { data: tables      = [] } = useQuery<any[]>({ queryKey: ["/api/tables"] });
  const { data: settings        } = useQuery<Settings>({ queryKey: ["/api/settings"] });

  const taxRate = settings?.taxRate ?? 5;

  /* ── Filtered menu ── */
  const filteredItems = useMemo(() => {
    let list = menuItems.filter(i => i.isAvailable);
    if (activeCatId) list = list.filter(i => i.categoryId === activeCatId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [menuItems, activeCatId, search]);

  /* ── Cart helpers ── */
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const subtotal  = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const taxAmt    = subtotal * (taxRate / 100);
  const total     = subtotal + taxAmt;

  const addToCart = (item: MenuItem, size?: { size: string; price: number }) => {
    const price = size ? size.price : parseFloat(item.price);
    const key   = `${item.id}-${size?.size ?? ""}`;
    setCart(prev => {
      const existing = prev.find(c => `${c.menuItemId}-${c.size ?? ""}` === key);
      if (existing) {
        return prev.map(c =>
          `${c.menuItemId}-${c.size ?? ""}` === key ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { menuItemId: item.id, name: item.name, price, quantity: 1, size: size?.size }];
    });
  };

  const changeQty = (key: string, delta: number) => {
    setCart(prev =>
      prev
        .map(c => `${c.menuItemId}-${c.size ?? ""}` === key ? { ...c, quantity: c.quantity + delta } : c)
        .filter(c => c.quantity > 0)
    );
  };

  const clearCart = () => setCart([]);

  /* ── Save order ── */
  const saveOrderMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("Cart is empty");

      const selectedTable = tables.find((t: any) => t.id === tableId);

      const payload = {
        orderType,
        customerName:  customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        tableId:       orderType === "dine-in" && tableId ? Number(tableId) : null,
        tableNumber:   orderType === "dine-in" && tableName ? tableName : null,
        status:        "pending",
        totalAmount:   total.toFixed(2),
        taxAmount:     taxAmt.toFixed(2),
        discountAmount:"0",
        paymentStatus: "pending",
        source:        "mobile-pos",
        notes:         notes.trim() || null,
        items: cart.map(c => ({
          menuItemId:          c.menuItemId,
          name:                c.name,
          quantity:            c.quantity,
          price:               c.price.toFixed(2),
          size:                c.size ?? null,
          specialInstructions: null,
        })),
      };

      return apiRequest("POST", "/api/orders", payload);
    },
    onSuccess: () => {
      setSuccess(true);
      clearCart();
      setCustomerName("");
      setCustomerPhone("");
      setTableId("");
      setTableName("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      setTimeout(() => { setSuccess(false); setTab("menu"); }, 2200);
    },
    onError: (err: any) => {
      toast({ title: "Failed to place order", description: err.message, variant: "destructive" });
    },
  });

  /* ── Success screen ── */
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-800">Order Placed!</h2>
        <p className="text-sm text-gray-500">Your order has been sent to the kitchen.</p>
      </div>
    );
  }

  /* ─────────────────────── RENDER ─────────────────────────── */
  return (
    <div className="flex flex-col h-full max-w-md mx-auto bg-white overflow-hidden">

      {/* ── Top Bar ── */}
      <header className="shrink-0 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shadow-sm">
        <div>
          <p className="text-xs text-gray-400 leading-none">Mobile POS</p>
          <p className="text-sm font-bold text-gray-800 capitalize">{user?.username ?? "Staff"}</p>
        </div>
        <button
          onClick={logout}
          className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* ── Tab Content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* ═══════════ MENU TAB ═══════════ */}
        {tab === "menu" && (
          <div className="flex flex-col h-full">
            {/* Search */}
            <div className="px-3 pt-3 pb-2 sticky top-0 bg-white z-10">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search menu…"
                className="w-full rounded-xl bg-gray-100 border-0 px-3 py-2.5 text-sm outline-none
                           focus:ring-2 focus:ring-emerald-400 transition-all"
              />
            </div>

            {/* Category chips */}
            <div className="flex gap-2 px-3 pb-2 overflow-x-auto scrollbar-hide shrink-0">
              <button
                onClick={() => setActiveCatId(null)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  !activeCatId
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600"
                }`}
              >All</button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCatId(cat.id === activeCatId ? null : cat.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    activeCatId === cat.id
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >{cat.name}</button>
              ))}
            </div>

            {/* Menu grid */}
            <div className="grid grid-cols-2 gap-3 px-3 pb-24">
              {filteredItems.map(item => (
                <MenuItemCard key={item.id} item={item} onAdd={addToCart} />
              ))}
              {filteredItems.length === 0 && (
                <p className="col-span-2 text-center text-sm text-gray-400 py-12">No items found</p>
              )}
            </div>
          </div>
        )}

        {/* ═══════════ CART TAB ═══════════ */}
        {tab === "cart" && (
          <div className="px-3 py-3 pb-24 space-y-3">
            {cart.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-400">Your cart is empty</p>
              </div>
            ) : (
              <>
                {cart.map(c => {
                  const key = `${c.menuItemId}-${c.size ?? ""}`;
                  return (
                    <div key={key} className="flex items-center gap-3 bg-gray-50 rounded-2xl p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                        {c.size && <p className="text-xs text-gray-400">{c.size}</p>}
                        <p className="text-sm font-bold text-emerald-600 mt-0.5">{fmt(c.price * c.quantity)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => changeQty(key, -1)}
                          className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-200 flex items-center justify-center"
                        >
                          <Minus className="w-3 h-3 text-gray-600" />
                        </button>
                        <span className="w-5 text-center text-sm font-bold">{c.quantity}</span>
                        <button
                          onClick={() => changeQty(key, 1)}
                          className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm"
                        >
                          <Plus className="w-3 h-3 text-white" />
                        </button>
                        <button
                          onClick={() => changeQty(key, -c.quantity)}
                          className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-100 flex items-center justify-center ml-1"
                        >
                          <X className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Summary */}
                <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Subtotal</span><span>{fmt(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Tax ({taxRate}%)</span><span>{fmt(taxAmt)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-gray-800 pt-1 border-t border-gray-200">
                    <span>Total</span><span className="text-emerald-600">{fmt(total)}</span>
                  </div>
                </div>

                <button
                  onClick={() => setTab("order")}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl
                             bg-gradient-to-r from-emerald-500 to-green-500 text-white font-semibold
                             shadow-sm active:scale-[0.98] transition-transform"
                >
                  Continue to Order Details <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        )}

        {/* ═══════════ ORDER TAB ═══════════ */}
        {tab === "order" && (
          <div className="px-3 py-3 pb-28 space-y-4">

            {/* Order type */}
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
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >{t === "dine-in" ? "Dine In" : t}</button>
                ))}
              </div>
            </div>

            {/* Customer fields */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Customer Name</label>
                <input
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-xl bg-gray-100 border-0 px-3 py-2.5 text-sm outline-none
                             focus:ring-2 focus:ring-emerald-400 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Phone Number</label>
                <input
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="Optional"
                  type="tel"
                  inputMode="numeric"
                  className="w-full rounded-xl bg-gray-100 border-0 px-3 py-2.5 text-sm outline-none
                             focus:ring-2 focus:ring-emerald-400 transition-all"
                />
              </div>

              {/* Table select — dine-in only */}
              {orderType === "dine-in" && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Table</label>
                  <select
                    value={tableId}
                    onChange={e => {
                      const id = e.target.value ? Number(e.target.value) : "";
                      setTableId(id);
                      const t = tables.find((x: any) => x.id === Number(id));
                      setTableName(t ? t.name : "");
                    }}
                    className="w-full rounded-xl bg-gray-100 border-0 px-3 py-2.5 text-sm outline-none
                               focus:ring-2 focus:ring-emerald-400 transition-all appearance-none"
                  >
                    <option value="">Select table (optional)</option>
                    {tables
                      .filter((t: any) => t.status === "free")
                      .map((t: any) => (
                        <option key={t.id} value={t.id}>{t.name} ({t.section})</option>
                      ))
                    }
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Special instructions…"
                  rows={2}
                  className="w-full rounded-xl bg-gray-100 border-0 px-3 py-2.5 text-sm outline-none
                             focus:ring-2 focus:ring-emerald-400 transition-all resize-none"
                />
              </div>
            </div>

            {/* Order summary */}
            <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Order Summary ({cartCount} item{cartCount !== 1 ? "s" : ""})
              </p>
              {cart.map(c => (
                <div key={`${c.menuItemId}-${c.size}`} className="flex justify-between text-sm text-gray-700">
                  <span className="truncate flex-1 mr-2">{c.name}{c.size ? ` (${c.size})` : ""} ×{c.quantity}</span>
                  <span className="font-medium shrink-0">{fmt(c.price * c.quantity)}</span>
                </div>
              ))}
              <div className="border-t border-gray-200 pt-2 mt-1">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Tax ({taxRate}%)</span><span>{fmt(taxAmt)}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-gray-800 mt-1">
                  <span>Total</span>
                  <span className="text-emerald-600">{fmt(total)}</span>
                </div>
              </div>
            </div>

            {/* Place order */}
            <button
              onClick={() => saveOrderMutation.mutate()}
              disabled={cart.length === 0 || saveOrderMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl
                         bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold text-base
                         shadow-md active:scale-[0.98] transition-transform
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveOrderMutation.isPending ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Placing Order…</>
              ) : (
                <><ClipboardCheck className="w-5 h-5" /> Place Order · {fmt(total)}</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav className="shrink-0 fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md
                      bg-white/90 backdrop-blur-xl border-t border-gray-100 px-2 pb-2 pt-1 z-20">
        <div className="grid grid-cols-3 gap-1">
          {[
            { id: "menu",  icon: UtensilsCrossed, label: "Menu",  badge: 0 },
            { id: "cart",  icon: ShoppingCart,     label: "Cart",  badge: cartCount },
            { id: "order", icon: ClipboardCheck,   label: "Order", badge: 0 },
          ].map(({ id, icon: Icon, label, badge }) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={`relative flex flex-col items-center justify-center py-2 rounded-xl transition-all ${
                tab === id
                  ? "bg-emerald-50 text-emerald-600"
                  : "text-gray-400"
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full
                                   bg-emerald-500 text-white text-[10px] font-bold
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

/* ─────────────────────────────────────────────────────────────
   MENU ITEM CARD
   ───────────────────────────────────────────────────────────── */
function MenuItemCard({
  item,
  onAdd,
}: {
  item: MenuItem;
  onAdd: (item: MenuItem, size?: { size: string; price: number }) => void;
}) {
  const hasSizes = item.sizes && item.sizes.length > 0;
  const [showSizes, setShowSizes] = useState(false);

  return (
    <>
      <button
        onClick={() => hasSizes ? setShowSizes(true) : onAdd(item)}
        className="flex flex-col items-start bg-gray-50 rounded-2xl p-3 text-left
                   active:scale-[0.96] transition-transform touch-manipulation"
      >
        <div className="w-full flex items-start justify-between gap-1 mb-2">
          <p className="text-sm font-semibold text-gray-800 leading-snug flex-1">{item.name}</p>
          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
            <Plus className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
        {hasSizes ? (
          <div className="flex flex-wrap gap-1">
            {item.sizes!.map(s => (
              <span key={s.size} className="text-[11px] bg-white rounded-lg px-1.5 py-0.5 text-gray-500 border border-gray-200">
                {s.size} ₹{s.price}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm font-bold text-emerald-600">
            ₹{parseFloat(item.price).toFixed(0)}
          </p>
        )}
      </button>

      {/* Size picker sheet */}
      {showSizes && hasSizes && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center"
          onClick={() => setShowSizes(false)}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md bg-white rounded-t-3xl px-4 pt-4 pb-8 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />
            <p className="font-bold text-gray-800 mb-3">{item.name}</p>
            <div className="space-y-2">
              {item.sizes!.map(s => (
                <button
                  key={s.size}
                  onClick={() => { onAdd(item, s); setShowSizes(false); }}
                  className="w-full flex items-center justify-between py-3 px-4
                             rounded-xl bg-gray-50 active:bg-emerald-50 transition-colors"
                >
                  <span className="font-medium text-gray-700">{s.size}</span>
                  <span className="font-bold text-emerald-600">₹{s.price}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
