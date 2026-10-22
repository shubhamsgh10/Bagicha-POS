/**
 * Stale-while-revalidate cache for the desktop host's "does this Windows printer queue exist on THIS
 * machine?" check (see canExecuteLocallyVerified in printStationCore.ts). The real check spawns a fresh
 * PowerShell for `Get-Printer` — measured ~1.0–1.2 s — and it runs before every print job is claimed.
 * Remembering a "yes" for only 30 s meant ~95% of prints waited that second just to re-learn something
 * that almost never changes.
 *
 * Rules (pure — no window, no Electron; `check` and `now` are injected so it is unit-tested):
 *   - answered "yes" less than `freshMs` ago           → instant yes, nothing to do.
 *   - answered "yes" between `freshMs` and `maxStaleMs` → instant yes, and ONE background re-check.
 *   - never verified, or older than `maxStaleMs`        → wait for a real check.
 *   - a "no" is NEVER cached and never served stale. The check exists to stop a second PC that has no such
 *     queue from winning the claim race for a printer it can't drive; a cached "no" would also starve a
 *     legitimate job with no automatic retry. If a background re-check finds the queue gone, the cached
 *     "yes" is dropped, so the very next call waits for a real answer.
 *   - concurrent callers share one in-flight check.
 */
export interface QueueCheckCacheOptions {
  /** The real check. Should not reject (the caller fails open); a rejection is swallowed in the background. */
  check: (queue: string) => Promise<boolean>;
  now?: () => number;
  /** A "yes" younger than this is served with no re-check. Default 30 s. */
  freshMs?: number;
  /** A "yes" older than this is not trusted at all. Default 12 h. */
  maxStaleMs?: number;
}

export interface QueueCheckCache {
  exists(queue: string): Promise<boolean>;
  /** Start a background verification if the queue isn't verified or its answer is stale. */
  prewarm(queue: string): void;
}

export function createQueueCheckCache(opts: QueueCheckCacheOptions): QueueCheckCache {
  const now = opts.now ?? Date.now;
  const freshMs = opts.freshMs ?? 30_000;
  const maxStaleMs = opts.maxStaleMs ?? 12 * 60 * 60 * 1000;

  const verifiedAt = new Map<string, number>();
  const inFlight = new Map<string, Promise<boolean>>();

  /** One shared check per queue; records the outcome ("no" clears the entry). */
  const run = (queue: string): Promise<boolean> => {
    let p = inFlight.get(queue);
    if (p) return p;
    p = opts.check(queue).then((exists) => {
      if (exists) verifiedAt.set(queue, now());
      else verifiedAt.delete(queue);
      return exists;
    });
    inFlight.set(queue, p);
    // Clear on settle (either way) without creating an unhandled rejection of its own.
    p.then(() => inFlight.delete(queue), () => inFlight.delete(queue));
    return p;
  };

  const refreshInBackground = (queue: string) => {
    run(queue).catch(() => { /* keep serving the last known "yes"; the next call retries */ });
  };

  const ageOf = (queue: string): number | null => {
    const at = verifiedAt.get(queue);
    return at === undefined ? null : now() - at;
  };

  return {
    async exists(queue) {
      const age = ageOf(queue);
      if (age !== null && age < freshMs) return true;
      if (age !== null && age < maxStaleMs) {
        refreshInBackground(queue);
        return true;
      }
      return run(queue);
    },

    prewarm(queue) {
      const age = ageOf(queue);
      if (age !== null && age < freshMs) return;
      refreshInBackground(queue);
    },
  };
}
