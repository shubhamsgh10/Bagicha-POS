import { apiUrl } from '@/lib/api';
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
    setActionLoading(true);
    try {
      await apiRequest("PUT", `/api/orders/${activeOrderId}/cancel`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Order cancelled" });
      setShowCancelConfirm(false);
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
      containerCharge: appliedContainerCharge,
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

  const triggerKOTPrint = async (orderId: number, order?: any) => {
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
        toast({ title: 'Nothing new to print', description: 'No new items added since last KOT' });
      } else if (outcome === 'hardware') {
        toast({ title: 'KOT sent to printer!' });
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
          const [freshOrder, freshSettings] = await Promise.all([
            fetch(apiUrl(`/api/orders/${orderId}`), { credentials: 'include' }).then((r) => r.json()),
            fetch(apiUrl('/api/settings'), { credentials: 'include' }).then((r) => r.json()),
          ]);
          const printed = await printOrderBill(freshOrder, freshOrder.items || [], freshSettings);
          // Popup + iframe both blocked (rare) — show the in-page preview so the user isn't stuck.
          if (!printed) showBillPreview(freshOrder ?? order);
          if (!skipKOT) {
            const kotSettings = freshSettings?.printSettings?.kot;
            if (kotSettings?.printOnBill) {
              triggerKOTPrint(orderId, order);
            }
          }
        },
      });
      if (outcome === 'hardware' || outcome === 'browser' || outcome === 'dispatched') {
        toast({ title: 'Bill sent to printer!' });
        if (!skipKOT) {
          const kotSettings = (settings as any)?.printSettings?.kot;
          if (kotSettings?.printOnBill && (outcome === 'hardware' || outcome === 'dispatched')) {
            triggerKOTPrint(orderId, order);
          }
        }
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
      try {
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
        triggerKOTPrint(order.id, order);
      } else if (mode === "save") {
        toast({ title: "Order saved!" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "save-print") {
        toast({ title: "Order saved!" });
        triggerBillPrint(order.id, order);
        if (isSectionMode) {
          // Stay on screen so Settle can follow the same print (print now, settle after).
          setActiveOrderId(order.id);
          setCartLoaded(false);
        } else {
          setCartItems([]); setDiscountPercent(0);
          navigate("/tables");
        }
      } else if (mode === "save-ebill") {
        toast({ title: "Order saved!", description: "WhatsApp bill sent" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
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
        triggerKOTPrint(vars.orderId, order);
      } else if (mode === "save") {
        toast({ title: "Order updated!" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "save-print") {
        toast({ title: "Order updated!" });
        triggerBillPrint(vars.orderId, order);
        if (!isSectionMode) {
          setCartItems([]); setDiscountPercent(0);
          navigate("/tables");
        }
      } else if (mode === "save-ebill") {
        toast({ title: "Order updated!", description: "WhatsApp bill sent" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "bill-print") {
        // Stays on screen (unlike save-print) — plain Bill is a mid-service
        // reprint/preview, not a "finish and leave" action.
        triggerBillPrint(vars.orderId, order);
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
  const toggleParcel = (cartKey: string) =>
    setCartItems(prev => prev.map(c => c.cartKey === cartKey ? { ...c, parcelLeftover: !c.parcelLeftover } : c));

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
  // In table sessions (and quick-POS sections), container charge applies only to
  // pickup/delivery items (not dine-in items) — same per-item logic either way.
  const isTableSession = !posMode && (!!preselectedTableId || !!activeOrderId || isSectionMode);
  // A container is a physical unit — a 0.5 qty still needs one whole container, so
  // each line rounds up individually (ceil-then-sum, not sum-then-ceil: two separate
  // 0.5-qty lines need two containers, not one).
  const containerQty = isTableSession
    ? cartItems.filter(i => i.serviceMode === "pickup" || i.serviceMode === "delivery").reduce((s, i) => s + Math.ceil(i.quantity), 0)
    : (isDeliveryOrPickup ? cartItems.reduce((s, i) => s + Math.ceil(i.quantity), 0) : 0);
  // Dine-in items flagged as a leftover parcel get a flat container charge each (not multiplied by qty).
  // Never applied to pickup/delivery orders — those already charge a container per item.
  const containerRate = Number(settings?.containerCharge ?? 15);
  const parcelCount = isDeliveryOrPickup ? 0 : cartItems.filter(
    i => i.parcelLeftover && i.serviceMode !== "pickup" && i.serviceMode !== "delivery"
  ).length;
  const appliedContainerCharge = containerQty * containerRate + parcelCount * containerRate;
  const grandTotal = total + appliedContainerCharge;

  // ── Submit ───────────────────────────────────────────────────────────────────

  const onSubmit = (data: OrderForm) => {
    if (cartItems.length === 0) {
      toast({ title: "Cart is empty", description: "Add items before placing order", variant: "destructive" });
      setSettlePhase("idle"); // a settle attempt on an unloaded/empty cart must not freeze the buttons
      return;
    }

    const buildInstructions = (c: CartItem) => {
      const parts: string[] = [];
      const variantEntries = Object.entries(c.variants);
      if (variantEntries.length) parts.push(variantEntries.map(([g, v]) => `${g}: ${v}`).join(", "));
      if (c.notes) parts.push(`Note: ${c.notes}`);
      return parts.join(" | ");
    };

    const itemsPayload = cartItems.map(c => ({
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

    if (activeOrderId) {
      updateOrderMutation.mutate({
        orderId: activeOrderId,
        items: itemsPayload,
        discountAmount: discountAmt.toFixed(2),
        customerName: data.customerName || "",
        customerPhone: data.customerPhone || "",
      });
    } else {
      createOrderMutation.mutate({
        ...data,
        totalAmount: grandTotal.toFixed(2),
        taxAmount: tax.toFixed(2),
        discountAmount: discountAmt.toFixed(2),
        ...(preselectedTableId ? { tableId: preselectedTableId, tableNumber: preselectedTableName || String(preselectedTableId) } : {}),
        // Section counter orders carry their section id — separates them from generic pickup
        ...(isSectionMode ? { posSectionId: sectionId } : {}),
        items: itemsPayload,
      });
    }
  };

  const isPending = createOrderMutation.isPending || updateOrderMutation.isPending || settleMutation.isPending;
  const isEditMode = !!activeOrderId;

  // Tell the Electron main process whether a transaction is active so the
  // auto-updater won't restart the app mid-order.
  useEffect(() => {
    const active = isPending || settlePhase !== "idle";
    window.electronAPI?.setPosActive(active);
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

  const handleKOT     = () => { capturePreKOTItems(); submitModeRef.current = "kot-print"; triggerSubmit(); };
  const handleSettle  = () => { if (hasItems) setShowSettleDialog(true); };
  const handleBillPrint = () => {
    if (!activeOrderId) return;
    // Sync the current cart first — /api/print/bill reads order_items straight
    // from the DB, so anything added to the cart after the last save/KOT (e.g.
    // an item added right before printing) would otherwise be silently missing
    // from the printed bill.
    submitModeRef.current = "bill-print";
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

  const handleSave = () => { submitModeRef.current = "save"; triggerSubmit(); };
  const handleSaveAndPrint = () => { submitModeRef.current = "save-print"; triggerSubmit(); };
  const handleSaveEBill = () => {
    const go = () => {
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

        appliedContainerCharge > 0 ? `Container Charge: ₹${appliedContainerCharge.toFixed(0)}` : null,
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
                  onClick={() => { const next = Math.max(0.5, Math.round((openItemQty - 0.5) * 10) / 10); setOpenItemQty(next); setOpenItemQtyRaw(String(next)); }}
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
                  onClick={() => { const next = Math.round((openItemQty + 0.5) * 10) / 10; setOpenItemQty(next); setOpenItemQtyRaw(String(next)); }}
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
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Order?</DialogTitle>
            <DialogDescription>
              This will permanently cancel the order and free the table. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>Keep Order</Button>
            <Button variant="destructive" onClick={handleCancelOrder} disabled={actionLoading}>
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
              onClick={() => go("clearCart", "New Order (Clear Cart)", () => { setCartItems([]); setDiscountPercent(0); })}
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
                const modes: [ItemServiceMode, string, string][] = [
                  ["dinein",   "🍽",  "Dine-In" ],
                  ["pickup",   "📦",  "Pickup"  ],
                  ["delivery", "🛵",  "Delivery"],
                ];
                return (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-1.5 py-1">
                    <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mr-1 whitespace-nowrap">Adding as</span>
                    {modes.map(([mode, icon, label]) => (
                      <button
                        key={mode}
                        onClick={() => setActiveItemMode(mode)}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-all duration-150 ${
                          activeItemMode === mode
                            ? mode === "dinein"   ? "bg-green-600 text-white shadow-sm"
                            : mode === "pickup"   ? "bg-blue-600 text-white shadow-sm"
                            :                       "bg-amber-500 text-white shadow-sm"
                            : "text-gray-500 hover:text-gray-800 hover:bg-gray-200"
                        }`}
                      >
                        <span>{icon}</span>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                );
              }
              // Normal order type tabs (standalone pickup/delivery or new dine-in without table)
              return (
                <div className="flex items-center gap-1">
                  {([["dine-in","Dine In"],["delivery","Delivery"],["takeaway","Pick Up"]] as const)
                    .filter(([val]) =>
                      posMode === "delivery" ? val === "delivery" :
                      posMode === "pickup"   ? val === "takeaway" :
                      true
                    )
                    .map(([val, label]) => {
                    const active = form.watch("orderType") === val;
                    return (
                      <button
                        key={val}
                        onClick={() => { if (!posMode) form.setValue("orderType", val); }}
                        className={`px-3 py-1.5 text-xs font-semibold rounded transition-all duration-150 ${
                          active
                            ? "bg-green-600 text-white shadow-sm"
                            : posMode ? "text-gray-400 cursor-default" : "text-gray-500 hover:text-gray-800"
                        }`}
                      >
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
          containerRate={containerRate}
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
                      const next = Math.max(0.5, Math.round((modal.qty - 0.5) * 10) / 10);
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
                      const next = Math.round((modal.qty + 0.5) * 10) / 10;
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
          <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Adding as</span>
          {([["dinein", "🍽", "Dine-In"], ["pickup", "📦", "Pickup"], ["delivery", "🛵", "Delivery"]] as [ItemServiceMode, string, string][]).map(([mode, icon, label]) => (
            <button
              key={mode}
              onClick={() => setActiveItemMode(mode)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-all duration-150 ${
                activeItemMode === mode
                  ? mode === "dinein"   ? "bg-green-600 text-white shadow-sm"
                  : mode === "pickup"   ? "bg-blue-600 text-white shadow-sm"
                  :                       "bg-amber-500 text-white shadow-sm"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
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
        <div className={`flex-1 flex-col overflow-hidden ${mobileTab === "cart" ? "hidden md:flex" : "flex"}`}
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
                <div className="text-center text-gray-400 py-16 text-sm">No items found</div>
              )}
              <div className={isSectionMode
                ? "grid grid-cols-2 md:grid-cols-3 gap-3"
                : "grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2"}>
                {filteredItems?.map((item: any) => {
                  const hasSizes = Array.isArray(item.sizes) && item.sizes.length > 0;
                  const hasAddons = item.addonsEnabled && Array.isArray(item.addons) && item.addons.length > 0;
                  const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
                  const needsPicker = hasSizes || hasAddons || hasVariants || item.notesAllowed;
                  const isAvailable = item.isAvailable !== false;
                  return (
                    <button
                      key={item.id}
                      disabled={!isAvailable}
                      onClick={() => isAvailable && (needsPicker ? openPicker(item) : directAddItem(item))}
                      className={`text-left bg-white rounded-lg ${isSectionMode ? "p-4 min-h-[92px]" : "p-2.5"} shadow-sm transition-all border border-transparent ${
                        isAvailable
                          ? "hover:border-green-500 hover:bg-green-50 hover:shadow-md cursor-pointer active:scale-95"
                          : "opacity-40 cursor-not-allowed"
                      }`}
                    >
                      <div className={`font-semibold ${isSectionMode ? "text-base" : "text-xs"} mb-1 leading-tight line-clamp-2 text-gray-800`}>{item.name}</div>
                      {hasSizes ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.sizes.map((s: SizeOption) => (
                            <span key={s.size} className="text-[10px] bg-green-50 border border-green-200 px-1.5 py-0.5 rounded font-medium text-green-700">
                              {s.size} {fmt(Number(s.price))}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className={`font-bold text-green-700 ${isSectionMode ? "text-xl" : "text-sm"} mt-0.5`}>{fmt(parseFloat(item.price || "0"))}</div>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        {!isAvailable && <span className="text-[10px] text-green-500 font-medium">Unavailable</span>}
                        {hasAddons && isAvailable && <span className="text-[10px] text-gray-400">Customizable</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* ── RIGHT: Billing panel — full width on mobile when cart tab active ── */}
        <div className={`${isSectionMode ? "md:w-[340px]" : "md:w-[290px]"} w-full shrink-0 flex-col overflow-hidden ${mobileTab === "menu" ? "hidden md:flex" : "flex"}`}
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
                  onClick={() => go("clearCart", "Clear All Items", () => { setCartItems([]); setDiscountPercent(0); })}
                  className="text-[10px] text-[var(--text-3)] hover:text-[var(--danger)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5"
                >
                  Clear all
                  {activeRole === "staff" && <Lock className="w-2.5 h-2.5" />}
                </button>
              )}
            </div>
          </div>

          {/* Column headers — skipped at section counters (bigger rows carry their own layout) */}
          {hasItems && !isSectionMode && (
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 px-3 py-1 shrink-0"
              style={{ borderBottom: "1px solid var(--line)", background: "var(--paper-50)" }}>
              <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase">Item</span>
              <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase w-14 text-center">Qty</span>
              <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase w-10 text-right">Rate</span>
              <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase w-12 text-right">Amt</span>
            </div>
          )}
          <ScrollArea className="flex-1 min-h-0">
            {(() => {
              const isTableSession = !posMode && (!!preselectedTableId || isEditMode || isSectionMode);
              const renderCartRow = (item: CartItem) => (
                <div key={item.cartKey} className={`border rounded-lg ${isSectionMode ? "p-3" : "p-2.5"} bg-background`}>
                  <div className="flex justify-between items-start gap-1">
                    <div className="flex-1 min-w-0">
                      <p className={`${isSectionMode ? "text-base" : "text-sm"} font-medium leading-tight`}>
                        {item.name}{item.size ? ` (${item.size})` : ""}
                        {item.id < 0 && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-[var(--green-700)] bg-green-50 border border-green-200 rounded px-1 py-px align-middle">Open</span>
                        )}
                      </p>
                      {item.addons.map(a => (
                        <p key={a.name} className="text-xs text-muted-foreground">+ {a.name}</p>
                      ))}
                      {Object.entries(item.variants || {}).map(([g, v]) => (
                        <div key={g} className="text-[10px] text-purple-600">▸ {g}: {v}</div>
                      ))}
                      {item.notes && (
                        <div className="text-[10px] text-blue-500 italic truncate">📝 {item.notes}</div>
                      )}
                      {item.parcelLeftover && (
                        <div className="text-[10px] text-amber-600 font-semibold">🥡 Leftover parcel (+{fmt(containerRate)})</div>
                      )}
                    </div>
                    {/* Quantity is display-only here — direct inline edits bypassed the deliberate
                        Edit-Item flow with no gating at all; change quantity via Edit instead. */}
                    <div className={`flex items-center justify-center ${isSectionMode ? "w-24" : "w-16"}`}>
                      <span className={`${isSectionMode ? "text-base" : "text-xs"} font-bold`}>
                        {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(1)}
                      </span>
                    </div>
                    <div className={`w-10 text-right ${isSectionMode ? "text-xs" : "text-[10px]"} text-gray-500`}>{fmt(item.totalPrice)}</div>
                    <div className="w-12 flex items-center justify-end gap-0.5">
                      <span className={`${isSectionMode ? "text-base" : "text-xs"} font-bold text-gray-800`}>{fmt(item.totalPrice * item.quantity)}</span>
                    </div>
                    <button onClick={() => removeFromCart(item.cartKey)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
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
                    <button disabled={isOff("removeItem")} onClick={() => go("removeItem", "Remove Item", () => removeFromCart(item.cartKey))} className="text-[10px] text-green-400 hover:text-green-600 transition-colors flex items-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Trash2 className="w-2.5 h-2.5" />Remove
                      {!isAdmin && !isOff("removeItem") && <Lock className="w-2 h-2 ml-0.5 opacity-50" />}
                    </button>
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
                    {/* Parcel toggle only for dine-in items — pickup/delivery already add a container charge per item */}
                    {!isDeliveryOrPickup && (item.serviceMode ?? "dinein") === "dinein" && (
                      <button
                        onClick={() => toggleParcel(item.cartKey)}
                        className={`text-[10px] flex items-center gap-0.5 transition-colors ${
                          item.parcelLeftover ? "text-amber-600 font-semibold" : "text-amber-400 hover:text-amber-600"
                        }`}
                      >
                        🥡 {item.parcelLeftover ? "Parcel ✓" : "Parcel"}
                      </button>
                    )}
                  </div>
                </div>
              );

              if (cartItems.length === 0) return (
                <div className="flex flex-col items-center justify-center text-center px-6 py-10">
                  <img
                    src="/brand/illustration-wood-fire-oven.png"
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
          </ScrollArea>

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
          {!isSectionMode && <div className="md:border-t px-3 py-2 space-y-1" style={{ background: "var(--paper-50)" }}>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal</span>
              <span className="font-medium text-gray-700">{fmt(subtotal)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500 flex-1 flex items-center gap-1">
                Discount
                {isOff("discount") && <Lock className="w-2.5 h-2.5 opacity-40" />}
                {discountAmt > 0 && (
                  <span className="text-green-600 ml-1">(-{fmt(discountAmt)})</span>
                )}
              </span>
              <div className="flex items-center gap-1">
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
                  className="w-14 text-right text-xs border border-gray-200 rounded px-1.5 py-0.5 outline-none focus:border-green-400 disabled:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-gray-400 text-[10px]">%</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Tax ({settings?.taxRate ?? 18}%)</span>
              <span className="font-medium text-gray-700">{fmt(tax)}</span>
            </div>

            {/* Container Charge — pickup/delivery items + dine-in leftover parcels */}
            {appliedContainerCharge > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Container Charge <span className="text-gray-400">({fmt(containerRate)} × {containerQty + parcelCount})</span></span>
                <span className="font-medium text-gray-700">{fmt(appliedContainerCharge)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-1.5 mt-0.5">
              <span className="text-gray-800">Total</span>
              <span className="text-green-600 text-base">{fmt(grandTotal)}</span>
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
                containerCharge={appliedContainerCharge}
                containerRate={containerRate}
                containerCount={containerQty + parcelCount}
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
                className="py-1 rounded text-[10px] font-medium border border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                Split
                {isOff("splitBill") && <Lock className="w-2 h-2 opacity-50" />}
              </button>
              <button
                disabled={!hasItems || isPending || isOff("complimentary")}
                onClick={handleComplimentary}
                className="py-1 rounded text-[10px] font-medium border border-gray-200 text-gray-500 hover:border-orange-300 hover:text-orange-500 hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
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
                className="py-1.5 rounded text-[10px] font-semibold border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                KOT
                {isOff("printKot") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
              <button
                disabled={!activeOrderId || isPending || isOff("printBill")}
                onClick={() => go("printBill", "Print Bill", handleBillPrint)}
                className="py-1.5 rounded text-[10px] font-semibold border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
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
                className="py-1.5 rounded text-[10px] font-semibold border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                {(createOrderMutation.isPending || updateOrderMutation.isPending) && submitModeRef.current === "save" ? "Saving..." : "Save"}
                {isOff("saveOrder") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
              <button
                disabled={!activeOrderId || isPending || isOff("holdOrder")}
                onClick={() => go("holdOrder", "Hold Order", () => setShowHoldConfirm(true))}
                className="py-1.5 rounded text-[10px] font-semibold border border-amber-300 text-amber-600 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                Hold
                {isOff("holdOrder") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
              <button
                disabled={!hasItems || isPending || isOff("settleOrder")}
                onClick={() => go("settleOrder", "Settle Order", handleSettle)}
                className="py-1.5 rounded text-[10px] font-bold bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
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
