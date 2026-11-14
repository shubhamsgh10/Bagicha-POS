/**
 * Tiny async key/value store on IndexedDB (db `bagicha-cache`, store `kv`) for the query
 * persister. Never throws and never blocks the app: any failure (private mode, quota,
 * blocked upgrade) logs a warning and resolves null / no-op.
 */
const DB_NAME = "bagicha-cache";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { console.warn("[cache] IndexedDB open failed", req.error); resolve(null); };
        req.onblocked = () => { console.warn("[cache] IndexedDB open blocked"); resolve(null); };
      } catch (e) {
        console.warn("[cache] IndexedDB unavailable", e);
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => { console.warn("[cache] IndexedDB request failed", req.error); resolve(null); };
        tx.onabort = () => { console.warn("[cache] IndexedDB transaction aborted", tx.error); resolve(null); };
      } catch (e) {
        console.warn("[cache] IndexedDB error", e);
        resolve(null);
      }
    });
  } catch (e) {
    console.warn("[cache] IndexedDB error", e);
    return null;
  }
}

export const idbStorage = {
  async getItem(key: string): Promise<string | null> {
    const v = await run<unknown>("readonly", (s) => s.get(key));
    return typeof v === "string" ? v : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await run("readwrite", (s) => s.put(value, key));
  },
  async removeItem(key: string): Promise<void> {
    await run("readwrite", (s) => s.delete(key));
  },
};
