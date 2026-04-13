import { useEffect } from "react";
import { useLocation } from "wouter";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { canAccess, ROLE_SAFE_REDIRECT } from "@/lib/routePermissions";

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

  const allowed = canAccess(location, activeRole);

  useEffect(() => {
    if (!allowed) {
      const safePath = ROLE_SAFE_REDIRECT[activeRole];
      // Replace so the restricted page is removed from browser history
      window.history.replaceState(null, "", safePath);
      navigate(safePath, { replace: true } as any);
    }
  }, [location, activeRole, allowed]);

  // Block render immediately — don't let restricted content flash
  if (!allowed) return null;

  return <>{children}</>;
}
