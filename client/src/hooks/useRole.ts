import { useAuth } from "./useAuth";

export type UserRole = "admin" | "manager" | "staff";

export const ROLE_LEVEL: Record<UserRole, number> = {
  staff: 0,
  manager: 1,
  admin: 2,
};

/** Returns the current logged-in user's role. Defaults to "staff". */
export function useRole(): UserRole {
  const { user } = useAuth();
  const r = user?.role ?? "staff";
  if (r === "admin" || r === "manager") return r;
  return "staff";
}
