import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
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

import { Plus, Minus, X, ShoppingCart, Search, Trash2, Edit2, ArrowLeft, LayoutGrid, Printer, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PinGuard } from "@/components/PinGuard";
import { useManagerAuth } from "@/hooks/useManagerAuth";

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
}
interface ModalState {
  item: any;
  isEdit: boolean;
  cartKey?: string;
  size: SizeOption | null;
  addons: AddonOption[];
  variants: Record<string, string>;
  notes: string;
  qty: number;
}

const fmt = (n: number) => `₹${n.toFixed(0)}`;

function printBill(order: any, items: any[] = [], settings?: any) {
  const win = window.open("", "_blank", "width=450,height=700");
  if (!win) return;
  const subtotal = parseFloat(order.totalAmount) - parseFloat(order.taxAmount || "0");
  const discount = parseFloat(order.discountAmount || "0");
  const restaurantName = settings?.restaurantName || "Bagicha Restaurant";
  const address = settings?.address || "";
  const phone = settings?.phone || "";
  const gstNumber = settings?.gstNumber || "";
  const footerNote = settings?.footerNote || "Thank you for dining with us!";
  win.document.write(`<html><head><title>Bill - ${order.orderNumber}</title>
    <style>body{font-family:monospace;font-size:13px;margin:0;padding:16px;}h2{text-align:center;font-size:20px;margin:0 0 4px;}.center{text-align:center;}.divider{border-top:1px dashed #000;margin:10px 0;}.row{display:flex;justify-content:space-between;padding:2px 0;}.bold{font-weight:bold;}.large{font-size:16px;}.footer{text-align:center;margin-top:16px;font-size:12px;}</style>
    </head><body>
    <h2>${restaurantName.toUpperCase()}</h2>
    ${address ? `<div class="center" style="font-size:11px">${address}</div>` : ""}
    ${phone ? `<div class="center" style="font-size:11px">Ph: ${phone}</div>` : ""}
    ${gstNumber ? `<div class="center" style="font-size:11px">GSTIN: ${gstNumber}</div>` : ""}
    <div style="margin-bottom:8px"></div>
    <div class="divider"></div>
    <div class="row"><span>Order #</span><span class="bold">${order.orderNumber}</span></div>
    <div class="row"><span>Type</span><span>${order.orderType}</span></div>
    ${order.tableNumber ? `<div class="row"><span>Table</span><span>${order.tableNumber}</span></div>` : ""}
    ${order.customerName ? `<div class="row"><span>Customer</span><span>${order.customerName}</span></div>` : ""}
    <div class="row"><span>Date</span><span>${new Date(order.createdAt || Date.now()).toLocaleString()}</span></div>
    <div class="divider"></div>
    <div class="bold" style="margin-bottom:6px">ITEMS</div>
    ${items.length > 0 ? items.map((item: any) => `<div class="row"><span>${item.name || "Item"} × ${item.quantity}</span><span>₹${(parseFloat(item.price) * item.quantity).toFixed(0)}</span></div>`).join("") : "<div>—</div>"}
    <div class="divider"></div>
    <div class="row"><span>Subtotal</span><span>₹${subtotal.toFixed(0)}</span></div>
    ${discount > 0 ? `<div class="row"><span>Discount</span><span>-₹${discount.toFixed(0)}</span></div>` : ""}
    <div class="row"><span>Tax (GST)</span><span>₹${parseFloat(order.taxAmount || "0").toFixed(0)}</span></div>
    <div class="divider"></div>
    <div class="row bold large"><span>TOTAL</span><span>₹${parseFloat(order.totalAmount).toFixed(0)}</span></div>
    <div class="row" style="margin-top:4px"><span>Payment</span><span>${order.paymentMethod || "—"}</span></div>
    <div class="footer"><div class="divider">${footerNote}<br>Please visit again</div></div>
    </body></html>`);
  win.document.close(); win.focus(); win.print(); win.close();
}

