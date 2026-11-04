// Pure helpers for "self" endpoints (profile/password) that key off req.user.id.
//
// `users` and `staffMembers` share the integer id space (see CLAUDE.md's id-collision
// gotcha), and a staff-member session is `{ id: sm.id, _isStaffMember: true }`. Any
// endpoint that reads/writes a `users` row by `req.user.id` without checking
// `_isStaffMember` is a cross-table IDOR: a staff-tier PIN session with `sm.id === N`
// can read/write `users` row N. Use `requireUserAccount` on any such endpoint.

export interface SessionUser {
  id: number;
  _isStaffMember?: boolean;
  [key: string]: any;
}

export function requireUserAccount(req: any, res: any, next: any) {
  const user = req.user as SessionUser | undefined;
  if (user?._isStaffMember) {
    return res.status(403).json({ message: "Not available for this session type" });
  }
  next();
}

const SENSITIVE_USER_FIELDS = ["password", "pin", "totpSecret"] as const;

/** Strip password/pin/totpSecret from a `users` row before it goes in a response body. */
export function sanitizeUser<T extends Record<string, any>>(
  user: T
): Omit<T, "password" | "pin" | "totpSecret"> {
  const clone: any = { ...user };
  for (const field of SENSITIVE_USER_FIELDS) delete clone[field];
  return clone;
}

/**
 * A users / staff_members row with its secrets removed, plus `hasPin`. Attendance, leave and
 * staff-profile reads attach the person to every row and are served to any logged-in session —
 * they used to carry the plaintext PIN, the password hash and the TOTP secret, so a staff PIN
 * session could read every manager's PIN and replay it into /api/auth/verify-pin for manager
 * elevation. Every person embedded in a response goes through this (storage.ts).
 */
export function publicPerson<T extends Record<string, any>>(
  row: T
): Omit<T, "password" | "pin" | "totpSecret"> & { hasPin: boolean } {
  const { password: _p, pin, totpSecret: _t, ...rest } = row as any;
  return { ...rest, hasPin: !!pin };
}
