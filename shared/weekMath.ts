/**
 * weekMath.ts — shared "YYYY-WW" week math (Monday-start, week 1 anchored to the week
 * containing Jan 4 — same anchor rule ISO 8601 uses). Single source of truth for both
 * server/storage.ts's getRoster (which turns a week string into 7 dates) and the Shifts
 * tab's client-side week picker (which turns "today" / a navigation step into a week
 * string) — they used to be two independent implementations, and the client's used a
 * different, non-equivalent formula that could resolve "today" to the wrong week string,
 * so the roster shown on load didn't actually contain today. Navigating by real date
 * arithmetic here also fixes the previous integer 52/53 wraparound bug (a naive
 * `week > 52 -> year+1, week = 1` skips week 53 outright in the ~29% of years that
 * have one, and lands one week off when stepping backward out of week 1 of such a year).
 */

/** The Monday that starts ISO-style week `weekNum` of `year` (local midnight). */
export function isoWeekMonday(year: number, weekNum: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Mon=1..Sun=7
  const weekStart = new Date(jan4);
  weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

/** Local Y/M/D as "YYYY-MM-DD" — NOT toISOString(), which round-trips through UTC and
 *  would shift the date by a day whenever the process's ambient timezone has a positive
 *  UTC offset (e.g. a server genuinely running in IST) — see this file's Batch 21 note. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The 7 "YYYY-MM-DD" dates (Mon..Sun) of week `week` ("YYYY-WW"). */
export function weekDates(week: string): string[] {
  const [year, weekNum] = week.split("-").map(Number);
  const weekStart = isoWeekMonday(year, weekNum);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    dates.push(ymd(d));
  }
  return dates;
}

/** The "YYYY-WW" week string containing `date`, inverting isoWeekMonday exactly. */
export function weekStringOf(date: Date): string {
  const dow = date.getDay() || 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - dow + 1);
  monday.setHours(0, 0, 0, 0);
  // The anchor year for a given Monday is always its own calendar year or an adjacent
  // one (a week can't span more than a year away from the Jan-4 anchor) — try all three.
  // Exactly one Monday per year (the one containing that year's Jan 4) is reachable as
  // BOTH "this year's week 1" and "last year's week 53/52+1" — both are arithmetically
  // valid, so among all matches prefer the smallest weekNum (equivalently: prefer
  // "new year's week 1" over "old year's week 53" for that boundary Monday, matching
  // week 1's own definition of being anchored to Jan 4 of its year).
  let candidate: { year: number; weekNum: number } | null = null;
  for (const year of [monday.getFullYear() - 1, monday.getFullYear(), monday.getFullYear() + 1]) {
    const week1Monday = isoWeekMonday(year, 1);
    const weekNum = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
    if (weekNum >= 1 && weekNum <= 53 && isoWeekMonday(year, weekNum).getTime() === monday.getTime()) {
      if (!candidate || weekNum < candidate.weekNum) candidate = { year, weekNum };
    }
  }
  // Unreachable in practice — the loop above always finds a match.
  if (!candidate) return `${monday.getFullYear()}-01`;
  return `${candidate.year}-${String(candidate.weekNum).padStart(2, "0")}`;
}

/** Shift a "YYYY-WW" week string by `deltaWeeks` real calendar weeks. */
export function shiftWeek(week: string, deltaWeeks: number): string {
  const [year, weekNum] = week.split("-").map(Number);
  const monday = isoWeekMonday(year, weekNum);
  monday.setDate(monday.getDate() + deltaWeeks * 7);
  return weekStringOf(monday);
}
