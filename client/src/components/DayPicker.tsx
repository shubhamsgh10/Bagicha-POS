import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar, ChevronDown, Check } from "lucide-react";
import { todayBusinessDate, shiftBusinessDate } from "@shared/businessDay";

function formatLabel(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/**
 * Single-day picker for "per-day" views (Order History, Billing). Defaults to the
 * current business day (see shared/businessDay.ts) — a late-running shift crossing
 * midnight stays on "today" rather than flipping to a new, near-empty day.
 *
 * The dropdown (not the browser's native calendar popup, so "All Dates" can live
 * alongside date selection in one place) offers Today / All Dates presets plus a
 * custom date field. Prev/Next arrows outside the dropdown give quick day-by-day nav.
 */
export function DayPicker({
  value,
  onChange,
  allDates = false,
  onAllDatesChange,
}: {
  value: string;                              // YYYY-MM-DD, business-day calendar
  onChange: (v: string) => void;
  allDates?: boolean;                         // true = "All Dates" mode is active
  onAllDatesChange?: (v: boolean) => void;    // omit to hide the All Dates option
}) {
  const [open, setOpen] = useState(false);
  const [customDate, setCustomDate] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const today = todayBusinessDate();
  const isToday = value === today && !allDates;

  useEffect(() => { setCustomDate(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const goToday = () => { onAllDatesChange?.(false); onChange(today); setOpen(false); };
  const goAll = () => { onAllDatesChange?.(true); setOpen(false); };
  const applyCustom = () => {
    if (!customDate) return;
    onAllDatesChange?.(false);
    onChange(customDate);
    setOpen(false);
  };
  const shift = (delta: number) => {
    onAllDatesChange?.(false);
    onChange(shiftBusinessDate(value, delta));
  };

  const label = allDates ? "All Dates" : isToday ? "Today" : formatLabel(value);

  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--paper-0)] px-1 py-1 shadow-sm">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
        title="Previous day"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Calendar className="w-3.5 h-3.5 text-emerald-500" />
          <span>{label}</span>
          <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 z-50 w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl
                          bg-[var(--paper-0)] border border-[var(--line)] shadow-xl shadow-black/10 p-2">
            <button
              type="button"
              onClick={goToday}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                isToday ? "bg-emerald-50 text-emerald-700 font-semibold" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              Today
              {isToday && <Check className="w-3.5 h-3.5 text-emerald-500" />}
            </button>

            {onAllDatesChange && (
              <button
                type="button"
                onClick={goAll}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                  allDates ? "bg-emerald-50 text-emerald-700 font-semibold" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                All Dates
                {allDates && <Check className="w-3.5 h-3.5 text-emerald-500" />}
              </button>
            )}

            <div className="border-t border-gray-100 mt-1 pt-2 px-1">
              <label className="block text-[10px] text-gray-500 mb-1 px-1">Pick a date</label>
              <input
                type="date"
                value={customDate}
                max={today}
                onChange={e => setCustomDate(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 mb-2
                           focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customDate}
                className="w-full py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 text-white
                           hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => shift(1)}
        disabled={isToday}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Next day"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
