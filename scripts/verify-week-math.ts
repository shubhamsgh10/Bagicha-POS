/**
 * Verifies shared/weekMath.ts — the "YYYY-WW" week math now shared between
 * server/storage.ts's getRoster (week string -> 7 dates) and Staff.tsx's Shifts-tab
 * week picker (today / navigation -> week string). Regression lock for two real bugs:
 * the client used to derive "today"'s week with a different, non-equivalent formula
 * than the server's Jan-4-anchored algorithm (so the roster shown on load didn't
 * actually contain today), and navigateWeek wrapped on a hardcoded 52, which both
 * skips week 53 outright in years that have one and lands one week off stepping
 * backward out of week 1 of such a year.
 * Run: npx tsx scripts/verify-week-math.ts
 */
import { isoWeekMonday, weekDates, weekStringOf, shiftWeek } from "../shared/weekMath";

const checks: Array<[string, boolean]> = [];
const pad = (n: number) => String(n).padStart(2, "0");

// ── Round trip: isoWeekMonday -> weekStringOf must recover the original string ──
for (const year of [2024, 2025, 2026, 2027, 2028]) {
  for (const week of [1, 2, 26, 51, 52]) {
    const label = `${year}-${pad(week)}`;
    const monday = isoWeekMonday(year, week);
    checks.push([`round trip ${label}`, weekStringOf(monday) === label]);
  }
}

// ── weekDates: 7 consecutive calendar dates, starting Monday ──────────────────
{
  const dates = weekDates("2026-10");
  checks.push(["weekDates returns 7 dates", dates.length === 7]);
  const monday = new Date(dates[0] + "T00:00:00");
  checks.push(["weekDates[0] is a Monday", monday.getDay() === 1]);
  const allConsecutive = dates.every((d, i) => {
    if (i === 0) return true;
    const prev = new Date(dates[i - 1] + "T00:00:00");
    const cur = new Date(d + "T00:00:00");
    return Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1;
  });
  checks.push(["weekDates are 7 consecutive days", allConsecutive]);
}

// ── Find a real 53-week year under this algorithm and test wraparound through it ──
function weeksInYear(year: number): number {
  const thisJan1 = isoWeekMonday(year, 1).getTime();
  const nextJan1 = isoWeekMonday(year + 1, 1).getTime();
  return Math.round((nextJan1 - thisJan1) / (7 * 86400000));
}

let year53: number | null = null;
for (let y = 2015; y <= 2035; y++) {
  if (weeksInYear(y) === 53) { year53 = y; break; }
}
checks.push(["found at least one 53-week year in range (sanity check on the test itself)", year53 !== null]);

if (year53 !== null) {
  const y = year53;
  // Stepping forward from week 52 of a 53-week year must land on week 53, not
  // jump straight to next year's week 1 (the old bug: `nw > 52 -> ny++, nw = 1`).
  checks.push([`${y}: week 52 + 1 = week 53 (not next year's week 1)`, shiftWeek(`${y}-52`, 1) === `${y}-53`]);
  // Stepping forward once more from week 53 lands on next year's week 1.
  checks.push([`${y}: week 53 + 1 = next year's week 1`, shiftWeek(`${y}-53`, 1) === `${y + 1}-01`]);
  // Stepping backward from next year's week 1 must land back on week 53 (the old
  // bug hardcoded `nw = 52` here, landing one week off).
  checks.push([`${y + 1}: week 01 - 1 = ${y}'s week 53 (not week 52)`, shiftWeek(`${y + 1}-01`, -1) === `${y}-53`]);
}

// ── shiftWeek forward-then-back returns to the start, across several deltas ──
for (const [start, delta] of [["2026-01", 5], ["2026-50", 4], ["2024-01", -3], ["2026-30", 26]] as const) {
  const forward = shiftWeek(String(start), Number(delta));
  const back = shiftWeek(forward, -Number(delta));
  checks.push([`${start} shift by ${delta} then by ${-delta} returns to start`, back === start]);
}

// ── weekStringOf("today") lands on a week whose weekDates() actually contains that day ──
{
  const now = new Date();
  const week = weekStringOf(now);
  const dates = weekDates(week);
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  checks.push(["today's week actually contains today", dates.includes(todayStr)]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
