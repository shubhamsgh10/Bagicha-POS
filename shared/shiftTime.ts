/**
 * shiftTime.ts — shared shift/punch time math (server + client).
 *
 * Times are plain "HH:MM" 24h strings. The one subtlety is shifts that cross
 * midnight (e.g. Evening 16:00–00:00): a naive `end - start` goes negative, so
 * every duration/window computation must wrap the end past midnight (+24h).
 */

/** Minutes since midnight for an "HH:MM" (or "HH:MM:SS" / "HH:MM AM/PM"-prefixed) string. */
export function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export interface ShiftWindow {
  start: number; // minutes since midnight
  end: number;   // minutes since midnight, wrapped past midnight if the shift crosses it (may exceed 1440)
  hours: number; // window length in hours
}

/** Normalize a shift's [start,end] into a window, wrapping the end past midnight when needed. */
export function shiftWindow(startTime: string, endTime: string): ShiftWindow {
  const start = minutesOf(startTime);
  let end = minutesOf(endTime);
  if (end <= start) end += 1440; // wrap past midnight — fixes 16:00–00:00 showing 0h
  return { start, end, hours: Math.round(((end - start) / 60) * 100) / 100 };
}

/** Hours between two "HH:MM" punch times, wrapping across midnight; 0 if out<=in on the same day span. */
export function spanHours(clockIn: string, clockOut: string): number {
  const inM = minutesOf(clockIn);
  let outM = minutesOf(clockOut);
  if (outM < inM) outM += 1440; // punch-out after midnight
  return Math.round(((outM - inM) / 60) * 100) / 100;
}

export interface ShiftDef { id: number; startTime: string; endTime: string; }

/**
 * Pick the shift a punch-in belongs to: the shift whose window contains it
 * (checking both the raw minute and its after-midnight +1440 form), else the
 * nearest shift by absolute distance to the window start. Returns null if no shifts.
 */
export function matchShift(clockIn: string, shifts: ShiftDef[]): ShiftDef | null {
  if (!shifts.length) return null;
  const inM = minutesOf(clockIn);
  let best: ShiftDef | null = null;
  let bestDist = Infinity;
  for (const s of shifts) {
    const w = shiftWindow(s.startTime, s.endTime);
    for (const cand of [inM, inM + 1440]) {
      if (cand >= w.start && cand < w.end) return s; // contained — exact match wins
      const dist = Math.abs(cand - w.start);
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
  }
  return best;
}

export interface DetectedSession { shiftId: number; clockIn: string; clockOut?: string; workingHours: number; }

/**
 * Turn a pool of "HH:MM" punch times into per-shift work sessions.
 * Sorts + dedupes, pairs sequentially ([in,out],[in,out],…) — a trailing odd
 * punch is an open session (no out yet, 0h) — and matches each pair to a shift.
 */
export function detectSessions(punchPool: string[], shifts: ShiftDef[]): DetectedSession[] {
  const valid = Array.from(new Set(
    punchPool.filter((t) => /^\d{1,2}:\d{2}/.test(t)).map((t) => t.slice(0, 5)),
  )).sort((a, b) => minutesOf(a) - minutesOf(b));

  const sessions: DetectedSession[] = [];
  for (let i = 0; i < valid.length; i += 2) {
    const clockIn = valid[i];
    const clockOut = valid[i + 1]; // may be undefined (open session)
    const shift = matchShift(clockIn, shifts);
    if (!shift) continue; // no shifts defined — caller falls back to single-span behavior
    sessions.push({
      shiftId: shift.id,
      clockIn,
      clockOut,
      workingHours: clockOut ? spanHours(clockIn, clockOut) : 0,
    });
  }
  return sessions;
}
