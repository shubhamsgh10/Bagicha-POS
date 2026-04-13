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
  // ── Admin only ──────────────────────────────────────────────
  "/dashboard":      ["admin"],
  "/live-analytics": ["admin"],
  "/live-tables":    ["admin", "manager"],
  "/reports":        ["admin"],
  "/menu":           ["admin", "manager"],
  "/inventory":      ["admin", "manager"],
  "/admin":          ["admin"],
  "/settings":       ["admin"],

  // ── Manager + Admin ─────────────────────────────────────────
  "/orders":         ["admin", "manager"],
  "/customers":      ["admin", "manager"],
  "/kitchen":        ["admin", "manager"],
  "/kot":            ["admin", "manager"],

  // ── All roles (explicit; also covers unlisted paths below) ──
  // "/tables", "/pos", "/mobile-pos" → no entry = open to all
};

/** Safe landing page per role when a redirect is forced. */
export const ROLE_SAFE_REDIRECT: Record<UserRole, string> = {
  admin:   "/dashboard",
  manager: "/tables",
  staff:   "/tables",
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
