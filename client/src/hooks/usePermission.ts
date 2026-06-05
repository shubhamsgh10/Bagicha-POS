import { useCallback } from "react";
import { UserRole } from "./useRole";
import { useManagerAuth } from "./useManagerAuth";

// ── Cart action permission types (mirrors server/settingsStore.ts) ─────────────

export type CartAction =
  | "discount" | "complimentary" | "clearCart" | "cancelOrder"
  | "editItem" | "removeItem" | "splitBill" | "moveTable" | "mergeTable"
  | "holdOrder" | "printKot" | "printBill" | "saveOrder" | "settleOrder";

export type CartActionPermission = "off" | "pin" | "allowed";

export interface CartPermissions {
  manager: Record<CartAction, CartActionPermission>;
  staff:   Record<CartAction, CartActionPermission>;
}

const CART_ACTIONS: CartAction[] = [
  "discount", "complimentary", "clearCart", "cancelOrder",
  "editItem", "removeItem", "splitBill", "moveTable", "mergeTable",
  "holdOrder", "printKot", "printBill", "saveOrder", "settleOrder",
];

export const DEFAULT_CART_PERMISSIONS: CartPermissions = {
  manager: Object.fromEntries(CART_ACTIONS.map(a => [
    a,
    (["editItem", "removeItem"] as CartAction[]).includes(a) ? "pin" :
    (["discount","complimentary","clearCart","cancelOrder","splitBill","moveTable","mergeTable"] as CartAction[]).includes(a) ? "off" :
    "allowed",
  ])) as Record<CartAction, CartActionPermission>,
  staff: Object.fromEntries(CART_ACTIONS.map(a => [
    a,
    (["editItem", "removeItem"] as CartAction[]).includes(a) ? "pin" :
    (["discount","complimentary","clearCart","cancelOrder","splitBill","moveTable","mergeTable"] as CartAction[]).includes(a) ? "off" :
    "allowed",
  ])) as Record<CartAction, CartActionPermission>,
};

// ── Legacy type alias (kept for any remaining uses) ───────────────────────────

export type AdminOnlyAction = CartAction;

/**
 * Role-aware permission hook.
 *
 * Admin mode   → everything free, no PIN ever.
 * Manager mode → per-action setting; "pin" requires admin PIN.
 * Staff mode   → per-action setting; "pin" requires manager (or admin) PIN.
 *
 * @param activeRole    Current active role from useActiveRole
 * @param cartPermissions  Per-role permission map from /api/settings. Falls back
 *                         to DEFAULT_CART_PERMISSIONS if omitted.
 */
export function usePermission(activeRole: UserRole, cartPermissions?: CartPermissions) {
  const managerAuth = useManagerAuth();

  const _perms = cartPermissions ?? DEFAULT_CART_PERMISSIONS;
  const _role  = activeRole === "manager" ? "manager" : "staff";

  // ── isOff — button completely disabled, no PIN option ────────────────────────
  const isOff = useCallback(
    (action: CartAction): boolean => {
      if (activeRole === "admin") return false;
      return (_perms[_role][action] ?? "off") === "off";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRole, _perms, _role]
  );

  // ── can — true when action is "pin" or "allowed" (button should be enabled) ──
  const can = useCallback(
    (action: CartAction): boolean => {
      if (activeRole === "admin") return true;
      const p = _perms[_role][action] ?? "off";
      return p === "allowed" || p === "pin";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRole, _perms, _role]
  );

  // ── Which PIN tier to request ─────────────────────────────────────────────────
  const actionPinRole: "manager" | "admin" =
    activeRole === "manager" ? "admin" : "manager";

  // ── go — unified gate: check perm, skip/execute/PIN as appropriate ────────────
  const go = useCallback(
    (action: CartAction, label: string, fn: () => void) => {
      if (activeRole === "admin") { fn(); return; }
      const p = _perms[_role][action] ?? "off";
      if (p === "off")     return;
      if (p === "allowed") { fn(); return; }
      // p === "pin"
      managerAuth.requirePin(label, fn, actionPinRole);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRole, _perms, _role, actionPinRole, managerAuth.requirePin]
  );

  // ── requirePin — legacy helper (still used for non-action PIN requests) ───────
  const requirePin = useCallback(
    (label: string, action: () => void) => {
      if (activeRole === "admin") { action(); return; }
      managerAuth.requirePin(label, action, actionPinRole);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRole, actionPinRole, managerAuth.requirePin]
  );

  // ── isLocked — whether PIN session is currently locked ───────────────────────
  const isLocked = useCallback((): boolean => {
    if (activeRole === "admin") return false;
    return managerAuth.isLocked();
  }, [activeRole, managerAuth.isLocked]);

  return {
    can,
    isOff,
    go,
    requirePin,
    isLocked,
    actionPinRole,
    pinRequest:        managerAuth.pinRequest,
    resolvePinSuccess: managerAuth.resolvePinSuccess,
    resolvePinCancel:  managerAuth.resolvePinCancel,
  };
}
