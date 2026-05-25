import type { ReactNode } from "react";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

/**
 * Electron loads the UI via file:// — pathname routing becomes file:///C:/tables.
 * Hash routing (#/tables) keeps navigation inside the SPA.
 */
export function usesHashRouting(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.protocol === "file:" ||
    !!(window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron
  );
}

export function AppWouterRouter({ children }: { children: ReactNode }) {
  if (usesHashRouting()) {
    return (
      <Router hook={useHashLocation} ssrPath="/">
        {children}
      </Router>
    );
  }
  return <>{children}</>;
}
