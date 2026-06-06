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
import { storage } from "../storage";
import { attendanceSyncLog } from "../../shared/schema";
import { getSettings } from "../settingsStore";

export interface InboundPunch {
  biometricId: string | number;
  date?: string;       // "YYYY-MM-DD" (device-local) — preferred
  time?: string;       // "HH:MM"      (device-local) — preferred
  timestamp?: string;  // fallback "YYYY-MM-DD HH:MM[:SS]" / ISO, treated as WALL-CLOCK (no TZ math)
}

export interface DeviceIngestResult {
  punches: number;                                   // punches received
  imported: number;                                  // attendance rows written/updated
  unmatched: string[];                               // biometricIds with no staff profile
  affected: { userId: number; date: string }[];      // for the realtime broadcast
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

  // biometricId (device user-ID) -> userId
  const profiles = await storage.getStaffProfiles();
  const bioMap = new Map<string, number>();
  for (const p of profiles) {
    if (p.biometricId != null && String(p.biometricId).trim() !== "") {
      bioMap.set(String(p.biometricId).trim(), p.userId);
    }
  }

  // Group all punch times by (userId, date)
  const groups = new Map<string, { userId: number; date: string; times: string[] }>();
  const unmatched = new Set<string>();

  for (const punch of punches) {
    const bio = String(punch.biometricId ?? "").trim();
    if (!bio) continue;
    const userId = bioMap.get(bio);
    if (userId == null) { unmatched.add(bio); continue; }
    const split = splitPunch(punch);
    if (!split) continue;
    const key = `${userId}|${split.date}`;
    if (!groups.has(key)) groups.set(key, { userId, date: split.date, times: [] });
    groups.get(key)!.times.push(split.time);
  }

  try {
    for (const { userId, date, times } of Array.from(groups.values())) {
      // Merge with the existing row so incremental / live single punches stay correct.
      const [existing] = await storage.getAttendance({ userId, date });

      // Respect a manual admin override (markedBy != null) — device only fills biometric rows.
      if (existing && existing.markedBy != null) {
        result.affected.push({ userId, date });
        continue;
      }

      const all = [...times];
      if (existing?.clockIn) all.push(existing.clockIn.slice(0, 5));
      if (existing?.clockOut) all.push(existing.clockOut.slice(0, 5));
      const valid = all
        .filter((t) => /^\d{2}:\d{2}$/.test(t))
        .sort((a, b) => minutesOf(a) - minutesOf(b));
      if (valid.length === 0) continue;

      const clockIn = valid[0];
      const clockOut = valid.length > 1 ? valid[valid.length - 1] : undefined;

      let workingHours: string | undefined;
      let overtimeHours = "0";
      let status = "present";
      if (clockIn && clockOut) {
        const h = Math.round(((minutesOf(clockOut) - minutesOf(clockIn)) / 60) * 100) / 100;
        if (h > 0) {
          workingHours = h.toFixed(2);
          if (h < 4) status = "half-day";
          overtimeHours = Math.max(0, h - standardHours).toFixed(2);
        }
      }

      await storage.upsertAttendance(userId, date, {
        clockIn,
        clockOut,
        status,
        workingHours,
        overtimeHours,
      });
      result.imported++;
      result.affected.push({ userId, date });
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
