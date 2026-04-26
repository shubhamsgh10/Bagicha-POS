import { useEffect, useRef } from "react";

/**
 * Detects a left-edge swipe gesture and calls onSwipeBack.
 * Only activates when the initial touch/pointer starts within EDGE_ZONE px
 * of the left edge. Cancels if vertical drift exceeds MAX_Y_DRIFT px.
 * Does not produce visual drag feedback — purely gesture detection.
 */
export function useSwipeBack(onSwipeBack: () => void, enabled = true) {
  const startX   = useRef(0);
  const startY   = useRef(0);
  const tracking = useRef(false);
  // Stable ref so the effect dependency doesn't change on every render
  const callbackRef = useRef(onSwipeBack);
  callbackRef.current = onSwipeBack;

  useEffect(() => {
    if (!enabled) return;

    const EDGE_ZONE  = 30;  // px from left edge to start tracking
    const THRESHOLD  = 80;  // minimum horizontal travel to trigger back
    const MAX_Y_DRIFT = 60; // cancel if user drifts this far vertically

    const onDown = (e: PointerEvent) => {
      if (e.clientX > EDGE_ZONE) return;
      startX.current   = e.clientX;
      startY.current   = e.clientY;
      tracking.current = true;
    };

    const onMove = (e: PointerEvent) => {
      if (!tracking.current) return;
      if (Math.abs(e.clientY - startY.current) > MAX_Y_DRIFT) {
        tracking.current = false; // too much vertical drift — cancel
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking.current) return;
      tracking.current = false;
      if (e.clientX - startX.current > THRESHOLD) {
        callbackRef.current();
      }
    };

    const onCancel = () => { tracking.current = false; };

    document.addEventListener("pointerdown",   onDown,   { passive: true });
    document.addEventListener("pointermove",   onMove,   { passive: true });
    document.addEventListener("pointerup",     onUp,     { passive: true });
    document.addEventListener("pointercancel", onCancel, { passive: true });

    return () => {
      document.removeEventListener("pointerdown",   onDown);
      document.removeEventListener("pointermove",   onMove);
      document.removeEventListener("pointerup",     onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  }, [enabled]);
}
