/**
 * Which React Query caches a realtime event makes stale. Pure — used by
 * client/src/hooks/RealtimeProvider.tsx, locked by scripts/verify-egress-helpers.ts.
 *
 * This replaces a blanket `queryClient.invalidateQueries()` every 60s in App.tsx, which re-ran
 * every query on every open screen whether or not anything had changed (including whole-history
 * order lists). Now an order/table/KOT change on ANY device — the server publishes an event for
 * each — refreshes exactly the order-derived queries currently on screen, and nothing runs while
 * the restaurant is idle.
 */

/** Events that mean orders, tables or KOTs changed somewhere. */
export const ORDER_EVENT_TYPES: readonly string[] = [
  "NEW_ORDER", "ORDER_UPDATE", "TABLE_UPDATE", "KOT_UPDATE", "NEW_DELIVERY_ORDER",
];

/** Query-key roots whose data is derived from orders (sales, stock and reports move with them). */
const ORDER_DERIVED_ROOTS = [
  "/api/orders", "/api/live-status", "/api/tables", "/api/kot", "/api/dashboard",
  "/api/reports", "/api/inventory", "/api/menu/sold-today",
];

/**
 * Never refreshed per event: whole-history lists ("All Dates" keeps itself current incrementally,
 * see shared/orderHistorySync.ts) and the customer lists, which change slowly and refresh on mount.
 */
const EXCLUDED_ROOTS = ["/api/orders/customers", "/api/orders/customer-history"];

const underRoot = (key: string, root: string) =>
  key === root || key.startsWith(root + "/") || key.startsWith(root + "?");

export function isOrderEvent(type: string | undefined): boolean {
  return !!type && ORDER_EVENT_TYPES.includes(type);
}

export function isOrderDerivedKey(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  if (typeof root !== "string") return false;
  if (queryKey[1] === "all") return false;
  if (EXCLUDED_ROOTS.some((r) => underRoot(root, r))) return false;
  return ORDER_DERIVED_ROOTS.some((r) => underRoot(root, r));
}
