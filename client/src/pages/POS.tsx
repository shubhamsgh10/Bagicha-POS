import { apiUrl, apiJson } from '@/lib/api';
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

import { Plus, Minus, X, ShoppingCart, Search, Trash2, Edit2, ArrowLeft, LayoutGrid, Printer, ChevronDown, Lock, User, Phone, Clock, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { serialNum } from "@/lib/orderDisplay";
import { SettlementDialog, type SettlementData } from "@/components/SettlementDialog";
import { SectionParcelToggle } from "@/components/section-pos/SectionParcelToggle";
import { SectionActionBar } from "@/components/section-pos/SectionActionBar";
import { SectionOpenOrdersButton } from "@/components/section-pos/SectionOpenOrdersButton";
import { PinGuard } from "@/components/PinGuard";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { usePermission } from "@/hooks/usePermission";
import { useLocation } from "wouter";
import { PrintPreviewModal, type PrintPreview } from "@/components/PrintPreviewModal";
import { kotLines, billLines } from "@/lib/receiptText";
import { printKOT, printOrderBill } from "@/lib/printBill";

function POSTimer({ startedAt }: { startedAt: string }) {
  const getElapsed = (s: string) => {
    const totalMins = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return { h, m };
  };
  const [elapsed, setElapsed] = useState(() => getElapsed(startedAt));
  useEffect(() => {
    setElapsed(getElapsed(startedAt));
    const id = setInterval(() => setElapsed(getElapsed(startedAt)), 60000);
    return () => clearInterval(id);
  }, [startedAt]);
  const display = elapsed.h > 0 ? `${elapsed.h}h ${elapsed.m}m` : `${elapsed.m} Min`;
  return <span className="opacity-90">{display}</span>;
}

const orderSchema = z.object({
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  orderType: z.enum(["dine-in", "takeaway", "delivery"]),
  tableNumber: z.string().optional(),
  paymentMethod: z.enum(["cash", "card", "upi", "online"]).optional(),
  notes: z.string().optional(),
});

type OrderForm = z.infer<typeof orderSchema>;

interface SizeOption { size: string; price: number; }
interface AddonOption { name: string; price: number; }
interface VariantOption { name: string; price?: number; }
interface VariantGroup { group: string; options: VariantOption[]; required?: boolean; }
type ItemServiceMode = "dinein" | "pickup" | "delivery";

interface CartItem {
  cartKey: string;
  id: number;
  name: string;
  basePrice: number;
  addons: AddonOption[];
  variants: Record<string, string>; // group → chosen option name
  notes: string;
  totalPrice: number;
  quantity: number;
  size?: string;
  serviceMode: ItemServiceMode;
  parcelLeftover?: boolean; // dine-in leftover packed as takeaway → flat container charge
}
interface ModalState {
  item: any;
  cartKey: string | null;
  isEdit: boolean;
  size: SizeOption | null;
  addons: AddonOption[];
  variants: Record<string, string>;
  notes: string;
  qty: number;
  qtyRaw: string;
}

const fmt = (n: number) => `₹${n.toFixed(0)}`;

// Order-type tab icons — inline SVG, no emoji, matching the Bagicha design system's icon style.
function DineInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round">
      <line x1="5" y1="3" x2="15" y2="17" />
      <line x1="15" y1="3" x2="5" y2="17" />
    </svg>
  );
}
function TakeawayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7h10l-1 10H6L5 7z" />
      <path d="M7 7a3 3 0 0 1 6 0" />
    </svg>
  );
}
function DeliveryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="15" r="3" />
      <circle cx="15" cy="15" r="3" />
      <path d="M5 15l4-8h4l2 4M9 7h3" />
    </svg>
  );
}

// Long-press (touch/mouse) + right-click handlers that fire `onLongPress` after ~500ms hold.
function longPressHandlers(onLongPress: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const start = () => { timer = setTimeout(onLongPress, 500); };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerMove: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => { e.preventDefault(); onLongPress(); },
  };
}


function sendWhatsAppBill(order: any, items: any[] = [], settings?: any, targetWindow?: Window | null) {
  const phone = order.customerPhone?.replace(/\D/g, "");
  if (!phone) {
    if (targetWindow) targetWindow.close();
    return false;
  }
  const restaurantName = settings?.restaurantName || "Bagicha Restaurant";
  const address = settings?.address ? `\n${settings.address}` : "";
  const itemLines = items.length > 0
    ? items.map((i: any) => `  • ${i.name || "Item"} × ${i.quantity}  ₹${(parseFloat(i.price) * i.quantity).toFixed(0)}`).join("\n")
    : "";
  const subtotal = parseFloat(order.totalAmount) - parseFloat(order.taxAmount || "0");
  const discount = parseFloat(order.discountAmount || "0");
  const tax = parseFloat(order.taxAmount || "0");
  const total = parseFloat(order.totalAmount);
  const lines = [
    `🧾 *${restaurantName}*${address}`,
    ``,
    `Order: *${order.orderNumber}*`,
    order.tableNumber ? `Table: ${order.tableNumber}` : null,
    order.customerName ? `Name: ${order.customerName}` : null,
    ``,
    `*ITEMS*`,
    itemLines,
    ``,
    `Subtotal: ₹${subtotal.toFixed(0)}`,
    discount > 0 ? `Discount: -₹${discount.toFixed(0)}` : null,
    `Tax: ₹${tax.toFixed(0)}`,
    `*TOTAL: ₹${total.toFixed(0)}*`,
    ``,
    settings?.footerNote || "Thank you for dining with us!",
  ].filter(l => l !== null).join("\n");
  const url = `https://wa.me/${phone.startsWith("91") ? phone : "91" + phone}?text=${encodeURIComponent(lines)}`;
  if (targetWindow) {
    targetWindow.location.href = url;
  } else {
    window.open(url, "_blank");
  }
  return true;
}



