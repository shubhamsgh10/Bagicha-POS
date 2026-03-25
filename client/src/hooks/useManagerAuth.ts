import { useRef, useState, useCallback } from "react";

interface PinRequest {
  label: string;
  action: () => void;
}

const UNLOCK_DURATION_MS = 60_000; // 60-second session unlock after correct PIN

/**
 * Manager PIN gating for protected POS actions.
 *
 * The PIN is a separate authorization layer — ALL logged-in users must
 * enter a manager PIN for protected actions (just like Petpooja).
 * The PIN belongs to any manager/admin account set up in the system.
 *
 * After a correct PIN, a 60-second session unlock window allows rapid
 * subsequent actions without re-prompting.
 */
export function useManagerAuth() {
  const unlockedUntilRef = useRef<number>(0);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);

  const requirePin = useCallback((label: string, action: () => void) => {
    // Still within the 60-second session unlock window — skip popup
    if (Date.now() < unlockedUntilRef.current) {
      console.log(`[AUTH] ${label}: session unlocked — running`);
      action();
      return;
    }

    // Block the action and show the PIN popup
    console.log(`[AUTH] ${label}: PIN required — blocking action`);
    setPinRequest({ label, action });
  }, []);

  const resolvePinSuccess = useCallback(() => {
    const saved = pinRequest;
    unlockedUntilRef.current = Date.now() + UNLOCK_DURATION_MS;
    console.log(`[AUTH] PIN verified — session unlocked 60s, running: ${saved?.label}`);
    setPinRequest(null);
    saved?.action();
  }, [pinRequest]);

  const resolvePinCancel = useCallback(() => {
    console.log(`[AUTH] PIN cancelled — action blocked: ${pinRequest?.label}`);
    setPinRequest(null);
  }, [pinRequest]);

  /**
   * Returns true when the user needs to enter a PIN.
   * (always true outside the 60-second unlock window)
   */
  const isLocked = useCallback(() => {
    return Date.now() >= unlockedUntilRef.current;
  }, []);

  return { requirePin, pinRequest, resolvePinSuccess, resolvePinCancel, isLocked };
}
