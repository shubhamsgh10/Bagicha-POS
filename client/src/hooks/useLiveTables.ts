import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveOrderItem {
  id: number;
  orderId: number;
  menuItemId: number;
  name: string;
  quantity: number;
  price: string;
  specialInstructions: string | null;
  size: string | null;
}

export interface LiveOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  orderType: string;
  status: string;
  totalAmount: string;
  taxAmount: string;
  discountAmount: string | null;
  paymentStatus: string;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: LiveOrderItem[];
}

export interface EnrichedTable {
  id: number;
  name: string;
  capacity: number;
  status: string; // free | running | billed
  currentOrderId: number | null;
  section: string;
  order: LiveOrder | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLiveTables() {
  const [tables, setTables] = useState<EnrichedTable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { lastMessage, connectionStatus } = useWebSocket("/ws");

  // Prevents state updates after component unmount
  const mountedRef = useRef(true);
  // Prevents overlapping concurrent loadAll calls
  const loadingRef = useRef(false);

  const loadAll = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const rawTables = await apiFetch<any[]>("/api/tables");

      // Fetch active orders in parallel for tables that have one
      const enriched: EnrichedTable[] = await Promise.all(
        rawTables.map(async (t: any) => {
          if (!t.currentOrderId) return { ...t, order: null };
          try {
            const order = await apiFetch<LiveOrder>(`/api/orders/${t.currentOrderId}`);
            return { ...t, order };
          } catch {
            return { ...t, order: null };
          }
        })
      );

      if (mountedRef.current) {
        setTables(enriched);
        setIsLoading(false);
      }
    } catch {
      if (mountedRef.current) setIsLoading(false);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // Initial load + 30-second auto-refresh fallback
  useEffect(() => {
    mountedRef.current = true;
    loadAll();
    const id = setInterval(loadAll, 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [loadAll]);

  // ── WebSocket PATCH updates ──────────────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as any;

    if (msg.type === "TABLE_UPDATE") {
      // Table status / currentOrderId may have changed — do a full reload
      loadAll();
    } else if (msg.type === "NEW_ORDER" && msg.order?.tableId) {
      // A new order was placed on a table — patch only that table
      const { order, items = [] } = msg;
      setTables(prev =>
        prev.map(t =>
          t.id === order.tableId
            ? {
                ...t,
                status: "running",
                currentOrderId: order.id,
                order: { ...order, items },
              }
            : t
        )
      );
    } else if (msg.type === "ORDER_UPDATE" && msg.order) {
      // An order was updated — patch only the affected table
      const updatedOrder = msg.order;
      setTables(prev =>
        prev.map(t =>
          t.currentOrderId === updatedOrder.id
            ? { ...t, order: t.order ? { ...t.order, ...updatedOrder } : null }
            : t
        )
      );
    }
  }, [lastMessage, loadAll]);

  return { tables, isLoading, connectionStatus, refresh: loadAll };
}