function printKOTSlip(items: any[], tableLabel: string | null) {
  const win = window.open("", "_blank", "width=300,height=400");
  if (!win) return;
  win.document.write(`<html><head><title>KOT</title>
    <style>body{font-family:monospace;font-size:14px;padding:12px;}h3{text-align:center;margin:0 0 8px;}.row{display:flex;justify-content:space-between;}.divider{border-top:1px dashed #000;margin:8px 0;}.bold{font-weight:bold;}</style>
    </head><body>
    <h3>KITCHEN ORDER TICKET</h3>
    ${tableLabel ? `<div class="row"><span>Table:</span><span class="bold">${tableLabel}</span></div>` : ""}
    <div class="row"><span>Time:</span><span>${new Date().toLocaleTimeString()}</span></div>
    <div class="divider"></div>
    ${items.map(i => `<div class="row bold"><span>${i.name}${i.size ? ` (${i.size})` : ""}</span><span>× ${i.quantity}</span></div>${i.addons?.length ? i.addons.map((a: any) => `<div style="font-size:11px;padding-left:8px">+ ${a.name}</div>`).join("") : ""}${i.variants && Object.keys(i.variants).length ? Object.entries(i.variants).map(([g,v]: any) => `<div style="font-size:11px;padding-left:8px;color:#444">▸ ${g}: ${v}</div>`).join("") : ""}${i.notes ? `<div style="font-size:11px;padding-left:8px;font-style:italic;color:#555">📝 ${i.notes}</div>` : ""}`).join("")}
    <div class="divider"></div>
    </body></html>`);
  win.document.close(); win.focus(); win.print(); win.close();
}

