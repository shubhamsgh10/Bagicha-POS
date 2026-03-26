import { useCallback } from "react";
import { UserRole } from "./useRole";
import { useManagerAuth } from "./useManagerAuth";

/**
 * Actions completely disabled for manager AND staff.
 * Only admin mode can use these — no PIN override.
 */
const ADMIN_ONLY_ACTIONS = [
  "discount",
  "complimentary",
  "newOrder",
  "cancelOrder",
  "moveTable",
  "mergeTable",
  "splitBill",
] as const;

export type AdminOnlyAction = (typeof ADMIN_ONLY_ACTIONS)[number];

/**
 * Role-aware permission hook. Takes the current activeRole from useActiveRole.
 *
 * Admin mode   → everything free, no PIN ever.
 * Manager mode → restricted actions need admin PIN; others disabled.
 * Staff mode   → restricted actions need manager PIN; save needs manager PIN; others disabled.
 */
export function usePermission(activeRole: UserRole) {
  const managerAuth = useManagerAuth();

  /** Returns false when the button should be disabled entirely. */
  const can = useCallback(
    (action: AdminOnlyAction): boolean => activeRole === "admin",
    [activeRole]
  );

  /**
   * Which PIN tier is required for this active role:
   * - staff   → manager (or admin) PIN
   * - manager → manager (or admin) PIN
   * - admin   → never called
   */
  const actionPinRole: "manager" | "admin" =
    activeRole === "admin" ? "admin" : "manager";

  /** Gate an action behind a PIN popup (skipped for admin). */
  const requirePin = useCallback(
    (label: string, action: () => void) => {
      if (activeRole === "admin") { action(); return; }
      managerAuth.requirePin(label, action, actionPinRole);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRole, actionPinRole, managerAuth.requirePin]
  );

  /** Whether the discount field focus-gate should trigger. */
  const isLocked = useCallback((): boolean => {
    if (activeRole === "admin") return false;
    return managerAuth.isLocked();
  }, [activeRole, managerAuth.isLocked]);

  return {
    can,
    requirePin,
    isLocked,
    actionPinRole,
    pinRequest: managerAuth.pinRequest,
    resolvePinSuccess: managerAuth.resolvePinSuccess,
    resolvePinCancel: managerAuth.resolvePinCancel,
  };
}
