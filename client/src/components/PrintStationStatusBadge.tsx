import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Printer } from "lucide-react";
import { isStationEnabled } from "@/lib/printStationCore";

/**
 * App-wide reminder for a device that has been turned into a print station
 * (Station Mode toggled ON, once, on /print-station) but is currently viewing
 * a different page. /print-station is the ONLY route that listens for and
 * prints PRINT_JOB broadcasts — navigating away silently stops this device
 * from printing anything until it returns, with no other on-screen sign of
 * that (see CLAUDE.md's print-station "Station mode" note). Mounted once at
 * the app root so it's visible even on routes without TopNav (e.g. POS).
 */
export function PrintStationStatusBadge() {
  const [location, navigate] = useLocation();
  const [enabled, setEnabled] = useState(isStationEnabled);

  useEffect(() => {
    setEnabled(isStationEnabled());
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === "printStation.enabled") setEnabled(isStationEnabled());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [location]);

  if (window.electronAPI?.isElectron) return null;
  if (!enabled || location === "/print-station") return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/print-station")}
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-2xl animate-pulse hover:bg-amber-600 hover:animate-none transition-colors"
    >
      <Printer className="w-4 h-4" />
      Print Station idle — tap to resume
    </button>
  );
}
