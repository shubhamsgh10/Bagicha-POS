/**
 * Kitchen stations for the KOT: one ticket per chef. A station is a named set of categories (a chef who
 * cooks Main Course + Combos + Indian Bread is ONE station → ONE ticket). Items whose category is in no
 * station print on the General ticket. Separately, a skip list (categories and/or single menu items, e.g.
 * Mineral Water) keeps items off every KOT and off the Kitchen screen — they stay on the bill.
 * Pure: used by server/services/printDispatch.ts (printed KOT), server/routes.ts (Kitchen-screen ticket)
 * and server/printRoutes.ts (preview). Locked by scripts/verify-kot-stations.ts.
 */
import type { KitchenStationsSettings, SkipKotSettings } from "./print/types";

export const GENERAL_STATION_KEY = "general";

export type CategoryOf = (itemId: number) => number | null | undefined;

export function hasSkipRules(skip?: SkipKotSettings | null): boolean {
  return !!skip && ((skip.itemIds?.length ?? 0) > 0 || (skip.categoryIds?.length ?? 0) > 0);
}

/** Open items (negative synthetic ids) always reach the kitchen — they have no category and no menu row. */
export function isKotSkipped(itemId: number, categoryId: number | null | undefined, skip?: SkipKotSettings | null): boolean {
  if (!skip || itemId < 0) return false;
  if ((skip.itemIds ?? []).indexOf(itemId) >= 0) return true;
  return categoryId != null && (skip.categoryIds ?? []).indexOf(categoryId) >= 0;
}

export function filterKotSkipped<T extends { itemId: number }>(items: T[], catOf: CategoryOf, skip?: SkipKotSettings | null): T[] {
  if (!hasSkipRules(skip)) return items;
  return items.filter((i) => !isKotSkipped(i.itemId, catOf(i.itemId), skip));
}

export function stationsActive(cfg?: KitchenStationsSettings | null): boolean {
  return !!cfg?.enabled && (cfg.stations?.length ?? 0) > 0;
}

/** `name` null = stations off: the single ticket carries no station header (today's ticket). */
export interface StationRef {
  key: string;
  name: string | null;
}

export function stationFor(categoryId: number | null | undefined, cfg?: KitchenStationsSettings | null): StationRef {
  if (!stationsActive(cfg)) return { key: GENERAL_STATION_KEY, name: null };
  if (categoryId != null) {
    for (const s of cfg!.stations) {
      if ((s.categoryIds ?? []).indexOf(categoryId) >= 0) return { key: `s:${s.id}`, name: s.name.trim() || "Station" };
    }
  }
  return { key: GENERAL_STATION_KEY, name: cfg!.generalName?.trim() || "General" };
}

function stationRank(key: string, cfg?: KitchenStationsSettings | null): number {
  const list = cfg?.stations ?? [];
  const idx = list.findIndex((s) => `s:${s.id}` === key);
  return idx < 0 ? list.length : idx;
}

export interface StationGroup<N, M, C> {
  key: string;
  name: string | null;
  newItems: N[];
  modifiedItems: M[];
  cancelledItems: C[];
}

/** Splits a KOT's lines into station tickets: station-list order, General last, empty stations dropped. */
export function groupByStation<N extends { itemId: number }, M extends { itemId: number }, C extends { itemId: number }>(
  items: { newItems: N[]; modifiedItems: M[]; cancelledItems: C[] },
  catOf: CategoryOf,
  cfg?: KitchenStationsSettings | null,
): StationGroup<N, M, C>[] {
  const map = new Map<string, StationGroup<N, M, C>>();
  const groupOf = (itemId: number) => {
    const ref = stationFor(catOf(itemId) ?? null, cfg);
    let g = map.get(ref.key);
    if (!g) {
      g = { key: ref.key, name: ref.name, newItems: [], modifiedItems: [], cancelledItems: [] };
      map.set(ref.key, g);
    }
    return g;
  };
  for (const i of items.newItems) groupOf(i.itemId).newItems.push(i);
  for (const i of items.modifiedItems) groupOf(i.itemId).modifiedItems.push(i);
  for (const i of items.cancelledItems) groupOf(i.itemId).cancelledItems.push(i);
  return Array.from(map.values()).sort((a, b) => stationRank(a.key, cfg) - stationRank(b.key, cfg));
}

/**
 * One print job per printer: that printer's station tickets joined in print order (each ticket ends with its
 * own cut). One job keeps the tickets in order, and the print_jobs ids / desktop queue dedup are keyed per
 * printer — four separate jobs for one printer would collide there. `tickets` stays split for the browser
 * fallback, which prints one page per ticket.
 */
export function assemblePrinterJobs<P extends { id: string }>(
  tickets: Array<{ printer: P; buffer: Buffer }>,
): Array<{ printer: P; buffer: Buffer; tickets: Buffer[] }> {
  const by = new Map<string, { printer: P; tickets: Buffer[] }>();
  for (const t of tickets) {
    let e = by.get(t.printer.id);
    if (!e) {
      e = { printer: t.printer, tickets: [] };
      by.set(t.printer.id, e);
    }
    e.tickets.push(t.buffer);
  }
  return Array.from(by.values()).map((e) => ({ printer: e.printer, tickets: e.tickets, buffer: Buffer.concat(e.tickets) }));
}
