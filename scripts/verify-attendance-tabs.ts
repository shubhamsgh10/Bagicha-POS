/**
 * Verifies the device-backed Attendance/Summary reads over the unified roster (admins excluded).
 * Run: npx tsx -r dotenv/config scripts/verify-attendance-tabs.ts
 */
import { storage } from "../server/storage";
import { ingestDevicePunches } from "../server/services/deviceAttendanceService";
import { db } from "../server/db";
import { attendance } from "../shared/schema";
import { eq } from "drizzle-orm";

const today = new Date().toISOString().slice(0, 10);
const BIO = "ZZTAB1";
let smId: number | null = null;
try {
  const sm = await storage.createStaffMember({ name: "ZZ Tab Cook", designation: "Cook", pin: null, biometricId: BIO, monthlySalary: "10000", isActive: true } as any);
  smId = sm.id;
  await ingestDevicePunches([{ biometricId: BIO, date: today, time: "09:00" }, { biometricId: BIO, date: today, time: "17:00" }], "verify-tabs");

  const range = await storage.getAttendanceRange({ from: today, to: today });
  const mine = range.find((r: any) => r.key === `sm:${sm.id}`);
  console.log("range row:", mine);

  const summary = await storage.getAttendanceSummary({ from: today, to: today });
  const mineSum = summary.find((s: any) => s.key === `sm:${sm.id}`);
  console.log("summary row:", mineSum);

  const adminUser = await storage.getUserByUsername("admin");
  const adminInRange = adminUser ? range.some((r: any) => r.key === `u:${adminUser.id}`) : false;
  const adminInSummary = adminUser ? summary.some((s: any) => s.key === `u:${adminUser.id}`) : false;
  console.log(`admin present in range/summary: ${adminInRange} / ${adminInSummary} (both must be false)`);

  const ok = !!mine && mine.employeeName === "ZZ Tab Cook" && mine.punchIn === "09:00" && mine.punchOut === "17:00"
    && !!mineSum && mineSum.present === 1 && !adminInRange && !adminInSummary;
  console.log(ok ? "\nRESULT: PASS ✅" : "\nRESULT: FAIL ❌");
} catch (e: any) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  if (smId != null) { await db.delete(attendance).where(eq(attendance.staffMemberId, smId)); await storage.deleteStaffMember(smId); }
  console.log("cleaned up");
  process.exit(process.exitCode ?? 0);
}
