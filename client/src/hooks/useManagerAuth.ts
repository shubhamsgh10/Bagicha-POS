import { useRef, useState, useCallback } from "react";

export interface PinRequest {
  label: string;
  action: () => void;
  requiredRole: "manager" | "admin"; // which tier's PIN the popup must accept
}

const UNLOCK_DURATION_MS = 60_000; // 60-second session unlock after correct PIN

/**
 * Low-level PIN gating hook.
 * Call requirePin(label, action, requiredRole) to gate an action behind a PIN popup.
 * After a correct PIN, a 60-second session unlock window skips re-prompting.
 */
export function useManagerAuth() {
  const unlockedUntilRef = useRef<number>(0);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);

  const requirePin = useCallback(
    (label: string, action: () => void, requiredRole: "manager" | "admin" = "manager") => {
      if (Date.now() < unlockedUntilRef.current) {
        console.log(`[AUTH] ${label}: session unlocked — running`);
        action();
        return;
      }
      console.log(`[AUTH] ${label}: PIN required (${requiredRole}) — blocking`);
      setPinRequest({ label, action, requiredRole });
    },
    []
  );

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

  const isLocked = useCallback(() => Date.now() >= unlockedUntilRef.current, []);

  return { requirePin, pinRequest, resolvePinSuccess, resolvePinCancel, isLocked };
}
