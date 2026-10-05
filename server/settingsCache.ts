/**
 * settingsCache.ts — pure (no DB, no express) cache for the restaurant-settings singleton.
 *
 * WHY THIS EXISTS. The settings row is the single source of truth for tax rate, printers, GST,
 * bill/KOT print layout and POS sections. Each serverless instance used to read it ONCE at cold
 * start; if that one read failed (a transient DB blip is routine on Vercel → Supabase pooler) the
 * instance silently fell back to `DEFAULT_SETTINGS` for the rest of its life — 18% tax, no
 * printers, no GST number. Orders saved on such an instance were priced at 18% instead of 5%, and
 * its bills/KOTs found "no printer configured" and bounced to a browser print window. Which
 * instance served a tap was luck, so it looked random.
 *
 * THE RULE THIS ENFORCES: a value is only ever "live" if it was read from (or authoritatively
 * written to) the DB. The fallback is readable (so synchronous callers and scripts never crash)
 * but never live, and anything that prices or prints must go through `getLive()` / `ensureLive()`,
 * which refuse (503) rather than serve the fallback.
 */

export class SettingsUnavailableError extends Error {
  readonly status = 503;
  constructor(message = "Restaurant settings could not be loaded — please try again in a moment") {
    super(message);
    this.name = "SettingsUnavailableError";
  }
}

export interface SettingsCacheOptions<T> {
  /** Reads the authoritative value (the DB row). MUST throw on any failure. */
  load: () => Promise<T>;
  /** Served by get() until a load succeeds. Never counts as live. */
  fallback: () => T;
  /** Load attempts when the cache is not live (boot / recovery). Default 3. */
  attempts?: number;
  /** Sleep before attempt N+1, in ms; the last entry repeats. Default [250, 750]. */
  backoffMs?: number[];
  /** Hard cap per attempt so a hung DB can't hold a request/boot forever. Default 4000. */
  attemptTimeoutMs?: number;
  /** A live value older than this is re-read on the next ensureLive(). Default 60_000. */
  maxAgeMs?: number;
  /** After a failed re-read of a live value, wait this long before trying again. Default 10_000. */
  staleRetryMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, err?: unknown) => void;
}

export interface SettingsCache<T> {
  /** Current value; the fallback if nothing has ever loaded. Never throws. */
  get(): T;
  /** True only after a successful load or an authoritative set(). */
  isLive(): boolean;
  /** The live value, or throws SettingsUnavailableError. Use anywhere money or printing depends on it. */
  getLive(): T;
  /** Authoritative write (e.g. just saved to the DB): marks live + fresh and wins over any in-flight read. */
  set(value: T): void;
  /** Cosmetic in-place update (e.g. a counter): does NOT change liveness, freshness or ordering. */
  patch(update: (current: T) => T): void;
  /** Forget everything (bench / tests). */
  reset(): void;
  /** Re-read from the DB. Never throws; resolves true on success. Concurrent calls share one load. */
  refresh(opts?: { attempts?: number }): Promise<boolean>;
  /** refresh(), then run `afterLoad` in its OWN try/catch so it can never discard a loaded value. */
  init(afterLoad?: (value: T) => Promise<void>): Promise<boolean>;
  /** Resolve once the cache is live and fresh; throws SettingsUnavailableError if it can't be. */
  ensureLive(): Promise<void>;
}

/** One-line description of a failure — a DB outage retried per request must not print a stack trace each time. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

export function createSettingsCache<T>(opts: SettingsCacheOptions<T>): SettingsCache<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const backoff = opts.backoffMs && opts.backoffMs.length > 0 ? opts.backoffMs : [250, 750];
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? 4_000;
  const maxAgeMs = opts.maxAgeMs ?? 60_000;
  const staleRetryMs = opts.staleRetryMs ?? 10_000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = opts.log ?? ((message: string, err?: unknown) => (err === undefined ? console.warn(message) : console.warn(message, err)));

  let value: T | undefined;
  let hasValue = false;
  let live = false;
  let loadedAt = 0;
  let nextStaleAttemptAt = 0;
  // Bumped by every authoritative set()/reset(); a read that started before the bump is older
  // than that write and must not be applied.
  let generation = 0;
  let inflight: Promise<boolean> | null = null;
  let fallbackValue: T | undefined;
  let hasFallback = false;

  /** One bounded load attempt. */
  const attemptLoad = async (): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => opts.load())(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`settings load timed out after ${attemptTimeoutMs}ms`)), attemptTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const doRefresh = (maxAttempts: number): Promise<boolean> => {
    if (inflight) return inflight;
    const startedAt = generation;
    const p = (async () => {
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const loaded = await attemptLoad();
          if (generation === startedAt) {
            value = loaded;
            hasValue = true;
            live = true;
            loadedAt = now();
          }
          // else: a set() landed while we were reading — that write is newer than this read,
          // so keep it (the cache is already live because set() made it so).
          return true;
        } catch (err) {
          log(`[settings] load attempt ${i + 1}/${maxAttempts} failed — ${describeError(err)}`);
          if (i < maxAttempts - 1) await sleep(backoff[Math.min(i, backoff.length - 1)]);
        }
      }
      return false;
    })().finally(() => {
      inflight = null;
    });
    inflight = p;
    return p;
  };

  return {
    get() {
      if (hasValue) return value as T;
      if (!hasFallback) {
        fallbackValue = opts.fallback();
        hasFallback = true;
      }
      return fallbackValue as T;
    },

    isLive: () => live,

    getLive() {
      if (!live) throw new SettingsUnavailableError();
      return value as T;
    },

    set(next) {
      value = next;
      hasValue = true;
      live = true;
      loadedAt = now();
      nextStaleAttemptAt = 0;
      generation++;
    },

    patch(update) {
      if (!hasValue) return;
      value = update(value as T);
    },

    reset() {
      value = undefined;
      hasValue = false;
      live = false;
      loadedAt = 0;
      nextStaleAttemptAt = 0;
      generation++;
    },

    refresh: (o) => doRefresh(Math.max(1, o?.attempts ?? attempts)),

    async init(afterLoad) {
      const ok = await doRefresh(attempts);
      if (ok && afterLoad) {
        try {
          await afterLoad(value as T);
        } catch (err) {
          log(`[settings] post-load step failed — loaded settings are kept (${describeError(err)})`);
        }
      }
      return ok;
    },

    async ensureLive() {
      const t = now();
      if (live) {
        if (t - loadedAt < maxAgeMs) return;
        if (t < nextStaleAttemptAt) return;
        // Live but old: one quick re-read to pick up edits made on other instances. A failure here
        // is harmless — the last real value keeps serving — so never delay the request retrying.
        const ok = await doRefresh(1);
        if (!ok && live) {
          nextStaleAttemptAt = now() + staleRetryMs;
          log("[settings] refresh failed — serving the last known-good settings");
        }
        return;
      }
      const ok = await doRefresh(attempts);
      if (!ok && !live) throw new SettingsUnavailableError();
    },
  };
}
