import { UserRole } from "@/hooks/useRole";

/**
 * Route permission map.
 * Key   = path prefix (exact or prefix match)
 * Value = roles that MAY access it
 *
 * Paths NOT listed here are accessible to ALL authenticated users.
 * Admin always has full access (handled in canAccess).
 */
const ROUTE_ROLES: Record<string, UserRole[]> = {
  // ── Always admin-only (never configurable via Role Permissions UI) ──
  "/dashboard":      ["admin"],
  "/live-analytics": ["admin"],
  "/reports":        ["admin"],
  "/admin":          ["admin"],
  "/settings":       ["admin"],

  // All other pages (orders, kot, kitchen, customers, menu, inventory,
  // live-tables, etc.) are configurable via Admin > Role Permissions.
  // Their access is enforced by staffAllowedPages / managerAllowedPages
  // in the TopNav filter — not here.
};

/** Safe landing page per role when a redirect is forced. */
export const ROLE_SAFE_REDIRECT: Record<UserRole, string> = {
  admin:   "/dashboard",
  manager: "/tables",
  staff:   "/tables",
  cashier: "/tables",
  kitchen: "/tables",
};

/**
 * Returns true if `role` is allowed to access `path`.
 * Uses longest-prefix matching so /admin/users matches /admin.
 */
export function canAccess(path: string, role: UserRole): boolean {
  if (role === "admin") return true;

  const matched = Object.keys(ROUTE_ROLES)
    .filter(k => path === k || path.startsWith(k + "/"))
    .sort((a, b) => b.length - a.length)[0]; // longest match wins

  if (!matched) return true; // no restriction on this path
  return (ROUTE_ROLES[matched] as UserRole[]).includes(role);
}
