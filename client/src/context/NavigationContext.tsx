import { createContext, useContext, useRef, useState, useCallback, ReactNode } from "react";
import { useLocation } from "wouter";

export type NavDirection = "forward" | "backward";

interface NavContextValue {
  direction: NavDirection;
  goBack: () => void;
  canGoBack: boolean;
}

const NavContext = createContext<NavContextValue>({
  direction: "forward",
  goBack: () => {},
  canGoBack: false,
});

/**
 * NavigationProvider — tracks a history stack inferred from wouter's location.
 *
 * Direction is derived synchronously during render (React 18 setState-during-render
 * pattern) so AnimatePresence always sees the correct direction on the same render
 * cycle as the location change.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [location, wouterNav] = useLocation();
  const stackRef   = useRef<string[]>([location]);
  const prevLocRef = useRef(location);
  const [direction, setDirection] = useState<NavDirection>("forward");

  // Synchronously update direction when location changes.
  // React 18: calling setState during render causes React to discard the current
  // render output and immediately re-render with the new state — no extra cycle.
  if (prevLocRef.current !== location) {
    const stack   = stackRef.current;
    const prevPrev = stack.length >= 2 ? stack[stack.length - 2] : null;

    if (prevPrev === location) {
      // Navigated back to previous page
      stackRef.current = stack.slice(0, -1);
      setDirection("backward");
    } else if (stack[stack.length - 1] !== location) {
      // New forward navigation
      stackRef.current = [...stack, location];
      setDirection("forward");
    }
    prevLocRef.current = location;
  }

  const goBack = useCallback(() => {
    const stack = stackRef.current;
    if (stack.length >= 2) {
      const prev = stack[stack.length - 2];
      stackRef.current = stack.slice(0, -1);
      setDirection("backward");
      wouterNav(prev);
    }
  }, [wouterNav]);

  return (
    <NavContext.Provider value={{
      direction,
      goBack,
      canGoBack: stackRef.current.length >= 2,
    }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNavigation() {
  return useContext(NavContext);
}
