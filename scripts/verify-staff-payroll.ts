/**
 * End-to-end check (no HTTP): staff member → device punch → attendance → payroll.
 * Run: npx tsx -r dotenv/config scripts/verify-staff-payroll.ts
 * Creates a temporary staff member, ingests punches, asserts, then cleans up.
 */
import { storage } from "../server/storage";
import { ingestDevicePunches } from "../server/services/deviceAttendanceService";
import { db } from "../server/db";
import { attendance } from "../shared/schema";
import { eq } from "drizzle-orm";

const BIO = "ZZVERIFY1";
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

let createdId: number | null = null;
try {
  const sm = await storage.createStaffMember({
    name: "ZZ Verify Cook", designation: "Cook", pin: null,
    biometricId: BIO, monthlySalary: "26000", isActive: true,
  } as any);
  createdId = sm.id;
  console.log(`✓ created staff member #${sm.id} (bio=${BIO}, salary=26000, designation=Cook)`);

  const res = await ingestDevicePunches(
    [{ biometricId: BIO, date: today, time: "09:00" }, { biometricId: BIO, date: today, time: "18:30" }],
    "verify-script",
  );
  console.log(`✓ ingest: imported=${res.imported}, unmatched=${JSON.stringify(res.unmatched)}, affected=${JSON.stringify(res.affected)}`);

  const att = await storage.getAttendance({ staffMemberId: sm.id, date: today });
  console.log("✓ attendance row:", att.map(a => ({
    staffMemberId: a.staffMemberId, userId: a.userId, clockIn: a.clockIn, clockOut: a.clockOut,
    status: a.status, workingHours: a.workingHours, overtimeHours: a.overtimeHours, who: a.displayName,
  })));

  const report = await storage.getPayrollReport(month);
  const mine = report.find((r: any) => r.staffMemberId === sm.id);
  console.log("✓ payroll row:", mine);

  const ok = att.length === 1 && att[0].staffMemberId === sm.id && att[0].clockIn === "09:00"
    && att[0].clockOut === "18:30" && mine && mine.daysPresent === 1 && mine.monthlySalary === 26000;
  console.log(ok ? "\nRESULT: PASS ✅" : "\nRESULT: FAIL ❌ (see values above)");
} catch (e: any) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  if (createdId != null) {
    await db.delete(attendance).where(eq(attendance.staffMemberId, createdId));
    await storage.deleteStaffMember(createdId);
    console.log(`✓ cleaned up staff member #${createdId} + its attendance`);
  }
  process.exit(process.exitCode ?? 0);
}
