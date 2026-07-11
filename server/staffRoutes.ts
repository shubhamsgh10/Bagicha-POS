/**
 * staffRoutes.ts
 * Staff management + attendance API endpoints.
 */

import type { Express } from "express";
import { db } from "./db";
import { orders, users, staffMembers } from "../shared/schema";
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

      // Orders grouped by creator. `createdBy` (users.id) and `createdByStaffMemberId`
      // (staffMembers.id) share an integer id space, so both columns are needed to
      // disambiguate — see CLAUDE.md's id-collision note.
      const rows = await db
        .select({
          createdBy: orders.createdBy,
          createdByStaffMemberId: orders.createdByStaffMemberId,
          totalOrders: count(orders.id),
          totalRevenue: sql<string>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
        })
        .from(orders)
        .where(conditions.length ? and(...conditions) : undefined)
        .groupBy(orders.createdBy, orders.createdByStaffMemberId);

      const allUsers = await db.select({ id: users.id, username: users.username, role: users.role }).from(users);
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const allStaffMembers = await db.select({ id: staffMembers.id, name: staffMembers.name }).from(staffMembers);
      const staffMap = new Map(allStaffMembers.map(s => [s.id, s.name]));

      // Merge everything unresolvable (or admin/owner, excluded by design) into one bucket.
      const merged = new Map<string, { staffId: number | null; staffName: string; totalOrders: number; totalRevenue: number }>();
      for (const r of rows) {
        let staffId: number | null = null;
        let staffName: string | null = null;

        if (r.createdByStaffMemberId != null) {
          staffId = r.createdByStaffMemberId;
          staffName = staffMap.get(r.createdByStaffMemberId) ?? null;
        } else if (r.createdBy != null) {
          const u = userMap.get(r.createdBy);
          if (u?.role === "admin") continue; // owner/admin excluded from staff performance
          staffId = r.createdBy;
          staffName = u?.username ?? null;
        }

        const key = staffName ? `${staffId}` : "unassigned";
        const existing = merged.get(key);
        if (existing) {
          existing.totalOrders += Number(r.totalOrders);
          existing.totalRevenue += parseFloat(r.totalRevenue);
        } else {
          merged.set(key, {
            staffId: staffName ? staffId : null,
            staffName: staffName ?? "Unassigned",
            totalOrders: Number(r.totalOrders),
            totalRevenue: parseFloat(r.totalRevenue),
          });
        }
      }

      const result = Array.from(merged.values())
        .map(r => ({ ...r, avgBill: r.totalOrders > 0 ? r.totalRevenue / r.totalOrders : 0 }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue);

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Attendance is device-driven now (see routes.ts: /api/attendance/range, /summary, /today).
  // The legacy Google-Sheet import endpoints were removed.
}
