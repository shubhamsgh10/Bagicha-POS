import type { ReactNode } from "react";

/** Horizontally scrolling row of pill filters (MobilePOS design). Presentational only. */
export function ChipRow({
  children, className = "", ariaLabel,
}: { children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className={`flex gap-1.5 overflow-x-auto scrollbar-hide ${className}`}>
      {children}
    </div>
  );
}

export function Chip({
  active, onClick, children, count, dot, title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Optional count shown after the label. */
  count?: number;
  /** Optional Tailwind background class for a small status dot, e.g. "bg-emerald-500". */
  dot?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className="shrink-0 min-h-[36px] px-3.5 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
      style={
        active
          ? { background: "var(--green-800)", color: "#F4F8F0", borderColor: "var(--green-800)" }
          : { background: "#fff", color: "var(--text-1)", borderColor: "var(--line-strong)" }
      }
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {children}
      {count != null && <span className="tabular-nums text-[10px] opacity-70">{count}</span>}
    </button>
  );
}
