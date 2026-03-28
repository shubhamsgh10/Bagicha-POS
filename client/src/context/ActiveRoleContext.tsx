import { createContext, useContext, ReactNode } from "react";
import { useActiveRole } from "@/hooks/useActiveRole";
import { UserRole } from "@/hooks/useRole";

interface ActiveRoleContextValue {
  activeRole: UserRole;
  loginRole: UserRole;
  secondsLeft: number;
  timeoutMinutes: number;
  isElevated: boolean;
  elevateRole: (role: UserRole) => void;
  revertRole: () => void;
}

const ActiveRoleContext = createContext<ActiveRoleContextValue | null>(null);

export function ActiveRoleProvider({ children }: { children: ReactNode }) {
  const value = useActiveRole();
  return (
    <ActiveRoleContext.Provider value={value}>
      {children}
    </ActiveRoleContext.Provider>
  );
}

export function useActiveRoleContext(): ActiveRoleContextValue {
  const ctx = useContext(ActiveRoleContext);
  if (!ctx) throw new Error("useActiveRoleContext must be used inside ActiveRoleProvider");
  return ctx;
}
