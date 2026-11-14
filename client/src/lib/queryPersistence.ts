import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { idbStorage } from "./idbStorage";
import { shouldPersistQuery, PERSIST_MAX_AGE_MS, persistBuster } from "./persistPolicy";

/** Desktop-app only (see main.tsx). Bump to invalidate every saved copy; the client has no build-version constant. */
const CACHE_VERSION = "1";

const persister = createAsyncStoragePersister({ storage: idbStorage, key: "bagicha-query-cache", throttleTime: 1000 });

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: persistBuster(CACHE_VERSION),
  dehydrateOptions: { shouldDehydrateQuery: (q) => shouldPersistQuery(q.queryKey, q.state.status, q.state.data !== undefined) },
};

/** Wipes the saved copy (logout). Never throws. */
export async function clearPersistedCache(): Promise<void> {
  try { await persister.removeClient(); } catch (e) { console.warn("[cache] clear failed", e); }
}
