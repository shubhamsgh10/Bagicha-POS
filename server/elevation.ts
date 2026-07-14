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

export function grantElevation(req: any, level: number, now: number = Date.now()): void {
  if (!req.session) return;
  req.session.elevatedLevel = level;
  req.session.elevatedUntil = now + ELEVATION_WINDOW_MS;
}

export function hasElevation(req: any, minRole: "manager" | "admin", now: number = Date.now()): boolean {
  const need = ROLE_LEVEL[minRole] ?? 1;
  if ((ROLE_LEVEL[req.user?.role] ?? 0) >= need) return true;
  const until = Number(req.session?.elevatedUntil ?? 0);
  const lvl = Number(req.session?.elevatedLevel ?? 0);
  return now < until && lvl >= need;
}

export function requireElevation(minRole: "manager" | "admin" = "manager") {
  return (req: any, res: any, next: any) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ message: "Unauthorized" });
    if (hasElevation(req, minRole)) return next();
    return res.status(403).json({ message: "Manager approval required for this action" });
  };
}
