import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiveItem {
  id: number;
  menuItemId: number;
  name: string;
  quantity: number;
  isNew: boolean;
  newAt: number | null;
  specialInstructions: string | null;
  size: string | null;
}

export type OrderType = "dine-in" | "delivery" | "pickup";

export interface LiveTableState {
  id: number;
  name: string;
  capacity: number;
  status: string; // free | running | billed
  section: string;
  currentOrderId: number | null;
  orderNumber: string | null;
  orderType: OrderType;
  startedAt: string | null;
  items: LiveItem[];
  hasNewItems: boolean;
  lastUpdated: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise any raw orderType string → canonical OrderType */
export function normalizeOrderType(raw: string | null | undefined, isTableOrder: boolean): OrderType {
  if (!raw) return isTableOrder ? "dine-in" : "pickup";
  const v = raw.toLowerCase().replace(/[-_\s]/g, "");
  if (v.includes("deliv"))                               return "delivery";
  if (v.includes("pickup") || v.includes("take"))       return "pickup";
  return "dine-in";
}

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function rawToLiveItem(raw: any, isNew = false): LiveItem {
  return {
    id: raw.id,
    menuItemId: raw.menuItemId,
    name: raw.name ?? "Unknown Item",
    quantity: raw.quantity,
    isNew,
    newAt: isNew ? Date.now() : null,
    specialInstructions: raw.specialInstructions ?? null,
    size: raw.size ?? null,
  };
}

/**
 * Compare previous items vs incoming raw items — marks genuinely new ones.
 *
 * KEY: we key by menuItemId+size, NOT by DB id.
 * Reason: the server calls deleteOrderItemsByOrderId then re-inserts all items
 * on every save (PUT /api/orders/:id/items), so every item gets a fresh DB id
 * on each update. Using DB id would mark EVERY item as new on every save.
 * menuItemId+size is stable — it only changes when a truly new dish is added.
 */
function diffItems(
  prevItems: LiveItem[],
  newRaw: any[]
): { items: LiveItem[]; hasAnyNew: boolean } {
  const stableKey = (menuItemId: number, size: string | null) =>
    `${menuItemId}|${size ?? ""}`;

  const prevMap = new Map(prevItems.map(i => [stableKey(i.menuItemId, i.size), i]));
  let hasAnyNew = false;

  const items: LiveItem[] = newRaw.map((raw: any) => {
    const key = stableKey(raw.menuItemId, raw.size ?? null);
    const prev = prevMap.get(key);

    if (!prev) {
      // Genuinely new dish added to the order
      hasAnyNew = true;
      return rawToLiveItem(raw, true);
    }

    if (raw.quantity > prev.quantity) {
      // Same dish but quantity increased — treat as updated
      hasAnyNew = true;
      return { ...rawToLiveItem(raw, true) };
    }

    // Same dish, same or lower quantity — preserve the existing isNew window
    return {
      ...rawToLiveItem(raw, false),
      isNew: prev.isNew,
      newAt: prev.newAt,
    };
  });

  const finalHasNew = hasAnyNew || items.some(i => i.isNew);
  return { items, hasAnyNew: finalHasNew };
}

function buildTableState(table: any, order: any | null): LiveTableState {
  const items: LiveItem[] = order?.items?.map((i: any) => rawToLiveItem(i)) ?? [];
  return {
    id: table.id,
    name: table.name,
    capacity: table.capacity,
    status: table.status,
    section: table.section ?? "inner",
    currentOrderId: table.currentOrderId ?? null,
    orderNumber: order?.orderNumber ?? null,
    orderType: normalizeOrderType(order?.orderType, !!table.currentOrderId),
    startedAt: order?.createdAt ?? null,
    items,
    hasNewItems: false,
    lastUpdated: Date.now(),
  };
}

// ── Sound alert ───────────────────────────────────────────────────────────────

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.28);
  } catch {
    // Audio may be blocked — silently ignore
  }
}

