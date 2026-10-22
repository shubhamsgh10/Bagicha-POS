/**
 * Short-lived, per-process cache of the logged-in principal that passport's deserializeUser
 * resolves on EVERY authenticated request (a `users` row, or a staff member). Without it each API
 * call — including the 5-15s polls from every open screen — paid one extra database round trip just
 * to re-read the same row.
 *
 * Keys are the session's serialized principal key: "u:<id>" for a users row, "sm:<id>" for a
 * staff member (the two tables share an id space — see CLAUDE.md's id-collision note).
 *
 * Freshness: entries live TTL_MS. Writes made through this process call forgetPrincipal() so they
 * apply immediately here; another serverless instance may serve the old row for at most TTL_MS
 * (e.g. a role change or a deleted account takes up to that long to bite there).
 *
 * Each hit returns a shallow copy, so a request that mutates req.user can never leak into others.
 */
export const PRINCIPAL_TTL_MS = 10_000;

type Entry = { at: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();

export function cachedPrincipal<T extends object | undefined>(
  key: string,
  load: () => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  const hit = entries.get(key);
  let value: Promise<T>;
  if (hit && now - hit.at < PRINCIPAL_TTL_MS) {
    value = hit.value as Promise<T>;
  } else {
    value = load();
    entries.set(key, { at: now, value });
    // Never cache a failure: drop the entry so the next request retries the database.
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
  }
  return value.then((v) => (v ? ({ ...v } as T) : v));
}

export function userPrincipalKey(id: number | string): string {
  return `u:${id}`;
}

export function staffPrincipalKey(id: number | string): string {
  return `sm:${id}`;
}

export function forgetPrincipal(key: string): void {
  entries.delete(key);
}

/** Test hook. */
export function forgetAllPrincipals(): void {
  entries.clear();
}
