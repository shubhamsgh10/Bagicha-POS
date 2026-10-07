/**
 * Privileged-action elevation — server-side backing for the POS PIN dialog.
 *
 * The client verifies a manager/admin PIN via POST /api/auth/verify-pin right
 * before running a gated action; that call stamps a short-lived elevation grant
 * on the session (grantElevation). Privileged endpoints then accept EITHER a
 * manager/admin session role OR an unexpired grant (hasElevation / requireElevation)
 * — so a staff-tier session can no longer call destructive/discount endpoints
 * directly (curl/devtools), bypassing the client dialog. The window is a touch
 * longer than the client's 60s unlock so in-window actions (which don't re-verify)
 * still pass.
 *
 * Pure (no DB / no imports) so it is unit-testable — see scripts/verify-elevation.ts.
 */
export const ROLE_LEVEL: Record<string, number> = { staff: 0, cashier: 0, manager: 1, admin: 2 };
const ELEVATION_WINDOW_MS = 90_000;

/** Who typed the PIN that opened an elevation window — recorded so an audit row can say who APPROVED. */
export interface PinApprover {
  /** "u:<id>" — users and staffMembers share an id space, so ids are always prefixed (see auditService). */
  id: string;
  name: string;
  role: string;
}

export function grantElevation(req: any, level: number, now: number = Date.now(), approver?: PinApprover): void {
  if (!req.session) return;
  req.session.elevatedLevel = level;
  req.session.elevatedUntil = now + ELEVATION_WINDOW_MS;
  req.session.elevatedBy = approver ?? null;
}

export function hasElevation(req: any, minRole: "manager" | "admin", now: number = Date.now()): boolean {
  const need = ROLE_LEVEL[minRole] ?? 1;
  if ((ROLE_LEVEL[req.user?.role] ?? 0) >= need) return true;
  const until = Number(req.session?.elevatedUntil ?? 0);
  const lvl = Number(req.session?.elevatedLevel ?? 0);
  return now < until && lvl >= need;
}

/**
 * Has a manager/admin PIN been typed in THIS session within the window — **ignoring the session's own
 * role**. `hasElevation` short-circuits for a logged-in manager/admin, which is right for ordinary
 * restricted POS actions but wrong for money-changing corrections: the restaurant's day-to-day login
 * (rajbhaghel) IS a manager account, so under `hasElevation` nobody using it was ever asked for a PIN.
 * Only a successful POST /api/auth/verify-pin (which calls grantElevation) satisfies this.
 */
export function hasFreshPin(req: any, minRole: "manager" | "admin", now: number = Date.now()): boolean {
  const need = ROLE_LEVEL[minRole] ?? 1;
  const until = Number(req.session?.elevatedUntil ?? 0);
  const lvl = Number(req.session?.elevatedLevel ?? 0);
  return now < until && lvl >= need;
}

/** The person whose PIN opened the still-open window, or null (expired, or no approver was recorded). */
export function freshPinApprover(req: any, now: number = Date.now()): PinApprover | null {
  if (!(now < Number(req.session?.elevatedUntil ?? 0))) return null;
  return (req.session?.elevatedBy as PinApprover | null | undefined) ?? null;
}

/** Route gate: 401 if logged out, 403 `PIN_REQUIRED` unless a manager/admin PIN was just verified. */
export function requireFreshPin(minRole: "manager" | "admin" = "manager") {
  return (req: any, res: any, next: any) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ message: "Unauthorized" });
    if (hasFreshPin(req, minRole)) return next();
    return res.status(403).json({
      message: "A manager or admin PIN is required for this action",
      code: "PIN_REQUIRED",
    });
  };
}

export function requireElevation(minRole: "manager" | "admin" = "manager") {
  return (req: any, res: any, next: any) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ message: "Unauthorized" });
    if (hasElevation(req, minRole)) return next();
    return res.status(403).json({ message: "Manager approval required for this action" });
  };
}
