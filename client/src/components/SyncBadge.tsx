import { Link } from "wouter";
import { useLocalSync, syncBadgeState } from "@/hooks/useLocalSync";
import { useRole } from "@/hooks/useRole";

const TONES = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-300",
  red: "bg-red-50 text-red-700 border-red-300",
  blue: "bg-sky-50 text-sky-700 border-sky-200",
} as const;
const DOTS = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", blue: "bg-sky-500 animate-pulse" } as const;

/** Shop-PC sync state. Renders nothing (and polls nothing) on the cloud deployment. */
export function SyncBadge({ className = "" }: { className?: string }) {
  const status = useLocalSync();
  const role = useRole();
  const s = syncBadgeState(status);
  if (!s) return null;
  const body = (
    <span
      data-testid="sync-badge"
      title={status.schemaBlocked ? "A local database update is waiting for the internet" : status.lastError ?? "Shop PC sync"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5 whitespace-nowrap ${TONES[s.tone]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOTS[s.tone]}`} />
      {s.label}
    </span>
  );
  // The Sync screen is for managers/admins (it is not on staff-tier page lists).
  return role === "admin" || role === "manager" ? <Link href="/sync">{body}</Link> : body;
}
