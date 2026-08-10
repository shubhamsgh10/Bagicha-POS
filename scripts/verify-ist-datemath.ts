/**
 * Verifies shared/businessDay.ts's plain-IST-calendar helpers (istHour,
 * istCalendarDate, istMonthDay, istCalendarDayRange) — added to replace the raw
 * server-local Date.getHours()/getDate()/toISOString() calls scattered across the
 * WhatsApp/CRM/scheduler/dashboard/reports code, which read the SERVER's ambient
 * timezone (not guaranteed to be IST — see CLAUDE.md) instead of the restaurant's
 * actual IST wall clock.
 * Run: npx tsx scripts/verify-ist-datemath.ts
 */
import { istHour, istCalendarDate, istMonthDay, istCalendarDayRange } from "../shared/businessDay";

const checks: Array<[string, boolean]> = [];

// IST midnight for 2026-01-02 is exactly 2026-01-01T18:30:00.000Z (UTC+5:30).
const justBeforeISTMidnight = new Date("2026-01-01T18:29:59.999Z"); // 2026-01-01 23:59:59.999 IST
const exactlyISTMidnight    = new Date("2026-01-01T18:30:00.000Z"); // 2026-01-02 00:00:00.000 IST
const midDayIST             = new Date("2026-01-01T20:00:00.000Z"); // 2026-01-02 01:30 IST

checks.push(["hour just before IST midnight is 23", istHour(justBeforeISTMidnight) === 23]);
checks.push(["hour exactly at IST midnight is 0", istHour(exactlyISTMidnight) === 0]);
checks.push(["hour rolls over correctly (20:00 UTC -> 01:30 IST -> hour 1)", istHour(midDayIST) === 1]);

checks.push(["calendar date just before IST midnight is still the previous day", istCalendarDate(justBeforeISTMidnight) === "2026-01-01"]);
checks.push(["calendar date exactly at IST midnight rolls to the next day", istCalendarDate(exactlyISTMidnight) === "2026-01-02"]);
checks.push(["calendar date after the rollover matches", istCalendarDate(midDayIST) === "2026-01-02"]);

checks.push(["month-day derived correctly", istMonthDay(exactlyISTMidnight) === "01-02"]);

{
  const { start, end } = istCalendarDayRange("2026-06-15");
  checks.push(["calendar day range starts at IST midnight (UTC-5:30)", start.toISOString() === "2026-06-14T18:30:00.000Z"]);
  checks.push(["calendar day range ends 1ms before the next IST midnight", end.toISOString() === "2026-06-15T18:29:59.999Z"]);
  checks.push(["a timestamp just inside the range reports the same calendar date", istCalendarDate(new Date(start.getTime() + 1000)) === "2026-06-15"]);
  checks.push(["a timestamp just outside the range (1ms after end) reports the next day", istCalendarDate(new Date(end.getTime() + 1)) === "2026-06-16"]);
}

// Regression guard for the exact bug class fixed: hour and calendar-date must always
// come from the SAME IST snapshot, never mixed with a UTC or server-local one — this is
// what let dailyScheduler.ts's `today` (UTC) and `hour` (local) disagree.
{
  const now = new Date("2026-03-10T19:15:00.000Z"); // 2026-03-11 00:45 IST
  const hour = istHour(now);
  const date = istCalendarDate(now);
  checks.push(["hour/date pair agree on the same IST snapshot", hour === 0 && date === "2026-03-11"]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