export default function POS() {
  const [, navigate] = useLocation();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);

  // Unified modifier modal state (handles both add-new and edit-existing)
  const [modal, setModal] = useState<ModalState | null>(null);

  // URL params
  const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const preselectedTableId = urlParams.get("tableId") ? Number(urlParams.get("tableId")) : null;
  const preselectedTableName = urlParams.get("tableName") ? decodeURIComponent(urlParams.get("tableName") || "") : null;
  const editOrderId = urlParams.get("orderId") ? Number(urlParams.get("orderId")) : null;

  // ── Active order ID (starts from URL, updated after KOT creates a new order) ─
  const [activeOrderId, setActiveOrderId] = useState<number | null>(editOrderId);
  // Tracks what action triggered the submit
  const submitModeRef = useRef<"kot" | "kot-print" | "save" | "save-print" | "save-ebill" | "settle">("save");
  // Payment method selection
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");
  const paymentMethodRef = useRef("cash");
  const setPayment = (m: string) => { setSelectedPaymentMethod(m); paymentMethodRef.current = m; };
  // It's Paid checkbox
  const [isPaid, setIsPaid] = useState(false);
  // Short code input
  const [shortCode, setShortCode] = useState("");
  // Discount input ref (for re-focus after PIN unlock)
  const discountInputRef = useRef<HTMLInputElement>(null);

  // ── Manager PIN protection ────────────────────────────────────────────────────
  const { requirePin, pinRequest, resolvePinSuccess, resolvePinCancel, isLocked } = useManagerAuth();

  // ── Route guard: POS requires a tableId OR an orderId (recalled hold) ────────
  useEffect(() => {
    if (!preselectedTableId && !editOrderId) {
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
  const form = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { orderType: editOrderId ? "dine-in" : "dine-in", paymentMethod: "cash" },
  });

  const { data: categories } = useQuery<any[]>({ queryKey: ["/api/categories"] });
  const { data: menuItems } = useQuery<any[]>({ queryKey: ["/api/menu"] });
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
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
      const name = menuItem?.name || "Unknown Item";
      const price = parseFloat(item.price);
      return {
        cartKey: `db-${item.id}-${item.menuItemId}`,
        id: item.menuItemId,
        name,
        basePrice: price,
        addons: [],
        variants: {},
        notes: item.specialInstructions || "",
        totalPrice: price,
        size: item.size || undefined,
        quantity: item.quantity,
      };
    });
    setCartItems(loadedItems);
    setCartLoaded(true);
    // Discount is now stored as %; existing orders reset to 0 since we stored rupees before
    setDiscountPercent(0);
  }, [existingOrder, menuItems, activeOrderId, cartLoaded]);

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
        printKOTSlip(cartItems, tableLabel);
      } else if (mode === "save") {
        toast({ title: "Order saved!" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "save-print") {
        toast({ title: "Order saved!" });
        printBill(order, [], settings);
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "save-ebill") {
        toast({ title: "Order saved!", description: "E-bill sent to customer" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "settle") {
        settleMutation.mutate({ orderId: order.id, order, paymentMethod: paymentMethodRef.current });
      }
    },
    onError: (error: any) => {
      toast({ title: "Failed to place order", description: error.message || "Something went wrong", variant: "destructive" });
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
        printKOTSlip(cartItems, tableLabel);
      } else if (mode === "save") {
        toast({ title: "Order updated!" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "save-print") {
        toast({ title: "Order updated!" });
        printBill(order, existingOrder?.items || [], settings);
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "save-ebill") {
        toast({ title: "Order updated!", description: "E-bill sent to customer" });
        setCartItems([]); setDiscountPercent(0);
        navigate("/tables");
      } else if (mode === "settle") {
        settleMutation.mutate({ orderId: vars.orderId, order, paymentMethod: paymentMethodRef.current });
      }
    },
    onError: (error: any) => {
      toast({ title: "Failed to update order", description: error.message || "Something went wrong", variant: "destructive" });
    },
  });

  // ── Settle / payment mutation ─────────────────────────────────────────────

  const settleMutation = useMutation({
    mutationFn: async ({ orderId, paymentMethod }: { orderId: number; paymentMethod: string; order?: any }) => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/payment`, { paymentMethod });
      return res.json();
    },
    onSuccess: (settled: any, vars: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
      const billOrder = vars.order || settled;
      printBill(billOrder, existingOrder?.items || [], settings);
      toast({ title: "Payment complete!", description: "Bill printed" });
      navigate("/tables");
    },
    onError: (error: any) => {
      toast({ title: "Settlement failed", description: error.message || "Something went wrong", variant: "destructive" });
    },
  });

  // ── Unified modifier modal helpers ──────────────────────────────────────────

  const openPicker = (item: any) => {
    setModal({ item, isEdit: false, size: null, addons: [], variants: {}, notes: "", qty: 1 });
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
    const mergeKey = `${item.id}-${sizePart}-${addonPart}-${variantPart}`;
    const uniqueKey = notes ? `${mergeKey}-${Date.now()}` : mergeKey;

    if (isEdit) {
      setCartItems(prev => prev.map(c => c.cartKey === cartKey
        ? { ...c, basePrice, addons, variants, notes, totalPrice, size: sizePart || undefined, quantity: qty }
        : c
      ));
    } else {
      setCartItems(prev => {
        const existing = !notes ? prev.find(c => c.cartKey === mergeKey) : null;
        if (existing) return prev.map(c => c.cartKey === mergeKey ? { ...c, quantity: c.quantity + qty } : c);
        return [...prev, { cartKey: uniqueKey, id: item.id, name: item.name, basePrice, addons, variants, notes, totalPrice, quantity: qty, size: sizePart || undefined }];
      });
    }
    setModal(null);
  };

  // ── Cart helpers ─────────────────────────────────────────────────────────────

  const directAddItem = (item: any) => {
    const basePrice = parseFloat(item.price || "0");
    const cartKey = `${item.id}`;
    setCartItems(prev => {
      const existing = prev.find(c => c.cartKey === cartKey);
      if (existing) return prev.map(c => c.cartKey === cartKey ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { cartKey, id: item.id, name: item.name, basePrice, addons: [], variants: {}, notes: "", totalPrice: basePrice, quantity: 1 }];
    });
  };

  const removeFromCart = (cartKey: string) => setCartItems(prev => prev.filter(c => c.cartKey !== cartKey));
  const updateQty = (cartKey: string, qty: number) => {
    if (qty <= 0) { removeFromCart(cartKey); return; }
    setCartItems(prev => prev.map(c => c.cartKey === cartKey ? { ...c, quantity: qty } : c));
  };

  // ── Filter ───────────────────────────────────────────────────────────────────

  const filteredItems = menuItems?.filter((item: any) => {
    const matchCat = selectedCategory === "all" || item.categoryId === selectedCategory;
    const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  // ── Totals ───────────────────────────────────────────────────────────────────

  const subtotal = cartItems.reduce((s, i) => s + i.totalPrice * i.quantity, 0);
  const discountAmt = subtotal * Math.min(discountPercent, 100) / 100;
  const taxable = subtotal - discountAmt;
  const tax = taxable * taxRate;
  const total = taxable + tax;

  // ── Submit ───────────────────────────────────────────────────────────────────

  const onSubmit = (data: OrderForm) => {
    if (cartItems.length === 0) {
      toast({ title: "Cart is empty", description: "Add items before placing order", variant: "destructive" });
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
    }));

    if (activeOrderId) {
      updateOrderMutation.mutate({
        orderId: activeOrderId,
        items: itemsPayload,
        discountAmount: discountAmt.toFixed(2),
      });
    } else {
      createOrderMutation.mutate({
        ...data,
        totalAmount: total.toFixed(2),
        taxAmount: tax.toFixed(2),
        discountAmount: discountAmt.toFixed(2),
        ...(preselectedTableId ? { tableId: preselectedTableId, tableNumber: preselectedTableName || String(preselectedTableId) } : {}),
        items: itemsPayload,
      });
    }
  };

  const isPending = createOrderMutation.isPending || updateOrderMutation.isPending || settleMutation.isPending;
  const isEditMode = !!activeOrderId;

  // ── Submit action handlers ───────────────────────────────────────────────────

  const triggerSubmit = () => {
    if (activeOrderId) { onSubmit(form.getValues()); }
    else { form.handleSubmit(onSubmit)(); }
  };

  const handleKOT        = () => { submitModeRef.current = "kot";        triggerSubmit(); };
  const handleKOTAndPrint= () => { submitModeRef.current = "kot-print";  triggerSubmit(); };
  const handleSave       = () => { submitModeRef.current = "save";       triggerSubmit(); };
  const handleSaveAndPrint=() => { submitModeRef.current = "save-print"; triggerSubmit(); };
  const handleSaveEBill  = () => { submitModeRef.current = "save-ebill"; triggerSubmit(); };
  const handleSettle     = () => { submitModeRef.current = "settle";     triggerSubmit(); };

  const handleComplimentary = () => requirePin("Complimentary (100% Discount)", () => setDiscountPercent(100));

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
          onSuccess={resolvePinSuccess}
          onCancel={resolvePinCancel}
        />
      )}


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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Recall Held Order</DialogTitle>
            <DialogDescription>Select a held order to resume.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto py-1">
            {heldOrders.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No held orders</p>
            )}
            {heldOrders.map((o: any) => (
              <button
                key={o.id}
                onClick={() => {
                  setShowRecallDialog(false);
                  navigate(`/pos?orderId=${o.id}`);
                }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border hover:border-primary hover:bg-primary/5 transition-colors text-sm"
              >
                <div className="text-left">
                  <p className="font-medium">{o.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">{o.items?.length || 0} items · {o.customerName || "No name"}</p>
                </div>
                <span className="font-semibold text-primary">₹{parseFloat(o.totalAmount).toFixed(0)}</span>
              </button>
            ))}
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
      <div className="shrink-0 bg-white border-b shadow-sm z-10">
        <div className="flex items-center gap-2 px-3 py-2">

          {/* Back */}
          <button
            onClick={handleBackToTables}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors shrink-0 font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Tables
          </button>

          {/* Table label badge */}
          {tableLabel && (
            <div className="flex items-center gap-1.5 bg-green-600 text-white px-2.5 py-1 rounded text-xs font-bold shrink-0">
              <span>{tableLabel}</span>
              {isEditMode && existingOrder?.orderNumber && (
                <span className="opacity-75">#{existingOrder.orderNumber}</span>
              )}
              <span className="opacity-75 text-[10px] capitalize">{orderTypeLabel}</span>
            </div>
          )}

          <div className="w-px h-5 bg-gray-200 mx-1 shrink-0" />

          {/* New Order */}
          <button
            onClick={() => requirePin("New Order (Clear Cart)", () => { setCartItems([]); setDiscountPercent(0); })}
            className="text-xs font-semibold text-green-600 border border-green-600 px-2.5 py-1.5 rounded hover:bg-green-50 transition-colors shrink-0"
          >
            + New Order
          </button>

          {/* Search */}
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 flex-1 min-w-0 max-w-[200px]">
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

          {/* Short Code */}
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 w-[130px] shrink-0">
            <input
              placeholder="Short code + ↵"
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value)}
              onKeyDown={handleShortCode}
              className="bg-transparent text-xs outline-none w-full placeholder-gray-400"
            />
          </div>

          <div className="flex-1" />

          {/* Order type tabs */}
          <div className="flex border border-gray-200 rounded overflow-hidden shrink-0">
            {([["dine-in","Dine In"],["delivery","Delivery"],["takeaway","Pick Up"]] as const).map(([val, label]) => {
              const active = form.watch("orderType") === val;
              return (
                <button
                  key={val}
                  onClick={() => form.setValue("orderType", val)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors border-r border-gray-200 last:border-r-0 ${
                    active ? "bg-green-600 text-white" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Customer name */}
          <input
            placeholder="Customer name"
            {...form.register("customerName")}
            className="text-xs border border-gray-200 rounded px-2.5 py-1.5 w-32 bg-gray-50 outline-none focus:border-green-400 placeholder-gray-400 shrink-0"
          />

          {/* Table Actions */}
          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
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
                  { label: "Move Table",   action: () => openAction(() => requirePin("Move Table", () => setShowMoveDialog(true))),   icon: "→" },
                  { label: "Merge Table",  action: () => openAction(() => requirePin("Merge Tables", () => setShowMergeDialog(true))),  icon: "⊕" },
                  { label: "Split Bill",   action: () => openAction(() => requirePin("Split Bill", () => { setSplitSelectedIds([]); setShowSplitDialog(true); })), icon: "⊘" },
                  { label: "Recall Held",  action: () => openAction(() => { refetchHeld(); setShowRecallDialog(true); }), icon: "↩" },
                  { label: "Cancel Order", action: () => openAction(() => requirePin("Cancel Order", () => setShowCancelConfirm(true))), icon: "✕", danger: true },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors text-left ${
                      item.danger ? "text-green-500 hover:bg-green-50" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="w-4 text-center text-base leading-none">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
           MODIFIER MODAL — Petpooja style
      ════════════════════════════════════════════════════════════════════════ */}
      {modal && (
        <Dialog open={true} onOpenChange={() => setModal(null)}>
          <DialogContent className="max-w-md p-0 gap-0 overflow-hidden rounded-2xl">

            {/* Header */}
            <div className="bg-green-600 px-5 py-4">
              <DialogTitle className="text-white font-bold text-lg leading-tight">
                {modal.item.name}
              </DialogTitle>
              <DialogDescription className="text-green-100 text-sm mt-0.5">
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
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 hover:border-green-300 bg-white"
                          }`}
                        >
                          <div className={`text-xs font-bold ${chosen ? "text-green-700" : "text-gray-700"}`}>{s.size}</div>
                          <div className={`text-xs font-semibold mt-0.5 ${chosen ? "text-green-600" : "text-gray-500"}`}>{fmt(Number(s.price))}</div>
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
                            checked ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-green-200 bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? "border-green-500 bg-green-500" : "border-gray-300"}`}>
                              {checked && <span className="text-white text-[9px] font-bold">✓</span>}
                            </div>
                            <span className={`text-sm font-medium ${checked ? "text-green-800" : "text-gray-700"}`}>{a.name}</span>
                          </div>
                          <span className={`text-sm font-bold ${checked ? "text-green-600" : "text-gray-400"}`}>+{fmt(Number(a.price))}</span>
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
                            chosen ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-green-300 bg-white"
                          }`}
                        >
                          <div className={`text-xs font-bold ${chosen ? "text-green-700" : "text-gray-700"}`}>{opt.name}</div>
                          {opt.price ? <div className={`text-[10px] font-semibold mt-0.5 ${chosen ? "text-green-600" : "text-gray-400"}`}>+{fmt(Number(opt.price))}</div> : null}
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
                    className="w-full border-2 border-gray-200 focus:border-green-400 rounded-xl px-3 py-2 text-sm outline-none resize-none placeholder-gray-300 text-gray-700 transition-colors"
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
                    onClick={() => setModal(m => m ? { ...m, qty: Math.max(1, m.qty - 1) } : m)}
                    className="w-9 h-9 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                  >
                    <Minus className="w-4 h-4 text-gray-700" />
                  </button>
                  <span className="text-xl font-bold text-gray-800 w-7 text-center">{modal.qty}</span>
                  <button
                    onClick={() => setModal(m => m ? { ...m, qty: m.qty + 1 } : m)}
                    className="w-9 h-9 rounded-full bg-green-600 hover:bg-green-700 text-white flex items-center justify-center transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {/* Live total */}
                <div className="text-right">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">Total</div>
                  <div className="text-2xl font-bold text-green-700">{fmt(modalUnitTotal * modal.qty)}</div>
                  {modal.qty > 1 && (
                    <div className="text-[10px] text-gray-400">{fmt(modalUnitTotal)} × {modal.qty}</div>
                  )}
                </div>
              </div>
              {/* Add / Update button */}
              <button
                disabled={!!(modalSizeBlocked || modalVariantBlocked)}
                onClick={confirmModal}
                className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm transition-colors"
              >
                {modalSizeBlocked
                  ? "Select a size to continue"
                  : modalVariantBlocked
                    ? "Select required options"
                    : modal.isEdit
                      ? "Update Item"
                      : `Add ${modal.qty > 1 ? `${modal.qty} × ` : ""}to Order · ${fmt(modalUnitTotal * modal.qty)}`}
              </button>
            </div>

          </DialogContent>
        </Dialog>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
           MAIN: Category | Items | Billing
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── LEFT: Category sidebar ─────────────────────────────────────────── */}
        <div className="w-[130px] shrink-0 bg-white border-r flex flex-col overflow-hidden">
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
            {categories?.map((cat: any) => (
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
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
          <ScrollArea className="flex-1">
            <div className="p-3">
              {filteredItems?.length === 0 && (
                <div className="text-center text-gray-400 py-16 text-sm">No items found</div>
              )}
              <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
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
                      className={`text-left bg-white rounded-lg p-2.5 shadow-sm transition-all border border-transparent ${
                        isAvailable
                          ? "hover:border-green-500 hover:bg-green-50 hover:shadow-md cursor-pointer active:scale-95"
                          : "opacity-40 cursor-not-allowed"
                      }`}
                    >
                      <div className="font-semibold text-xs mb-1 leading-tight line-clamp-2 text-gray-800">{item.name}</div>
                      {hasSizes ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.sizes.map((s: SizeOption) => (
                            <span key={s.size} className="text-[10px] bg-green-50 border border-green-200 px-1.5 py-0.5 rounded font-medium text-green-700">
                              {s.size} {fmt(Number(s.price))}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="font-bold text-green-700 text-sm mt-0.5">{fmt(parseFloat(item.price || "0"))}</div>
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

        {/* ── RIGHT: Billing panel ───────────────────────────────────────────── */}
        <div className="w-[290px] shrink-0 bg-white border-l flex flex-col overflow-hidden">

          {/* Panel header */}
          <div className="px-3 py-2 border-b bg-gray-50 shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Order</span>
              {hasItems && (
                <span className="text-[10px] bg-green-600 text-white rounded-full px-1.5 py-0.5 font-bold">{cartItems.length}</span>
              )}
            </div>
            {hasItems && (
              <button
                onClick={() => requirePin("Clear All Items", () => { setCartItems([]); setDiscountPercent(0); })}
                className="text-[10px] text-gray-400 hover:text-green-500 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Column headers */}
          {hasItems && (
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 px-3 py-1 border-b bg-gray-50 shrink-0">
              <span className="text-[10px] font-semibold text-gray-500 uppercase">Item</span>
              <span className="text-[10px] font-semibold text-gray-500 uppercase w-14 text-center">Qty</span>
              <span className="text-[10px] font-semibold text-gray-500 uppercase w-10 text-right">Rate</span>
              <span className="text-[10px] font-semibold text-gray-500 uppercase w-12 text-right">Amt</span>
            </div>
          )}

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto">
            {!hasItems && (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                <ShoppingCart className="w-10 h-10" />
                <span className="text-xs">Tap items to add</span>
              </div>
            )}
            {cartItems.map((item, idx) => (
              <div key={item.cartKey} className={`px-3 py-1.5 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"} border-b border-gray-100`}>
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 items-center">
                  {/* Name + modifiers */}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-800 truncate leading-tight">
                      {item.name}{item.size ? ` (${item.size})` : ""}
                    </div>
                    {item.addons.map(a => (
                      <div key={a.name} className="text-[10px] text-green-600">+ {a.name}</div>
                    ))}
                    {Object.entries(item.variants).map(([g, v]) => (
                      <div key={g} className="text-[10px] text-purple-600">▸ {g}: {v}</div>
                    ))}
                    {item.notes && (
                      <div className="text-[10px] text-blue-500 italic truncate">📝 {item.notes}</div>
                    )}
                  </div>
                  {/* Qty controls */}
                  <div className="flex items-center gap-0.5 w-14 justify-center">
                    <button
                      onClick={() => requirePin("Change Qty", () => updateQty(item.cartKey, item.quantity - 1))}
                      className="w-5 h-5 rounded bg-gray-100 hover:bg-green-100 hover:text-green-600 flex items-center justify-center transition-colors"
                    >
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <span className="text-xs font-bold w-5 text-center">{item.quantity}</span>
                    <button
                      onClick={() => requirePin("Change Qty", () => updateQty(item.cartKey, item.quantity + 1))}
                      className="w-5 h-5 rounded bg-gray-100 hover:bg-green-100 hover:text-green-600 flex items-center justify-center transition-colors"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  {/* Unit price */}
                  <div className="w-10 text-right text-[10px] text-gray-500">{fmt(item.totalPrice)}</div>
                  {/* Line total + remove */}
                  <div className="w-12 flex items-center justify-end gap-0.5">
                    <span className="text-xs font-bold text-gray-800">{fmt(item.totalPrice * item.quantity)}</span>
                  </div>
                </div>
                {/* Edit / remove row */}
                <div className="flex items-center gap-2 mt-0.5">
                  <button onClick={() => requirePin("Edit Item", () => openEditPicker(item))} className="text-[10px] text-blue-400 hover:text-blue-600 transition-colors flex items-center gap-0.5">
                    <Edit2 className="w-2.5 h-2.5" /> Edit
                  </button>
                  <button onClick={() => requirePin("Remove Item", () => removeFromCart(item.cartKey))} className="text-[10px] text-green-400 hover:text-green-600 transition-colors flex items-center gap-0.5">
                    <Trash2 className="w-2.5 h-2.5" /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t px-3 py-2 space-y-1 shrink-0 bg-gray-50">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal</span>
              <span className="font-medium text-gray-700">{fmt(subtotal)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500 flex-1">
                Discount
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
                  value={discountPercent || ""}
                  onFocus={() => {
                    if (isLocked()) {
                      discountInputRef.current?.blur();
                      requirePin("Edit Discount", () => setTimeout(() => discountInputRef.current?.focus(), 50));
                    }
                  }}
                  onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                  placeholder="0"
                  className="w-14 text-right text-xs border border-gray-200 rounded px-1.5 py-0.5 outline-none focus:border-green-400"
                />
                <span className="text-gray-400 text-[10px]">%</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Tax ({settings?.taxRate ?? 18}%)</span>
              <span className="font-medium text-gray-700">{fmt(tax)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-1.5 mt-0.5">
              <span className="text-gray-800">Total</span>
              <span className="text-green-600 text-base">{fmt(total)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div className="px-2 py-2 border-t shrink-0">
            <div className="grid grid-cols-5 gap-1">
              {[
                { id: "cash",  label: "Cash"   },
                { id: "card",  label: "Card"   },
                { id: "upi",   label: "Online" },
                { id: "due",   label: "Due"    },
                { id: "other", label: "Other"  },
              ].map((pm) => (
                <button
                  key={pm.id}
                  onClick={() => setPayment(pm.id)}
                  className={`py-1.5 rounded text-[10px] font-bold border transition-colors ${
                    selectedPaymentMethod === pm.id
                      ? "bg-green-600 text-white border-green-600"
                      : "border-gray-200 text-gray-600 hover:border-green-400 hover:text-green-600"
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
            {/* It's Paid */}
            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(e) => setIsPaid(e.target.checked)}
                className="accent-green-600 w-3.5 h-3.5"
              />
              <span className="text-xs font-semibold text-gray-600">It's Paid</span>
            </label>
          </div>

          {/* Action buttons */}
          <div className="px-2 pb-2 shrink-0 space-y-1 border-t pt-2">
            {/* Split + Complimentary */}
            <div className="grid grid-cols-2 gap-1">
              <button
                disabled={!activeOrderId || isPending}
                onClick={() => requirePin("Split Bill", () => { setSplitSelectedIds([]); setShowSplitDialog(true); })}
                className="py-1.5 rounded text-[11px] font-semibold border border-gray-300 text-gray-600 hover:border-green-400 hover:text-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Split
              </button>
              <button
                disabled={!hasItems || isPending}
                onClick={handleComplimentary}
                className="py-1.5 rounded text-[11px] font-semibold border border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Complimentary
              </button>
            </div>

            {/* Save row */}
            <div className="grid grid-cols-3 gap-1">
              <button
                disabled={!hasItems || isPending}
                onClick={handleSave}
                className="py-2 rounded text-[11px] font-bold bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
              <button
                disabled={!hasItems || isPending}
                onClick={handleSaveAndPrint}
                className="py-2 rounded text-[11px] font-bold bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                <Printer className="w-3 h-3" />
                Save
              </button>
              <button
                disabled={!hasItems || isPending}
                onClick={handleSaveEBill}
                className="py-2 rounded text-[11px] font-bold bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                EBill
              </button>
            </div>

            {/* KOT row */}
            <div className="grid grid-cols-2 gap-1">
              <button
                disabled={!hasItems || isPending}
                onClick={handleKOT}
                className="py-2 rounded text-[11px] font-bold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                KOT
              </button>
              <button
                disabled={!hasItems || isPending}
                onClick={handleKOTAndPrint}
                className="py-2 rounded text-[11px] font-bold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
              >
                <Printer className="w-3 h-3" />
                KOT & Print
              </button>
            </div>

            {/* Hold + Settle row */}
            <div className="grid grid-cols-2 gap-1">
              <button
                disabled={!activeOrderId || isPending}
                onClick={() => setShowHoldConfirm(true)}
                className="py-2 rounded text-[11px] font-bold border-2 border-amber-500 text-amber-600 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Hold
              </button>
              <button
                disabled={!hasItems || isPending}
                onClick={handleSettle}
                className="py-2 rounded text-[11px] font-bold bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {settleMutation.isPending ? "Settling..." : "Settle"}
              </button>
            </div>
          </div>

        </div>{/* end RIGHT */}
      </div>{/* end MAIN */}
    </div>
  );
}
