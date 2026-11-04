/** Verifies shared/leaveDays.ts. Run: npx tsx scripts/verify-leave-days.ts */
import { leaveDaysInMonth as L } from "../shared/leaveDays";
const checks: Array<[string, boolean]> = [];
const lv = (startDate: string, endDate: string, totalDays: number) => ({ startDate, endDate, totalDays });
checks.push(["inside one month", L(lv("2026-11-10", "2026-11-12", 3), "2026-11") === 3]);
checks.push(["Oct 30 – Nov 3: 2 days in October", L(lv("2026-10-30", "2026-11-03", 5), "2026-10") === 2]);
checks.push(["Oct 30 – Nov 3: 3 days in November", L(lv("2026-10-30", "2026-11-03", 5), "2026-11") === 3]);
checks.push(["not in the month → 0", L(lv("2026-09-01", "2026-09-02", 2), "2026-11") === 0]);
checks.push(["half-day leave → 0.5", L(lv("2026-11-05", "2026-11-05", 0.5), "2026-11") === 0.5]);
checks.push(["31 Dec – 1 Jan across a year", L(lv("2026-12-31", "2027-01-01", 2), "2026-12") === 1 && L(lv("2026-12-31", "2027-01-01", 2), "2027-01") === 1]);
checks.push(["garbage dates → 0", L(lv("x", "y", 2), "2026-11") === 0]);
let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
