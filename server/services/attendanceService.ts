/**
 * attendanceService.ts
 *
 * Fetches attendance data from a public Google Sheet (CSV export URL),
 * parses it using a configurable column mapping, and upserts into
 * attendance_records table.
 *
 * No API key required — sheet must be shared as "Anyone with link can view".
 * We use the Google Sheets CSV export endpoint:
 *   https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}
 */

import { db } from "../db";
import { attendanceRecords, attendanceSyncLog } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { getAutomationConfig } from "./automationStore";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnMapping {
  employeeName:  string;   // header name in the sheet for employee name
  employeeCode?: string;   // optional employee ID / code column
  date:          string;   // header for date column
  punchIn?:      string;   // header for punch-in time
  punchOut?:     string;   // header for punch-out time
  hoursWorked?:  string;   // header for total hours (if machine calculates it)
  status?:       string;   // header for status (Present/Absent etc.)
}

export interface SyncResult {
  rowsFetched:  number;
  rowsInserted: number;
  rowsSkipped:  number;
  status:       "success" | "failed" | "partial";
  error?:       string;
  preview?:     Array<Record<string, string>>;  // first 3 rows for UI preview
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Convert any Google Sheets URL to the CSV export URL.
 * Handles /edit, /view, /pub and raw spreadsheet URLs.
 */
export function toCsvExportUrl(sheetUrl: string): string {
  // Extract spreadsheet ID
  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new Error("Invalid Google Sheets URL — cannot extract spreadsheet ID.");
  const id = idMatch[1];

  // Extract gid (sheet tab id) if present
  const gidMatch = sheetUrl.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header row — handle quoted fields
  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] ?? "").trim();
    });
    return row;
  }).filter(row => Object.values(row).some(v => v !== ""));
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current); current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Date normaliser ───────────────────────────────────────────────────────────

function normaliseDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  // MM/DD/YYYY
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;

  // Try JS Date parse as fallback
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function normaliseTime(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  // HH:MM or HH:MM:SS
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return t.substring(0, 5);
  // 12-hour: 09:02 AM
  const ampm = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2];
    const period = ampm[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  return null;
}

function calcHours(punchIn: string | null, punchOut: string | null): number | null {
  if (!punchIn || !punchOut) return null;
  const [ih, im] = punchIn.split(":").map(Number);
  const [oh, om] = punchOut.split(":").map(Number);
  const diff = (oh * 60 + om) - (ih * 60 + im);
  return diff > 0 ? Math.round((diff / 60) * 100) / 100 : null;
}

function inferStatus(row: Record<string, string>, mapping: ColumnMapping, punchIn: string | null): string {
  if (mapping.status && row[mapping.status]) {
    const raw = row[mapping.status].toLowerCase();
    if (raw.includes("absent") || raw === "a") return "absent";
    if (raw.includes("half"))   return "half-day";
    if (raw.includes("late"))   return "late";
    return "present";
  }
  return punchIn ? "present" : "absent";
}

// ── Preview (no DB write) ─────────────────────────────────────────────────────

export async function previewSheet(sheetUrl: string): Promise<{
  headers: string[];
  rows: Array<Record<string, string>>;
  error?: string;
}> {
  try {
    const csvUrl = toCsvExportUrl(sheetUrl);
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching sheet`);
    const text = await res.text();
    const rows = parseCsv(text);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { headers, rows: rows.slice(0, 5) };
  } catch (e: any) {
    return { headers: [], rows: [], error: e.message };
  }
}

// ── Main sync ─────────────────────────────────────────────────────────────────

export async function syncAttendanceFromSheet(
  sheetUrl?: string,
  mapping?: ColumnMapping,
): Promise<SyncResult> {
  const config = getAutomationConfig();
  const url     = sheetUrl  ?? config.attendanceSheetUrl;
  const colMap  = mapping   ?? config.attendanceColumnMapping;

  if (!url) {
    return { rowsFetched: 0, rowsInserted: 0, rowsSkipped: 0, status: "failed", error: "No Google Sheet URL configured." };
  }
  if (!colMap?.employeeName || !colMap?.date) {
    return { rowsFetched: 0, rowsInserted: 0, rowsSkipped: 0, status: "failed", error: "Column mapping incomplete — need at least employeeName and date." };
  }

  let rowsFetched = 0, rowsInserted = 0, rowsSkipped = 0;
  let syncStatus: "success" | "failed" | "partial" = "success";
  let errorMsg: string | undefined;

  try {
    const csvUrl = toCsvExportUrl(url);
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} — unable to fetch Google Sheet. Make sure the sheet is shared as "Anyone with link can view".`);

    const text = await res.text();
    const rows = parseCsv(text);
    rowsFetched = rows.length;

    for (const row of rows) {
      const name = row[colMap.employeeName]?.trim();
      const rawDate = row[colMap.date]?.trim();
      if (!name || !rawDate) { rowsSkipped++; continue; }

      const date = normaliseDate(rawDate);
      if (!date) { rowsSkipped++; continue; }

      const punchIn  = colMap.punchIn  ? normaliseTime(row[colMap.punchIn]  ?? "") : null;
      const punchOut = colMap.punchOut ? normaliseTime(row[colMap.punchOut] ?? "") : null;
      const code     = colMap.employeeCode ? (row[colMap.employeeCode] ?? null) : null;

      let hours: number | null = null;
      if (colMap.hoursWorked && row[colMap.hoursWorked]) {
        hours = parseFloat(row[colMap.hoursWorked]) || null;
      } else {
        hours = calcHours(punchIn, punchOut);
      }

      const status = inferStatus(row, colMap, punchIn);

      // Upsert: skip if same employee+date already exists from this sync
      const existing = await db
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.employeeName, name),
          eq(attendanceRecords.date, date),
        ))
        .limit(1);

      if (existing.length > 0) {
        // Update punch times in case sheet was corrected
        await db.update(attendanceRecords)
          .set({ punchIn, punchOut, hoursWorked: hours?.toString() ?? null, status, rawRow: row, syncedAt: new Date() })
          .where(eq(attendanceRecords.id, existing[0].id));
        rowsSkipped++;
      } else {
        await db.insert(attendanceRecords).values({
          employeeName: name,
          employeeCode: code,
          date,
          punchIn,
          punchOut,
          hoursWorked: hours?.toString() ?? null,
          status,
          source: "gsheet",
          rawRow: row,
          syncedAt: new Date(),
        });
        rowsInserted++;
      }
    }
  } catch (e: any) {
    syncStatus = "failed";
    errorMsg   = e.message;
  }

  // Log the sync run
  await db.insert(attendanceSyncLog).values({
    rowsFetched,
    rowsInserted,
    rowsSkipped,
    status: syncStatus,
    error:  errorMsg,
    sheetUrl: url,
  }).catch(() => {});

  return { rowsFetched, rowsInserted, rowsSkipped, status: syncStatus, error: errorMsg };
}
