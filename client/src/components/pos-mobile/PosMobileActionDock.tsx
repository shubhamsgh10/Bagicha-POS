import { Lock } from "lucide-react";

export type DockTone = "ink" | "clay" | "green" | "plain" | "amber";

export interface DockAction {
  key: string;
  label: string;
  tone: DockTone;
  disabled: boolean;
  locked: boolean;
  onClick: () => void;
}

const TONES: Record<DockTone, { bg: string; fg: string; bd: string }> = {
  ink:   { bg: "var(--info-bg)",    fg: "var(--ink-700)",   bd: "#C9D4E5" },
  clay:  { bg: "var(--warning-bg)", fg: "var(--clay-700)",  bd: "#EBD9B4" },
  green: { bg: "var(--green-50)",   fg: "var(--green-800)", bd: "var(--green-200)" },
  plain: { bg: "#fff",              fg: "var(--text-1)",    bd: "var(--line-strong)" },
  amber: { bg: "var(--warning-bg)", fg: "var(--amber-600)", bd: "#EBD9B4" },
};

/** Compact POS action dock (Cart tab, phones): 5 equal buttons + a full-width Settle button. */
export function PosMobileActionDock(p: {
  actions: DockAction[];
  settleLabel: string;
  settleDisabled: boolean;
  settleLocked: boolean;
  onSettle: () => void;
}) {
  return (
    <div className="shrink-0 bg-white flex flex-col gap-[7px] px-3 pt-2 pb-2" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="grid grid-cols-5 gap-[5px]">
        {p.actions.map(a => {
          const t = TONES[a.tone];
          return (
            <button key={a.key} type="button" disabled={a.disabled} onClick={a.onClick}
              className="h-11 rounded-[10px] text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.96] transition-transform"
              style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}>
              {a.label}
              {a.locked && <Lock className="w-2.5 h-2.5 opacity-50" />}
            </button>
          );
        })}
      </div>
      <button type="button" disabled={p.settleDisabled} onClick={p.onSettle}
        className="w-full h-[46px] rounded-xl text-[14.5px] font-extrabold text-white flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
        style={{ background: "linear-gradient(180deg, var(--green-700), var(--green-800))", boxShadow: "var(--shadow-green)" }}>
        {p.settleLabel}
        {p.settleLocked && <Lock className="w-3 h-3 opacity-60" />}
      </button>
    </div>
  );
}
