import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

/** GET /api/local/status on the shop PC's local server (phase 3/4). */
export interface LocalSyncStatus {
  localMode: boolean;
  online?: boolean;
  syncing?: boolean;
  outboxPending?: number;
  problems?: number;
  schemaBlocked?: boolean;
  lastError?: string | null;
  lastPullAt?: string | null;
}

const NOT_LOCAL: LocalSyncStatus = { localMode: false };

/**
 * One probe per page load. A cloud deployment answers 404 -> `{ localMode:false }`, cached forever, and
 * the poll never starts: cloud mode makes no recurring request. Only a local server (localMode:true)
 * is re-read, every 5 s.
 */
export function useLocalSync(): LocalSyncStatus {
  const { data } = useQuery<LocalSyncStatus>({
    queryKey: ["/api/local/status"],
    queryFn: async () => {
      try {
        const res = await fetch(apiUrl("/api/local/status"), { credentials: "include" });
        if (!res.ok) return NOT_LOCAL;
        const body = await res.json();
        return body?.localMode === true ? (body as LocalSyncStatus) : NOT_LOCAL;
      } catch {
        return NOT_LOCAL;
      }
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.localMode ? 5000 : false),
  });
  return data ?? NOT_LOCAL;
}

/** The label + tone the badge shows. Pure so it can be reasoned about (and tested) without React. */
export function syncBadgeState(s: LocalSyncStatus): { tone: "green" | "amber" | "red" | "blue"; label: string } | null {
  if (!s.localMode) return null;
  const waiting = s.outboxPending ?? 0;
  const problems = s.problems ?? 0;
  if (problems > 0) return { tone: "red", label: `${problems} problem${problems === 1 ? "" : "s"}` };
  if (s.online === false) return { tone: "amber", label: waiting > 0 ? `Offline · ${waiting} waiting` : "Offline" };
  if (s.syncing || waiting > 0) return { tone: "blue", label: "Syncing…" };
  return { tone: "green", label: "Online" };
}
