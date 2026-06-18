import { useEffect } from "react";
import { useLocation } from "wouter";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { canAccess, ROLE_SAFE_REDIRECT } from "@/lib/routePermissions";
import { useAllowedPages } from "@/hooks/useAllowedPages";
import { STAFF_PAGE_HREFS } from "@shared/pageAccess";

interface RouteGuardProps {
  children: React.ReactNode;
}

/**
 * RouteGuard — global RBAC enforcement for Wouter routes.
 *
 * Runs on every location change AND every activeRole change.
 * If the current path is off-limits for the active role:
 *   1. Redirects to the role's safe landing page (replace — no history pollution)
 *   2. Shows a toast notification
 *   3. Returns null immediately to prevent any flash of restricted content
 *
 * Does NOT touch POS logic, timers, table state, or any business logic.
 */
export function RouteGuard({ children }: RouteGuardProps) {
  const [location, navigate] = useLocation();
  const { activeRole } = useActiveRoleContext();
  const allowedPages = useAllowedPages(); // Set for staff-tier, null for admin/manager

  const roleAllowed = canAccess(location, activeRole);

  // Per-person page access for staff-tier people. Only the configurable staff pages are gated;
  // My Attendance and any unknown path pass. Root "/" resolves to Tables.
  const pageAllowed = (() => {
    if (allowedPages == null) return true; // admin/manager — not restricted by this layer
    if (location === "/my-attendance") return true;
    const base = location === "/" ? "/tables" : "/" + (location.split("/")[1] ?? "");
    if (!STAFF_PAGE_HREFS.includes(base)) return true; // non-configurable path — leave to canAccess
    return allowedPages.has(base);
  })();

  const allowed = roleAllowed && pageAllowed;

  useEffect(() => {
    if (!allowed) {
      // Staff-tier always lands on My Attendance (it's the one page they can always see).
      const safePath = allowedPages != null ? "/my-attendance" : ROLE_SAFE_REDIRECT[activeRole];
      navigate(safePath, { replace: true });
    }
  }, [location, activeRole, allowed, allowedPages]);

  // Block render immediately — don't let restricted content flash
  if (!allowed) return null;

  return <>{children}</>;
}
