/**
 * deviceAttendanceService.ts
 *
 * Ingests raw fingerprint punches coming from the K30 Pro (via the Electron
 * AttendanceAgent) into the canonical `attendance` table — the SAME table that
 * payroll reads (`getPayrollReport`). Mirrors the Excel-import logic in
 * server/routes.ts so device punches behave identically to a manual import.
 *
 * Flow: biometricId -> userId (via staff_profiles), group by (userId, date),
 * merge with the existing day's row (so incremental / live single punches are
 * correct), recompute first/last punch -> clockIn/clockOut, hours, status, OT.
 */

import { db } from "../db";
import { storage, type PersonRef } from "../storage";
import { attendanceSyncLog } from "../../shared/schema";
import { getSettings } from "../settingsStore";
import { detectSessions } from "@shared/shiftTime";

export interface InboundPunch {
  biometricId: string | number;
  date?: string;       // "YYYY-MM-DD" (device-local) — preferred
  time?: string;       // "HH:MM"      (device-local) — preferred
  timestamp?: string;  // fallback "YYYY-MM-DD HH:MM[:SS]" / ISO, treated as WALL-CLOCK (no TZ math)
}

export interface DeviceIngestResult {
  punches: number;                                   // punches received
  imported: number;                                  // attendance rows written/updated
  unmatched: string[];                               // biometricIds with no staff member / profile
  affected: { userId?: number; staffMemberId?: number; date: string }[]; // for the realtime broadcast
  status: "success" | "partial" | "failed";
  error?: string;
}

/** Split a punch into device-local date + HH:MM without any timezone conversion. */
function splitPunch(p: InboundPunch): { date: string; time: string } | null {
  if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.time && /^\d{1,2}:\d{2}/.test(p.time)) {
    const [h, m] = p.time.split(":");
    return { date: p.date, time: `${h.padStart(2, "0")}:${m.slice(0, 2)}` };
  }
  const ts = String(p.timestamp ?? "");
  const match = ts.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (match) return { date: match[1], time: `${match[2].padStart(2, "0")}:${match[3]}` };
  return null;
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export async function ingestDevicePunches(
  punches: InboundPunch[],
  deviceId?: string,
): Promise<DeviceIngestResult> {
  const result: DeviceIngestResult = {
    punches: Array.isArray(punches) ? punches.length : 0,
    imported: 0,
    unmatched: [],
    affected: [],
    status: "success",
  };
  if (!Array.isArray(punches) || punches.length === 0) return result;

  const standardHours = getSettings().attendanceDevice?.standardHours ?? 8;
  const activeShifts = await storage.getShifts(); // for punch→shift bucketing

  // biometricId (device user-ID) -> employee. Staff members are the primary employee
  // record; system-account profiles remain a fallback for any legacy biometric setup.
  const members = await storage.getStaffMembers();
  const smBio = new Map<string, number>();          // biometricId -> staffMemberId
  for (const m of members) {
    if (m.biometricId != null && String(m.biometricId).trim() !== "") {
      smBio.set(String(m.biometricId).trim(), m.id);
    }
  }
  const profiles = await storage.getStaffProfiles();
  const userBio = new Map<string, number>();        // biometricId -> userId (legacy fallback)
  for (const p of profiles) {
    if (p.biometricId != null && String(p.biometricId).trim() !== "") {
      userBio.set(String(p.biometricId).trim(), p.userId);
    }
  }

  // Group all punch times by the matched employee (staff member OR legacy user) + date.
  const groups = new Map<string, { staffMemberId?: number; userId?: number; date: string; times: string[] }>();
  const unmatched = new Set<string>();

  for (const punch of punches) {
    const bio = String(punch.biometricId ?? "").trim();
    if (!bio) continue;
    const split = splitPunch(punch);
    if (!split) continue;
    let key: string;
    let who: { staffMemberId?: number; userId?: number };
    if (smBio.has(bio))        { who = { staffMemberId: smBio.get(bio)! }; key = `s${who.staffMemberId}|${split.date}`; }
    else if (userBio.has(bio)) { who = { userId: userBio.get(bio)! };       key = `u${who.userId}|${split.date}`; }
    else { unmatched.add(bio); continue; }
    if (!groups.has(key)) groups.set(key, { ...who, date: split.date, times: [] });
    groups.get(key)!.times.push(split.time);
  }

  try {
    for (const { staffMemberId, userId, date, times } of Array.from(groups.values())) {
      // Merge with the existing row so incremental / live single punches stay correct.
      const [existing] = staffMemberId != null
        ? await storage.getAttendance({ staffMemberId, date })
        : await storage.getAttendance({ userId, date });

      // Respect a manual admin override (markedBy != null) — device only fills biometric rows.
      if (existing && existing.markedBy != null) {
        result.affected.push({ staffMemberId, userId, date });
        continue;
      }

      const person: PersonRef = staffMemberId != null
        ? { kind: "staff", id: staffMemberId }
        : { kind: "user", id: userId! };

      // Pool = this batch's punches + the in/out of already-detected AUTO sessions for the day.
      // Pulling from the auto sessions (each stores BOTH endpoints) preserves interior shift
      // boundaries across sync batches — the single attendance row only keeps global first/last.
      const priorSessions = await storage.getAutoShiftSessions(person, date);
      const pool: string[] = [...times];
      for (const s of priorSessions) {
        if (s.clockIn) pool.push(s.clockIn.slice(0, 5));
        if (s.clockOut) pool.push(s.clockOut.slice(0, 5));
      }
      // Legacy single-span rows (pre-feature) may still carry endpoints on the attendance row.
      if (priorSessions.length === 0) {
        if (existing?.clockIn) pool.push(existing.clockIn.slice(0, 5));
        if (existing?.clockOut) pool.push(existing.clockOut.slice(0, 5));
      }
      const valid = Array.from(new Set(pool.filter((t) => /^\d{1,2}:\d{2}/.test(t)).map((t) => t.slice(0, 5))))
        .sort((a, b) => minutesOf(a) - minutesOf(b));
      if (valid.length === 0) continue;

      // Bucket punches into shift sessions (Morning / Evening / …). Empty if no shifts defined.
      const sessions = detectSessions(valid, activeShifts);
      await storage.replaceAutoShiftSessions(person, date, sessions);

      // Attendance day row: first/last for display, hours = Σ session spans (excludes midday gaps).
      const clockIn = valid[0];
      const clockOut = valid.length > 1 ? valid[valid.length - 1] : undefined;
      let workingHours: string | undefined;
      let overtimeHours = "0";
      let status = "present";
      const totalHours = sessions.length > 0
        ? sessions.reduce((sum, s) => sum + s.workingHours, 0)
        // No shifts defined → fall back to raw first→last span.
        : (clockIn && clockOut ? Math.round(((minutesOf(clockOut) - minutesOf(clockIn)) / 60) * 100) / 100 : 0);
      if (totalHours > 0) {
        workingHours = totalHours.toFixed(2);
        if (totalHours < 4) status = "half-day";
        overtimeHours = Math.max(0, totalHours - standardHours).toFixed(2);
      }

      const row = { clockIn, clockOut, status, workingHours, overtimeHours };
      if (staffMemberId != null) {
        await storage.upsertAttendanceForStaffMember(staffMemberId, date, row);
      } else {
        await storage.upsertAttendance(userId!, date, row);
      }
      result.imported++;
      result.affected.push({ staffMemberId, userId, date });
    }
  } catch (e: any) {
    result.status = "failed";
    result.error = e.message;
  }

  result.unmatched = Array.from(unmatched);

  // Audit trail (reuses the existing sync-log table; sheetUrl column doubles as the source label).
  await db.insert(attendanceSyncLog).values({
    rowsFetched: result.punches,
    rowsInserted: result.imported,
    rowsSkipped: result.punches - result.imported,
    status: result.status,
    error: result.error,
    sheetUrl: deviceId ? `device:${deviceId}` : "device",
  }).catch(() => {});

  return result;
}

