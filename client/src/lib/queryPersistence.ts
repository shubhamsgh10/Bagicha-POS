import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions, PersistedClient } from "@tanstack/react-query-persist-client";
import { idbStorage } from "./idbStorage";
import { shouldPersistQuery, PERSIST_MAX_AGE_MS, persistBuster } from "./persistPolicy";

/**
 * Desktop-app only (see main.tsx). Bump to invalidate every saved copy; the client has no build-version constant.
 * "2" (1.0.44): copies saved by 1.0.42/1.0.43 can hold a `null` tables list (a 401 used to resolve to null);
 * 1.0.43 restored one on the shop PC at 20:25 on 18 Nov 2026 and crashed on start (client.error 8TE7M-EJ99).
 */
const CACHE_VERSION = "2";

/**
 * Reads a saved copy, dropping anything the persist policy would not save today (a null list, a root
 * that has since left the allow-list). A saved copy is written by whatever build ran last, so restore
 * must not trust it to follow the current rules. Unreadable JSON -> empty (the app starts fresh).
 */
export function deserializeSavedCache(cached: string): PersistedClient {
  const parsed = JSON.parse(cached) as PersistedClient;
  const state = parsed?.clientState;
  if (state && Array.isArray(state.queries)) {
    state.queries = state.queries.filter((q) =>
      shouldPersistQuery(q.queryKey, q.state.status, q.state.data !== undefined, q.state.data === null),
    );
  }
  return parsed;
}

const persister = createAsyncStoragePersister({
  storage: idbStorage,
  key: "bagicha-query-cache",
  throttleTime: 1000,
  deserialize: deserializeSavedCache,
});

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: persistBuster(CACHE_VERSION),
  dehydrateOptions: { shouldDehydrateQuery: (q) => shouldPersistQuery(q.queryKey, q.state.status, q.state.data !== undefined, q.state.data === null) },
};

/** Wipes the saved copy (logout). Never throws. */
export async function clearPersistedCache(): Promise<void> {
  try { await persister.removeClient(); } catch (e) { console.warn("[cache] clear failed", e); }
}
