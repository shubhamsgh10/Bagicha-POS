import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/api";
import { deltaSince, mergeOrderRows } from "@shared/orderHistorySync";

/** Cache key of the whole order history (Orders → "All Dates", Billing → "Show all"). */
export const ORDER_HISTORY_KEY = ["/api/orders", "all"] as const;

const DELTA_INTERVAL_MS = 60_000;     // ask for changed rows this often while the view is visible
const FULL_RELOAD_MS = 10 * 60_000;   // and reload everything this often (deletes, unstamped writes)

/**
 * Keeps the cached whole-history order list current while `enabled`, without re-downloading it:
 * every minute it fetches only the rows whose updated_at moved (`?updatedSince=`) and merges them
 * in; every 10 minutes it reloads the lot. Paused while the page is hidden.
 *
 * "All Dates" used to re-fetch the entire history (~0.5 MB and growing) every minute for as long
 * as it stayed open. Saves on the page itself still invalidate the key and reload it immediately.
 */
export function useOrderHistorySync(enabled: boolean): void {
  // useQueryClient(), not the module import — see App.tsx's Router for why.
  const queryClient = useQueryClient();
  const lastFullRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;
    lastFullRef.current = Date.now();
    let busy = false;

    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      const current = queryClient.getQueryData<any[]>(ORDER_HISTORY_KEY);
      if (!current) return; // the initial load hasn't landed yet
      busy = true;
      try {
        const since = deltaSince(current);
        if (!since || Date.now() - lastFullRef.current >= FULL_RELOAD_MS) {
          lastFullRef.current = Date.now();
          await queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_KEY, exact: true });
          return;
        }
        const changed = await apiJson<any[]>(`/api/orders?updatedSince=${encodeURIComponent(since.toISOString())}`);
        // Re-read: a save may have reloaded the list while the delta was in flight.
        const latest = queryClient.getQueryData<any[]>(ORDER_HISTORY_KEY);
        if (!latest) return;
        const merged = mergeOrderRows(latest, changed);
        if (merged !== latest) queryClient.setQueryData(ORDER_HISTORY_KEY, merged);
      } catch {
        // Silent like every other background refresh; the next tick retries.
      } finally {
        busy = false;
      }
    };

    const id = setInterval(tick, DELTA_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, queryClient]);
}
