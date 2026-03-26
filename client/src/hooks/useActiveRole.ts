import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRole, UserRole, ROLE_LEVEL } from "./useRole";

/**
 * Manages the active POS role — separate from the login role.
 *
 * - Any role can be selected via the RoleSwitcher in the POS top bar.
 * - Elevating above the login role starts an auto-revert countdown.
 * - Manual revert is always available via the lock button.
 * - Timeout is configured in Settings (posRoleTimeout, minutes; 0 = never).
 */
export function useActiveRole() {
  const loginRole = useRole();
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const timeoutMinutes: number = settings?.posRoleTimeout ?? 2;

  const [activeRole, setActiveRole] = useState<UserRole>(loginRole);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync if login role changes (e.g. re-auth)
  useEffect(() => {
    setActiveRole(loginRole);
    stopTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginRole]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setSecondsLeft(0);
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  /**
   * Switch to a new active role.
   * Only starts the countdown when elevating ABOVE the user's own login role.
   */
  const elevateRole = useCallback((role: UserRole) => {
    setActiveRole(role);
    stopTimer();

    const isAboveLogin = ROLE_LEVEL[role] > ROLE_LEVEL[loginRole];
    if (isAboveLogin && timeoutMinutes > 0) {
      let secs = timeoutMinutes * 60;
      setSecondsLeft(secs);
      timerRef.current = setInterval(() => {
        secs -= 1;
        if (secs <= 0) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          setSecondsLeft(0);
          setActiveRole(loginRole); // revert to login role, not necessarily staff
        } else {
          setSecondsLeft(secs);
        }
      }, 1000);
    }
  }, [loginRole, timeoutMinutes, stopTimer]);

  /** Instantly revert to the user's own login role. */
  const revertRole = useCallback(() => {
    setActiveRole(loginRole);
    stopTimer();
  }, [loginRole, stopTimer]);

  const isElevated = ROLE_LEVEL[activeRole] > ROLE_LEVEL[loginRole];

  return {
    activeRole,
    loginRole,
    secondsLeft,   // 0 when no timer running
    timeoutMinutes,
    isElevated,    // true when above own login level (show lock button + countdown)
    elevateRole,
    revertRole,
  };
}
