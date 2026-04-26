import { useAuth } from "./useAuth";

export type UserRole = "admin" | "manager" | "cashier" | "kitchen" | "staff";

export const ROLE_LEVEL: Record<UserRole, number> = {
  staff: 0,
  kitchen: 0,
  cashier: 0,
  manager: 1,
  admin: 2,
};

/** Maps any DB role to the POS permission tier (admin | manager | staff). */
export type PosRole = "admin" | "manager" | "staff";
export function toPosRole(role: UserRole): PosRole {
  if (role === "admin") return "admin";
  if (role === "manager") return "manager";
  return "staff";
}

/** Returns the current logged-in user's role. Defaults to "staff". */
export function useRole(): UserRole {
  const { user } = useAuth();
  const r = (user?.role ?? "staff") as UserRole;
  return r;
}
