/**
 * staffRoutes.ts
 * Staff management + attendance API endpoints.
 */

import type { Express } from "express";
import { db } from "./db";
import { orders, users } from "../shared/schema";
import { gte, lte, and, sql, count } from "drizzle-orm";
import { requireAuth } from "./routes";
import { storage } from "./storage";

export function registerStaffRoutes(app: Express) {

  // ── Staff list (users) ──────────────────────────────────────────────────────

  // Rich staff list: profile fields (userId, biometricId, salary, dept…) + nested `user`,
  // PLUS flat id/username/role mirrors so every consumer works regardless of which it reads.
  // (Both this and routes.ts register /api/staff; this one wins by registration order, so it
  // must carry the full shape the Payroll editor and attendance board depend on.)
  app.get("/api/staff", requireAuth, async (_req, res) => {
    try {
      const profiles = await storage.getStaffProfiles();
      res.json(profiles.map((p) => ({
        ...p,
        id: p.user.id,
        username: p.user.username,
        role: p.user.role,
      })));
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
        staffName:   (r.createdBy != null ? userMap[r.createdBy] : null) ?? "Unassigned",
        totalOrders: Number(r.totalOrders),
        totalRevenue: parseFloat(r.totalRevenue),
        avgBill:      parseFloat(r.avgBill),
      })).sort((a, b) => b.totalRevenue - a.totalRevenue);

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Attendance is device-driven now (see routes.ts: /api/attendance/range, /summary, /today).
  // The legacy Google-Sheet import endpoints were removed.
}
