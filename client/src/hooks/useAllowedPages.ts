import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { toPosRole } from "./useRole";
import { resolveStaffAllowedPages, personPageKey } from "@shared/pageAccess";

/**
 * For a STAFF-TIER active role, returns the set of configurable pages the current person may open
 * (resolved per-person → role default → none). Returns `null` for admin/manager — this visibility
 * layer never restricts them. My Attendance is always allowed (handled by callers / alwaysVisible).
 *
 * This is page VISIBILITY only — it does not affect login, PINs, or POS permissions.
 */
export function useAllowedPages(): Set<string> | null {
  const { user } = useAuth();
  const { activeRole } = useActiveRoleContext();
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"], staleTime: 30_000, enabled: !!user });

  if (!user || toPosRole(activeRole) !== "staff") return null;
  const u = user as any;
  const key = u._isStaffMember ? personPageKey("staff", u.id) : personPageKey("user", u.id);
  const role = u._isStaffMember ? u.designation : u.role;
  return new Set(resolveStaffAllowedPages(key, role, settings?.staffPageAccess));
}
