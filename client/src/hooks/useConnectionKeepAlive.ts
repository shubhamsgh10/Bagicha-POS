import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { startConnectionKeepAlive } from "@/lib/connectionKeepAlive";

/**
 * Mounted once (App.tsx). While signed in, keeps the connection to the API warm so a print/settle
 * tap after a quiet spell isn't the request that discovers a dead connection (see
 * shared/connectionKeepAlive.ts). Browsers only ping while the page is visible; the Electron app
 * also pings while minimised, because it is the print station and claims jobs in the background.
 */
export function useConnectionKeepAlive(): void {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    return startConnectionKeepAlive({ keepWhileHidden: !!window.electronAPI?.isElectron });
  }, [isAuthenticated]);
}
