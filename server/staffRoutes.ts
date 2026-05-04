/**
 * staffRoutes.ts
 * Staff management + attendance API endpoints.
 */

import type { Express } from "express";
import { db } from "./db";
import { attendanceRecords, attendanceSyncLog, orders, users } from "../shared/schema";
import { eq, desc, gte, lte, and, sql, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./routes";
import { syncAttendanceFromSheet, previewSheet } from "./services/attendanceService";
import { getAutomationConfig, saveAutomationConfig } from "./services/automationStore";

export function registerStaffRoutes(app: Express) {

  // ── Staff list (users) ──────────────────────────────────────────────────────

  app.get("/api/staff", requireAuth, async (_req, res) => {
    try {
      const staff = await db
        .select({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt })
        .from(users)
        .orderBy(users.role, users.username);
      res.json(staff);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Per-staff performance report ────────────────────────────────────────────

  app.get("/api/staff/performance", requireAuth, async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      const conditions = [];
      if (from) conditions.push(gte(orders.createdAt, new Date(from)));
      if (to)   conditions.push(lte(orders.createdAt, new Date(to + "T23:59:59")));

      // Orders grouped by createdBy
      const rows = await db
        .select({
          createdBy:  orders.createdBy,
          totalOrders: count(orders.id),
          totalRevenue: sql<string>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
          avgBill:      sql<string>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
        })
        .from(orders)
        .where(conditions.length ? and(...conditions) : undefined)
        .groupBy(orders.createdBy);

      // Attach user names
      const allUsers = await db.select({ id: users.id, username: users.username }).from(users);
      const userMap = Object.fromEntries(allUsers.map(u => [u.id, u.username]));

      const result = rows.map(r => ({
        staffId:     r.createdBy,
        staffName:   r.createdBy ? (userMap[r.createdBy] ?? "Unknown") : "Unassigned",
        totalOrders: Number(r.totalOrders),
        totalRevenue: parseFloat(r.totalRevenue),
        avgBill:      parseFloat(r.avgBill),
      })).sort((a, b) => b.totalRevenue - a.totalRevenue);

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Attendance: list records ────────────────────────────────────────────────

  app.get("/api/attendance", requireAuth, async (req, res) => {
    try {
      const { from, to, employee } = req.query as { from?: string; to?: string; employee?: string };
      const conditions = [];
      if (from)     conditions.push(gte(attendanceRecords.date, from));
      if (to)       conditions.push(lte(attendanceRecords.date, to));
      if (employee) conditions.push(eq(attendanceRecords.employeeName, employee));

      const rows = await db
        .select()
        .from(attendanceRecords)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(attendanceRecords.date), attendanceRecords.employeeName)
        .limit(500);

      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Attendance: unique employee names (for filter dropdown) ─────────────────

  app.get("/api/attendance/employees", requireAuth, async (_req, res) => {
    try {
      const rows = await db
        .selectDistinct({ name: attendanceRecords.employeeName })
        .from(attendanceRecords)
        .orderBy(attendanceRecords.employeeName);
      res.json(rows.map(r => r.name));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Attendance: summary stats ───────────────────────────────────────────────

  app.get("/api/attendance/summary", requireAuth, async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      const today = new Date().toISOString().slice(0, 10);
      const dateFrom = from ?? today;
      const dateTo   = to   ?? today;

      const rows = await db
        .select({
          employeeName: attendanceRecords.employeeName,
          status:       attendanceRecords.status,
          cnt:          count(attendanceRecords.id),
          totalHours:   sql<string>`COALESCE(SUM(${attendanceRecords.hoursWorked}::numeric), 0)`,
        })
        .from(attendanceRecords)
        .where(and(
          gte(attendanceRecords.date, dateFrom),
          lte(attendanceRecords.date, dateTo),
        ))
        .groupBy(attendanceRecords.employeeName, attendanceRecords.status);

      // Pivot into per-employee summary
      const map: Record<string, { present: number; absent: number; late: number; halfDay: number; totalHours: number }> = {};
      for (const r of rows) {
        if (!map[r.employeeName]) map[r.employeeName] = { present: 0, absent: 0, late: 0, halfDay: 0, totalHours: 0 };
        const cnt = Number(r.cnt);
        const hrs = parseFloat(r.totalHours);
        if (r.status === "present")  { map[r.employeeName].present  += cnt; map[r.employeeName].totalHours += hrs; }
        if (r.status === "absent")   map[r.employeeName].absent  += cnt;
        if (r.status === "late")     { map[r.employeeName].late     += cnt; map[r.employeeName].totalHours += hrs; }
        if (r.status === "half-day") { map[r.employeeName].halfDay  += cnt; map[r.employeeName].totalHours += hrs; }
      }

      res.json(Object.entries(map).map(([name, stats]) => ({ name, ...stats })));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Attendance: sync from Google Sheet ─────────────────────────────────────

  app.post("/api/attendance/sync", requireAdmin, async (req, res) => {
    try {
      const { sheetUrl, mapping } = req.body ?? {};
      const result = await syncAttendanceFromSheet(sheetUrl, mapping);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Attendance: preview sheet headers + sample rows ─────────────────────────

  app.post("/api/attendance/preview", requireAdmin, async (req, res) => {
    try {
      const { sheetUrl } = req.body ?? {};
      if (!sheetUrl) return res.status(400).json({ error: "sheetUrl required" });
      const result = await previewSheet(sheetUrl);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Attendance: sync log history ────────────────────────────────────────────

  app.get("/api/attendance/sync-log", requireAdmin, async (_req, res) => {
    try {
      const logs = await db
        .select()
        .from(attendanceSyncLog)
        .orderBy(desc(attendanceSyncLog.syncedAt))
        .limit(20);
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Attendance settings (sheetUrl + column mapping) ─────────────────────────

  app.get("/api/attendance/settings", requireAdmin, (_req, res) => {
    const config = getAutomationConfig();
    res.json({
      sheetUrl:        config.attendanceSheetUrl,
      columnMapping:   config.attendanceColumnMapping,
      autoSyncHour:    config.attendanceAutoSyncHour,
    });
  });

  app.post("/api/attendance/settings", requireAdmin, (req, res) => {
    const { sheetUrl, columnMapping, autoSyncHour } = req.body ?? {};
    saveAutomationConfig({
      attendanceSheetUrl:      sheetUrl      ?? "",
      attendanceColumnMapping: columnMapping ?? null,
      attendanceAutoSyncHour:  autoSyncHour  ?? -1,
    });
    res.json({ ok: true });
  });
}
