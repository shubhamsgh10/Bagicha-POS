/**
 * Which React Query results the desktop app saves to disk (IndexedDB) so screens show
 * instantly at startup and survive an outage read-only. An ALLOW-list: anything not named
 * here (reports, payroll/salaries, automation, WhatsApp, audit, whole order history, new
 * endpoints) is never written to disk.
 */

/** Saved copies older than this are discarded on startup. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Root paths (first element of the query key) that may be persisted. */
const ALLOWED_ROOTS = new Set<string>([
  "/api/auth/me",
  "/api/menu",
  "/api/categories",
  "/api/tables",
  "/api/settings",
  "/api/staff-members",
  "/api/live-status",
  "/api/kot",
  "/api/orders", // lists per business day + single orders; ["/api/orders","all"] excluded below
  "/api/orders/hold",
  "/api/orders/customers",
]);

export function shouldPersistQuery(queryKey: readonly unknown[], status: string): boolean {
  if (status !== "success") return false;
  const root = queryKey[0];
  if (typeof root !== "string" || !ALLOWED_ROOTS.has(root)) return false;
  // Whole order history is large and rarely needed offline.
  if (root === "/api/orders" && queryKey[1] === "all") return false;
  return true;
}

/** Changing the app version invalidates every saved copy (shape may have changed). */
export function persistBuster(appVersion: string): string {
  return `bagicha-cache-v1:${appVersion}`;
}