export default function POS() {
  const [, navigate] = useLocation();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  // Manually staff-entered container charge (₹) — a flat amount typed in on the cart,
  // like a delivery charge, not computed from item quantities/serviceMode.
  const [containerCharge, setContainerCharge] = useState(0);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Unified modifier modal state (handles both add-new and edit-existing)
  const [modal, setModal] = useState<ModalState | null>(null);

  // URL params
  const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const preselectedTableId = urlParams.get("tableId") ? Number(urlParams.get("tableId")) : null;
  const preselectedTableName = urlParams.get("tableName") ? decodeURIComponent(urlParams.get("tableName") || "") : null;
  const editOrderId = urlParams.get("orderId") ? Number(urlParams.get("orderId")) : null;
  const posMode = urlParams.get("mode") as "delivery" | "pickup" | null; // direct delivery/pickup mode
  // Quick-POS section (e.g. South Indian counter): filtered menu, no table, print-bill-then-settle flow
  const sectionId = urlParams.get("section");
  const sectionName = urlParams.get("sectionName") ? decodeURIComponent(urlParams.get("sectionName") || "") : null;
  const isSectionMode = !!sectionId;

  // ── Active order ID (starts from URL, updated after KOT creates a new order) ─
  const [activeOrderId, setActiveOrderId] = useState<number | null>(editOrderId);
  // Tracks what action triggered the submit
  const submitModeRef = useRef<"kot" | "kot-print" | "save" | "save-print" | "save-ebill" | "settle" | "bill-print">("save");
  // Snapshot of existingOrder.items captured at KOT click time — used for delta preview
  const preKOTItemsRef = useRef<Array<{ menuItemId: number; quantity: number; size: string | null }>>([]);
  // Payment method selection
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");
  const paymentMethodRef = useRef("cash");
  const setPayment = (m: string) => { setSelectedPaymentMethod(m); paymentMethodRef.current = m; };
  const [otherReason, setOtherReason] = useState("");
  const otherReasonRef = useRef("");
  // It's Paid checkbox
  const [isPaid, setIsPaid] = useState(false);
  const [showSettleDialog, setShowSettleDialog] = useState(false);
  const settlementDataRef = useRef<SettlementData | null>(null);
  // Settle two-phase loading state
  const [settlePhase, setSettlePhase] = useState<"idle" | "processing" | "printing">("idle");
  // True from click until the post-save print step (triggerKOTPrint/triggerBillPrint,
  // called un-awaited from mutation onSuccess) actually finishes. isPending alone isn't
  // enough — it flips false as soon as the PUT/POST resolves, before the print fetch
  // inside onSuccess has completed, which is the real window where a second click can
  // race the first click's own print request.
  const [isPrinting, setIsPrinting] = useState(false);
  // Auto-KOT debounce refs
  const autoKotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoKotReadyRef = useRef(false);
  // Short code input
  const [shortCode, setShortCode] = useState("");
  // Open Item (off-menu, staff-typed name + price). Each line gets a unique NEGATIVE
  // menuItemId — no menu row exists, and PUT /items' KOT delta keys on menuItemId.
  const [showOpenItemDialog, setShowOpenItemDialog] = useState(false);
  const [openItemName, setOpenItemName] = useState("");
  const [openItemPrice, setOpenItemPrice] = useState("");
  const [openItemQty, setOpenItemQty] = useState(1);
  const [openItemQtyRaw, setOpenItemQtyRaw] = useState("1");
  // Same dialog doubles as the editor for an existing open item — has no menu row to
  // edit against via openEditPicker, so this is its only path to change qty/name/price.
  const [editingOpenItemCartKey, setEditingOpenItemCartKey] = useState<string | null>(null);
  const openItemSeqRef = useRef(-(Date.now() % 1_000_000_000));
  // Active item mode — only relevant in table sessions; controls serviceMode of newly added items.
  // Section counters reuse it as the big Eating Here/Parcel toggle: "pickup" = parcel
  // (container charge per item via the existing serviceMode computation), "dinein" = eating here.
  // Items keep their own mode, so one order can mix both — same per-item logic as tables.
  const [activeItemMode, setActiveItemMode] = useState<ItemServiceMode>("dinein");
  // Mobile tab: switch between menu and cart panels
  const [mobileTab, setMobileTab] = useState<"menu" | "cart">("menu");
  // Mobile: collapse the cart order-summary (totals + action buttons) to browse more items
  const [summaryOpen, setSummaryOpen] = useState(true);
  const prevHasItemsRef = useRef(false);
  useEffect(() => {
    // Auto-open the summary when the cart goes from empty → has items
    if (cartItems.length > 0 && !prevHasItemsRef.current) setSummaryOpen(true);
    prevHasItemsRef.current = cartItems.length > 0;
  }, [cartItems.length]);
  // Mobile customer autocomplete dropdown
  const [showMobileCustomerDropdown, setShowMobileCustomerDropdown] = useState(false);
  // Discount input ref (for re-focus after PIN unlock)
  const discountInputRef = useRef<HTMLInputElement>(null);

  // ── Role switcher + permission system ────────────────────────────────────────
  const { activeRole, loginRole, secondsLeft, isElevated, elevateRole, revertRole } = useActiveRoleContext();
  const { data: cartPermSettings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const { can, isOff, go, requirePin, pinRequest, resolvePinSuccess, resolvePinCancel, isLocked, actionPinRole } = usePermission(activeRole, cartPermSettings?.cartPermissions);
  const isAdmin = activeRole === "admin";
  const isStaff = activeRole === "staff";

  // ── Route guard: POS requires a tableId OR an orderId OR a direct mode OR a section ─
  useEffect(() => {
    if (!preselectedTableId && !editOrderId && !posMode && !sectionId) {
      navigate("/tables");
    }
  }, []);

  // ── Leave confirmation ────────────────────────────────────────────────────────
  const handleBackToTables = () => {
    navigate("/tables");
  };

  // ── Table Actions state ───────────────────────────────────────────────────────
  const [showActionsMenu, setShowActionsMenu]       = useState(false);
  const [showMoveDialog, setShowMoveDialog]         = useState(false);
  const [showMergeDialog, setShowMergeDialog]       = useState(false);
  const [showSplitDialog, setShowSplitDialog]       = useState(false);
  const [showHoldConfirm, setShowHoldConfirm]       = useState(false);
  const [showRecallDialog, setShowRecallDialog]     = useState(false);
  const [showCancelConfirm, setShowCancelConfirm]   = useState(false);
  const [cancelReason, setCancelReason]             = useState("");
  const [splitSelectedIds, setSplitSelectedIds]     = useState<number[]>([]);
  const [actionLoading, setActionLoading]           = useState(false);

  // Tables list (for move + merge)
  const { data: allTables = [] } = useQuery<any[]>({
    queryKey: ["/api/tables"],
    staleTime: 0,
    enabled: showMoveDialog || showMergeDialog,
  });
  const freeTables   = allTables.filter((t) => t.status === "free");
  const runningTables = allTables.filter(
    (t) => t.status === "running" && t.id !== preselectedTableId
  );

  // Held orders (for recall)
  const { data: heldOrders = [], refetch: refetchHeld } = useQuery<any[]>({
    queryKey: ["/api/orders/hold"],
    staleTime: 0,
    enabled: showRecallDialog,
  });

  // ── Table Action helpers ──────────────────────────────────────────────────────
  const openAction = (action: () => void) => {
    setShowActionsMenu(false);
    action();
  };

  const handleMoveTable = async (newTable: any) => {
    if (!activeOrderId) return;
    setActionLoading(true);
    try {
      await apiRequest("PUT", `/api/orders/${activeOrderId}/move-table`, {
        newTableId: newTable.id,
        newTableName: newTable.name,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      setShowMoveDialog(false);
      navigate("/tables");
    } catch {
      toast({ title: "Failed to move table", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMergeTable = async (sourceTable: any) => {
    if (!activeOrderId || !sourceTable.currentOrderId) return;
    setActionLoading(true);
    try {
      await apiRequest("POST", "/api/orders/merge", {
        targetOrderId: activeOrderId,
        sourceOrderId: sourceTable.currentOrderId,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", String(activeOrderId)] });
      setShowMergeDialog(false);
      // Reload the current order since items changed
      window.location.reload();
    } catch {
      toast({ title: "Failed to merge tables", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleHoldOrder = async () => {
    if (!activeOrderId) return;
    setActionLoading(true);
    try {
      await apiRequest("PUT", `/api/orders/${activeOrderId}/hold`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Order placed on hold" });
      setShowHoldConfirm(false);
      navigate("/tables");
    } catch {
      toast({ title: "Failed to hold order", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!activeOrderId) return;
    const reason = cancelReason.trim();
    if (!reason) return; // confirm button is already disabled for this, belt-and-suspenders
    setActionLoading(true);
    try {
      await apiRequest("PUT", `/api/orders/${activeOrderId}/cancel`, { reason });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kot/running"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
      toast({ title: "Order cancelled" });
      setShowCancelConfirm(false);
      setCancelReason("");
      navigate("/tables");
    } catch {
      toast({ title: "Failed to cancel order", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSplitBill = async () => {
    if (!activeOrderId || splitSelectedIds.length === 0) return;
    setActionLoading(true);
    try {
      const result = await apiRequest("POST", `/api/orders/${activeOrderId}/split`, {
        itemIds: splitSelectedIds,
      });
      const data = await result.json();
      queryClient.invalidateQueries({ queryKey: ["/api/orders", String(activeOrderId)] });
      toast({
        title: "Bill split successfully",
        description: `New order #${data.newOrderId} created for selected items`,
      });
      setShowSplitDialog(false);
      setSplitSelectedIds([]);
      window.location.reload();
    } catch {
      toast({ title: "Failed to split bill", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSplitItem = (id: number) => {
    setSplitSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const { toast } = useToast();
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);

  const showKOTPreview = (order: any, kotNumber?: string) => {
    // Delta: compare current cart against what was in the order before this KOT action.
    // preKOTItemsRef is captured at button-click time so it always has the pre-mutation state,
    // regardless of whether lastKotSnapshot was ever updated (it only updates on successful print).
    const prevMap = new Map<string, number>();
    for (const s of preKOTItemsRef.current) {
      prevMap.set(`${s.menuItemId}:${s.size ?? ''}`, s.quantity);
    }
    const deltaItems = cartItems
      .map(i => {
        const prevQty = prevMap.get(`${i.id}:${i.size ?? ''}`) ?? 0;
        const dQty = i.quantity - prevQty;
        return dQty > 0 ? { name: i.name, quantity: dQty, size: i.size ?? null, notes: i.notes || null, serviceMode: i.serviceMode } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const items = deltaItems.length > 0
      ? deltaItems
      : cartItems.map(i => ({ name: i.name, quantity: i.quantity, size: i.size ?? null, notes: i.notes || null, serviceMode: i.serviceMode }));
    const lines = kotLines({
      kotNumber,
      orderRef: order.orderNumber ?? String(order.id),
      tableNumber: order.tableNumber ?? null,
      items,
    });
    setPrintPreview({ title: 'KOT Preview', lines });
  };

  const showBillPreview = (order: any) => {
    const s = settings as any;
    const lines = billLines({
      orderNumber: order.orderNumber ?? String(order.id),
      tableNumber: order.tableNumber ?? null,
      customerName: order.customerName ?? null,
      orderType: order.orderType,
      totalAmount: parseFloat(order.totalAmount ?? '0'),
      taxAmount: parseFloat(order.taxAmount ?? '0'),
      discountAmount: parseFloat(order.discountAmount ?? '0'),
      containerCharge: order.containerCharge != null ? parseFloat(order.containerCharge) : containerCharge,
      paymentMethod: order.paymentMethod ?? null,
      createdAt: order.createdAt ?? new Date(),
      items: cartItems.map(i => ({ name: i.name, quantity: i.quantity, price: i.totalPrice, size: i.size ?? null, notes: i.notes || null, serviceMode: i.serviceMode })),
      restaurantName: s?.restaurantName,
      address: s?.address,
      phone: s?.phone,
      gstNumber: s?.gstNumber,
      currencySymbol: s?.currencySymbol,
      taxRate: s?.taxRate,
      footerNote: s?.footerNote,
    });
    setPrintPreview({ title: 'Bill Preview', lines });
  };

  const triggerKOTPrint = async (orderId: number, order?: any, silent = false) => {
    try {
      const res = await fetch(apiUrl('/api/print/kot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: 'KOT print failed',
          description: data?.message ?? 'Printer error — showing preview instead.',
          variant: 'destructive',
        });
        if (order) showKOTPreview(order, data?.kotNumber);
        return;
      }
      const { handlePrintResponse } = await import('@/lib/printGateway');
      const outcome = await handlePrintResponse(data, {
        orderId,
        ackType: 'kot',
        pendingAck: data.pendingAck,
        onBrowserKOT: () => {
          if (!order) {
            printKOT(
              { orderNumber: data.orderNumber, tableNumber: data.tableNumber, createdAt: new Date() },
              data.items ?? [],
            );
          }
        },
      });
      if (outcome === 'skipped') {
        // silent: called as triggerBillPrint's quiet pre-bill catch-up check — a
        // no-op here just means "nothing new," which should feel like plain bill
        // printing, not surface irrelevant KOT chatter. A genuine manual KOT click
        // (silent=false) still tells the user so.
        if (!silent) toast({ title: 'Nothing new to print', description: 'No new items added since last KOT' });
      } else if (outcome === 'hardware') {
        // data.message carries a partial-failure note when one routed printer failed
        // but at least one other printer (direct or dispatched) still got the ticket —
        // "printed: true" is accurate for the ones that succeeded, but staff still need
        // to know a specific printer needs attention, not silence.
        toast(data.message
          ? { title: 'KOT sent to printer!', description: data.message, variant: 'destructive' }
          : { title: 'KOT sent to printer!' });
      } else if (outcome === 'browser') {
        toast({
          title: data.reason === 'non_escpos_printer' ? 'Use KOT preview to print' : 'KOT ready',
          description:
            data.message ??
            (data.reason === 'non_escpos_printer'
              ? 'Office printers cannot print thermal tickets. Use Print in the preview window or add a thermal printer.'
              : 'Use Print in the preview panel.'),
        });
        if (order) showKOTPreview(order, data?.kotNumber);
      } else if (outcome === 'dispatched') {
        toast({ title: 'Sent to kitchen printer!' });
      } else if (outcome === 'noop' && data.printJob) {
        toast({
          title: 'Print job ready',
          description: 'Use the Electron app for thermal printing.',
          variant: 'destructive',
        });
        if (order) showKOTPreview(order, data?.kotNumber);
      }
    } catch {
      if (order) showKOTPreview(order);
    }
  };

  const triggerBillPrint = async (orderId: number, order?: any, skipKOT = false) => {
    // Kitchen-first, always: every bill print first runs the same KOT delta-check
    // the KOT button uses, silently (silent=true) — no longer a toggleable setting,
    // so it can't be switched off. If there's nothing new, this no-ops with no
    // toast, so an already-KOT'd order's bill click feels like "just the bill." If
    // there IS something new (a never-KOT'd order clicked straight to Bill, or an
    // item added after the last KOT that staff forgot to re-send), it's sent to the
    // kitchen first — with its own normal toast, since that's genuinely useful
    // information — before the bill prints. This is the safety net: nothing added
    // to the order can silently miss the kitchen's notice just because Bill was
    // clicked instead of KOT.
    if (!skipKOT) {
      await triggerKOTPrint(orderId, order, true);
    }
    try {
      const res = await fetch(apiUrl('/api/print/bill'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        if (order) showBillPreview(order);
        return;
      }
      const { handlePrintResponse } = await import('@/lib/printGateway');
      const outcome = await handlePrintResponse(data, {
        orderId,
        ackType: 'bill',
        pendingAck: data.pendingAck,
        onBrowserBill: async () => {
          // apiJson() checks res.ok before parsing — a hand-rolled fetch(...).then(r =>
          // r.json()) here used to let a non-2xx response's error body flow straight into
          // printOrderBill as if it were real order/settings data instead of throwing
          // (which triggerBillPrint's outer catch already handles via showBillPreview).
          const [freshOrder, freshSettings] = await Promise.all([
            apiJson<any>(`/api/orders/${orderId}`),
            apiJson<any>('/api/settings'),
          ]);
          const printed = await printOrderBill(freshOrder, freshOrder.items || [], freshSettings);
          // Popup + iframe both blocked (rare) — show the in-page preview so the user isn't stuck.
          if (!printed) showBillPreview(freshOrder ?? order);
          // (no trailing KOT call here — the silent delta-check already ran BEFORE
          // the bill fetch above, see triggerBillPrint's own comment)
        },
      });
      if (outcome === 'hardware' || outcome === 'browser' || outcome === 'dispatched') {
        toast({ title: 'Bill sent to printer!' });
      } else if (outcome === 'noop' && data.printJob) {
        toast({
          title: 'Print job ready',
          description: 'Use the Electron app for thermal printing.',
          variant: 'destructive',
        });
        if (order) showBillPreview(order);
      }
    } catch {
      if (order) showBillPreview(order);
    }
  };

  const form = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      orderType: posMode === "delivery" ? "delivery" : posMode === "pickup" ? "takeaway" : sectionId ? "takeaway" : "dine-in",
      paymentMethod: "cash",
    },
  });

  const { data: categories } = useQuery<any[]>({ queryKey: ["/api/categories"] });
  const { data: menuItems } = useQuery<any[]>({ queryKey: ["/api/menu"] });
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });

  const activeSection = sectionId
    ? (settings?.posSections ?? []).find((s: any) => s.id === sectionId)
    : null;
  const sectionCategoryIds: number[] = activeSection?.categoryIds ?? [];
  const visibleCategories = isSectionMode
    ? (categories ?? []).filter((c: any) => sectionCategoryIds.includes(c.id))
    : categories;

  // Customer lookup — fetch past orders to build a unique name+phone list
  const { data: pastOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/orders"],
    staleTime: 60_000,
  });
  const uniqueCustomers = useMemo(() => {
    const seen = new Set<string>();
    const list: { name: string; phone: string }[] = [];
    for (let i = pastOrders.length - 1; i >= 0; i--) {
      const o = pastOrders[i];
      if (!o.customerName) continue;
      const key = o.customerPhone || o.customerName;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ name: o.customerName, phone: o.customerPhone || "" });
    }
    return list;
  }, [pastOrders]);
  const taxRate = (settings?.taxRate ?? 18) / 100;

  // Fetch existing order when in edit mode (uses activeOrderId so it updates after KOT creates order)
  const { data: existingOrder } = useQuery<any>({
    queryKey: ["/api/orders", String(activeOrderId)],
    enabled: !!activeOrderId,
    staleTime: 0,
  });

  // Load existing order items into cart (only once)
  useEffect(() => {
    if (!activeOrderId || !existingOrder || !menuItems || cartLoaded) return;
    const loadedItems: CartItem[] = (existingOrder.items || []).map((item: any) => {
      const menuItem = menuItems.find((m: any) => m.id === item.menuItemId);
      // Open items (negative menuItemId) and deleted menu items fall back to the name stored on the row
      const name = menuItem?.name || item.name || "Unknown Item";
      const price = parseFloat(item.price);
      const sm = (item.serviceMode as ItemServiceMode) || "dinein";
      return {
        cartKey: `db-${item.id}-${item.menuItemId}-${sm}`,
        id: item.menuItemId,
        name,
        basePrice: price,
        addons: [],
        variants: {},
        notes: item.specialInstructions || "",
        totalPrice: price,
        size: item.size || undefined,
        quantity: item.quantity,
        serviceMode: sm,
        parcelLeftover: !!item.parcelLeftover,
      };
    });
    setCartItems(loadedItems);
    setDiscountPercent(0);
    // Restore the order's already-saved manual container charge — unlike discount
    // above, this must NOT reset to 0, or reopening a running order and saving again
    // without touching this field would silently wipe out a charge already applied.
    setContainerCharge(Number(existingOrder.containerCharge) || 0);
    // Section counter: point the add-mode toggle at the mode of the last saved item
    // (staff usually keep adding more of the same kind); items keep their own modes.
    if (isSectionMode && loadedItems.length > 0) {
      const last = loadedItems[loadedItems.length - 1].serviceMode;
      setActiveItemMode(last === "pickup" || last === "delivery" ? "pickup" : "dinein");
    }
    // Pre-fill customer details — always sync with DB value
    form.setValue("customerName", existingOrder.customerName || "");
    form.setValue("customerPhone", existingOrder.customerPhone || "");
    if (!posMode && existingOrder.orderType) {
      const ft = existingOrder.orderType === "delivery" ? "delivery"
        : existingOrder.orderType === "takeaway" ? "takeaway"
        : "dine-in";
      form.setValue("orderType", ft as any);
    }
    setCartLoaded(true);
  }, [existingOrder, menuItems, activeOrderId, cartLoaded]);

  // Disable auto-KOT readiness when cart resets, re-enable 300ms after load completes
  // so the initial population of the cart from DB doesn't trigger a spurious print.
  useEffect(() => {
    if (!cartLoaded) { autoKotReadyRef.current = false; return; }
    const t = setTimeout(() => { autoKotReadyRef.current = true; }, 300);
    return () => clearTimeout(t);
  }, [cartLoaded]);

  // Auto-KOT: debounced trigger when the user adds/modifies items in an existing order.
  // Calls the same /api/print/kot endpoint as manual KOT — the backend's delta logic
  // ensures only new/changed items are printed and prevents duplicate prints.
  useEffect(() => {
    if (!autoKotReadyRef.current || !activeOrderId || cartItems.length === 0) return;
    const kotSettings = (settings as any)?.printSettings?.kot;
    if (!kotSettings?.autoKOTPrint) return;

    if (autoKotTimerRef.current) clearTimeout(autoKotTimerRef.current);
    const delay: number = kotSettings.autoKOTDebounceMs ?? 1500;

    autoKotTimerRef.current = setTimeout(async () => {
      if (busyRef.current) return; // a manual submit/print is already in flight — don't race it
      try {
        // /api/print/kot computes its delta strictly from persisted order_items — it has
        // no knowledge of this tab's in-memory cart. Without syncing first, this timer
        // fired against whatever was last saved (e.g. the previous manual KOT/Save), so
        // anything typed since then was silently never sent to the kitchen: the server
        // saw no delta, returned reason:"no_delta", and this effect (like manual KOT)
        // treats that as a quiet no-op — the user believed Auto-KOT had it covered.
        const syncRes = await fetch(apiUrl(`/api/orders/${activeOrderId}/items`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: activeOrderId,
            items: buildItemsPayload(cartItems),
            discountAmount: discountAmt.toFixed(2),
            // Must be re-sent on every sync, same as discountAmount — the server only
            // preserves what's explicitly re-sent, so omitting this would silently
            // reset an already-entered manual container charge back to 0.
            containerCharge: containerCharge.toFixed(2),
          }),
          credentials: 'include',
        });
        if (!syncRes.ok) return;

        const res = await fetch(apiUrl('/api/print/kot'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: activeOrderId, auto: true }),
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) return;
        const { handlePrintResponse } = await import('@/lib/printGateway');
        const outcome = await handlePrintResponse(data, {
          orderId: activeOrderId,
          ackType: 'kot',
          pendingAck: data.pendingAck,
        });
        if (outcome === 'hardware') {
          toast({ title: 'KOT sent!', description: 'Kitchen notified automatically' });
        }
      } catch {
        // Network failure — silently ignore; user can always use manual KOT
      }
    }, delay);

    return () => {
      if (autoKotTimerRef.current) clearTimeout(autoKotTimerRef.current);
    };
  }, [cartItems, activeOrderId]); // settings intentionally omitted — read via closure at fire time

  // Cancel a pending Auto-KOT timer before any manual submit/print action — otherwise
  // a background auto-KOT fetch armed by a recent edit can race the manual action's
  // own print request. Every manual path already re-syncs the full cart itself, a
  // strict superset of what the debounced timer would have sent.
  const cancelPendingAutoKot = () => {
    if (autoKotTimerRef.current) {
      clearTimeout(autoKotTimerRef.current);
      autoKotTimerRef.current = null;
    }
  };

  // ── Create order mutation ────────────────────────────────────────────────────

  const createOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/orders", data);
      return res.json();
    },
    onSuccess: (order: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kot/running"] });

      const mode = submitModeRef.current;
      if (mode === "kot") {
        toast({ title: "KOT sent!", description: "Order created and sent to kitchen" });
        setActiveOrderId(order.id);
        setCartLoaded(false); // allow reload of cart from new order
      } else if (mode === "kot-print") {
        toast({ title: "KOT sent!" });
        setActiveOrderId(order.id);
        setCartLoaded(false);
        triggerKOTPrint(order.id, order).finally(() => setIsPrinting(false));
      } else if (mode === "save") {
        toast({ title: "Order saved!" });
        setCartItems([]); setDiscountPercent(0); setContainerCharge(0);
        navigate("/tables");
      } else if (mode === "save-print") {
        toast({ title: "Order saved!" });
        triggerBillPrint(order.id, order).finally(() => setIsPrinting(false));
        if (isSectionMode) {
          // Stay on screen so Settle can follow the same print (print now, settle after).
          setActiveOrderId(order.id);
          setCartLoaded(false);
        } else {
          setCartItems([]); setDiscountPercent(0); setContainerCharge(0);
          navigate("/tables");
        }
      } else if (mode === "save-ebill") {
        toast({ title: "Order saved!", description: "WhatsApp bill sent" });
        setCartItems([]); setDiscountPercent(0); setContainerCharge(0);
        navigate("/tables");
      } else if (mode === "bill-print") {
        // First-ever submit for this cart — Bill created the order itself (same as
        // kot-print above). Stay on screen, mirroring updateOrderMutation's existing
        // "bill-print" branch: plain Bill is a mid-service action, not "finish and leave".
        setActiveOrderId(order.id);
        setCartLoaded(false);
        triggerBillPrint(order.id, order).finally(() => setIsPrinting(false));
        apiRequest("POST", `/api/orders/${order.id}/bill-requested`, {})
          .then(() => queryClient.invalidateQueries({ queryKey: ["/api/tables"] }))
          .catch(() => {
            // non-critical — bill is printed even if status update fails
          });
      } else if (mode === "settle") {
        const sd = settlementDataRef.current;
        settleMutation.mutate(sd
          ? { orderId: order.id, order, ...sd }
          : { orderId: order.id, order, paymentMethod: paymentMethodRef.current, notes: paymentMethodRef.current === "other" ? otherReasonRef.current : undefined }
        );
      }
    },
    onError: (error: any) => {
      toast({ title: "Failed to place order", description: error.message || "Something went wrong", variant: "destructive" });
      setSettlePhase("idle"); // a failed settle-create must not leave the buttons frozen at "…"
      setIsPrinting(false); // a failed create must not leave KOT/Bill buttons frozen either
    },
  });

  // ── Update order mutation (edit mode) ────────────────────────────────────────

  const updateOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", `/api/orders/${data.orderId}/items`, data);
      return res.json();
    },
    onSuccess: (order: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", String(vars.orderId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kot/running"] });
      const mode = submitModeRef.current;
      if (mode === "kot") {
        toast({ title: "KOT sent!", description: "Kitchen notified with updated items" });
      } else if (mode === "kot-print") {
        toast({ title: "KOT sent!" });
        triggerKOTPrint(vars.orderId, order).finally(() => setIsPrinting(false));
      } else if (mode === "save") {
        toast({ title: "Order updated!" });
        setCartItems([]); setDiscountPercent(0); setContainerCharge(0);
        navigate("/tables");
      } else if (mode === "save-print") {
        toast({ title: "Order updated!" });
        triggerBillPrint(vars.orderId, order).finally(() => setIsPrinting(false));
        if (!isSectionMode) {
          setCartItems([]); setDiscountPercent(0); setContainerCharge(0);
          navigate("/tables");
        }
      } else if (mode === "save-ebill") {
        toast({ title: "Order updated!", description: "WhatsApp bill sent" });
        setCartItems([]); setDiscountPercent(0); setContainerCharge(0);
        navigate("/tables");
      } else if (mode === "bill-print") {
        // Stays on screen (unlike save-print) — plain Bill is a mid-service
        // reprint/preview, not a "finish and leave" action.
        triggerBillPrint(vars.orderId, order).finally(() => setIsPrinting(false));
        apiRequest("POST", `/api/orders/${vars.orderId}/bill-requested`, {})
          .then(() => queryClient.invalidateQueries({ queryKey: ["/api/tables"] }))
          .catch(() => {
            // non-critical — bill is printed even if status update fails
          });
      } else if (mode === "settle") {
        const sd = settlementDataRef.current;
        settleMutation.mutate(sd
          ? { orderId: vars.orderId, order, ...sd }
          : { orderId: vars.orderId, order, paymentMethod: paymentMethodRef.current, notes: paymentMethodRef.current === "other" ? otherReasonRef.current : undefined }
        );
      }
    },
    onError: (error: any) => {
      toast({ title: "Failed to update order", description: error.message || "Something went wrong", variant: "destructive" });
      setSettlePhase("idle"); // a failed settle-update must not leave the buttons frozen at "…"
      setIsPrinting(false); // a failed update must not leave KOT/Bill buttons frozen either
    },
  });

  // ── Settle / payment mutation ─────────────────────────────────────────────

  const settleMutation = useMutation({
    mutationFn: async ({ orderId, paymentMethod, notes, payments, totalPaid, changeAmount, isDue, customerName, customerPhone }: {
      orderId: number;
      order?: any;
      paymentMethod?: string;
      notes?: string;
      payments?: { method: string; amount: number }[];
      totalPaid?: number;
      changeAmount?: number;
      isDue?: boolean;
      customerName?: string;
      customerPhone?: string;
    }) => {
      const body = payments
        ? { payments, totalPaid, changeAmount, isDue, customerName, customerPhone }
        : { paymentMethod: paymentMethod || "cash", notes };
      const res = await apiRequest("POST", `/api/orders/${orderId}/payment`, body);
      return res.json();
    },
    onSuccess: (settled: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
      setSettlePhase("idle");
      toast({ title: "Payment complete!" });
      navigate("/tables");
    },
    onError: (error: any) => {
      setSettlePhase("idle");
      // apiRequest() throws `${status}: ${rawBodyText}` — for our JSON error
      // responses that body is `{"error": "..."}`; pull the message back out so
      // an already-settled order shows its actual cause, not a raw status dump.
      let description = error.message || "Something went wrong";
      const jsonStart = description.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(description.slice(jsonStart));
          if (parsed?.error) description = parsed.error;
        } catch {
          /* leave the raw message as-is */
        }
      }
      toast({ title: "Settlement failed", description, variant: "destructive" });
    },
  });

  // ── Unified modifier modal helpers ──────────────────────────────────────────

  const openPicker = (item: any) => {
    setModal({ item, cartKey: null, isEdit: false, size: null, addons: [], variants: {}, notes: "", qty: 1, qtyRaw: "1" });
  };

  const openEditPicker = (cartItem: CartItem) => {
    const menuItem = menuItems?.find((m: any) => m.id === cartItem.id);
    if (!menuItem) return;
    let size: SizeOption | null = null;
    if (cartItem.size && menuItem.sizes) {
      const matched = menuItem.sizes.find((s: any) => s.size === cartItem.size);
      if (matched) size = { size: matched.size, price: Number(matched.price) };
    }
    setModal({
      item: menuItem,
      isEdit: true,
      cartKey: cartItem.cartKey,
      size,
      addons: [...cartItem.addons],
      variants: { ...cartItem.variants },
      notes: cartItem.notes || "",
      qty: cartItem.quantity,
      qtyRaw: String(cartItem.quantity),
    });
  };

  const confirmModal = () => {
    if (!modal) return;
    const { item, isEdit, cartKey, size, addons, variants, notes, qty } = modal;
    const hasSizes = Array.isArray(item.sizes) && item.sizes.length > 0;
    if (hasSizes && !size) return;

    const variantGroups: VariantGroup[] = Array.isArray(item.variants) ? item.variants : [];
    const missingRequired = variantGroups.find(g => g.required && !variants[g.group]);
    if (missingRequired) {
      toast({ title: `Please select ${missingRequired.group}`, variant: "destructive" });
      return;
    }

    const basePrice = hasSizes ? Number(size!.price) : parseFloat(item.price || "0");
    const addonTotal = addons.reduce((s, a) => s + Number(a.price), 0);
    const variantTotal = variantGroups.reduce((s, g) => {
      const chosen = variants[g.group];
      const opt = g.options.find(o => o.name === chosen);
      return s + Number(opt?.price || 0);
    }, 0);
    const totalPrice = basePrice + addonTotal + variantTotal;
    const sizePart = size?.size || "";
    const addonPart = [...addons].map(a => a.name).sort().join(",");
    const variantPart = Object.values(variants).join("-");
    // Include activeItemMode in mergeKey so same item in different modes stays separate
    const mergeKey = `${item.id}-${sizePart}-${addonPart}-${variantPart}-${activeItemMode}`;
    const uniqueKey = notes ? `${mergeKey}-${Date.now()}` : mergeKey;

    if (isEdit) {
      // Preserve existing serviceMode when editing — don't change it
      setCartItems(prev => prev.map(c => c.cartKey === cartKey
        ? { ...c, basePrice, addons, variants, notes, totalPrice, size: sizePart || undefined, quantity: qty }
        : c
      ));
    } else {
      setCartItems(prev => {
        const existing = !notes ? prev.find(c => c.cartKey === mergeKey) : null;
        if (existing) return prev.map(c => c.cartKey === mergeKey ? { ...c, quantity: c.quantity + qty } : c);
        return [...prev, { cartKey: uniqueKey, id: item.id, name: item.name, basePrice, addons, variants, notes, totalPrice, quantity: qty, size: sizePart || undefined, serviceMode: activeItemMode }];
      });
    }
    setModal(null);
  };

  // ── Cart helpers ─────────────────────────────────────────────────────────────

  const directAddItem = (item: any) => {
    const basePrice = parseFloat(item.price || "0");
    const cartKey = `${item.id}-${activeItemMode}`;
    setCartItems(prev => {
      const existing = prev.find(c => c.cartKey === cartKey);
      if (existing) return prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { cartKey, id: item.id, name: item.name, basePrice, addons: [], variants: {}, notes: "", totalPrice: basePrice, quantity: 1, serviceMode: activeItemMode }];
    });
  };

  const removeFromCart = (cartKey: string) => setCartItems(prev => prev.filter(c => c.cartKey !== cartKey));

  // Quick +1/-1 quantity stepper (menu tiles + cart rows). Reuses the exact same
  // "editItem" gate the Edit-Item modal's own qty input already sits behind, and
  // "removeItem" when a decrement would empty the line — no new permission surface,
  // just a faster path to what Edit Item and Remove already allow. See the removed
  // inline stepper note elsewhere in this file for why quantity must never bypass
  // go()/isOff() again.
  const bumpCartQty = (cartKey: string, delta: number) => {
    const current = cartItems.find(c => c.cartKey === cartKey);
    if (!current) return;
    if (delta < 0 && current.quantity + delta <= 0) {
      go("removeItem", "Remove Item", () => removeFromCart(cartKey));
      return;
    }
    go("editItem", "Edit Item", () => {
      setCartItems(prev => prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + delta } : c));
    });
  };

  // Open item: off-menu line typed by staff. Always its own cart line (never merged),
  // under a fresh negative id so the server's menuItemId-keyed KOT delta stays correct.
  const openItemValid = openItemName.trim().length > 0 && parseFloat(openItemPrice) > 0;
  const closeOpenItemDialog = () => {
    setShowOpenItemDialog(false);
    setOpenItemName(""); setOpenItemPrice(""); setOpenItemQty(1); setOpenItemQtyRaw("1");
    setEditingOpenItemCartKey(null);
  };
  const openOpenItemEditor = (item: CartItem) => {
    setEditingOpenItemCartKey(item.cartKey);
    setOpenItemName(item.name);
    setOpenItemPrice(String(item.basePrice));
    setOpenItemQty(item.quantity);
    setOpenItemQtyRaw(String(item.quantity));
    setShowOpenItemDialog(true);
  };
  const addOpenItem = () => {
    if (!openItemValid) return;
    const price = parseFloat(openItemPrice);
    if (editingOpenItemCartKey) {
      setCartItems(prev => prev.map(c => c.cartKey === editingOpenItemCartKey
        ? { ...c, name: openItemName.trim(), basePrice: price, totalPrice: price, quantity: openItemQty }
        : c));
    } else {
      openItemSeqRef.current -= 1;
      const id = openItemSeqRef.current;
      setCartItems(prev => [...prev, {
        cartKey: `open-${id}-${activeItemMode}`,
        id, name: openItemName.trim(), basePrice: price, addons: [], variants: {},
        notes: "", totalPrice: price, quantity: openItemQty, serviceMode: activeItemMode,
      }]);
    }
    closeOpenItemDialog();
  };

  // Section counter: flip ONE cart line between Eating Here (dinein) and Parcel (pickup).
  // cartKeys embed the mode (`${id}-${mode}`, `db-…-${mode}`) — rewrite the key and merge
  // if a line with the target key already exists, so quantities don't split across dupes.
  const flipItemMode = (cartKey: string) => {
    setCartItems(prev => {
      const item = prev.find(c => c.cartKey === cartKey);
      if (!item) return prev;
      const mode: ItemServiceMode = item.serviceMode === "pickup" ? "dinein" : "pickup";
      const newKey = cartKey.replace(/dinein|pickup|delivery/g, mode);
      const rest = prev.filter(c => c.cartKey !== cartKey);
      const existing = rest.find(c => c.cartKey === newKey);
      if (existing) {
        return rest.map(c => c.cartKey === newKey ? { ...c, quantity: c.quantity + item.quantity } : c);
      }
      return prev.map(c => c.cartKey === cartKey ? { ...c, serviceMode: mode, cartKey: newKey } : c);
    });
  };

  // ── Filter ───────────────────────────────────────────────────────────────────

  const filteredItems = menuItems?.filter((item: any) => {
    const matchCat = selectedCategory === "all" || item.categoryId === selectedCategory;
    const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchSection = !isSectionMode || sectionCategoryIds.includes(item.categoryId);
    return matchCat && matchSearch && matchSection;
  });

  // ── Totals ───────────────────────────────────────────────────────────────────

  const subtotal = cartItems.reduce((s, i) => s + i.totalPrice * i.quantity, 0);
  const discountAmt = subtotal * Math.min(discountPercent, 100) / 100;
  const taxable = subtotal - discountAmt;
  const tax = taxable * taxRate;
  const total = taxable + tax;
  const currentOrderType = form.watch("orderType");
  const isDeliveryOrPickup = currentOrderType === "delivery" || currentOrderType === "takeaway";
  const totalItemQty = cartItems.reduce((s, i) => s + i.quantity, 0);
  const isTableSession = !posMode && (!!preselectedTableId || !!activeOrderId || isSectionMode);
  // Container charge is a manually staff-entered flat amount (containerCharge state),
  // not computed from item quantities/serviceMode.
  const grandTotal = total + containerCharge;

  // ── Submit ───────────────────────────────────────────────────────────────────

  // Shared with the Auto-KOT effect below, which must sync the cart through this exact
  // same shape before asking the server to print — see its comment for why.
  const buildItemsPayload = (cartSource: CartItem[]) => {
    const buildInstructions = (c: CartItem) => {
      const parts: string[] = [];
      const variantEntries = Object.entries(c.variants);
      if (variantEntries.length) parts.push(variantEntries.map(([g, v]) => `${g}: ${v}`).join(", "));
      if (c.notes) parts.push(`Note: ${c.notes}`);
      return parts.join(" | ");
    };
    return cartSource.map(c => ({
      menuItemId: c.id,
      quantity: c.quantity,
      price: c.totalPrice.toFixed(2),
      specialInstructions: buildInstructions(c),
      name: c.size ? `${c.name} (${c.size})` : c.name,
      size: c.size || null,
      addons: c.addons,
      // Table/section sessions track serviceMode per item (toggled via the parcel UI).
      // A standalone order has no such per-item toggle — activeItemMode never leaves
      // "dinein" there — so stamp it from the order type instead, or the server's
      // per-item container-charge check (shared/orderPricing.ts) silently sees every
      // line as dine-in and drops the container charge from the persisted total.
      serviceMode: isTableSession
        ? (c.serviceMode ?? "dinein")
        : (isDeliveryOrPickup ? (currentOrderType === "delivery" ? "delivery" : "pickup") : "dinein"),
      parcelLeftover: c.parcelLeftover ?? false,
    }));
  };

  const onSubmit = (data: OrderForm) => {
    if (cartItems.length === 0) {
      toast({ title: "Cart is empty", description: "Add items before placing order", variant: "destructive" });
      setSettlePhase("idle"); // a settle attempt on an unloaded/empty cart must not freeze the buttons
      setIsPrinting(false); // ditto for a KOT/Bill attempt on an unloaded/empty cart
      return;
    }

    const itemsPayload = buildItemsPayload(cartItems);

    if (activeOrderId) {
      updateOrderMutation.mutate({
        orderId: activeOrderId,
        items: itemsPayload,
        discountAmount: discountAmt.toFixed(2),
        containerCharge: containerCharge.toFixed(2),
        customerName: data.customerName || "",
        customerPhone: data.customerPhone || "",
      });
    } else {
      createOrderMutation.mutate({
        ...data,
        totalAmount: grandTotal.toFixed(2),
        taxAmount: tax.toFixed(2),
        discountAmount: discountAmt.toFixed(2),
        containerCharge: containerCharge.toFixed(2),
        ...(preselectedTableId ? { tableId: preselectedTableId, tableNumber: preselectedTableName || String(preselectedTableId) } : {}),
        // Section counter orders carry their section id — separates them from generic pickup
        ...(isSectionMode ? { posSectionId: sectionId } : {}),
        items: itemsPayload,
      });
    }
  };

  const isPending = createOrderMutation.isPending || updateOrderMutation.isPending || settleMutation.isPending || isPrinting;
  const isEditMode = !!activeOrderId;

  // Tell the Electron main process whether a transaction is active so the
  // auto-updater won't restart the app mid-order. Also mirrored into a ref so the
  // Auto-KOT timer callback (which fires from a setTimeout, not a render) can check
  // "is a manual submit/print already in flight" without racing it.
  const busyRef = useRef(false);
  useEffect(() => {
    const active = isPending || settlePhase !== "idle";
    window.electronAPI?.setPosActive(active);
    busyRef.current = active;
  }, [isPending, settlePhase]);

  // ── Submit action handlers ───────────────────────────────────────────────────

  const triggerSubmit = () => {
    if (activeOrderId) { onSubmit(form.getValues()); }
    else { form.handleSubmit(onSubmit)(); }
  };

  const capturePreKOTItems = () => {
    preKOTItemsRef.current = (existingOrder?.items ?? []).map((i: any) => ({
      menuItemId: Number(i.menuItemId),
      quantity: Number(i.quantity),
      size: i.size ?? null,
    }));
  };

  const handleKOT     = () => { cancelPendingAutoKot(); capturePreKOTItems(); submitModeRef.current = "kot-print"; setIsPrinting(true); triggerSubmit(); };
  const handleSettle  = () => { if (hasItems) setShowSettleDialog(true); };
  const handleBillPrint = () => {
    // Sync the current cart first — /api/print/bill reads order_items straight
    // from the DB, so anything added to the cart after the last save/KOT (e.g.
    // an item added right before printing) would otherwise be silently missing
    // from the printed bill. No longer requires activeOrderId — Bill can now
    // create the order itself, same as KOT does, via the generic
    // createOrderMutation/updateOrderMutation routing in triggerSubmit/onSubmit.
    cancelPendingAutoKot();
    capturePreKOTItems();
    submitModeRef.current = "bill-print";
    setIsPrinting(true);
    triggerSubmit();
  };

  // Direct KOT preview — no server call, shows delta of new items not yet in the order
  const handleKOTPreview = () => {
    const prevItems: Array<{ menuItemId: number; quantity: number; size: string | null }> =
      (existingOrder?.items ?? []).map((i: any) => ({
        menuItemId: Number(i.menuItemId),
        quantity: Number(i.quantity),
        size: i.size ?? null,
      }));
    const prevMap = new Map<string, number>();
    for (const s of prevItems) {
      prevMap.set(`${s.menuItemId}:${s.size ?? ''}`, s.quantity);
    }
    const deltaItems = cartItems
      .map(i => {
        const prevQty = prevMap.get(`${i.id}:${i.size ?? ''}`) ?? 0;
        const dQty = i.quantity - prevQty;
        return dQty > 0 ? { name: i.name, quantity: dQty, size: i.size ?? null, notes: i.notes || null, serviceMode: i.serviceMode } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const items = deltaItems.length > 0
      ? deltaItems
      : cartItems.map(i => ({ name: i.name, quantity: i.quantity, size: i.size ?? null, notes: i.notes || null, serviceMode: i.serviceMode }));
    const fv = form.getValues();
    const lines = kotLines({
      orderRef: existingOrder?.orderNumber ?? (activeOrderId ? String(activeOrderId) : 'NEW'),
      tableNumber: existingOrder?.tableNumber ?? fv.tableNumber ?? null,
      items,
    });
    setPrintPreview({ title: 'KOT Preview', lines });
  };

  const handleSave = () => { cancelPendingAutoKot(); submitModeRef.current = "save"; triggerSubmit(); };
  const handleSaveAndPrint = () => { cancelPendingAutoKot(); submitModeRef.current = "save-print"; setIsPrinting(true); triggerSubmit(); };
  const handleSaveEBill = () => {
    const go = () => {
      cancelPendingAutoKot();
      // Build and open WhatsApp URL right here — synchronous with user click, browser never blocks it
      const formData = form.getValues();
      const rawPhone = formData.customerPhone?.replace(/\D/g, "");
      if (!rawPhone) {
        toast({ title: "No phone number", description: "Enter a customer phone number first", variant: "destructive" });
        return;
      }
      const rName = settings?.restaurantName || "Bagicha Restaurant";
      const addr = settings?.address ? `\n${settings.address}` : "";
      const itemLines = cartItems.map(c => `  • ${c.name} × ${c.quantity}  ₹${(c.totalPrice * c.quantity).toFixed(0)}`).join("\n");
      const msgLines = [
        `🧾 *${rName}*${addr}`,
        ``,
        existingOrder?.orderNumber ? `Order: *${existingOrder.orderNumber}*` : null,
        formData.tableNumber ? `Table: ${formData.tableNumber}` : null,
        formData.customerName ? `Name: ${formData.customerName}` : null,
        ``,
        `*ITEMS*`,
        itemLines || "—",
        ``,
        `Subtotal: ₹${subtotal.toFixed(0)}`,
        discountAmt > 0 ? `Discount: -₹${discountAmt.toFixed(0)}` : null,
        `Tax: ₹${tax.toFixed(0)}`,

        containerCharge > 0 ? `Container Charge: ₹${containerCharge.toFixed(0)}` : null,
        `*TOTAL: ₹${grandTotal.toFixed(0)}*`,
        ``,
        settings?.footerNote || "Thank you for dining with us!",
      ].filter(l => l !== null).join("\n");
      const phone = rawPhone.startsWith("91") ? rawPhone : "91" + rawPhone;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msgLines)}`, "_blank");
      submitModeRef.current = "save-ebill";
      triggerSubmit();
    };
    go();
  };


  const handleComplimentary = () => go("complimentary", "Complimentary (100% Discount)", () => setDiscountPercent(100));

  const handleShortCode = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !shortCode.trim()) return;
    const q = shortCode.trim().toLowerCase();
    const found = menuItems?.find(
      (m: any) => m.isAvailable !== false && (
        m.shortCode?.toLowerCase() === q ||
        m.name?.toLowerCase().startsWith(q)
      )
    );
    if (!found) {
      toast({ title: "Item not found", description: `No item matches "${shortCode}"`, variant: "destructive" });
    } else {
      const hasSizes = Array.isArray(found.sizes) && found.sizes.length > 0;
      const hasAddons = found.addonsEnabled && Array.isArray(found.addons) && found.addons.length > 0;
      if (hasSizes || hasAddons) {
        openPicker(found);
      } else {
        directAddItem(found);
        toast({ title: `Added: ${found.name}` });
      }
    }
    setShortCode("");
  };

  // ── UI ───────────────────────────────────────────────────────────────────────

  const tableLabel = preselectedTableName || (preselectedTableId ? `Table ${preselectedTableId}` : null);

  const hasItems = cartItems.length > 0;
  const orderTypeLabel = { "dine-in": "Dine In", takeaway: "Pick Up", delivery: "Delivery" }[form.watch("orderType")] || "Dine In";

  // ── Modal derived values ─────────────────────────────────────────────────────
  const modalHasSizes = modal && Array.isArray(modal.item.sizes) && modal.item.sizes.length > 0;
  const modalBasePrice = modalHasSizes && modal!.size ? Number(modal!.size.price) : parseFloat(modal?.item.price || "0");
  const modalAddonTotal = modal ? modal.addons.reduce((s, a) => s + Number(a.price), 0) : 0;
  const modalVariantGroups: VariantGroup[] = modal ? (Array.isArray(modal.item.variants) ? modal.item.variants : []) : [];
  const modalVariantTotal = modal ? modalVariantGroups.reduce((s, g) => {
    const opt = g.options.find(o => o.name === modal.variants[g.group]);
    return s + Number(opt?.price || 0);
  }, 0) : 0;
  const modalUnitTotal = modalBasePrice + modalAddonTotal + modalVariantTotal;
  const modalSizeBlocked = modalHasSizes && !modal?.size;
  const modalVariantBlocked = modalVariantGroups.some(g => g.required && !modal?.variants[g.group]);

  return (
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden" onClick={() => showActionsMenu && setShowActionsMenu(false)}>

      {/* ── Manager PIN Guard ─────────────────────────────────────────────────── */}
      {pinRequest && (
        <PinGuard
          actionLabel={pinRequest.label}
          requiredRole={pinRequest.requiredRole}
          onSuccess={resolvePinSuccess}
          onCancel={resolvePinCancel}
        />
      )}


      {/* ── Open Item Dialog (off-menu item: staff types name + price; also doubles as
             the editor for an existing open item, which has no menu row to edit against
             via openEditPicker) ────────────────────────────────────────────────────── */}
      <Dialog open={showOpenItemDialog} onOpenChange={(o) => { if (!o) closeOpenItemDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingOpenItemCartKey ? "Edit Open Item" : "Open Item"}</DialogTitle>
            <DialogDescription>
              {editingOpenItemCartKey ? "Update this off-menu item." : "Add an item that's not on the menu."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide">Item Name *</label>
              <Input
                autoFocus
                value={openItemName}
                onChange={(e) => setOpenItemName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addOpenItem()}
                placeholder="e.g. Veg Manchurian"
                className={`mt-1 ${isSectionMode ? "h-12 text-base" : ""}`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide">Price *</label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  value={openItemPrice}
                  onChange={(e) => setOpenItemPrice(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addOpenItem()}
                  placeholder="0"
                  className={`pl-7 ${isSectionMode ? "h-12 text-base" : ""}`}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide">Quantity *</label>
              <div className="flex items-center gap-3 mt-1">
                <button
                  onClick={() => { const next = Math.max(1, openItemQty - 1); setOpenItemQty(next); setOpenItemQtyRaw(String(next)); }}
                  className="w-9 h-9 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                >
                  <Minus className="w-4 h-4 text-gray-700" />
                </button>
                <input
                  type="number"
                  step="any"
                  min="0.5"
                  value={openItemQtyRaw}
                  onChange={(e) => setOpenItemQtyRaw(e.target.value)}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    const safe = !isNaN(v) && v >= 0.5 ? Math.round(v * 100) / 100 : openItemQty;
                    setOpenItemQty(safe); setOpenItemQtyRaw(String(safe));
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="text-lg font-bold text-gray-800 w-16 text-center border border-gray-200 rounded-lg outline-none focus:border-green-400 bg-white py-1"
                />
                <button
                  onClick={() => { const next = openItemQty + 1; setOpenItemQty(next); setOpenItemQtyRaw(String(next)); }}
                  className="w-9 h-9 rounded-full bg-green-600 hover:bg-green-700 text-white flex items-center justify-center transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size={isSectionMode ? "default" : "sm"} onClick={closeOpenItemDialog}>Cancel</Button>
              <Button
                size={isSectionMode ? "default" : "sm"}
                disabled={!openItemValid}
                onClick={addOpenItem}
                className="bg-[var(--green-700)] text-white hover:opacity-90"
              >
                {editingOpenItemCartKey ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Move Table Dialog ────────────────────────────────────────────────── */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move Table</DialogTitle>
            <DialogDescription>Select a free table to move this order to.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto py-1">
            {freeTables.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No free tables available</p>
            )}
            {freeTables.map((t) => (
              <button
                key={t.id}
                onClick={() => handleMoveTable(t)}
                disabled={actionLoading}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border hover:border-primary hover:bg-primary/5 transition-colors text-sm"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{t.section} · {t.capacity} seats</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Merge Table Dialog ───────────────────────────────────────────────── */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Merge Table</DialogTitle>
            <DialogDescription>Select a running table to merge into this order.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto py-1">
            {runningTables.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No other running tables</p>
            )}
            {runningTables.map((t) => (
              <button
                key={t.id}
                onClick={() => handleMergeTable(t)}
                disabled={actionLoading || !t.currentOrderId}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-blue-200 hover:border-primary hover:bg-primary/5 transition-colors text-sm"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.runningTotal ? `₹${t.runningTotal}` : ""} · {t.section}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Split Bill Dialog ────────────────────────────────────────────────── */}
      <Dialog open={showSplitDialog} onOpenChange={setShowSplitDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Split Bill</DialogTitle>
            <DialogDescription>Select items to split into a separate order.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto py-1">
            {(existingOrder?.items || []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No saved items to split</p>
            )}
            {(existingOrder?.items || []).map((item: any) => {
              const menuItem = menuItems?.find((m: any) => m.id === item.menuItemId);
              const name = menuItem?.name || `Item #${item.menuItemId}`;
              const checked = splitSelectedIds.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                    checked ? "border-primary bg-primary/5" : "hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSplitItem(item.id)}
                      className="accent-primary w-4 h-4"
                    />
                    <span className="text-sm font-medium">{name}{item.size ? ` (${item.size})` : ""}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">×{item.quantity} · ₹{parseFloat(item.price) * item.quantity}</span>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowSplitDialog(false)}>Cancel</Button>
            <Button
              disabled={splitSelectedIds.length === 0 || actionLoading}
              onClick={handleSplitBill}
            >
              Split {splitSelectedIds.length > 0 ? `(${splitSelectedIds.length})` : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Hold Order Confirm ───────────────────────────────────────────────── */}
      <Dialog open={showHoldConfirm} onOpenChange={setShowHoldConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hold Order?</DialogTitle>
            <DialogDescription>
              The order will be saved on hold and the table will be freed. You can recall it later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowHoldConfirm(false)}>Cancel</Button>
            <Button onClick={handleHoldOrder} disabled={actionLoading}>Hold Order</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Recall Held Orders Dialog ────────────────────────────────────────── */}
      <Dialog open={showRecallDialog} onOpenChange={setShowRecallDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Recall Held Order</DialogTitle>
            <DialogDescription>Select a held order to resume.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto py-1 pr-1">
            {heldOrders.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No held orders</p>
            )}
            {heldOrders.map((o: any) => {
              const mins = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000);
              const heldFor = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
              const typeColor = o.orderType === "delivery"
                ? "bg-blue-100 text-blue-700"
                : o.orderType === "takeaway"
                ? "bg-orange-100 text-orange-700"
                : "bg-green-100 text-green-700";
              const typeLabel = o.orderType === "delivery" ? "Delivery"
                : o.orderType === "takeaway" ? "Takeaway" : "Dine-in";
              return (
                <button
                  key={o.id}
                  onClick={async () => {
                    setShowRecallDialog(false);
                    await apiRequest("PUT", `/api/orders/${o.id}/recall`, {});
                    queryClient.invalidateQueries({ queryKey: ["/api/orders/hold"] });
                    const modeParam = o.orderType === "delivery" ? "delivery"
                      : o.orderType === "takeaway" ? "pickup" : null;
                    navigate(`/pos?orderId=${o.id}${modeParam ? `&mode=${modeParam}` : ""}`);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl border hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base">{serialNum(o.id)}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColor}`}>{typeLabel}</span>
                        {o.tableNumber && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />Table {o.tableNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {(o.customerName || o.customerPhone) && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {[o.customerName, o.customerPhone].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />{heldFor}
                        </span>
                      </div>
                      {o.notes && (
                        <p className="text-xs text-muted-foreground italic truncate">Note: {o.notes}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-primary text-base">₹{parseFloat(o.totalAmount || 0).toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground">{o.items?.length || 0} items</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Order Confirm ─────────────────────────────────────────────── */}
      <Dialog
        open={showCancelConfirm}
        onOpenChange={(v) => { setShowCancelConfirm(v); if (!v) setCancelReason(""); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Order?</DialogTitle>
            <DialogDescription>
              This will permanently cancel the order and free the table. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">
              Reason for cancellation <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Customer changed their mind, ordered by mistake…"
              rows={3}
              className="text-sm resize-none"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>Keep Order</Button>
            <Button
              variant="destructive"
              onClick={handleCancelOrder}
              disabled={actionLoading || !cancelReason.trim()}
            >
              Cancel Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════════
           TOP BAR — Petpooja style
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 relative z-40"
        style={{
          background: "var(--paper-0)",
          borderBottom: "1px solid var(--line)",
          boxShadow: "0 2px 16px rgba(20,34,27,0.05)",
        }}>
        <div className="flex items-center gap-2 px-3 py-2">

          {/* ── LEFT FIXED: Back, mode badge, role switcher, new order ── */}
          <div className="flex items-center gap-2 shrink-0">

            {/* Back */}
            <button
              onClick={handleBackToTables}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors font-medium"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tables</span>
            </button>

            {/* Active mode badge — dynamically reflects current orderType */}
            {(() => {
              if (isSectionMode) return (
                <div className="flex items-center gap-1.5 bg-amber-500 text-white px-2.5 py-1 rounded text-xs font-bold max-w-[160px] sm:max-w-none overflow-hidden">
                  🍲
                  {isEditMode && existingOrder?.createdAt && (
                    <POSTimer startedAt={existingOrder.createdAt} />
                  )}
                  <span className="truncate">{sectionName ?? activeSection?.name ?? "Section"}</span>
                </div>
              );
              const ot = form.watch("orderType");
              if (ot === "delivery") return (
                <div className="flex items-center gap-1.5 bg-blue-600 text-white px-2.5 py-1 rounded text-xs font-bold">
                  🛵 <span>Delivery</span>
                </div>
              );
              if (ot === "takeaway") return (
                <div className="flex items-center gap-1.5 bg-orange-500 text-white px-2.5 py-1 rounded text-xs font-bold">
                  📦 <span>Pickup</span>
                </div>
              );
              return (
                <div className="flex items-center gap-1.5 bg-green-600 text-white px-2.5 py-1 rounded text-xs font-bold max-w-[160px] sm:max-w-none overflow-hidden">
                  🍽️
                  {isEditMode && existingOrder?.createdAt && (
                    <POSTimer startedAt={existingOrder.createdAt} />
                  )}
                  <span className="truncate">{tableLabel ?? "Dine In"}</span>
                  {isEditMode && existingOrder?.id && (
                    <span className="opacity-75 hidden md:inline">{serialNum(existingOrder.id)}</span>
                  )}
                </div>
              );
            })()}

            {/* Section counter: no role switcher / new-order — staff just order, print, settle.
                (+ New Order here would silently keep editing the previous order once activeOrderId is set.) */}
            {!isSectionMode && <>
            <div className="w-px h-5 bg-gray-200 mx-1 hidden sm:block" />

            {/* Role Switcher — outside overflow container so dropdown isn't clipped */}
            <RoleSwitcher
              activeRole={activeRole}
              loginRole={loginRole}
              secondsLeft={secondsLeft}
              isElevated={isElevated}
              onElevate={elevateRole}
              onRevert={revertRole}
            />

            <div className="w-px h-5 bg-gray-200 hidden md:block" />

            {/* New Order — hidden on mobile */}
            <button
              disabled={isOff("clearCart")}
              onClick={() => go("clearCart", "New Order (Clear Cart)", () => { setCartItems([]); setDiscountPercent(0); setContainerCharge(0); })}
              className="hidden md:flex text-xs font-semibold text-green-600 border border-green-600 px-2.5 py-1.5 rounded hover:bg-green-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed items-center gap-1"
            >
              + New Order
              {isOff("clearCart") && <Lock className="w-3 h-3 opacity-60" />}
            </button>
            </>}
          </div>

          {/* ── MIDDLE SCROLLABLE: search + short code (hidden at section counters — tiny menu, big tiles) ── */}
          {isSectionMode ? (
            <div className="flex-1 min-w-0 flex items-center justify-end">
              <SectionOpenOrdersButton
                sectionId={sectionId!}
                sectionName={sectionName ?? activeSection?.name ?? "Section"}
                currentOrderId={activeOrderId}
              />
            </div>
          ) :
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide min-w-0 flex-1">
            {/* Search */}
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 min-w-[140px] max-w-[200px] flex-1">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                placeholder="Search item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-xs outline-none w-full placeholder-gray-400 min-w-0"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="shrink-0">
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>

            {/* Short Code — hidden on mobile */}
            <div className="hidden md:flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 w-[130px] shrink-0">
              <input
                placeholder="Short code + ↵"
                value={shortCode}
                onChange={(e) => setShortCode(e.target.value)}
                onKeyDown={handleShortCode}
                className="bg-transparent text-xs outline-none w-full placeholder-gray-400"
              />
            </div>
          </div>}

          {/* ── RIGHT FIXED: order types, customer, phone, actions — hidden on mobile.
               Section counters skip the whole cluster (walk-up customers, one global Parcel toggle). ── */}
          {!isSectionMode && <div className="hidden md:flex items-center gap-2 shrink-0">

            {/* Order type tabs OR item-mode selector strip */}
            {(() => {
              const isTableSession = !posMode && (!!preselectedTableId || isEditMode || isSectionMode);
              if (isTableSession) {
                // "Adding as:" strip — tab clicks change item mode, not order type
                const modes: [ItemServiceMode, React.ComponentType<{ className?: string }>, string][] = [
                  ["dinein",   DineInIcon,   "Dine-In" ],
                  ["pickup",   TakeawayIcon, "Pickup"  ],
                  ["delivery", DeliveryIcon, "Delivery"],
                ];
                return (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wide mr-1 whitespace-nowrap" style={{ color: "var(--text-3)" }}>Adding as</span>
                    <div className="flex items-center gap-0.5 rounded-md p-[3px]" style={{ background: "var(--paper-100)", border: "1px solid var(--line)" }}>
                      {modes.map(([mode, Icon, label]) => {
                        const active = activeItemMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => setActiveItemMode(mode)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold transition-all duration-150"
                            style={active
                              ? { background: "var(--green-800)", color: "#fff", boxShadow: "var(--shadow-sm)" }
                              : { color: "var(--text-2)" }}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              // Normal order type tabs (standalone pickup/delivery or new dine-in without table)
              const orderTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
                "dine-in": DineInIcon, takeaway: TakeawayIcon, delivery: DeliveryIcon,
              };
              return (
                <div className="flex items-center gap-0.5 rounded-md p-[3px]" style={{ background: "var(--paper-100)", border: "1px solid var(--line)" }}>
                  {([["dine-in","Dine In"],["delivery","Delivery"],["takeaway","Pick Up"]] as const)
                    .filter(([val]) =>
                      posMode === "delivery" ? val === "delivery" :
                      posMode === "pickup"   ? val === "takeaway" :
                      true
                    )
                    .map(([val, label]) => {
                    const active = form.watch("orderType") === val;
                    const Icon = orderTypeIcons[val];
                    return (
                      <button
                        key={val}
                        onClick={() => { if (!posMode) form.setValue("orderType", val); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-all duration-150 ${posMode ? "cursor-default" : ""}`}
                        style={active
                          ? { background: "var(--green-800)", color: "#fff", boxShadow: "var(--shadow-sm)" }
                          : { color: posMode ? "var(--text-3)" : "var(--text-2)" }}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Customer name — autocomplete, outside overflow so dropdown renders */}
            {(() => {
              const nameValue = form.watch("customerName") || "";
              const filtered = nameValue.trim()
                ? uniqueCustomers.filter(c =>
                    c.name.toLowerCase().includes(nameValue.toLowerCase())
                  )
                : uniqueCustomers.slice(0, 8);
              return (
                <div className="relative">
                  <input
                    id="customer-name-desktop"
                    name="customerName"
                    autoComplete="off"
                    placeholder="Customer name"
                    value={nameValue}
                    onChange={(e) => {
                      form.setValue("customerName", e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                    className="text-xs border border-gray-200 rounded px-2.5 py-1.5 w-32 bg-gray-50 outline-none focus:border-green-400 placeholder-gray-400"
                  />
                  {showCustomerDropdown && filtered.length > 0 && (
                    <div className="absolute top-full left-0 mt-1 z-50 w-56 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                      {filtered.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            form.setValue("customerName", c.name);
                            form.setValue("customerPhone", c.phone);
                            setShowCustomerDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-gray-50 last:border-0 transition-colors"
                        >
                          <div className="text-xs font-semibold text-gray-800">{c.name}</div>
                          {c.phone && (
                            <div className="text-[10px] text-gray-400 mt-0.5">{c.phone}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Customer phone — controlled (not form.register) to avoid duplicate-name conflict with mobile input */}
            <input
              placeholder="Phone number"
              autoFocus={!!posMode}
              value={form.watch("customerPhone") || ""}
              onChange={(e) => form.setValue("customerPhone", e.target.value)}
              className="text-xs border border-gray-200 rounded px-2.5 py-1.5 w-28 bg-gray-50 outline-none focus:border-green-400 placeholder-gray-400"
            />

            {/* Table Actions — outside overflow so dropdown renders above content. Not shown
                for quick-POS sections (no table workflow — just order, print, settle). */}
            {!posMode && !isSectionMode && <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowActionsMenu((v) => !v)}
                className="flex items-center gap-1 text-xs text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded hover:bg-gray-50 transition-colors font-medium"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Actions
                <ChevronDown className="w-3 h-3" />
              </button>
              {showActionsMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                  {[
                    { label: "Move Table",   action: () => openAction(() => go("moveTable",   "Move Table",    () => setShowMoveDialog(true))),                              icon: "→", permKey: "moveTable"   as const },
                    { label: "Merge Table",  action: () => openAction(() => go("mergeTable",  "Merge Tables",  () => setShowMergeDialog(true))),                             icon: "⊕", permKey: "mergeTable"  as const },
                    { label: "Split Bill",   action: () => openAction(() => go("splitBill",   "Split Bill",    () => { setSplitSelectedIds([]); setShowSplitDialog(true); })), icon: "⊘", permKey: "splitBill"   as const },
                    { label: "Recall Held",  action: () => openAction(() => { refetchHeld(); setShowRecallDialog(true); }),                                                   icon: "↩", permKey: null },
                    { label: "Cancel Order", action: () => openAction(() => go("cancelOrder", "Cancel Order",  () => setShowCancelConfirm(true))),                            icon: "✕", permKey: "cancelOrder" as const, danger: true },
                  ].map((item) => {
                    const allowed = item.permKey === null ? true : !isOff(item.permKey);
                    return (
                      <button
                        key={item.label}
                        disabled={!allowed}
                        onClick={allowed ? item.action : undefined}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed ${
                          item.danger ? "text-green-500 hover:bg-green-50 disabled:hover:bg-white" : "text-gray-700 hover:bg-gray-50 disabled:hover:bg-white"
                        }`}
                      >
                        <span className="w-4 text-center text-base leading-none">{item.icon}</span>
                        {item.label}
                        {!allowed && <Lock className="w-3 h-3 ml-auto opacity-40" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>}
          </div>}
        </div>
      </div>

      {/* Section counter: big Eating Here/Parcel toggle — sets the mode NEW items are
          added as (per-item, same backend logic as tables; orders can mix both) */}
      {isSectionMode && (
        <SectionParcelToggle
          parcel={activeItemMode === "pickup"}
          onChange={(parcel) => setActiveItemMode(parcel ? "pickup" : "dinein")}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
           MODIFIER MODAL — Petpooja style
      ════════════════════════════════════════════════════════════════════════ */}
      {modal && (
        <Dialog open={true} onOpenChange={() => setModal(null)}>
          <DialogContent className="max-w-md p-0 gap-0 overflow-hidden rounded-2xl">

            {/* Header */}
            <div className="bg-white border-b border-gray-100 px-5 py-4">
              <DialogTitle className="text-gray-900 font-bold text-lg leading-tight">
                {modal.item.name}
              </DialogTitle>
              <DialogDescription className="text-gray-500 text-sm mt-0.5">
                Base price: {fmt(parseFloat(modal.item.price || "0"))}
                {modal.isEdit && " · Editing cart item"}
              </DialogDescription>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto max-h-[55vh] px-5 py-4 space-y-6 bg-white">

              {/* ── Sizes ── */}
              {Array.isArray(modal.item.sizes) && modal.item.sizes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-gray-800">Size</p>
                    <span className="text-[10px] bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full uppercase">Required</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {modal.item.sizes.map((s: SizeOption) => {
                      const chosen = modal.size?.size === s.size;
                      return (
                        <button
                          key={s.size}
                          onClick={() => setModal(m => m ? { ...m, size: { size: s.size, price: Number(s.price) } } : m)}
                          className={`py-2.5 px-2 rounded-xl border-2 text-center transition-all ${
                            chosen
                              ? "border-[var(--green-700)] bg-[var(--success-bg)]"
                              : "border-gray-200 hover:border-green-300 bg-white"
                          }`}
                        >
                          <div className={`text-xs font-bold ${chosen ? "text-[var(--green-700)]" : "text-gray-700"}`}>{s.size}</div>
                          <div className={`text-xs font-semibold mt-0.5 ${chosen ? "text-[var(--green-700)]" : "text-gray-500"}`}>{fmt(Number(s.price))}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Addons ── */}
              {modal.item.addonsEnabled && Array.isArray(modal.item.addons) && modal.item.addons.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-gray-800">Add-ons</p>
                    <span className="text-[10px] text-gray-400 font-medium">Optional · Multiple allowed</span>
                  </div>
                  <div className="space-y-2">
                    {modal.item.addons.map((a: AddonOption) => {
                      const checked = modal.addons.some(x => x.name === a.name);
                      return (
                        <button
                          key={a.name}
                          onClick={() => setModal(m => {
                            if (!m) return m;
                            const has = m.addons.some(x => x.name === a.name);
                            return { ...m, addons: has ? m.addons.filter(x => x.name !== a.name) : [...m.addons, { name: a.name, price: Number(a.price) }] };
                          })}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition-all text-left ${
                            checked ? "border-[var(--green-700)] bg-[var(--success-bg)]" : "border-gray-200 hover:border-green-300 bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? "border-[var(--green-700)] bg-[var(--green-700)]" : "border-gray-300"}`}>
                              {checked && <span className="text-white text-[9px] font-bold">✓</span>}
                            </div>
                            <span className={`text-sm font-medium ${checked ? "text-[var(--green-700)]" : "text-gray-700"}`}>{a.name}</span>
                          </div>
                          <span className={`text-sm font-bold ${checked ? "text-[var(--green-700)]" : "text-gray-400"}`}>+{fmt(Number(a.price))}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Variant Groups ── */}
              {modalVariantGroups.map((group) => (
                <div key={group.group}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-gray-800">{group.group}</p>
                    {group.required
                      ? <span className="text-[10px] bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full uppercase">Required</span>
                      : <span className="text-[10px] text-gray-400 font-medium">Optional</span>
                    }
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {group.options.map((opt) => {
                      const chosen = modal.variants[group.group] === opt.name;
                      return (
                        <button
                          key={opt.name}
                          onClick={() => setModal(m => m ? { ...m, variants: { ...m.variants, [group.group]: opt.name } } : m)}
                          className={`py-2.5 px-2 rounded-xl border-2 text-center transition-all ${
                            chosen ? "border-[var(--green-700)] bg-[var(--success-bg)]" : "border-gray-200 hover:border-green-300 bg-white"
                          }`}
                        >
                          <div className={`text-xs font-bold ${chosen ? "text-[var(--green-700)]" : "text-gray-700"}`}>{opt.name}</div>
                          {opt.price ? <div className={`text-[10px] font-semibold mt-0.5 ${chosen ? "text-[var(--green-700)]" : "text-gray-400"}`}>+{fmt(Number(opt.price))}</div> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* ── Notes ── */}
              {modal.item.notesAllowed !== false && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-gray-800">Special Instructions</p>
                    <span className="text-[10px] text-gray-400 font-medium">Optional</span>
                  </div>
                  <textarea
                    placeholder="E.g. Less spicy, No onion, Extra sauce..."
                    value={modal.notes}
                    onChange={(e) => setModal(m => m ? { ...m, notes: e.target.value } : m)}
                    rows={2}
                    className="w-full border-2 border-gray-200 focus:border-[var(--ring)] rounded-xl px-3 py-2 text-sm outline-none resize-none placeholder-gray-300 text-gray-700 transition-colors"
                  />
                </div>
              )}
            </div>

            {/* Footer: Qty + Total + Add button */}
            <div className="border-t bg-gray-50 px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                {/* Qty control */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const next = Math.max(1, modal.qty - 1);
                      setModal(m => m ? { ...m, qty: next, qtyRaw: String(next) } : m);
                    }}
                    className="w-9 h-9 rounded-full bg-white border-2 border-[var(--green-700)] hover:bg-[var(--success-bg)] flex items-center justify-center transition-colors"
                  >
                    <Minus className="w-4 h-4 text-[var(--green-700)]" />
                  </button>
                  <input
                    type="number"
                    step="any"
                    min="0.5"
                    value={modal.qtyRaw}
                    onChange={e => setModal(m => m ? { ...m, qtyRaw: e.target.value } : m)}
                    onBlur={e => {
                      const v = parseFloat(e.target.value);
                      const safe = !isNaN(v) && v >= 0.5 ? Math.round(v * 100) / 100 : modal.qty;
                      setModal(m => m ? { ...m, qty: safe, qtyRaw: String(safe) } : m);
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="text-xl font-bold text-gray-800 w-14 text-center border border-gray-200 rounded-lg outline-none focus:border-[var(--ring)] bg-white py-0.5"
                  />
                  <button
                    onClick={() => {
                      const next = modal.qty + 1;
                      setModal(m => m ? { ...m, qty: next, qtyRaw: String(next) } : m);
                    }}
                    className="w-9 h-9 rounded-full bg-white border-2 border-[var(--green-700)] hover:bg-[var(--success-bg)] flex items-center justify-center transition-colors"
                  >
                    <Plus className="w-4 h-4 text-[var(--green-700)]" />
                  </button>
                </div>
                {/* Live total */}
                <div className="text-right">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">Total</div>
                  <div className="text-2xl font-bold text-[var(--green-700)]">{fmt(modalUnitTotal * modal.qty)}</div>
                  {modal.qty !== 1 && (
                    <div className="text-[10px] text-gray-400">{fmt(modalUnitTotal)} × {modal.qty % 1 === 0 ? modal.qty : modal.qty.toFixed(1)}</div>
                  )}
                </div>
              </div>
              {/* Add / Update button */}
              <button
                disabled={!!(modalSizeBlocked || modalVariantBlocked)}
                onClick={confirmModal}
                className="w-full py-3 bg-[var(--green-700)] hover:opacity-90 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm transition-colors"
              >
                {modalSizeBlocked
                  ? "Select a size to continue"
                  : modalVariantBlocked
                    ? "Select required options"
                    : modal.isEdit
                      ? "Update Item"
                      : `Add ${modal.qty !== 1 ? `${modal.qty % 1 === 0 ? modal.qty : modal.qty.toFixed(1)} × ` : ""}to Order · ${fmt(modalUnitTotal * modal.qty)}`}
              </button>
            </div>

          </DialogContent>
        </Dialog>
      )}

      {/* ── Mobile customer fill-up — outside overflow-hidden so dropdown isn't clipped.
           Hidden at section counters (anonymous walk-ups). ── */}
      {!isSectionMode && <div className="md:hidden shrink-0 relative z-30 flex gap-2 px-3 py-2 border-b border-gray-100/60"
        style={{ background: "var(--paper-0)" }}>
        {(() => {
          const nameVal = form.watch("customerName") || "";
          const filtered = nameVal.trim()
            ? uniqueCustomers.filter(c => c.name.toLowerCase().includes(nameVal.toLowerCase()))
            : uniqueCustomers.slice(0, 8);
          return (
            <div className="relative flex-1">
              <input
                id="customer-name-mobile"
                name="customerName"
                autoComplete="off"
                placeholder="Customer name"
                value={nameVal}
                onChange={e => { form.setValue("customerName", e.target.value); setShowMobileCustomerDropdown(true); }}
                onFocus={() => setShowMobileCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowMobileCustomerDropdown(false), 150)}
                className="w-full px-2.5 py-2 text-base border border-gray-200 rounded-xl bg-gray-50 outline-none focus:border-green-400 placeholder-gray-400"
              />
              {showMobileCustomerDropdown && filtered.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                  {filtered.map((c, i) => (
                    <button key={i} type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        form.setValue("customerName", c.name);
                        form.setValue("customerPhone", c.phone);
                        setShowMobileCustomerDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 border-b border-gray-50 last:border-0 transition-colors"
                    >
                      <div className="text-sm font-semibold text-gray-800">{c.name}</div>
                      {c.phone && <div className="text-xs text-gray-400 mt-0.5">{c.phone}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        <input
          placeholder="Phone number"
          type="tel"
          value={form.watch("customerPhone") || ""}
          onChange={(e) => form.setValue("customerPhone", e.target.value)}
          className="w-32 px-2.5 py-2 text-base border border-gray-200 rounded-xl bg-gray-50 outline-none focus:border-green-400 placeholder-gray-400"
        />
      </div>}

      {/* ── Mobile: "Adding as:" strip — table sessions only (sections use the Parcel toggle) ──── */}
      {(!posMode && !isSectionMode && (!!preselectedTableId || isEditMode)) && (
        <div className="md:hidden shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100/60"
          style={{ background: "var(--paper-0)" }}>
          <span className="text-[9px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: "var(--text-3)" }}>Adding as</span>
          <div className="flex items-center gap-0.5 rounded-md p-[3px]" style={{ background: "var(--paper-100)", border: "1px solid var(--line)" }}>
            {([["dinein", DineInIcon, "Dine-In"], ["pickup", TakeawayIcon, "Pickup"], ["delivery", DeliveryIcon, "Delivery"]] as [ItemServiceMode, React.ComponentType<{ className?: string }>, string][]).map(([mode, Icon, label]) => {
              const active = activeItemMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setActiveItemMode(mode)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-semibold transition-all duration-150"
                  style={active
                    ? { background: "var(--green-800)", color: "#fff", boxShadow: "var(--shadow-sm)" }
                    : { color: "var(--text-2)" }}
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
           MAIN: Category | Items | Billing
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── LEFT: Category sidebar — desktop only ──────────────────────────── */}
        <div className="hidden md:flex w-[130px] shrink-0 bg-white border-r flex-col overflow-hidden">
          <div className="px-3 py-2 border-b shrink-0">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Categories</span>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors border-l-[3px] ${
                selectedCategory === "all"
                  ? "border-green-600 bg-green-50 text-green-700"
                  : "border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              All Items
            </button>
            {visibleCategories?.map((cat: any) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors border-l-[3px] ${
                  selectedCategory === cat.id
                    ? "border-green-600 bg-green-50 text-green-700"
                    : "border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* ── CENTER: Items grid ──────────────────────────────────────────────── */}
        <div className={`flex-1 min-w-0 flex-col overflow-hidden ${mobileTab === "cart" ? "hidden md:flex" : "flex"}`}
          style={{ background: "var(--paper-50)" }}>

          {/* Mobile category pills — horizontal scroll, mobile only */}
          <div className="md:hidden flex gap-1.5 overflow-x-auto px-3 py-2 scrollbar-hide shrink-0"
            style={{ background: "var(--paper-0)", borderBottom: "1px solid var(--line)" }}>
            <button
              onClick={() => setSelectedCategory("all")}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                selectedCategory === "all"
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              All
            </button>
            {visibleCategories?.map((cat: any) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  selectedCategory === cat.id
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3">
              {filteredItems?.length === 0 && (
                <div className="text-center py-16 text-sm" style={{ color: "var(--text-3)" }}>No items found</div>
              )}
              {(() => {
                const gridCls = isSectionMode
                  ? "grid grid-cols-2 md:grid-cols-3 gap-3"
                  : "grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2";
                const renderTile = (item: any) => {
                  const hasSizes = Array.isArray(item.sizes) && item.sizes.length > 0;
                  const hasAddons = item.addonsEnabled && Array.isArray(item.addons) && item.addons.length > 0;
                  const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
                  const needsPicker = hasSizes || hasAddons || hasVariants || item.notesAllowed;
                  const isAvailable = item.isAvailable !== false;
                  const activate = () => isAvailable && (needsPicker ? openPicker(item) : directAddItem(item));

                  // Which single cart line does the pill target? For a plain item this is always
                  // the one directAddItem merges into. For a configurable item (size/addons/variants/
                  // notes) there can be MULTIPLE simultaneous lines for the same item.id — only show
                  // a working pill when there's exactly one, so +/- never has to guess which line to
                  // touch; otherwise fall back to the existing plain "+" (opens the picker, as today).
                  const plainCartKey = `${item.id}-${activeItemMode}`;
                  const matchingLines = needsPicker ? cartItems.filter(c => c.id === item.id) : [];
                  const singleLine = matchingLines.length === 1 ? matchingLines[0] : null;
                  const pillCartKey = needsPicker ? (singleLine ? singleLine.cartKey : null) : plainCartKey;
                  const pillQty = needsPicker
                    ? (singleLine ? singleLine.quantity : 0)
                    : (cartItems.find(c => c.cartKey === plainCartKey)?.quantity ?? 0);
                  const showPill = pillQty > 0 && pillCartKey !== null;

                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={isAvailable ? 0 : -1}
                      aria-disabled={!isAvailable}
                      onClick={activate}
                      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && isAvailable) { e.preventDefault(); activate(); } }}
                      className={`text-left rounded-lg ${isSectionMode ? "p-4 min-h-[92px]" : "p-2.5"} transition-all border ${
                        isAvailable ? "cursor-pointer active:scale-[0.98]" : "opacity-40 cursor-not-allowed"
                      }`}
                      style={{
                        background: "var(--paper-0)",
                        borderColor: showPill ? "var(--green-400)" : "var(--line)",
                        boxShadow: showPill ? "0 0 0 1px var(--green-400), var(--shadow-sm)" : "var(--shadow-xs)",
                      }}
                    >
                      <div className={`font-semibold ${isSectionMode ? "text-base" : "text-xs"} mb-1 leading-tight line-clamp-2`} style={{ color: "var(--text-strong)" }}>{item.name}</div>
                      {hasSizes && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.sizes.map((s: SizeOption) => (
                            <span key={s.size} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--green-50)", border: "1px solid var(--green-200)", color: "var(--green-700)" }}>
                              {s.size} {fmt(Number(s.price))}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-1 gap-1">
                        <div className={`font-bold ${isSectionMode ? "text-xl" : "text-sm"}`} style={{ color: "var(--text-strong)" }}>
                          {!hasSizes && fmt(parseFloat(item.price || "0"))}
                        </div>
                        {showPill ? (
                          <div className="flex items-center gap-1.5 rounded-full px-1 py-0.5 shrink-0" style={{ background: "var(--green-800)" }} onClick={(e) => e.stopPropagation()}>
                            <button
                              disabled={pillQty <= 1 ? isOff("removeItem") : isOff("editItem")}
                              onClick={() => bumpCartQty(pillCartKey!, -1)}
                              className="w-5 h-5 rounded-full flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ background: "rgba(255,255,255,0.16)" }}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-white text-xs font-bold min-w-[10px] text-center tabular-nums">
                              {pillQty % 1 === 0 ? pillQty : pillQty.toFixed(1)}
                            </span>
                            <button
                              disabled={needsPicker ? isOff("editItem") : false}
                              onClick={() => needsPicker ? bumpCartQty(pillCartKey!, 1) : (isAvailable && directAddItem(item))}
                              className="w-5 h-5 rounded-full flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ background: "rgba(255,255,255,0.16)" }}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); activate(); }}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
                            style={{ background: "var(--green-800)", boxShadow: "var(--shadow-green)" }}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        {!isAvailable && <span className="text-[10px] font-medium" style={{ color: "var(--green-500)" }}>Unavailable</span>}
                        {hasAddons && isAvailable && <span className="text-[10px]" style={{ color: "var(--text-3)" }}>Customizable</span>}
                      </div>
                    </div>
                  );
                };

                const catList = selectedCategory === "all"
                  ? (visibleCategories ?? [])
                  : (visibleCategories ?? []).filter((c: any) => c.id === selectedCategory);
                const groups = catList
                  .map((cat: any) => ({ cat, items: filteredItems?.filter((i: any) => i.categoryId === cat.id) ?? [] }))
                  .filter((g: any) => g.items.length > 0);
                const groupedIds = new Set(groups.flatMap((g: any) => g.items.map((i: any) => i.id)));
                const leftover = filteredItems?.filter((i: any) => !groupedIds.has(i.id)) ?? [];
                if (leftover.length) groups.push({ cat: { id: "uncategorized", name: "Other" }, items: leftover });

                return groups.map(({ cat, items }: any) => (
                  <div key={cat.id} className="mb-4 last:mb-0">
                    <div className="flex items-baseline gap-2.5 mb-2.5">
                      <h2 className="font-display font-semibold text-[1.375rem] leading-none" style={{ color: "var(--text-strong)" }}>{cat.name}</h2>
                      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
                    </div>
                    <div className={gridCls}>
                      {items.map((item: any) => renderTile(item))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </ScrollArea>
        </div>

        {/* ── RIGHT: Billing panel — full width on mobile when cart tab active ── */}
        <div className={`${isSectionMode ? "md:w-[420px]" : "md:w-[390px]"} w-full shrink-0 flex-col overflow-hidden ${mobileTab === "menu" ? "hidden md:flex" : "flex"}`}
          style={{
            background: "var(--paper-0)",
            borderLeft: "1px solid var(--line)",
            boxShadow: "-8px 0 30px rgba(20,34,27,0.04)",
          }}>

          {/* Panel header */}
          <div className="px-3 py-2 shrink-0 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--line)", background: "var(--paper-0)" }}>
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-3.5 h-3.5 text-[var(--text-2)]" />
              <span className="text-xs font-bold text-[var(--text-1)] uppercase tracking-wide">Order</span>
              {activeOrderId && (
                <button
                  type="button"
                  {...longPressHandlers(() => hasItems && setShowSettleDialog(true))}
                  onClick={() => hasItems && setShowSettleDialog(true)}
                  title="Tap or long-press for full details, settle, or Pay Later"
                  className="text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 select-none active:scale-95 transition-transform"
                >
                  {serialNum(activeOrderId)}
                </button>
              )}
              {hasItems && (
                <span className="text-[10px] bg-[var(--green-700)] text-white rounded-full px-1.5 py-0.5 font-bold">{cartItems.length}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={isOff("openItem")}
                onClick={() => go("openItem", "Add Open Item", () => setShowOpenItemDialog(true))}
                className={`${isSectionMode ? "text-xs px-2.5 py-1.5" : "text-[10px] px-2 py-1"} font-semibold rounded-md border border-dashed border-[var(--green-700)] text-[var(--green-700)] hover:bg-green-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1`}
              >
                <Plus className="w-3 h-3" />Open Item
              </button>
              {hasItems && (
                <button
                  disabled={isOff("clearCart")}
                  onClick={() => go("clearCart", "Clear All Items", () => { setCartItems([]); setDiscountPercent(0); setContainerCharge(0); })}
                  className="text-[10px] font-semibold rounded-md px-1.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 hover:opacity-80"
                  style={{ color: "var(--danger)" }}
                >
                  <Trash2 className="w-3 h-3" />
                  Clear all
                  {activeRole === "staff" && <Lock className="w-2.5 h-2.5" />}
                </button>
              )}
            </div>
          </div>

          {/* Column headers — skipped at section counters (bigger rows carry their own layout) */}
          {hasItems && !isSectionMode && (
            <div className="grid grid-cols-[auto_1fr_auto] gap-2 px-3 py-1 shrink-0"
              style={{ borderBottom: "1px solid var(--line)", background: "var(--paper-50)" }}>
              <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase w-[52px]">Qty</span>
              <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase">Item</span>
              <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase text-right">Amount</span>
            </div>
          )}
          {/* Plain native-scroll div, not Radix ScrollArea — its Viewport wraps children in
              a display:table-style box that preserves their natural intrinsic width for scroll
              math, which silently defeats flex-shrink/min-w-0 on anything inside it. That let
              cart rows render a few px wider than this panel's fixed width, clipped only at the
              window edge instead of the panel boundary. Plain overflow-y-auto has no such quirk. */}
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
            {(() => {
              const isTableSession = !posMode && (!!preselectedTableId || isEditMode || isSectionMode);
              const renderCartRow = (item: CartItem) => (
                <div key={item.cartKey} className={`rounded-lg overflow-hidden ${isSectionMode ? "p-3" : "p-2.5"}`}
                  style={{ background: "var(--paper-0)", border: "1px solid var(--line)" }}>
                  <div className="flex items-start gap-2">
                    {/* Quantity stepper — reuses the exact same editItem/removeItem gates
                        the Edit/Remove buttons below already sit behind (see bumpCartQty). */}
                    <div className="flex items-center gap-1 rounded-full px-1 py-0.5 shrink-0" style={{ background: "var(--paper-100)" }}>
                      <button
                        disabled={item.quantity <= 1 ? isOff("removeItem") : isOff("editItem")}
                        onClick={() => bumpCartQty(item.cartKey, item.quantity <= 1 ? -item.quantity : -1)}
                        className="w-5 h-5 rounded-full flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "var(--paper-0)", color: "var(--green-800)", boxShadow: "var(--shadow-xs)" }}
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold min-w-[18px] text-center tabular-nums">
                        {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(1)}
                      </span>
                      <button
                        disabled={isOff("editItem")}
                        onClick={() => bumpCartQty(item.cartKey, 1)}
                        className="w-5 h-5 rounded-full flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "var(--paper-0)", color: "var(--green-800)", boxShadow: "var(--shadow-xs)" }}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`${isSectionMode ? "text-base" : "text-sm"} font-semibold leading-tight truncate`} style={{ color: "var(--text-strong)" }}>
                        {item.name}{item.size ? ` (${item.size})` : ""}
                        {item.id < 0 && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide rounded px-1 py-px align-middle" style={{ color: "var(--green-700)", background: "var(--green-50)", border: "1px solid var(--green-200)" }}>Open</span>
                        )}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--text-2)" }}>{fmt(item.totalPrice)} each</p>
                      {item.addons.map(a => (
                        <p key={a.name} className="text-xs text-muted-foreground">+ {a.name}</p>
                      ))}
                      {Object.entries(item.variants || {}).map(([g, v]) => (
                        <div key={g} className="text-[10px] text-purple-600">▸ {g}: {v}</div>
                      ))}
                      {item.notes && (
                        <div className="text-[10px] text-blue-500 italic truncate">📝 {item.notes}</div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`${isSectionMode ? "text-base" : "text-xs"} font-bold tabular-nums whitespace-nowrap`} style={{ color: "var(--text-strong)" }}>{fmt(item.totalPrice * item.quantity)}</span>
                      <button
                        disabled={isOff("removeItem")}
                        onClick={() => go("removeItem", "Remove Item", () => removeFromCart(item.cartKey))}
                        className="transition-colors hover:opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ color: "var(--text-3)" }}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-1">
                    {/* Open items (id < 0) have no menu row for openEditPicker — the Open
                        Item dialog doubles as their editor instead. */}
                    {item.id > 0 ? (
                      <button disabled={isOff("editItem")} onClick={() => go("editItem", "Edit Item", () => openEditPicker(item))} className="text-[10px] text-blue-400 hover:text-blue-600 transition-colors flex items-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Edit2 className="w-2.5 h-2.5" />Edit
                        {!isAdmin && !isOff("editItem") && <Lock className="w-2 h-2 ml-0.5 opacity-50" />}
                      </button>
                    ) : (
                      <button disabled={isOff("editItem")} onClick={() => go("editItem", "Edit Item", () => openOpenItemEditor(item))} className="text-[10px] text-blue-400 hover:text-blue-600 transition-colors flex items-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Edit2 className="w-2.5 h-2.5" />Edit
                        {!isAdmin && !isOff("editItem") && <Lock className="w-2 h-2 ml-0.5 opacity-50" />}
                      </button>
                    )}
                    {/* Section counter: move this line between Eating Here ↔ Parcel (per-item, like tables) */}
                    {isSectionMode && (
                      <button
                        onClick={() => flipItemMode(item.cartKey)}
                        className={`${isSectionMode ? "text-xs" : "text-[10px]"} flex items-center gap-0.5 transition-colors font-semibold ${
                          (item.serviceMode ?? "dinein") === "pickup"
                            ? "text-green-600 hover:text-green-700"
                            : "text-amber-500 hover:text-amber-700"
                        }`}
                      >
                        {(item.serviceMode ?? "dinein") === "pickup" ? "🍽 Make Eating Here" : "🥡 Make Parcel"}
                      </button>
                    )}
                  </div>
                </div>
              );

              if (cartItems.length === 0) return (
                <div className="flex flex-col items-center justify-center text-center px-6 py-10">
                  <img
                    src={apiUrl("/brand/illustration-wood-fire-oven.png")}
                    alt=""
                    aria-hidden
                    className="w-40 max-w-[70%] mb-1 select-none pointer-events-none"
                    style={{ mixBlendMode: "multiply", opacity: 0.92 }}
                  />
                  <h4 className="font-display font-semibold text-[var(--text-strong)] text-[1.375rem] leading-tight">The oven's warm.</h4>
                  <p className="text-sm text-muted-foreground mt-1.5 max-w-[220px] leading-relaxed">
                    Add a few dishes from the menu and the bill builds itself.
                  </p>
                </div>
              );

              if (isTableSession) {
                // Section counters use the same per-mode grouping as tables, with
                // counter-friendly labels (Eating Here / Parcel instead of Dine-In / Pickup).
                const modeConfig: Record<ItemServiceMode, { label: string; headerCls: string }> = isSectionMode ? {
                  dinein:   { label: "🍽 Eating Here", headerCls: "text-green-700 border-green-200 bg-green-50"  },
                  pickup:   { label: "🥡 Parcel",      headerCls: "text-amber-700 border-amber-200 bg-amber-50"  },
                  delivery: { label: "🥡 Parcel",      headerCls: "text-amber-700 border-amber-200 bg-amber-50"  },
                } : {
                  dinein:   { label: "🍽 Dine-In",  headerCls: "text-green-700 border-green-200 bg-green-50"  },
                  pickup:   { label: "📦 Pickup",   headerCls: "text-blue-700  border-blue-200  bg-blue-50"   },
                  delivery: { label: "🛵 Delivery", headerCls: "text-amber-700 border-amber-200 bg-amber-50"  },
                };
                return (
                  <div className="p-3 space-y-3">
                    {(["dinein", "pickup", "delivery"] as const).map(mode => {
                      const modeItems = cartItems.filter(i => (i.serviceMode ?? "dinein") === mode);
                      if (modeItems.length === 0) return null;
                      const cfg = modeConfig[mode];
                      return (
                        <div key={mode}>
                          <div className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm mb-1.5 border ${cfg.headerCls}`}>
                            {cfg.label}
                          </div>
                          <div className="space-y-2">{modeItems.map(renderCartRow)}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return <div className="p-3 space-y-2">{cartItems.map(renderCartRow)}</div>;
            })()}
          </div>

          {/* ── Collapsible order-summary handle (mobile only) ── */}
          {hasItems && (
            <button
              type="button"
              onClick={() => setSummaryOpen((o) => !o)}
              aria-expanded={summaryOpen}
              aria-controls="cart-summary-body"
              aria-label={summaryOpen ? "Hide order summary" : "Show order summary"}
              className="md:hidden shrink-0 flex items-center justify-between gap-3 px-3 h-11 border-t active:bg-black/[0.03] transition-colors"
              style={{
                background: "var(--paper-50)",
                boxShadow: summaryOpen ? "none" : "0 -6px 16px rgba(20,34,27,0.08)",
              }}
            >
              <span className="w-9 h-1.5 rounded-full bg-gray-300" aria-hidden />
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-gray-500">Total</span>
                <span className="text-sm font-bold text-green-600">{fmt(grandTotal)}</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${summaryOpen ? "" : "rotate-180"}`} />
              </span>
            </button>
          )}

          {/* Collapsible body: totals + actions. Grid-rows 1fr↔0fr animates height and frees space for the list. */}
          <div
            id="cart-summary-body"
            className="grid shrink-0 transition-[grid-template-rows] duration-300 ease-out md:!grid-rows-[1fr]"
            style={{ gridTemplateRows: summaryOpen ? "1fr" : "0fr" }}
          >
           <div className="overflow-hidden">
          {/* Totals — section counters get their own breakdown inside SectionActionBar */}
          {!isSectionMode && <div className="md:border-t px-3 py-2 space-y-1" style={{ borderColor: "var(--line)", background: "var(--paper-50)" }}>
            <div className="flex justify-between text-xs" style={{ color: "var(--text-2)" }}>
              <span>Subtotal</span>
              <span className="font-medium" style={{ color: "var(--text-1)" }}>{fmt(subtotal)}</span>
            </div>

            {/* Discount + Container Charge — the "%" suffix and "₹" prefix sit on opposite
                sides of their inputs, so a matching-width wrapper alone right-aligns the
                CLUSTERS but not the input BOXES themselves. Both signs now sit after their
                input, so the two boxes share the exact same shape and land at the same x
                position with no spacer needed. */}
            <div className="flex items-center gap-1 text-xs">
              <span className="flex-1 flex items-center gap-1" style={{ color: "var(--text-2)" }}>
                Discount
                {isOff("discount") && <Lock className="w-2.5 h-2.5 opacity-40" />}
                {discountAmt > 0 && (
                  <span className="ml-1" style={{ color: "var(--green-600)" }}>(-{fmt(discountAmt)})</span>
                )}
              </span>
              <div className="flex items-center gap-1 justify-end">
                <input
                  ref={discountInputRef}
                  type="number"
                  min="0"
                  max="100"
                  disabled={isOff("discount")}
                  value={discountPercent || ""}
                  onFocus={() => {
                    if (!isOff("discount") && isLocked()) {
                      discountInputRef.current?.blur();
                      go("discount", "Edit Discount", () => setTimeout(() => discountInputRef.current?.focus(), 50));
                    }
                  }}
                  onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                  placeholder="0"
                  className="w-14 text-right text-xs rounded px-1.5 py-0.5 outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ border: "1px solid var(--line-strong)", background: "var(--paper-0)", color: "var(--text-1)" }}
                />
                <span className="w-3 text-[10px]" style={{ color: "var(--text-3)" }}>%</span>
              </div>
            </div>

            <div className="flex items-center gap-1 text-xs">
              <span className="flex-1" style={{ color: "var(--text-2)" }}>Container Charge</span>
              <div className="flex items-center gap-1 justify-end">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={containerCharge || ""}
                  onChange={(e) => setContainerCharge(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  className="w-14 text-right text-xs rounded px-1.5 py-0.5 outline-none"
                  style={{ border: "1px solid var(--line-strong)", background: "var(--paper-0)", color: "var(--text-1)" }}
                />
                <span className="w-3 text-[10px]" style={{ color: "var(--text-3)" }}>₹</span>
              </div>
            </div>

            <div className="flex justify-between text-xs" style={{ color: "var(--text-2)" }}>
              <span>Tax ({settings?.taxRate ?? 18}%)</span>
              <span className="font-medium" style={{ color: "var(--text-1)" }}>{fmt(tax)}</span>
            </div>

            <div className="flex justify-between text-sm font-bold pt-1.5 mt-0.5" style={{ borderTop: "1px solid var(--line)" }}>
              <span style={{ color: "var(--text-strong)" }}>Total</span>
              <span className="text-base" style={{ color: "var(--green-700)" }}>{fmt(grandTotal)}</span>
            </div>
          </div>}

          <SettlementDialog
            open={showSettleDialog}
            onOpenChange={setShowSettleDialog}
            grandTotal={grandTotal}
            isLoading={settleMutation.isPending}
            items={cartItems.map(i => ({ name: i.name, quantity: i.quantity, price: i.totalPrice, size: i.size, serviceMode: i.serviceMode }))}
            subtotal={subtotal}
            taxAmount={tax}
            discountAmount={discountAmt}
            orderLabel={activeOrderId ? serialNum(activeOrderId) : undefined}
            initialCustomerName={form.watch("customerName") || ""}
            initialCustomerPhone={form.watch("customerPhone") || ""}
            onSettle={(data) => {
              settlementDataRef.current = data;
              setShowSettleDialog(false);
              setSettlePhase("processing");
              submitModeRef.current = "settle";
              triggerSubmit();
            }}
            // Only offered once the order actually exists — a never-saved cart has
            // nothing to cancel server-side (use Clear Cart instead). Hands off to the
            // same PIN-gated cancel-confirm dialog the "more actions" menu already uses,
            // rather than a second reason-collecting flow living inside this dialog.
            onCancelOrder={activeOrderId ? () => go("cancelOrder", "Cancel Order", () => {
              setShowSettleDialog(false);
              setShowCancelConfirm(true);
            }) : undefined}
          />

          {/* Action buttons */}
          <div className="px-2 pb-2 shrink-0 space-y-1 border-t pt-1.5">
            {isSectionMode ? (
              /* Quick-POS section: the grand total (tax + container included) lives ON the
                 Print Bill button — staff read that number to the customer, never a guess. */
              <SectionActionBar
                subtotal={subtotal}
                tax={tax}
                taxRatePct={settings?.taxRate ?? 18}
                containerCharge={containerCharge}
                onContainerChargeChange={setContainerCharge}
                grandTotal={grandTotal}
                hasItems={hasItems}
                isPending={isPending}
                printLocked={isOff("printBill")}
                settleLocked={isOff("settleOrder")}
                settleLabel={settlePhase === "printing" ? "Printing…" : (settleMutation.isPending || settlePhase === "processing") ? "…" : "Settle"}
                onPrintBill={() => go("printBill", "Print Bill", handleSaveAndPrint)}
                onSettle={() => go("settleOrder", "Settle Order", handleSettle)}
              />
            ) : (
              <>
            {/* Split + Complimentary */}
            <div className="grid grid-cols-2 gap-1">
              <button
                disabled={!activeOrderId || isPending || isOff("splitBill")}
                onClick={() => go("splitBill", "Split Bill", () => { setSplitSelectedIds([]); setShowSplitDialog(true); })}
                className="py-1 rounded text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ border: "1px solid var(--line-strong)", color: "var(--text-2)", background: "var(--paper-0)" }}
              >
                Split
                {isOff("splitBill") && <Lock className="w-2 h-2 opacity-50" />}
              </button>
              <button
                disabled={!hasItems || isPending || isOff("complimentary")}
                onClick={handleComplimentary}
                className="py-1 rounded text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ border: "1px solid var(--line-strong)", color: "var(--text-2)", background: "var(--paper-0)" }}
              >
                Complimentary
                {isOff("complimentary") && <Lock className="w-2 h-2 opacity-50" />}
              </button>
            </div>

            {/* KOT / Bill row */}
            <div className="grid grid-cols-2 gap-1">
              <button
                disabled={!hasItems || isPending || isOff("printKot")}
                onClick={() => go("printKot", "Print KOT", handleKOT)}
                className="py-1.5 rounded text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ border: "1px solid var(--ink-500)", color: "var(--ink-700)", background: "var(--info-bg)" }}
              >
                KOT
                {isOff("printKot") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
              <button
                disabled={!hasItems || isPending || isOff("printBill")}
                onClick={() => go("printBill", "Print Bill", handleBillPrint)}
                className="py-1.5 rounded text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ border: "1px solid var(--clay-500)", color: "var(--clay-700)", background: "var(--paper-100)" }}
              >
                <Printer className="w-3 h-3" />
                Bill
                {isOff("printBill") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
            </div>

            {/* Save + Hold + Settle row */}
            <div className="grid grid-cols-3 gap-1">
              <button
                disabled={!hasItems || isPending || isOff("saveOrder")}
                onClick={() => go("saveOrder", "Save Order", handleSave)}
                className="py-1.5 rounded text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ border: "1px solid var(--line-strong)", color: "var(--text-1)", background: "var(--paper-0)" }}
              >
                {(createOrderMutation.isPending || updateOrderMutation.isPending) && submitModeRef.current === "save" ? "Saving..." : "Save"}
                {isOff("saveOrder") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
              <button
                disabled={!activeOrderId || isPending || isOff("holdOrder")}
                onClick={() => go("holdOrder", "Hold Order", () => setShowHoldConfirm(true))}
                className="py-1.5 rounded text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ border: "1px solid var(--amber-500)", color: "var(--amber-600)", background: "var(--warning-bg)" }}
              >
                Hold
                {isOff("holdOrder") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
              <button
                disabled={!hasItems || isPending || isOff("settleOrder")}
                onClick={() => go("settleOrder", "Settle Order", handleSettle)}
                className="py-1.5 rounded text-[10px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ background: "linear-gradient(180deg, var(--green-700), var(--green-800))", boxShadow: "var(--shadow-green)" }}
              >
                {settlePhase === "printing" ? "Printing…" : (settleMutation.isPending || settlePhase === "processing") ? "…" : "Settle"}
                {isOff("settleOrder") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
            </div>
              </>
            )}
          </div>
           </div>
          </div>
        </div>
      </div>

      {/* ── Mobile: Menu / Cart tab switcher ────────────────────────────────── */}
      <div className="md:hidden shrink-0 bg-white border-t flex">
        <button
          onClick={() => setMobileTab("menu")}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 transition-colors ${
            mobileTab === "menu" ? "text-green-600" : "text-gray-400"
          }`}
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[10px] font-bold">Menu</span>
        </button>
        <button
          onClick={() => setMobileTab("cart")}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 relative transition-colors ${
            mobileTab === "cart" ? "text-green-600" : "text-gray-400"
          }`}
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="text-[10px] font-bold">Cart</span>
          {cartItems.length > 0 && (
            <span className="absolute top-2 left-[calc(50%+6px)] min-w-[16px] h-4 text-[9px] font-bold bg-green-600 text-white rounded-full flex items-center justify-center px-1">
              {cartItems.length}
            </span>
          )}
        </button>
      </div>

      {printPreview && (
        <PrintPreviewModal preview={printPreview} onClose={() => setPrintPreview(null)} />
      )}
    </div>
  );
}