/**
 * Re-derive shift sessions + corrected day-hours for every attendance row in a month, from the
 * punch endpoints already stored (each auto session keeps its own in/out; plus the row's first/last
 * for legacy pre-feature rows). Admin "Recompute" backfill.
 * LIMITATION: a day that collapsed to a single first→last span BEFORE this feature lost its interior
 * punches, so it can only resolve to one session — going forward, live punches split correctly.
 */
export async function recomputeShiftSessions(month: string): Promise<{ rows: number }> {
  const standardHours = getSettings().attendanceDevice?.standardHours ?? 8;
  const activeShifts = await storage.getShifts();
  const rows = await storage.getAttendance({ month });
  let touched = 0;

  for (const r of rows) {
    if (r.markedBy != null) continue; // don't clobber manual admin overrides
    const person: PersonRef = r.staffMemberId != null
      ? { kind: "staff", id: r.staffMemberId }
      : r.userId != null ? { kind: "user", id: r.userId } : (undefined as any);
    if (!person) continue;

    const priorSessions = await storage.getAutoShiftSessions(person, r.date);
    const pool: string[] = [];
    for (const s of priorSessions) {
      if (s.clockIn) pool.push(s.clockIn.slice(0, 5));
      if (s.clockOut) pool.push(s.clockOut.slice(0, 5));
    }
    if (priorSessions.length === 0) {
      if (r.clockIn) pool.push(r.clockIn.slice(0, 5));
      if (r.clockOut) pool.push(r.clockOut.slice(0, 5));
    }
    const valid = Array.from(new Set(pool.filter((t) => /^\d{1,2}:\d{2}/.test(t)).map((t) => t.slice(0, 5))))
      .sort((a, b) => minutesOf(a) - minutesOf(b));
    if (valid.length === 0) continue;

    const sessions = detectSessions(valid, activeShifts);
    await storage.replaceAutoShiftSessions(person, r.date, sessions);

    const clockIn = valid[0];
    const clockOut = valid.length > 1 ? valid[valid.length - 1] : undefined;
    const totalHours = sessions.length > 0
      ? sessions.reduce((sum, s) => sum + s.workingHours, 0)
      : (clockIn && clockOut ? Math.round(((minutesOf(clockOut) - minutesOf(clockIn)) / 60) * 100) / 100 : 0);
    let workingHours: string | undefined;
    let overtimeHours = "0";
    let status = "present";
    if (totalHours > 0) {
      workingHours = totalHours.toFixed(2);
      if (totalHours < 4) status = "half-day";
      overtimeHours = Math.max(0, totalHours - standardHours).toFixed(2);
    }
    const row = { clockIn, clockOut, status, workingHours, overtimeHours };
    if (person.kind === "staff") await storage.upsertAttendanceForStaffMember(person.id, r.date, row);
    else await storage.upsertAttendance(person.id, r.date, row);
    touched++;
  }
  return { rows: touched };
}
