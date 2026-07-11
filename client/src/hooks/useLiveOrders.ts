import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { useRealtime } from "@/hooks/useRealtime";
import { normalizeOrderType } from "@/hooks/useLiveTableOperations";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveOrderItem {
  id: number;
  menuItemId: number;
  name: string;
  quantity: number;
  size: string | null;
  specialInstructions: string | null;
}

export interface LiveOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  orderType: "delivery" | "pickup";
  /** Quick-POS section that created this order (e.g. South Indian counter); null = generic order. */
  posSectionId: string | null;
  status: string;
  totalAmount: number;
  createdAt: string;
  notes: string | null;
  items: LiveOrderItem[];
  hasNewItems: boolean;
  lastUpdated: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(apiUrl(url), { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function rawToOrder(raw: any): LiveOrder | null {
  const ot = normalizeOrderType(raw.orderType, false);
  if (ot !== "delivery" && ot !== "pickup") return null;
  return {
    id:           raw.id,
    orderNumber:  raw.orderNumber ?? `#${raw.id}`,
    customerName: raw.customerName ?? null,
    customerPhone: raw.customerPhone ?? null,
    orderType:    ot,
    posSectionId: raw.posSectionId ?? null,
    status:       raw.status ?? "pending",
    totalAmount:  parseFloat(String(raw.totalAmount ?? "0")),
    createdAt:    raw.createdAt,
    notes:        raw.notes ?? null,
    items: (raw.items ?? []).map((i: any): LiveOrderItem => ({
      id:                  i.id,
      menuItemId:          i.menuItemId,
      name:                i.name ?? i.menuItemName ?? "Unknown Item",
      quantity:            i.quantity,
      size:                i.size ?? null,
      specialInstructions: i.specialInstructions ?? null,
    })),
    hasNewItems:  false,
    lastUpdated:  Date.now(),
  };
}

// ── Module-level cache — survives unmount/remount ─────────────────────────────
let _ordersCache: LiveOrder[] | null = null;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLiveOrders() {
  const [orders, setOrders]   = useState<LiveOrder[]>(_ordersCache ?? []);
  const [isLoading, setIsLoading] = useState(_ordersCache === null);

  const { lastMessage, connectionStatus } = useRealtime();
  const mountedRef  = useRef(true);
  const loadingRef  = useRef(false);
  const ordersRef   = useRef<LiveOrder[]>([]);
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // ── Full load ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const rawList = await apiFetch<any[]>("/api/orders");

      // Delivery / pickup / section-counter orders: keep every OPEN (unsettled) order regardless
      // of age so nothing unfinished ever hides. Settled ("served") orders leave immediately —
      // they remain visible on the Orders/Billing pages. Cancelled orders never show.
      // (Settling an order sets status = "served"; see POST /api/orders/:id/payment.)
      const candidates = rawList.filter((o: any) => {
        const ot = normalizeOrderType(o.orderType, false);
        if (ot !== "delivery" && ot !== "pickup") return false;
        return o.status !== "cancelled" && o.status !== "served";
      });

      // Fetch full detail (includes items array)
      const settled = await Promise.all(
        candidates.map(async (o: any) => {
          try {
            const detail = await apiFetch<any>(`/api/orders/${o.id}`);
            return rawToOrder(detail);
          } catch {
            return rawToOrder(o);
          }
        })
      );

      if (mountedRef.current) {
        const valid = settled.filter((o): o is LiveOrder => o !== null);
        const sorted = valid.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        _ordersCache = sorted;
        setOrders(sorted);
        setIsLoading(false);
      }
    } catch {
      if (mountedRef.current) setIsLoading(false);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadAll();
    const id = setInterval(loadAll, 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [loadAll]);

  // ── Auto-clear hasNewItems after 6 s ──────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setOrders(prev => {
        if (!prev.some(o => o.hasNewItems)) return prev;
        return prev.map(o =>
          o.hasNewItems && now - o.lastUpdated > 6_000
            ? { ...o, hasNewItems: false }
            : o
        );
      });
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  // ── WebSocket real-time updates ───────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as any;

    if (msg.type === "NEW_ORDER") {
      const { order } = msg;
      if (!order) return;
      const ot = normalizeOrderType(order.orderType, false);
      if (ot !== "delivery" && ot !== "pickup") return;

      (async () => {
        try {
          const full = await apiFetch<any>(`/api/orders/${order.id}`);
          if (!mountedRef.current) return;
          const newOrder = rawToOrder(full);
          if (!newOrder) return;
          newOrder.hasNewItems  = true;
          newOrder.lastUpdated  = Date.now();
          setOrders(prev => [newOrder, ...prev.filter(o => o.id !== order.id)]);
        } catch { /* silent */ }
      })();
    } else if (msg.type === "ORDER_UPDATE") {
      const { order } = msg;
      if (!order?.id) return;
      // Only process if we're already tracking this order
      if (!ordersRef.current.some(o => o.id === order.id)) return;

      (async () => {
        try {
          const full = await apiFetch<any>(`/api/orders/${order.id}`);
          if (!mountedRef.current) return;
          // Settled/cancelled orders leave the live surfaces immediately
          if (full.status === "served" || full.status === "cancelled") {
            setOrders(prev => prev.filter(o => o.id !== full.id));
            return;
          }
          const updated = rawToOrder(full);
          if (!updated) return;
          updated.hasNewItems = true;
          updated.lastUpdated = Date.now();
          setOrders(prev => prev.map(o => o.id === full.id ? updated : o));
        } catch { /* silent */ }
      })();
    }
  }, [lastMessage, loadAll]);

  // ── Derived slices ────────────────────────────────────────────────────────
  // Section-counter orders (posSectionId set) get their own surface at the section
  // card on the Tables page — they never appear in the generic pickup/delivery rail.
  const deliveryOrders = useMemo(
    () => orders.filter(o => o.orderType === "delivery" && !o.posSectionId),
    [orders]
  );
  const pickupOrders = useMemo(
    () => orders.filter(o => o.orderType === "pickup" && !o.posSectionId),
    [orders]
  );
  const sectionOrders = useMemo(() => {
    const grouped: Record<string, LiveOrder[]> = {};
    for (const o of orders) {
      if (!o.posSectionId) continue;
      (grouped[o.posSectionId] ??= []).push(o);
    }
    return grouped;
  }, [orders]);

  return { deliveryOrders, pickupOrders, sectionOrders, isLoading, connectionStatus, refresh: loadAll };
}
