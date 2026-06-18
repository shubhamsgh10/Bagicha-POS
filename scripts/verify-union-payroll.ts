/**
 * Verifies the unified payroll roster: a manager ACCOUNT (users + staffProfiles) and a STAFF MEMBER
 * both flow into getPayrollPeople + payroll + device attendance; admins are excluded.
 * Run: npx tsx -r dotenv/config scripts/verify-union-payroll.ts
 */
import { storage } from "../server/storage";
import { ingestDevicePunches } from "../server/services/deviceAttendanceService";
import { db } from "../server/db";
import { attendance, users, staffProfiles } from "../shared/schema";
import { eq } from "drizzle-orm";

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const MGR_BIO = "ZZUMGR", STAFF_BIO = "ZZUSTF";

let userId: number | null = null, smId: number | null = null;
try {
  // 1) a MANAGER account + its staff profile (biometric + salary)
  const u = await storage.createUser({ username: "zz_verify_mgr", password: "x", role: "manager" } as any);
  userId = u.id;
  await storage.upsertStaffProfile(u.id, { designation: "Manager", biometricId: MGR_BIO, monthlySalary: "30000" } as any);
  // 2) a STAFF MEMBER (attendance-only, no PIN)
  const sm = await storage.createStaffMember({ name: "ZZ Verify Maid", designation: "Cleaning", pin: null, biometricId: STAFF_BIO, monthlySalary: "12000", isActive: true } as any);
  smId = sm.id;
  console.log(`✓ created manager account #${u.id} (bio ${MGR_BIO}) + staff member #${sm.id} (bio ${STAFF_BIO})`);

  // roster: both present, admins absent
  const people = await storage.getPayrollPeople();
  const mgr = people.find(p => p.kind === "user" && p.id === u.id);
  const maid = people.find(p => p.kind === "staff" && p.id === sm.id);
  const adminUser = await storage.getUserByUsername("admin");
  const adminInRoster = adminUser ? people.some(p => p.kind === "user" && p.id === adminUser.id) : false;
  console.log(`✓ roster: ${people.length} people; manager=${JSON.stringify(mgr)}; maid=${JSON.stringify(maid)}; admin present=${adminInRoster}`);

  // punches for both
  const res = await ingestDevicePunches([
    { biometricId: MGR_BIO, date: today, time: "10:00" }, { biometricId: MGR_BIO, date: today, time: "20:00" },
    { biometricId: STAFF_BIO, date: today, time: "08:00" }, { biometricId: STAFF_BIO, date: today, time: "12:00" },
  ], "verify-union");
  console.log(`✓ ingest: imported=${res.imported}, unmatched=${JSON.stringify(res.unmatched)}`);

  const report = await storage.getPayrollReport(month);
  const mgrRow = report.find((r: any) => r.kind === "user" && r.userId === u.id);
  const maidRow = report.find((r: any) => r.kind === "staff" && r.staffMemberId === sm.id);
  console.log("✓ payroll manager:", mgrRow);
  console.log("✓ payroll maid:   ", maidRow);

  const ok = !!mgr && mgr.role === "Manager" && !!maid && !adminInRoster
    && mgrRow && mgrRow.daysPresent === 1 && mgrRow.monthlySalary === 30000
    && maidRow && maidRow.daysPresent === 1 && maidRow.monthlySalary === 12000;
  console.log(ok ? "\nRESULT: PASS ✅" : "\nRESULT: FAIL ❌");
} catch (e: any) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  if (userId != null) {
    await db.delete(attendance).where(eq(attendance.userId, userId));
    await db.delete(staffProfiles).where(eq(staffProfiles.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
  if (smId != null) {
    await db.delete(attendance).where(eq(attendance.staffMemberId, smId));
    await storage.deleteStaffMember(smId);
  }
  console.log("✓ cleaned up test records");
  process.exit(process.exitCode ?? 0);
}
