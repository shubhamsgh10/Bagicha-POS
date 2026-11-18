/**
 * Which React Query results the desktop app saves to disk (IndexedDB) so screens show
 * instantly at startup and survive an outage read-only. An ALLOW-list: anything not named
 * here (reports, payroll/salaries, automation, WhatsApp, audit, whole order history, new
 * endpoints) is never written to disk.
 */

/** Saved copies older than this are discarded on startup. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Root paths (first element of the query key) that may be persisted. */
// Accepted tradeoff: /api/auth/me and the customer directory (names/phones) are saved unencrypted;
// shop PC only, encryption at rest planned for phase 3.
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

// `hasData`: a failed refetch (offline) turns a loaded query into "error" but keeps its data;
// that data must stay saved or a second restart during the same outage comes up empty.
// `isNull`: a null result is never a real list/record - it is what a 401 used to resolve to. Saved,
// it was restored on every start next to a signed-in /api/auth/me and crashed the screen (17 Nov
// 2026). Only /api/auth/me may be null ("signed out").
export function shouldPersistQuery(queryKey: readonly unknown[], status: string, hasData = status === "success", isNull = false): boolean {
  if (status !== "success" && !(status === "error" && hasData)) return false;
  const root = queryKey[0];
  if (typeof root !== "string" || !ALLOWED_ROOTS.has(root)) return false;
  if (isNull && root !== "/api/auth/me") return false;
  // Whole order history is large and rarely needed offline.
  if (root === "/api/orders" && queryKey[1] === "all") return false;
  return true;
}

/** Changing the app version invalidates every saved copy (shape may have changed). */
export function persistBuster(appVersion: string): string {
  return `bagicha-cache-v1:${appVersion}`;
}