// ── Module-level cache — survives unmount/remount ─────────────────────────────
let _tablesCache: LiveTableState[] | null = null;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLiveTableOperations() {
  const [tables, setTables] = useState<LiveTableState[]>(_tablesCache ?? []);
  const [isLoading, setIsLoading] = useState(_tablesCache === null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const { lastMessage, connectionStatus } = useWebSocket("/ws");
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Mirror of `tables` kept in a ref so async handlers can read the
  // pre-fetch snapshot without being in the useEffect dependency array.
  const tablesRef = useRef<LiveTableState[]>([]);
  useEffect(() => { tablesRef.current = tables; }, [tables]);

  const maybeSound = useCallback(() => {
    if (soundEnabledRef.current) playBeep();
  }, []);

  // ── Initial full load ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const rawTables = await apiFetch<any[]>("/api/tables");
      const states: LiveTableState[] = await Promise.all(
        rawTables.map(async (t: any) => {
          if (!t.currentOrderId) return buildTableState(t, null);
          try {
            const order = await apiFetch<any>(`/api/orders/${t.currentOrderId}`);
            return buildTableState(t, order);
          } catch {
            return buildTableState(t, null);
          }
        })
      );
      if (mountedRef.current) {
        // Merge: carry over still-active isNew flags so TABLE_UPDATE
        // (which triggers loadAll) doesn't wipe highlights mid-animation.
        // Use tablesRef (mirror of current state) so we can capture the result
        // for the module-level cache without a functional setState.
        const prevMap = new Map(tablesRef.current.map(t => [t.id, t]));
        const now = Date.now();
        const merged = states.map(newState => {
          const prevState = prevMap.get(newState.id);
          if (!prevState?.hasNewItems) return newState;
          // Re-apply by menuItemId+size (IDs are re-generated on every save)
          const prevItemMap = new Map(
            prevState.items.map(i => [`${i.menuItemId}|${i.size ?? ""}`, i])
          );
          const items = newState.items.map(item => {
            const key = `${item.menuItemId}|${item.size ?? ""}`;
            const prevItem = prevItemMap.get(key);
            if (prevItem?.isNew && prevItem.newAt && now - prevItem.newAt < 6_000) {
              return { ...item, isNew: true, newAt: prevItem.newAt };
            }
            return item;
          });
          return { ...newState, items, hasNewItems: items.some(i => i.isNew) };
        });
        _tablesCache = merged;
        setTables(merged);
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

  // ── Auto-clear isNew flags after 6 seconds ─────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTables(prev => {
        if (!prev.some(t => t.hasNewItems)) return prev; // nothing to clear
        return prev.map(t => {
          if (!t.hasNewItems) return t;
          const items = t.items.map(item =>
            item.isNew && item.newAt && now - item.newAt > 6_000
              ? { ...item, isNew: false, newAt: null }
              : item
          );
          const hasNewItems = items.some(i => i.isNew);
          return { ...t, items, hasNewItems };
        });
      });
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  // ── WebSocket diff-based updates ───────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as any;

    if (msg.type === "TABLE_UPDATE") {
      // Table status or currentOrderId changed — reload cleanly
      loadAll();
    } else if (msg.type === "NEW_ORDER" && msg.order?.tableId) {
      const { order, items: rawItems = [] } = msg;
      // Mark every item on a brand-new order as NEW
      const newItems = rawItems.map((i: any) => rawToLiveItem(i, true));
      setTables(prev =>
        prev.map(t =>
          t.id === order.tableId
            ? {
                ...t,
                status: "running",
                currentOrderId: order.id,
                orderNumber: order.orderNumber,
                orderType: normalizeOrderType(order.orderType, !!order.tableId),
                startedAt: order.createdAt,
                items: newItems,
                hasNewItems: newItems.length > 0,
                lastUpdated: Date.now(),
              }
            : t
        )
      );
      // Also trigger a full-order fetch so items get proper names
      // (WS payload items come from req.body and may lack resolved names)
      if (order.id) {
        (async () => {
          try {
            const fullOrder = await apiFetch<any>(`/api/orders/${order.id}`);
            if (!mountedRef.current) return;
            setTables(prev =>
              prev.map(t => {
                if (t.id !== order.tableId) return t;
                // Merge: preserve isNew flags on the now-named items
                const prevItemMap = new Map(t.items.map(i => [`${i.menuItemId}|${i.size ?? ""}`, i]));
                const items = (fullOrder.items ?? []).map((raw: any) => {
                  const key = `${raw.menuItemId}|${raw.size ?? ""}`;
                  const prev = prevItemMap.get(key);
                  if (prev?.isNew && prev.newAt && Date.now() - prev.newAt < 6_000) {
                    return { ...rawToLiveItem(raw), isNew: true, newAt: prev.newAt };
                  }
                  return rawToLiveItem(raw, !prev); // new if not in prev
                });
                return { ...t, items, hasNewItems: items.some((i: LiveItem) => i.isNew) };
              })
            );
          } catch { /* silent */ }
        })();
      }
      if (rawItems.length > 0) maybeSound();
    } else if (msg.type === "ORDER_UPDATE" && msg.order) {
      const updatedOrder = msg.order;
      if (!updatedOrder.id) return;

      // ── Snapshot items NOW (before any async gap) ──────────────────
      // If loadAll() fires while we await the fetch below, `prev.items`
      // inside setTables would already contain the new items with
      // isNew:false, making the diff find nothing. Snapshotting here
      // captures the TRUE pre-update baseline.
      const preUpdateItems = new Map<number, LiveItem[]>(
        tablesRef.current
          .filter(t => t.currentOrderId === updatedOrder.id)
          .map(t => [t.id, t.items])
      );

      (async () => {
        try {
          const fullOrder = await apiFetch<any>(`/api/orders/${updatedOrder.id}`);
          if (!mountedRef.current) return;

          setTables(prev =>
            prev.map(t => {
              if (t.currentOrderId !== updatedOrder.id) return t;
              // Use snapshotted baseline — not t.items which may have been
              // refreshed by a concurrent loadAll() during the await above.
              const baseline = preUpdateItems.get(t.id) ?? t.items;
              const { items, hasAnyNew } = diffItems(baseline, fullOrder.items ?? []);
              if (hasAnyNew) maybeSound();
              return {
                ...t,
                items,
                hasNewItems: hasAnyNew,
                lastUpdated: Date.now(),
              };
            })
          );
        } catch {
          // Silent — 30s fallback will sync
        }
      })();
    }
  }, [lastMessage, loadAll, maybeSound]);

  return {
    tables,
    isLoading,
    connectionStatus,
    soundEnabled,
    setSoundEnabled,
    refresh: loadAll,
  };
}
