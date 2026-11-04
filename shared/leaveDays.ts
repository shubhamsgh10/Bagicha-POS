/**
 * How many of a leave's days fall inside `month` ("YYYY-MM"). Payroll used to credit a leave's
 * whole totalDays to the month it STARTED in, so Oct 30 – Nov 3 paid 5 days in October and none
 * in November, which then docked Nov 1–3 as absent. Days are calendar days (dates are
 * "YYYY-MM-DD" strings, compared as UTC so no timezone can shift them). A leave whose totalDays is
 * less than its span (a half-day) is pro-rated. Pure; locked by scripts/verify-leave-days.ts.
 */
export function leaveDaysInMonth(
  leave: { startDate: string; endDate: string; totalDays: number },
  month: string,
): number {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86400000;
  const [y, m] = month.split("-").map(Number);
  const monthStart = Date.UTC(y, m - 1, 1) / 86400000;
  const monthEnd = Date.UTC(y, m, 0) / 86400000;
  const start = day(leave.startDate);
  const end = day(leave.endDate || leave.startDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  const overlap = Math.min(end, monthEnd) - Math.max(start, monthStart) + 1;
  if (overlap <= 0) return 0;
  const span = end - start + 1;
  const total = Number(leave.totalDays) || 0;
  return Math.round(Math.min(overlap, overlap * (total / span)) * 100) / 100;
}
