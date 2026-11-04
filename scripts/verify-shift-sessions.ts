/** Verifies shared/shiftTime.ts detectSessions' re-scan debounce. Run: npx tsx scripts/verify-shift-sessions.ts */
import { detectSessions } from "../shared/shiftTime";
const shifts = [{ id: 1, name: "Morning", startTime: "09:00", endTime: "15:00" }, { id: 2, name: "Evening", startTime: "16:00", endTime: "23:00" }] as any;
const checks: Array<[string, boolean]> = [];
const plain = detectSessions(["09:00", "15:00", "16:00", "23:00"], shifts);
checks.push(["two clean shifts → two 6h/7h sessions", plain.length === 2 && plain[0].workingHours === 6 && plain[1].workingHours === 7]);
const rescan = detectSessions(["09:00", "09:01", "15:00", "16:00", "23:00"], shifts);
checks.push(["a re-scan a minute later doesn't flip the pairs", rescan.length === 2 && rescan[0].clockOut === "15:00" && rescan[1].clockIn === "16:00"]);
const far = detectSessions(["09:00", "09:30"], shifts);
checks.push(["punches 30 min apart are still a pair", far.length === 1 && far[0].clockOut === "09:30"]);
let failed = 0;
for (const [n, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) failed++; }
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
