/**
 * useCrmProfile.ts
 *
 * Phase 10 — DB-enriched customer profile hook with full backward compatibility.
 *
 * Strategy:
 *   1. Always try to fetch from DB (/api/crm/customers/:key)
 *   2. If DB unavailable (network error / 5xx) → silently fall back to
 *      the existing localStorage data already passed in by the parent
 *   3. If DB returns a profile, merge it with localStorage extras
 *      (DB wins on conflicts)
 *   4. On successful load, auto-sync localStorage extras to DB in the background
 *
 * Existing localStorage helpers (loadExtras, saveExtras, defaultExtra)
 * in CustomerDashboard.tsx are KEPT intact and continue working exactly
 * as before — this hook is purely additive enrichment.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Matches CustomerExtra interface in CustomerDashboard.tsx */
export interface CustomerExtra {
  email:               string;
  dateOfBirth:         string;
  dateOfAnniversary:   string;
  locality:            string;
  gstNo:               string;
  address:             string;
  doNotSendUpdate:     boolean;
  isFavorite:          boolean;
  tags:                string;
  remark:              string;
  notificationEnabled: boolean;
}

export interface CrmSegment {
  segment:        string;
  rfmScore:       number;
  recencyScore:   number;
  frequencyScore: number;
  monetaryScore:  number;
  updatedAt:      string;
}

export interface CrmCustomerData {
  /** Resolved UUID from customers_master */
  id:      string;
  key:     string;
  name:    string;
  phone:   string | null;
  /** DB profile merged with localStorage (DB wins) */
  profile: CustomerExtra | null;
  segment: CrmSegment | null;
}

export interface TimelineEntry {
  id:        number;
  eventType: string;
  metadata:  Record<string, unknown> | null;
  createdAt: string;
}

// ── API response shape ────────────────────────────────────────────────────────

interface CrmApiResponse {
  exists:   boolean;
  id?:      string;
  key?:     string;
  name?:    string;
  phone?:   string | null;
  profile?: Partial<CustomerExtra> | null;
  segment?: CrmSegment | null;
}

// ── Merge helper ──────────────────────────────────────────────────────────────

/** Merges DB profile with localStorage extra. DB wins on non-empty values. */
function mergeExtras(
  localExtra: CustomerExtra | null,
  dbProfile:  Partial<CustomerExtra> | null
): CustomerExtra | null {
  if (!localExtra && !dbProfile) return null;

  const base = localExtra ?? {
    email: "", dateOfBirth: "", dateOfAnniversary: "",
    locality: "", gstNo: "", address: "",
    doNotSendUpdate: false, isFavorite: false,
    tags: "", remark: "", notificationEnabled: true,
  };

  if (!dbProfile) return base;

  return {
    email:               dbProfile.email               || base.email,
    dateOfBirth:         dbProfile.dateOfBirth         || base.dateOfBirth,
    dateOfAnniversary:   dbProfile.dateOfAnniversary   || base.dateOfAnniversary,
    locality:            dbProfile.locality            || base.locality,
    gstNo:               dbProfile.gstNo               || base.gstNo,
    address:             dbProfile.address             || base.address,
    doNotSendUpdate:     dbProfile.doNotSendUpdate     ?? base.doNotSendUpdate,
    isFavorite:          dbProfile.isFavorite          ?? base.isFavorite,
    tags:                dbProfile.tags                || base.tags,
    remark:              dbProfile.remark              || base.remark,
    notificationEnabled: dbProfile.notificationEnabled ?? base.notificationEnabled,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

/**
 * Returns enriched CRM data for a single customer.
 * Falls back gracefully when the DB is unavailable.
 *
 * @param customerKey  customer.key (phone || name)
 * @param localExtra   existing localStorage data for this customer (optional)
 */
export function useCrmProfile(
  customerKey: string | null | undefined,
  localExtra?: CustomerExtra | null
): {
  crmData:   CrmCustomerData | null;
  isLoading: boolean;
  isError:   boolean;
} {
  const enabled = !!customerKey;

  const { data, isLoading, isError } = useQuery<CrmApiResponse>({
    queryKey:  [`/api/crm/customers/${encodeURIComponent(customerKey ?? "")}`],
    enabled,
    staleTime: 30_000,
    retry:     1,   // don't hammer DB if it's down
    // On error the hook returns isError = true; caller falls back to localStorage
  });

  const crmData = useMemo<CrmCustomerData | null>(() => {
    if (!data?.exists) return null;

    const merged = mergeExtras(localExtra ?? null, data.profile ?? null);

    return {
      id:      data.id!,
      key:     data.key!,
      name:    data.name!,
      phone:   data.phone ?? null,
      profile: merged,
      segment: data.segment ?? null,
    };
  }, [data, localExtra]);

  return { crmData, isLoading, isError };
}

// ── Timeline hook ─────────────────────────────────────────────────────────────

/**
 * Fetches the CRM event timeline for a customer.
 * Returns an empty array (not an error) if the DB is unavailable.
 */
export function useCrmTimeline(
  customerKey: string | null | undefined,
  limit = 30
): {
  entries:   TimelineEntry[];
  isLoading: boolean;
  isError:   boolean;
} {
  const enabled = !!customerKey;

  const { data, isLoading, isError } = useQuery<TimelineEntry[]>({
    queryKey:  [`/api/crm/customers/${encodeURIComponent(customerKey ?? "")}/events`, { limit }],
    enabled,
    staleTime: 20_000,
    retry:     1,
  });

  return {
    entries:   data ?? [],
    isLoading: isLoading && enabled,
    isError,
  };
}

// ── Background sync: localStorage → DB ───────────────────────────────────────

/**
 * Syncs the full extras map from localStorage to the DB in the background.
 * Call once on page mount (e.g. in CustomerDashboard).
 * Completely silent — does NOT change any UI state.
 */
export function useCrmExtrasSync(
  extras: Record<string, CustomerExtra>,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled || !Object.keys(extras).length) return;

    // Debounce — only sync after 3 seconds of stability
    const timer = setTimeout(() => {
      fetch("/api/crm/sync-extras", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ extras }),
        credentials: "include",
      })
        .then(r => r.ok && r.json())
        .then(res => res && console.log(`[CRM] Synced ${res.synced} extras to DB`))
        .catch(e => console.warn("[CRM] Extras sync failed (non-fatal):", e));
    }, 3000);

    return () => clearTimeout(timer);
  // Only re-run when the extras object reference changes (not on every render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, Object.keys(extras).length]);
}

// ── Server-side recommendations hook ─────────────────────────────────────────

export interface ServerRecommendation {
  itemId:   number;
  itemName: string;
  score:    number;
  reason:   string;
  count:    number;
}

export interface ServerRecommendationResult {
  topItems:      ServerRecommendation[];
  categoryPrefs: { category: string; count: number }[];
  upsells:       ServerRecommendation[];
  isEmpty:       boolean;
}

/**
 * Fetches server-side AI recommendations for a customer.
 * Returns null while loading or on error (existing client-side recommendations
 * remain visible in that case).
 */
export function useServerRecommendations(
  customerKey: string | null | undefined
): {
  recommendations: ServerRecommendationResult | null;
  isLoading:       boolean;
} {
  const enabled = !!customerKey;

  const { data, isLoading } = useQuery<ServerRecommendationResult>({
    queryKey:  [`/api/crm/recommendations/${encodeURIComponent(customerKey ?? "")}`],
    enabled,
    staleTime: 60_000,
    retry:     1,
  });

  return {
    recommendations: data ?? null,
    isLoading:       isLoading && enabled,
  };
}
