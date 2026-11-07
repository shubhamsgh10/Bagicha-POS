/**
 * Per-process cache of `tables.section` by table id — what the KOT / bill print path uses to print
 * "Inner" / "Outer" next to a table number WITHOUT a database read on every tap (print latency was tuned
 * hard; see CLAUDE.md "Printing"). Pure: the loader is injected (server/tableSections.ts wires the real one),
 * so scripts/verify-table-section.ts runs it without a database.
 *
 *  - The first lookup on an instance waits for one load of the whole `tables` list (~15 rows).
 *  - After that, answers come from memory. Once the map is older than the TTL the OLD value is still answered
 *    immediately while one background reload runs (stale-while-revalidate) — a print never waits on a refresh.
 *  - An unknown id answers null without reloading (a table created on another instance appears within the TTL).
 *  - A failed load keeps the last good map and is not retried for RETRY_AFTER_FAILURE_MS. `get` NEVER throws:
 *    a lookup problem must never fail or delay a print — the ticket just prints without the section.
 *  - A load still unfinished after STUCK_LOAD_MS is treated as lost (a frozen serverless instance never
 *    resumes the promise) and replaced, so one frozen refresh cannot stop all future refreshes.
 *  - forget() drops the map (the next lookup reloads) and discards any load already running, so a stale
 *    answer that was in flight cannot overwrite what an edit just changed.
 */
export const TABLE_SECTION_TTL_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 10_000;
const STUCK_LOAD_MS = 15_000;

export interface TableSectionRow {
  id: number;
  section: string | null;
}

export interface TableSectionCache {
  get(tableId: number | null | undefined): Promise<string | null>;
  forget(): void;
}

export function createTableSectionCache(opts: {
  load: () => Promise<TableSectionRow[]>;
  ttlMs?: number;
  now?: () => number;
}): TableSectionCache {
  const ttl = opts.ttlMs ?? TABLE_SECTION_TTL_MS;
  const now = opts.now ?? Date.now;
  let map: Map<number, string> | null = null;
  let loadedAt = 0;
  let nextTryAt = 0;
  let generation = 0;
  let inflight: { promise: Promise<void>; startedAt: number } | null = null;

  const refresh = (): Promise<void> => {
    const startedAt = now();
    if (inflight && startedAt - inflight.startedAt < STUCK_LOAD_MS) return inflight.promise;
    const myGeneration = generation;
    const promise: Promise<void> = Promise.resolve()
      .then(() => opts.load())
      .then(
        (rows) => {
          if (myGeneration !== generation) return; // forget() ran while this load was in flight
          const next = new Map<number, string>();
          for (const r of rows) if (r.section) next.set(Number(r.id), String(r.section));
          map = next;
          loadedAt = now();
        },
        () => {
          if (myGeneration !== generation) return;
          nextTryAt = now() + RETRY_AFTER_FAILURE_MS; // keep the last good map
        },
      )
      .then(() => {
        if (inflight?.promise === promise) inflight = null;
      });
    inflight = { promise, startedAt };
    return promise;
  };

  return {
    async get(tableId) {
      if (tableId == null) return null;
      const id = Number(tableId);
      if (!Number.isFinite(id)) return null;
      const t = now();
      if (!map) {
        if (t >= nextTryAt) await refresh();
      } else if (t - loadedAt >= ttl && t >= nextTryAt) {
        void refresh();
      }
      return map?.get(id) ?? null;
    },
    forget() {
      generation++;
      map = null;
      loadedAt = 0;
      nextTryAt = 0;
      inflight = null;
    },
  };
}
