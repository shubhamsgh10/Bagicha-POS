// A restaurant open past midnight means a strict calendar-day boundary is wrong for
// "today" filters — at 12:00 AM the current, still-running shift would suddenly read
// as "yesterday". A business day instead runs from BUSINESS_DAY_CUTOFF_HOUR (IST) to
// the same time the next day, so late-night orders still count as part of the day
// they were actually served on.
export const BUSINESS_DAY_CUTOFF_HOUR = 5; // 5:00 AM IST

function istDateAndHour(d: Date): { dateStr: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  }).formatToParts(d).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
  // en-CA gives yyyy-mm-dd parts directly; hour "24" at midnight normalizes to 0.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

/** The business date (YYYY-MM-DD, IST calendar) that `d` belongs to — anything before
 *  the cutoff hour belongs to the previous calendar day's business day. */
export function businessDateOf(d: Date = new Date()): string {
  const { dateStr, hour } = istDateAndHour(d);
  if (hour >= BUSINESS_DAY_CUTOFF_HOUR) return dateStr;
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day - 1)).toISOString().slice(0, 10);
}

/** [start, end] instants (UTC Dates) spanning the business day for `dateStr`
 *  (YYYY-MM-DD, IST calendar) — dateStr 05:00:00 IST through next-day 04:59:59.999 IST. */
export function businessDayRange(dateStr: string): { start: Date; end: Date } {
  const cutoff = String(BUSINESS_DAY_CUTOFF_HOUR).padStart(2, "0");
  const start = new Date(`${dateStr}T${cutoff}:00:00.000+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

export function todayBusinessDate(): string {
  return businessDateOf(new Date());
}

/** Shift a business-date string by `deltaDays` (e.g. -1 for the previous day). */
export function shiftBusinessDate(dateStr: string, deltaDays: number): string {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + deltaDays)).toISOString().slice(0, 10);
}

// ── Plain IST calendar helpers (distinct from the business-day concept above) ──
// Some call sites don't want the 5am-cutoff business day — they want the actual IST
// wall-clock hour or calendar date: WhatsApp quiet-hours gating, "already messaged this
// customer today" dedup (should reset at IST midnight, not 5am), birthday matching, and
// the daily scheduler's once-per-day job gates. Using `new Date().getHours()`/`.getDate()`
// for any of these reads the SERVER's ambient timezone, which CLAUDE.md documents as
// "not guaranteed to be IST even though the restaurant is" — exactly what bit
// formatISTDateTime's callers before that fix. Use these instead.

/** Current hour in IST (0-23) for a given instant (defaults to now). */
export function istHour(d: Date = new Date()): number {
  return istDateAndHour(d).hour;
}

/** IST calendar date (YYYY-MM-DD) for a given instant (defaults to now). */
export function istCalendarDate(d: Date = new Date()): string {
  return istDateAndHour(d).dateStr;
}

/** IST month-day (MM-DD) for a given instant — e.g. for birthday-field matching. */
export function istMonthDay(d: Date = new Date()): string {
  return istCalendarDate(d).slice(5);
}

/** [start, end] UTC instants spanning the PLAIN IST calendar day for `dateStr`
 *  (00:00:00.000 through 23:59:59.999 IST) — distinct from businessDayRange's 5am cutoff. */
export function istCalendarDayRange(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00.000+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}
