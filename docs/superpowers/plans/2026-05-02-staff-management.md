# Staff Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Attendance (biometric Excel import), Shifts, Leaves, and Payroll tabs to the existing Admin page (`client/src/pages/Admin.tsx`), backed by 5 new DB tables, storage methods, and API routes.

**Architecture:** New tables added to `shared/schema.ts` -> storage methods in `server/storage.ts` -> REST endpoints in `server/routes.ts` -> 4 new tab components inlined into `client/src/pages/Admin.tsx`. All tabs are admin/manager visible only, following the existing pattern.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express, React + TanStack Query, shadcn/ui, xlsx (Excel parsing), date-fns (already installed)

---

## File Map

| File | Change |
|------|--------|
| `shared/schema.ts` | Add 5 tables + zod schemas + types |
| `server/storage.ts` | Add IStorage methods + DatabaseStorage impl |
| `server/routes.ts` | Add 16 staff API routes |
| `client/src/pages/Admin.tsx` | Add AttendanceTab, ShiftsTab, LeavesTab, PayrollTab + wire into Tabs |
| `package.json` (root) | Add `xlsx` + `multer` dependencies |

---

## Task 1: Install dependencies and add DB schema

**Files:**
- Modify: `package.json`
- Modify: `shared/schema.ts`

- [ ] **Step 1: Install xlsx and multer**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
npm install xlsx multer @types/multer
```

Expected: packages added successfully.

- [ ] **Step 2: Add 5 new tables to `shared/schema.ts`**

Append the following block at the very end of `shared/schema.ts` (after `export type CrmEventType = ...`).

NOTE: Do NOT add `import { date, time }` — all date/time fields use the existing `text` type. The existing imports already have everything needed.

```typescript
// =============================================================================
// STAFF MANAGEMENT TABLES
// =============================================================================

export const staffProfiles = pgTable("staff_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  biometricId: text("biometric_id"),
  department: text("department"),
  designation: text("designation"),
  monthlySalary: decimal("monthly_salary", { precision: 10, scale: 2 }).notNull().default("0"),
  joiningDate: text("joining_date"),
  emergencyContact: text("emergency_contact"),
  address: text("address"),
  bankAccountNo: text("bank_account_no"),
  bankName: text("bank_name"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: text("date").notNull(),        // "YYYY-MM-DD"
  clockIn: text("clock_in"),           // "HH:MM" or "HH:MM AM/PM"
  clockOut: text("clock_out"),         // "HH:MM" or "HH:MM AM/PM"
  status: text("status").notNull().default("present"), // present|absent|half-day|on-leave|holiday
  workingHours: decimal("working_hours", { precision: 4, scale: 2 }),
  overtimeHours: decimal("overtime_hours", { precision: 4, scale: 2 }).default("0"),
  notes: text("notes"),
  markedBy: integer("marked_by"),      // null = biometric import; userId = admin override
  importedAt: timestamp("imported_at").defaultNow(),
});

export const leaves = pgTable("leaves", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  leaveType: text("leave_type").notNull().default("casual"), // sick|casual|earned|unpaid
  startDate: text("start_date").notNull(),  // "YYYY-MM-DD"
  endDate: text("end_date").notNull(),      // "YYYY-MM-DD"
  totalDays: integer("total_days").notNull().default(1),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending|approved|rejected
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),  // "HH:MM"
  endTime: text("end_time").notNull(),      // "HH:MM"
  durationHours: decimal("duration_hours", { precision: 4, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
});

export const shiftAssignments = pgTable("shift_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  shiftId: integer("shift_id").notNull(),
  date: text("date").notNull(),  // "YYYY-MM-DD"
  createdBy: integer("created_by").notNull(),
});

// -- Staff Insert Schemas
export const insertStaffProfileSchema = createInsertSchema(staffProfiles).omit({ id: true, updatedAt: true });
export const insertAttendanceSchema = createInsertSchema(attendance).omit({ id: true, importedAt: true });
export const insertLeaveSchema = createInsertSchema(leaves).omit({ id: true, createdAt: true });
export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export const insertShiftAssignmentSchema = createInsertSchema(shiftAssignments).omit({ id: true });

// -- Staff Types
export type StaffProfile = typeof staffProfiles.$inferSelect;
export type InsertStaffProfile = z.infer<typeof insertStaffProfileSchema>;
export type Attendance = typeof attendance.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Leave = typeof leaves.$inferSelect;
export type InsertLeave = z.infer<typeof insertLeaveSchema>;
export type Shift = typeof shifts.$inferSelect;
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type InsertShiftAssignment = z.infer<typeof insertShiftAssignmentSchema>;
```

- [ ] **Step 3: Push schema to DB**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
npm run db:push
```

Expected: 5 new tables created (staff_profiles, attendance, leaves, shifts, shift_assignments). No errors.

- [ ] **Step 4: Commit**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
git add shared/schema.ts package.json package-lock.json
git commit -m "feat: add staff management DB schema (5 tables) + xlsx/multer deps"
```

---

## Task 2: Add storage methods to server/storage.ts

**Files:**
- Modify: `server/storage.ts`

- [ ] **Step 1: Update the import block at top of storage.ts**

Replace the existing import block (lines 1-9, starting with `import { users, categories...`) with:

```typescript
import {
  users, categories, menuItems, inventory, orders, orderItems, kotTickets, deliveryIntegrations, sales, tables,
  staffProfiles, attendance, leaves, shifts, shiftAssignments,
  type User, type InsertUser, type Category, type InsertCategory, type MenuItem, type InsertMenuItem,
  type Inventory, type InsertInventory, type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
  type KotTicket, type InsertKotTicket, type DeliveryIntegration, type InsertDeliveryIntegration,
  type Sales, type InsertSales, type Table, type InsertTable,
  type StaffProfile, type InsertStaffProfile, type Attendance, type InsertAttendance,
  type Leave, type InsertLeave, type Shift, type InsertShift,
  type ShiftAssignment, type InsertShiftAssignment,
} from "@shared/schema";
```

- [ ] **Step 2: Add staff methods to the IStorage interface**

Find the line `updateTableStatus(id: number, status: string, currentOrderId?: number | null): Promise<Table>;` in `IStorage` and add these lines immediately after it:

```typescript
  // Staff Management
  getStaffProfiles(): Promise<(StaffProfile & { user: User })[]>;
  getStaffProfile(userId: number): Promise<StaffProfile | null>;
  upsertStaffProfile(userId: number, data: Partial<InsertStaffProfile>): Promise<StaffProfile>;
  getAttendance(filters: { userId?: number; date?: string; month?: string }): Promise<(Attendance & { user: User })[]>;
  getTodayAttendance(): Promise<(Attendance & { user: User })[]>;
  upsertAttendance(userId: number, date: string, data: Partial<InsertAttendance>): Promise<Attendance>;
  updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance>;
  getAttendanceReport(month: string): Promise<any[]>;
  getLeaves(filters: { userId?: number; month?: string; status?: string }): Promise<(Leave & { user: User })[]>;
  createLeave(data: InsertLeave): Promise<Leave>;
  updateLeave(id: number, data: Partial<InsertLeave>): Promise<Leave>;
  getShifts(): Promise<Shift[]>;
  createShift(data: InsertShift): Promise<Shift>;
  updateShift(id: number, data: Partial<InsertShift>): Promise<Shift>;
  getRoster(week: string): Promise<any[]>;
  upsertShiftAssignment(userId: number, date: string, shiftId: number, createdBy: number): Promise<ShiftAssignment>;
  deleteShiftAssignment(id: number): Promise<void>;
  getPayrollReport(month: string): Promise<any[]>;
```

- [ ] **Step 3: Add implementations to DatabaseStorage class**

Find the closing brace `}` of the `DatabaseStorage` class (the last `}` in the file) and insert the following implementation before it:

```typescript
  // ============================================================
  // STAFF MANAGEMENT
  // ============================================================

  async getStaffProfiles(): Promise<(StaffProfile & { user: User })[]> {
    const allUsers = await db.select().from(users).orderBy(asc(users.id));
    const profiles = await db.select().from(staffProfiles);
    const profileMap = new Map(profiles.map(p => [p.userId, p]));
    return allUsers.map(u => ({
      ...(profileMap.get(u.id) ?? {
        id: 0, userId: u.id, biometricId: null, department: null, designation: null,
        monthlySalary: "0", joiningDate: null, emergencyContact: null, address: null,
        bankAccountNo: null, bankName: null, isActive: true, updatedAt: new Date(),
      }),
      user: u,
    })) as (StaffProfile & { user: User })[];
  }

  async getStaffProfile(userId: number): Promise<StaffProfile | null> {
    const [p] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, userId));
    return p ?? null;
  }

  async upsertStaffProfile(userId: number, data: Partial<InsertStaffProfile>): Promise<StaffProfile> {
    const existing = await this.getStaffProfile(userId);
    if (existing) {
      const [updated] = await db.update(staffProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(staffProfiles.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(staffProfiles)
      .values({ userId, monthlySalary: "0", ...data })
      .returning();
    return created;
  }

  async getAttendance(filters: { userId?: number; date?: string; month?: string }): Promise<(Attendance & { user: User })[]> {
    const conditions: any[] = [];
    if (filters.userId) conditions.push(eq(attendance.userId, filters.userId));
    if (filters.date)   conditions.push(eq(attendance.date, filters.date));
    if (filters.month)  conditions.push(sql`${attendance.date} LIKE ${filters.month + '-%'}`);
    const rows = conditions.length
      ? await db.select().from(attendance).where(and(...conditions)).orderBy(desc(attendance.date))
      : await db.select().from(attendance).orderBy(desc(attendance.date));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return rows.map(r => ({ ...r, user: userMap.get(r.userId)! })).filter(r => r.user);
  }

  async getTodayAttendance(): Promise<(Attendance & { user: User })[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.getAttendance({ date: today });
  }

  async upsertAttendance(userId: number, date: string, data: Partial<InsertAttendance>): Promise<Attendance> {
    const [existing] = await db.select().from(attendance)
      .where(and(eq(attendance.userId, userId), eq(attendance.date, date)));
    if (existing) {
      const [updated] = await db.update(attendance).set(data).where(eq(attendance.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(attendance).values({ userId, date, status: "present", ...data }).returning();
    return created;
  }

  async updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance> {
    const [updated] = await db.update(attendance).set(data).where(eq(attendance.id, id)).returning();
    return updated;
  }

  async getAttendanceReport(month: string): Promise<any[]> {
    const allUsers = await db.select().from(users);
    const monthAttendance = await db.select().from(attendance)
      .where(sql`${attendance.date} LIKE ${month + '-%'}`);
    return allUsers.map(u => {
      const records = monthAttendance.filter(a => a.userId === u.id);
      const present   = records.filter(a => a.status === 'present').length;
      const halfDay   = records.filter(a => a.status === 'half-day').length;
      const onLeave   = records.filter(a => a.status === 'on-leave').length;
      const absent    = records.filter(a => a.status === 'absent').length;
      const totalHours = records.reduce((sum, a) => sum + parseFloat(a.workingHours ?? '0'), 0);
      return { userId: u.id, username: u.username, role: u.role, present, halfDay, onLeave, absent, totalHours: totalHours.toFixed(1) };
    });
  }

  async getLeaves(filters: { userId?: number; month?: string; status?: string }): Promise<(Leave & { user: User })[]> {
    const conditions: any[] = [];
    if (filters.userId) conditions.push(eq(leaves.userId, filters.userId));
    if (filters.status && filters.status !== '') conditions.push(eq(leaves.status, filters.status));
    if (filters.month)  conditions.push(sql`${leaves.startDate} LIKE ${filters.month + '-%'}`);
    const rows = conditions.length
      ? await db.select().from(leaves).where(and(...conditions)).orderBy(desc(leaves.createdAt))
      : await db.select().from(leaves).orderBy(desc(leaves.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return rows.map(r => ({ ...r, user: userMap.get(r.userId)! })).filter(r => r.user);
  }

  async createLeave(data: InsertLeave): Promise<Leave> {
    const [created] = await db.insert(leaves).values(data).returning();
    return created;
  }

  async updateLeave(id: number, data: Partial<InsertLeave>): Promise<Leave> {
    const [updated] = await db.update(leaves).set(data).where(eq(leaves.id, id)).returning();
    return updated;
  }

  async getShifts(): Promise<Shift[]> {
    return db.select().from(shifts).where(eq(shifts.isActive, true)).orderBy(asc(shifts.id));
  }

  async createShift(data: InsertShift): Promise<Shift> {
    const [created] = await db.insert(shifts).values(data).returning();
    return created;
  }

  async updateShift(id: number, data: Partial<InsertShift>): Promise<Shift> {
    const [updated] = await db.update(shifts).set(data).where(eq(shifts.id, id)).returning();
    return updated;
  }

  async getRoster(week: string): Promise<any[]> {
    // Compute Mon-Sun for ISO week "YYYY-WW"
    const [year, weekNum] = week.split('-').map(Number);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const weekStart = new Date(jan4);
    weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    const allUsers = await db.select().from(users);
    const assignments = await db.select().from(shiftAssignments)
      .where(sql`${shiftAssignments.date} = ANY(ARRAY[${sql.join(dates.map(d => sql`${d}`), sql`, `)}])`);
    const allShifts = await db.select().from(shifts);
    const shiftMap = new Map(allShifts.map(s => [s.id, s]));
    return allUsers.map(u => {
      const userAssignments: Record<string, any> = {};
      dates.forEach(d => {
        const a = assignments.find(x => x.userId === u.id && x.date === d);
        userAssignments[d] = a ? { assignmentId: a.id, shift: shiftMap.get(a.shiftId) } : null;
      });
      return { userId: u.id, username: u.username, role: u.role, dates, assignments: userAssignments };
    });
  }

  async upsertShiftAssignment(userId: number, date: string, shiftId: number, createdBy: number): Promise<ShiftAssignment> {
    const [existing] = await db.select().from(shiftAssignments)
      .where(and(eq(shiftAssignments.userId, userId), eq(shiftAssignments.date, date)));
    if (existing) {
      const [updated] = await db.update(shiftAssignments)
        .set({ shiftId, createdBy })
        .where(eq(shiftAssignments.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(shiftAssignments).values({ userId, date, shiftId, createdBy }).returning();
    return created;
  }

  async deleteShiftAssignment(id: number): Promise<void> {
    await db.delete(shiftAssignments).where(eq(shiftAssignments.id, id));
  }

  async getPayrollReport(month: string): Promise<any[]> {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    let sundays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, mon - 1, d).getDay() === 0) sundays++;
    }
    const workingDays = daysInMonth - sundays;
    const allUsers = await db.select().from(users);
    const profiles = await db.select().from(staffProfiles);
    const profileMap = new Map(profiles.map(p => [p.userId, p]));
    const monthAttendance = await db.select().from(attendance)
      .where(sql`${attendance.date} LIKE ${month + '-%'}`);
    const monthLeaves = await db.select().from(leaves)
      .where(and(sql`${leaves.startDate} LIKE ${month + '-%'}`, eq(leaves.status, 'approved')));
    return allUsers.map(u => {
      const profile = profileMap.get(u.id);
      const salary = parseFloat(profile?.monthlySalary ?? '0');
      const records = monthAttendance.filter(a => a.userId === u.id);
      const daysPresent = records.filter(a => a.status === 'present').length;
      const halfDays = records.filter(a => a.status === 'half-day').length;
      const approvedLeaves = monthLeaves.filter(l => l.userId === u.id).reduce((s, l) => s + l.totalDays, 0);
      const paidDays = daysPresent + (halfDays * 0.5) + approvedLeaves;
      const absentDays = Math.max(0, workingDays - paidDays);
      const dailyRate = workingDays > 0 ? salary / workingDays : 0;
      const deductions = absentDays * dailyRate;
      const overtimeHours = records.reduce((s, a) => s + parseFloat(a.overtimeHours ?? '0'), 0);
      const overtimePay = overtimeHours * (dailyRate / 8);
      const netSalary = salary - deductions + overtimePay;
      return {
        userId: u.id, username: u.username, role: u.role,
        monthlySalary: salary, workingDays, daysPresent, halfDays,
        approvedLeaves, absentDays: Math.round(absentDays * 10) / 10,
        deductions: Math.round(deductions * 100) / 100,
        overtimeHours: Math.round(overtimeHours * 10) / 10,
        overtimePay: Math.round(overtimePay * 100) / 100,
        netSalary: Math.round(netSalary * 100) / 100,
      };
    });
  }
```

- [ ] **Step 4: Commit**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
git add server/storage.ts
git commit -m "feat: add staff management storage methods"
```

---

## Task 3: Add API routes to server/routes.ts

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: Add xlsx and multer imports to routes.ts**

Find the line `import { eq, desc } from "drizzle-orm";` near the top of routes.ts and add after it:

```typescript
import * as XLSX from "xlsx";
import multer from "multer";
import {
  staffProfiles, attendance, leaves, shifts, shiftAssignments,
} from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });
```

- [ ] **Step 2: Add all staff routes to routes.ts**

Find `return httpServer;` at the very end of the `registerRoutes` function and paste all the following routes immediately BEFORE that line:

```typescript
  // ==========================================================================
  // STAFF MANAGEMENT ROUTES
  // ==========================================================================

  // GET /api/staff — all users with staff profiles
  app.get("/api/staff", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getStaffProfiles());
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PUT /api/staff/:id/profile — upsert staff profile (salary, biometricId, dept, etc.)
  app.put("/api/staff/:id/profile", requireAuth, async (req, res) => {
    try {
      const profile = await storage.upsertStaffProfile(parseInt(req.params.id), req.body);
      res.json(profile);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance — list with optional ?userId=&date=&month=YYYY-MM
  app.get("/api/attendance", requireAuth, async (req, res) => {
    try {
      const { userId, date, month } = req.query as Record<string, string>;
      res.json(await storage.getAttendance({
        userId: userId ? parseInt(userId) : undefined,
        date: date || undefined,
        month: month || undefined,
      }));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/today
  app.get("/api/attendance/today", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getTodayAttendance());
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/attendance/report?month=YYYY-MM
  app.get("/api/attendance/report", requireAuth, async (req, res) => {
    try {
      const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
      res.json(await storage.getAttendanceReport(month));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/attendance/import — upload biometric Excel (.xlsx/.xls/.csv)
  app.post("/api/attendance/import", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const profiles = await storage.getStaffProfiles();
      const bioMap = new Map<string, number>();
      profiles.forEach(p => { if (p.biometricId) bioMap.set(p.biometricId.toString().trim(), p.userId); });
      const nameMap = new Map<string, number>();
      profiles.forEach(p => nameMap.set(p.user.username.toLowerCase(), p.userId));

      let imported = 0;
      const unmatched: string[] = [];

      for (const row of rows) {
        const empId   = String(row["Emp ID"] ?? row["EmpID"] ?? row["Employee ID"] ?? row["emp_id"] ?? "").trim();
        const empName = String(row["Name"] ?? row["Employee Name"] ?? row["EmpName"] ?? "").trim();
        const dateStr = row["Date"] ?? row["date"] ?? "";
        const inTime  = String(row["In-Time"] ?? row["InTime"] ?? row["Clock In"] ?? row["in_time"] ?? "").trim();
        const outTime = String(row["Out-Time"] ?? row["OutTime"] ?? row["Clock Out"] ?? row["out_time"] ?? "").trim();

        if (!dateStr) continue;

        let parsedDate: string;
        if (typeof dateStr === "number") {
          const d = XLSX.SSF.parse_date_code(dateStr);
          parsedDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        } else {
          const d = new Date(String(dateStr));
          if (isNaN(d.getTime())) continue;
          parsedDate = d.toISOString().split('T')[0];
        }

        const userId = bioMap.get(empId) ?? nameMap.get(empName.toLowerCase());
        if (!userId) { if (empName) unmatched.push(empName); continue; }

        let workingHours: string | undefined;
        let status: string = "present";

        const parseTimeToMinutes = (t: string): number | null => {
          const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
          if (!m) return null;
          let h = parseInt(m[1]);
          const min = parseInt(m[2]);
          if (m[3]?.toUpperCase() === "PM" && h < 12) h += 12;
          if (m[3]?.toUpperCase() === "AM" && h === 12) h = 0;
          return h * 60 + min;
        };

        if (inTime && outTime) {
          const inMin = parseTimeToMinutes(inTime);
          const outMin = parseTimeToMinutes(outTime);
          if (inMin !== null && outMin !== null && outMin > inMin) {
            const hours = (outMin - inMin) / 60;
            workingHours = hours.toFixed(2);
            if (hours < 4) status = "half-day";
          }
        } else {
          status = "absent";
        }

        await storage.upsertAttendance(userId, parsedDate, {
          clockIn: inTime || undefined,
          clockOut: outTime || undefined,
          status,
          workingHours: workingHours ?? undefined,
        });
        imported++;
      }

      res.json({ imported, unmatched: [...new Set(unmatched)] });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PUT /api/attendance/:id — admin override
  app.put("/api/attendance/:id", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updateAttendance(parseInt(req.params.id), {
        ...req.body,
        markedBy: (req.user as any)?.id,
      });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/attendance/manual — admin marks attendance manually
  app.post("/api/attendance/manual", requireAuth, async (req, res) => {
    try {
      const { userId, date, status, clockIn, clockOut, notes } = req.body;
      const record = await storage.upsertAttendance(userId, date, {
        status, clockIn, clockOut, notes,
        markedBy: (req.user as any)?.id,
      });
      res.json(record);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/leaves — ?status=&month=&userId=
  app.get("/api/leaves", requireAuth, async (req, res) => {
    try {
      const { userId, month, status } = req.query as Record<string, string>;
      res.json(await storage.getLeaves({
        userId: userId ? parseInt(userId) : undefined,
        month: month || undefined,
        status: status || undefined,
      }));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/leaves
  app.post("/api/leaves", requireAuth, async (req, res) => {
    try {
      res.json(await storage.createLeave(req.body));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PUT /api/leaves/:id — approve or reject
  app.put("/api/leaves/:id", requireAuth, async (req, res) => {
    try {
      const { status, notes } = req.body;
      const updated = await storage.updateLeave(parseInt(req.params.id), {
        status, notes,
        reviewedBy: (req.user as any)?.id,
        reviewedAt: new Date(),
      });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/shifts
  app.get("/api/shifts", requireAuth, async (req, res) => {
    try { res.json(await storage.getShifts()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/shifts
  app.post("/api/shifts", requireAuth, async (req, res) => {
    try { res.json(await storage.createShift(req.body)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PUT /api/shifts/:id
  app.put("/api/shifts/:id", requireAuth, async (req, res) => {
    try { res.json(await storage.updateShift(parseInt(req.params.id), req.body)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/shifts/roster?week=YYYY-WW
  app.get("/api/shifts/roster", requireAuth, async (req, res) => {
    try {
      const week = req.query.week as string || (() => {
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
        return `${now.getFullYear()}-${String(weekNum).padStart(2, '0')}`;
      })();
      res.json(await storage.getRoster(week));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/shifts/roster — assign shift to staff on a date
  app.post("/api/shifts/roster", requireAuth, async (req, res) => {
    try {
      const { userId, date, shiftId } = req.body;
      res.json(await storage.upsertShiftAssignment(userId, date, shiftId, (req.user as any)?.id));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // DELETE /api/shifts/roster/:id
  app.delete("/api/shifts/roster/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteShiftAssignment(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/payroll/report/:month — YYYY-MM
  app.get("/api/payroll/report/:month", requireAuth, async (req, res) => {
    try { res.json(await storage.getPayrollReport(req.params.month)); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });
```

- [ ] **Step 3: Commit**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
git add server/routes.ts
git commit -m "feat: add staff management API routes (attendance, leaves, shifts, payroll)"
```

---

## Task 4: Build frontend — add imports and AttendanceTab to Admin.tsx

**Files:**
- Modify: `client/src/pages/Admin.tsx`

- [ ] **Step 1: Add new icon imports to Admin.tsx**

Find the existing lucide-react import line:
```typescript
import {
  Loader2, User, KeyRound, Users, Plus, Trash2, Shield, ShieldCheck,
} from "lucide-react";
```

Replace it with:
```typescript
import {
  Loader2, User, KeyRound, Users, Plus, Trash2, Shield, ShieldCheck,
  Calendar, Clock, Upload, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, UserCheck, FileText, DollarSign, ClipboardList,
} from "lucide-react";
```

- [ ] **Step 2: Add Textarea import**

Find the line with `import { Input } from "@/components/ui/input";` and add after it:
```typescript
import { Textarea } from "@/components/ui/textarea";
```

- [ ] **Step 3: Add AttendanceTab component**

Add this entire component just before the line `// ── Main Admin Page ───────────────────────────────────────────────────────────`:

```typescript
// ── Attendance Tab ────────────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
  present:   "bg-green-100 text-green-800",
  absent:    "bg-red-100 text-red-800",
  "half-day":"bg-yellow-100 text-yellow-800",
  "on-leave":"bg-blue-100 text-blue-800",
  holiday:   "bg-purple-100 text-purple-800",
};

const glassStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.55)",
  backdropFilter: "blur(16px) saturate(1.8)",
  WebkitBackdropFilter: "blur(16px) saturate(1.8)",
  border: "1px solid rgba(255,255,255,0.72)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.055), 0 1px 0 rgba(255,255,255,0.95) inset",
};

function AttendanceTab() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"today" | "date" | "monthly">("today");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [importResult, setImportResult] = useState<{ imported: number; unmatched: string[] } | null>(null);
  const [overrideDialog, setOverrideDialog] = useState<any | null>(null);
  const [manualDialog, setManualDialog] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ status: "present", clockIn: "", clockOut: "", notes: "" });
  const [manualForm, setManualForm] = useState({ userId: "", date: new Date().toISOString().split('T')[0], status: "present", clockIn: "", clockOut: "", notes: "" });

  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff"] });

  const attendanceQueryKey = viewMode === "monthly"
    ? `/api/attendance?month=${selectedMonth}`
    : `/api/attendance?date=${selectedDate}`;

  const { data: attendanceData = [], isLoading: attLoading } = useQuery<any[]>({ queryKey: [attendanceQueryKey] });
  const { data: reportData = [] } = useQuery<any[]>({
    queryKey: [`/api/attendance/report?month=${selectedMonth}`],
    enabled: viewMode === "monthly",
  });

  const overrideMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) =>
      apiRequest("PUT", `/api/attendance/${id}`, data),
    onSuccess: () => {
      toast({ title: "Attendance updated" });
      queryClient.invalidateQueries({ queryKey: [attendanceQueryKey] });
      setOverrideDialog(null);
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const manualMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/attendance/manual", data),
    onSuccess: () => {
      toast({ title: "Attendance marked" });
      queryClient.invalidateQueries({ queryKey: [attendanceQueryKey] });
      setManualDialog(false);
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/attendance/import", { method: "POST", body: formData, credentials: "include" });
      const result = await res.json();
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: [attendanceQueryKey] });
      toast({ title: `Imported ${result.imported} records` });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    }
    e.target.value = "";
  };

  const todayBoard = staffList.map((staff: any) => ({
    ...staff,
    attendance: attendanceData.find((a: any) => a.userId === staff.userId),
  }));

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-white/60" style={{ background: "rgba(255,255,255,0.4)" }}>
          {(["today","date","monthly"] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${viewMode === m ? "bg-white/80 shadow-sm text-gray-900" : "text-gray-600"}`}>
              {m === "today" ? "Today" : m === "date" ? "By Date" : "Monthly"}
            </button>
          ))}
        </div>
        {viewMode === "date" && (
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        )}
        {viewMode === "monthly" && (
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => setManualDialog(true)}>
            <UserCheck className="w-3.5 h-3.5" /> Manual
          </Button>
          <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-white/60 bg-white/60 hover:bg-white/80 transition-colors">
            <Upload className="w-3.5 h-3.5" /> Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          </label>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className="rounded-xl p-3" style={glassStyle}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-green-700">Imported {importResult.imported} records</p>
              {importResult.unmatched.length > 0 && (
                <p className="text-xs text-orange-600 mt-1">Unmatched staff (set Biometric ID in Payroll tab): {importResult.unmatched.join(", ")}</p>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 ml-4">x</button>
          </div>
        </div>
      )}

      {/* Monthly summary table */}
      {viewMode === "monthly" && (
        <div className="rounded-2xl overflow-hidden" style={glassStyle}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/40">
                  <th className="text-left p-3 font-semibold">Staff</th>
                  <th className="text-center p-3 font-semibold">Role</th>
                  <th className="text-center p-3 font-semibold text-green-700">Present</th>
                  <th className="text-center p-3 font-semibold text-yellow-700">Half-day</th>
                  <th className="text-center p-3 font-semibold text-blue-700">Leave</th>
                  <th className="text-center p-3 font-semibold text-red-700">Absent</th>
                  <th className="text-center p-3 font-semibold">Hours</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((row: any) => (
                  <tr key={row.userId} className="border-b border-white/30 hover:bg-white/20">
                    <td className="p-3 font-medium">{row.username}</td>
                    <td className="p-3 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${roleColors[row.role] || roleColors.staff}`}>{row.role}</span></td>
                    <td className="p-3 text-center font-semibold text-green-700">{row.present}</td>
                    <td className="p-3 text-center text-yellow-700">{row.halfDay}</td>
                    <td className="p-3 text-center text-blue-700">{row.onLeave}</td>
                    <td className="p-3 text-center text-red-700">{row.absent}</td>
                    <td className="p-3 text-center">{row.totalHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Daily view (today + by-date) */}
      {viewMode !== "monthly" && (
        <>
          {attLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{[...Array(6)].map((_,i) => <div key={i} className="h-20 skeleton-glass rounded-xl" />)}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {todayBoard.map((staff: any) => {
                  const att = staff.attendance;
                  const status = att?.status ?? "not-marked";
                  return (
                    <div key={staff.userId} className="rounded-xl p-3 space-y-1.5" style={glassStyle}>
                      <div className="flex items-start justify-between">
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-xs font-semibold text-primary">
                          {staff.user?.username?.slice(0,2).toUpperCase()}
                        </div>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor[status] ?? "bg-gray-100 text-gray-500"}`}>{status}</span>
                      </div>
                      <p className="text-xs font-semibold">{staff.user?.username}</p>
                      {att && (
                        <p className="text-[10px] text-gray-500">
                          {att.clockIn && `In: ${att.clockIn}`}{att.clockIn && att.clockOut && " · "}{att.clockOut && `Out: ${att.clockOut}`}
                          {att.workingHours && ` (${att.workingHours}h)`}
                        </p>
                      )}
                      {att && (
                        <button className="text-[10px] text-blue-600 hover:underline"
                          onClick={() => { setOverrideDialog(att); setOverrideForm({ status: att.status, clockIn: att.clockIn ?? "", clockOut: att.clockOut ?? "", notes: att.notes ?? "" }); }}>
                          Edit
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {attendanceData.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={glassStyle}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/40">
                          <th className="text-left p-3">Staff</th><th className="text-center p-3">Status</th>
                          <th className="text-center p-3">In</th><th className="text-center p-3">Out</th>
                          <th className="text-center p-3">Hours</th><th className="text-center p-3">Edit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceData.map((a: any) => (
                          <tr key={a.id} className="border-b border-white/30 hover:bg-white/20">
                            <td className="p-3 font-medium">{a.user?.username}</td>
                            <td className="p-3 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColor[a.status] ?? ""}`}>{a.status}</span></td>
                            <td className="p-3 text-center">{a.clockIn || "—"}</td>
                            <td className="p-3 text-center">{a.clockOut || "—"}</td>
                            <td className="p-3 text-center">{a.workingHours ? `${a.workingHours}h` : "—"}</td>
                            <td className="p-3 text-center">
                              <button className="text-blue-600 hover:underline text-[10px]"
                                onClick={() => { setOverrideDialog(a); setOverrideForm({ status: a.status, clockIn: a.clockIn ?? "", clockOut: a.clockOut ?? "", notes: a.notes ?? "" }); }}>
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Override dialog */}
      <Dialog open={!!overrideDialog} onOpenChange={() => setOverrideDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Attendance</DialogTitle><DialogDescription>Admin override for {overrideDialog?.user?.username}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Status</Label>
              <Select value={overrideForm.status} onValueChange={v => setOverrideForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["present","absent","half-day","on-leave","holiday"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Clock In</Label><Input type="time" value={overrideForm.clockIn} onChange={e => setOverrideForm(f => ({ ...f, clockIn: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Clock Out</Label><Input type="time" value={overrideForm.clockOut} onChange={e => setOverrideForm(f => ({ ...f, clockOut: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={overrideForm.notes} onChange={e => setOverrideForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOverrideDialog(null)}>Cancel</Button>
              <Button disabled={overrideMutation.isPending} onClick={() => overrideMutation.mutate({ id: overrideDialog.id, data: overrideForm })}>
                {overrideMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual mark dialog */}
      <Dialog open={manualDialog} onOpenChange={setManualDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark Attendance Manually</DialogTitle><DialogDescription>Record attendance for any staff member</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Staff</Label>
              <Select value={manualForm.userId} onValueChange={v => setManualForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>{staffList.map((s: any) => <SelectItem key={s.userId} value={String(s.userId)}>{s.user?.username}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={manualForm.date} onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Status</Label>
              <Select value={manualForm.status} onValueChange={v => setManualForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["present","absent","half-day","on-leave","holiday"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Clock In</Label><Input type="time" value={manualForm.clockIn} onChange={e => setManualForm(f => ({ ...f, clockIn: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Clock Out</Label><Input type="time" value={manualForm.clockOut} onChange={e => setManualForm(f => ({ ...f, clockOut: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={manualForm.notes} onChange={e => setManualForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setManualDialog(false)}>Cancel</Button>
              <Button disabled={manualMutation.isPending || !manualForm.userId}
                onClick={() => manualMutation.mutate({ ...manualForm, userId: parseInt(manualForm.userId) })}>
                {manualMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Mark"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
git add client/src/pages/Admin.tsx
git commit -m "feat: add AttendanceTab component"
```

---

## Task 5: Add ShiftsTab and LeavesTab to Admin.tsx

**Files:**
- Modify: `client/src/pages/Admin.tsx`

- [ ] **Step 1: Add ShiftsTab component**

Add this component right after `AttendanceTab` closes (before `// ── Main Admin Page`):

```typescript
// ── Shifts Tab ────────────────────────────────────────────────────────────────

const shiftColors = ["bg-blue-100 text-blue-800","bg-orange-100 text-orange-800","bg-purple-100 text-purple-800","bg-green-100 text-green-800"];

function ShiftsTab() {
  const { toast } = useToast();
  const [showNewShift, setShowNewShift] = useState(false);
  const [newShift, setNewShift] = useState({ name: "", startTime: "09:00", endTime: "17:00" });
  const [currentWeek, setCurrentWeek] = useState(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-${String(weekNum).padStart(2, '0')}`;
  });

  const { data: shiftDefs = [] } = useQuery<any[]>({ queryKey: ["/api/shifts"] });
  const { data: roster = [] } = useQuery<any[]>({ queryKey: [`/api/shifts/roster?week=${currentWeek}`] });

  const createShiftMutation = useMutation({
    mutationFn: async (data: any) => {
      const [sh, sm] = data.startTime.split(':').map(Number);
      const [eh, em] = data.endTime.split(':').map(Number);
      const duration = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      return apiRequest("POST", "/api/shifts", { ...data, durationHours: Math.max(0, duration).toFixed(2) });
    },
    onSuccess: () => { toast({ title: "Shift created" }); queryClient.invalidateQueries({ queryKey: ["/api/shifts"] }); setShowNewShift(false); setNewShift({ name: "", startTime: "09:00", endTime: "17:00" }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/shifts/roster", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/shifts/roster?week=${currentWeek}`] }),
    onError: (err: any) => toast({ title: "Failed to assign", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/shifts/roster/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/shifts/roster?week=${currentWeek}`] }),
  });

  const navigateWeek = (delta: number) => {
    const [y, w] = currentWeek.split('-').map(Number);
    let nw = w + delta, ny = y;
    if (nw < 1) { ny--; nw = 52; } else if (nw > 52) { ny++; nw = 1; }
    setCurrentWeek(`${ny}-${String(nw).padStart(2, '0')}`);
  };

  const dates: string[] = roster[0]?.dates ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 space-y-3" style={glassStyle}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Shift Definitions</p>
          <Button size="sm" onClick={() => setShowNewShift(s => !s)}><Plus className="w-3.5 h-3.5 mr-1" />New Shift</Button>
        </div>
        {showNewShift && (
          <div className="flex flex-wrap gap-2 items-end p-3 rounded-xl bg-white/40">
            <div className="space-y-1 flex-1 min-w-[110px]"><Label className="text-xs">Name</Label>
              <Input placeholder="e.g. Morning" value={newShift.name} onChange={e => setNewShift(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Start</Label>
              <Input type="time" value={newShift.startTime} onChange={e => setNewShift(f => ({ ...f, startTime: e.target.value }))} className="h-8 text-xs w-28" /></div>
            <div className="space-y-1"><Label className="text-xs">End</Label>
              <Input type="time" value={newShift.endTime} onChange={e => setNewShift(f => ({ ...f, endTime: e.target.value }))} className="h-8 text-xs w-28" /></div>
            <Button size="sm" className="h-8" disabled={createShiftMutation.isPending} onClick={() => createShiftMutation.mutate(newShift)}>
              {createShiftMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setShowNewShift(false)}>Cancel</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {shiftDefs.map((s: any, i: number) => (
            <span key={s.id} className={`text-xs font-medium px-3 py-1.5 rounded-full ${shiftColors[i % shiftColors.length]}`}>
              {s.name}: {s.startTime}–{s.endTime} ({s.durationHours}h)
            </span>
          ))}
          {shiftDefs.length === 0 && <p className="text-xs text-gray-400">No shifts defined yet. Create one above.</p>}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={glassStyle}>
        <div className="flex items-center justify-between p-4 pb-2">
          <p className="text-sm font-semibold text-gray-700">Weekly Roster</p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => navigateWeek(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-xs font-medium px-2">Week {currentWeek}</span>
            <Button size="sm" variant="ghost" onClick={() => navigateWeek(1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/40">
                <th className="text-left p-3 min-w-[100px]">Staff</th>
                {dates.map((d: string) => (
                  <th key={d} className="text-center p-2 min-w-[90px]">
                    <div className="font-semibold">{new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</div>
                    <div className="text-[10px] text-gray-400">{new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((row: any) => (
                <tr key={row.userId} className="border-b border-white/30 hover:bg-white/20">
                  <td className="p-3">
                    <div className="font-medium">{row.username}</div>
                    <span className={`text-[10px] px-1 rounded ${roleColors[row.role] || roleColors.staff}`}>{row.role}</span>
                  </td>
                  {dates.map((d: string) => {
                    const cell = row.assignments?.[d];
                    const colorIdx = shiftDefs.findIndex((s: any) => s.id === cell?.shift?.id);
                    return (
                      <td key={d} className="p-2 text-center">
                        {cell ? (
                          <div className="space-y-0.5">
                            <div className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${shiftColors[colorIdx >= 0 ? colorIdx % shiftColors.length : 0]}`}>{cell.shift?.name}</div>
                            <button onClick={() => removeMutation.mutate(cell.assignmentId)} className="text-[9px] text-red-500 hover:underline">remove</button>
                          </div>
                        ) : (
                          <Select onValueChange={sid => assignMutation.mutate({ userId: row.userId, date: d, shiftId: parseInt(sid) })}>
                            <SelectTrigger className="h-6 text-[10px] border-dashed border-gray-300"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              {shiftDefs.map((s: any) => <SelectItem key={s.id} value={String(s.id)} className="text-xs">{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {roster.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-xs text-gray-400">No staff found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Leaves Tab ────────────────────────────────────────────────────────────────

function LeavesTab() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState("pending");
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showApply, setShowApply] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ userId: "", leaveType: "casual", startDate: "", endDate: "", reason: "" });
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff"] });
  const leavesKey = `/api/leaves?status=${filterStatus}&month=${filterMonth}`;
  const { data: leavesData = [], isLoading } = useQuery<any[]>({ queryKey: [leavesKey] });

  const leaveTypeColors: Record<string, string> = {
    sick: "bg-red-100 text-red-700", casual: "bg-blue-100 text-blue-700",
    earned: "bg-green-100 text-green-700", unpaid: "bg-gray-100 text-gray-700",
  };
  const leaveStatusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700", approved: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const start = new Date(data.startDate), end = new Date(data.endDate);
      const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
      return apiRequest("POST", "/api/leaves", { ...data, userId: parseInt(data.userId), totalDays });
    },
    onSuccess: () => { toast({ title: "Leave submitted" }); queryClient.invalidateQueries({ queryKey: [leavesKey] }); setShowApply(false); setLeaveForm({ userId: "", leaveType: "casual", startDate: "", endDate: "", reason: "" }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/leaves/${id}`, { status, notes: reviewNotes[id] ?? "" }),
    onSuccess: () => { toast({ title: "Leave updated" }); queryClient.invalidateQueries({ queryKey: [leavesKey] }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-white/60" style={{ background: "rgba(255,255,255,0.4)" }}>
          {["pending","approved","rejected",""].map(s => (
            <button key={s || "all"} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${filterStatus === s ? "bg-white/80 shadow-sm text-gray-900" : "text-gray-600"}`}>
              {s || "All"}
            </button>
          ))}
        </div>
        <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        <Button size="sm" className="ml-auto" onClick={() => setShowApply(true)}><Plus className="w-3.5 h-3.5 mr-1" />Apply Leave</Button>
      </div>

      <Dialog open={showApply} onOpenChange={setShowApply}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Apply Leave</DialogTitle><DialogDescription>Submit a leave request</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Staff</Label>
              <Select value={leaveForm.userId} onValueChange={v => setLeaveForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>{staffList.map((s: any) => <SelectItem key={s.userId} value={String(s.userId)}>{s.user?.username}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Type</Label>
              <Select value={leaveForm.leaveType} onValueChange={v => setLeaveForm(f => ({ ...f, leaveType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["sick","casual","earned","unpaid"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>From</Label><Input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>To</Label><Input type="date" value={leaveForm.endDate} onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label>Reason</Label><Textarea value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowApply(false)}>Cancel</Button>
              <Button disabled={createMutation.isPending || !leaveForm.userId || !leaveForm.startDate || !leaveForm.endDate}
                onClick={() => createMutation.mutate(leaveForm)}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_,i) => <div key={i} className="h-24 skeleton-glass rounded-xl" />)}</div>
      ) : leavesData.length === 0 ? (
        <p className="text-center py-10 text-sm text-gray-400">No leave requests found</p>
      ) : (
        <div className="space-y-2">
          {leavesData.map((leaf: any) => (
            <div key={leaf.id} className="rounded-xl p-4 space-y-2" style={glassStyle}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{leaf.user?.username}</p>
                  <p className="text-xs text-gray-500">{leaf.startDate} to {leaf.endDate} ({leaf.totalDays} day{leaf.totalDays !== 1 ? "s" : ""})</p>
                  {leaf.reason && <p className="text-xs text-gray-600 mt-1 italic truncate">"{leaf.reason}"</p>}
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${leaveTypeColors[leaf.leaveType] ?? ""}`}>{leaf.leaveType}</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${leaveStatusColors[leaf.status] ?? ""}`}>{leaf.status}</span>
                </div>
              </div>
              {leaf.status === "pending" && (
                <div className="flex items-center gap-2 pt-1">
                  <Input placeholder="Notes (optional)" value={reviewNotes[leaf.id] ?? ""} className="h-7 text-xs flex-1"
                    onChange={e => setReviewNotes(n => ({ ...n, [leaf.id]: e.target.value }))} />
                  <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
                    onClick={() => reviewMutation.mutate({ id: leaf.id, status: "approved" })}>
                    <CheckCircle2 className="w-3 h-3" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 gap-1"
                    onClick={() => reviewMutation.mutate({ id: leaf.id, status: "rejected" })}>
                    <XCircle className="w-3 h-3" />Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
git add client/src/pages/Admin.tsx
git commit -m "feat: add ShiftsTab and LeavesTab components"
```

---

## Task 6: Add PayrollTab to Admin.tsx

**Files:**
- Modify: `client/src/pages/Admin.tsx`

- [ ] **Step 1: Add PayrollTab and StaffProfileRow components**

Add both components right before `// ── Main Admin Page`:

```typescript
// ── Payroll Tab ───────────────────────────────────────────────────────────────

function StaffProfileRow({ staff }: { staff: any }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ biometricId: staff.biometricId ?? "", department: staff.department ?? "", designation: staff.designation ?? "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/staff/${staff.userId}/profile`, form);
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Saved" });
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-white/30">
      <span className="text-xs font-medium w-24 shrink-0">{staff.user?.username}</span>
      <Input placeholder="Biometric ID" value={form.biometricId} className="h-7 text-xs w-24" onChange={e => setForm(f => ({ ...f, biometricId: e.target.value }))} />
      <Input placeholder="Department" value={form.department} className="h-7 text-xs w-28" onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
      <Input placeholder="Designation" value={form.designation} className="h-7 text-xs w-28" onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
      <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={save}>{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}</Button>
    </div>
  );
}

function PayrollTab() {
  const { toast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [editingSalary, setEditingSalary] = useState<{ userId: number; salary: string } | null>(null);

  const { data: payrollData = [], isLoading } = useQuery<any[]>({ queryKey: [`/api/payroll/report/${selectedMonth}`] });
  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff"] });

  const updateSalaryMutation = useMutation({
    mutationFn: async ({ userId, salary }: { userId: number; salary: string }) =>
      apiRequest("PUT", `/api/staff/${userId}/profile`, { monthlySalary: salary }),
    onSuccess: () => {
      toast({ title: "Salary updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/payroll/report/${selectedMonth}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setEditingSalary(null);
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const totalNet = payrollData.reduce((s: number, r: any) => s + (r.netSalary ?? 0), 0);
  const totalSalary = payrollData.reduce((s: number, r: any) => s + (r.monthlySalary ?? 0), 0);
  const totalDeductions = payrollData.reduce((s: number, r: any) => s + (r.deductions ?? 0), 0);

  const handlePrint = () => {
    const rows = payrollData.map((r: any) =>
      `<tr><td>${r.username}</td><td>${r.role}</td><td>Rs.${Number(r.monthlySalary).toLocaleString('en-IN')}</td><td>${r.workingDays}</td><td>${r.daysPresent}</td><td>${r.absentDays}</td><td>${r.approvedLeaves}</td><td>Rs.${r.deductions.toFixed(2)}</td><td>Rs.${r.overtimePay.toFixed(2)}</td><td><strong>Rs.${r.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td></tr>`
    ).join('');
    const html = `<!DOCTYPE html><html><head><title>Payroll ${selectedMonth}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h2{margin-bottom:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0;font-weight:600}tfoot td{font-weight:bold;background:#f8f8f8}</style></head><body><h2>Payroll Report - ${selectedMonth}</h2><table><thead><tr><th>Staff</th><th>Role</th><th>Salary</th><th>Working Days</th><th>Present</th><th>Absent</th><th>Leave</th><th>Deductions</th><th>OT Pay</th><th>Net Pay</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="9">Total Net Payable</td><td>Rs.${totalNet.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td></tr></tfoot></table></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) { w.addEventListener('load', () => { w.print(); URL.revokeObjectURL(url); }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-0.5">
          <Label className="text-xs">Month</Label>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="block text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        </div>
        <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={handlePrint}><FileText className="w-3.5 h-3.5" />Print Register</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Staff", value: payrollData.length, color: "text-gray-800" },
          { label: "Total Salary", value: `Rs.${totalSalary.toLocaleString('en-IN')}`, color: "text-blue-700" },
          { label: "Deductions", value: `Rs.${totalDeductions.toFixed(0)}`, color: "text-red-600" },
          { label: "Net Payable", value: `Rs.${totalNet.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: "text-green-700" },
        ].map(c => (
          <div key={c.label} className="rounded-xl p-3 text-center" style={glassStyle}>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? <div className="h-40 skeleton-glass rounded-2xl" /> : (
        <div className="rounded-2xl overflow-hidden" style={glassStyle}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/40">
                  <th className="text-left p-3">Staff</th>
                  <th className="text-center p-3">Salary<br/><span className="text-[10px] font-normal text-gray-400">(click to edit)</span></th>
                  <th className="text-center p-3">Working<br/>Days</th>
                  <th className="text-center p-3">Present</th>
                  <th className="text-center p-3">Absent</th>
                  <th className="text-center p-3">Leave</th>
                  <th className="text-center p-3">Deductions</th>
                  <th className="text-center p-3">OT Pay</th>
                  <th className="text-right p-3 font-semibold">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {payrollData.map((row: any) => (
                  <tr key={row.userId} className="border-b border-white/30 hover:bg-white/20">
                    <td className="p-3">
                      <div className="font-medium">{row.username}</div>
                      <span className={`text-[10px] px-1 rounded ${roleColors[row.role] || roleColors.staff}`}>{row.role}</span>
                    </td>
                    <td className="p-3 text-center">
                      {editingSalary?.userId === row.userId ? (
                        <div className="flex items-center gap-1 justify-center">
                          <Input type="number" value={editingSalary.salary} className="h-6 w-24 text-xs text-center"
                            onChange={e => setEditingSalary(s => s ? { ...s, salary: e.target.value } : null)} />
                          <Button size="sm" className="h-6 text-[10px] px-2" disabled={updateSalaryMutation.isPending}
                            onClick={() => updateSalaryMutation.mutate({ userId: row.userId, salary: editingSalary!.salary })}>
                            {updateSalaryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1" onClick={() => setEditingSalary(null)}>X</Button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingSalary({ userId: row.userId, salary: String(row.monthlySalary) })}
                          className="text-blue-700 hover:underline font-medium">
                          Rs.{Number(row.monthlySalary).toLocaleString('en-IN')}
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-center">{row.workingDays}</td>
                    <td className="p-3 text-center text-green-700 font-medium">{row.daysPresent}</td>
                    <td className="p-3 text-center text-red-600">{row.absentDays}</td>
                    <td className="p-3 text-center text-blue-600">{row.approvedLeaves}</td>
                    <td className="p-3 text-center text-red-600">-Rs.{row.deductions.toFixed(2)}</td>
                    <td className="p-3 text-center text-green-600">+Rs.{row.overtimePay.toFixed(2)}</td>
                    <td className="p-3 text-right font-bold text-green-700">Rs.{row.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/60 bg-white/20">
                  <td className="p-3 font-semibold text-sm" colSpan={8}>Total Net Payable</td>
                  <td className="p-3 text-right font-bold text-lg text-green-700">Rs.{totalNet.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl p-4 space-y-3" style={glassStyle}>
        <p className="text-sm font-semibold text-gray-700">Staff Profiles &amp; Biometric ID Setup</p>
        <p className="text-xs text-gray-500">Set the Biometric ID matching your fingerprint machine's Employee ID column so Excel imports map correctly.</p>
        <div className="space-y-2">
          {staffList.map((staff: any) => <StaffProfileRow key={staff.userId} staff={staff} />)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
git add client/src/pages/Admin.tsx
git commit -m "feat: add PayrollTab and StaffProfileRow components"
```

---

## Task 7: Wire tabs into Admin() and final verification

**Files:**
- Modify: `client/src/pages/Admin.tsx`

- [ ] **Step 1: Expand TabsList from grid-cols-4 to grid-cols-8 for admin**

Find this line in the `Admin()` function:
```typescript
        <TabsList className={`grid w-full ${isAdmin ? "grid-cols-4" : "grid-cols-2"} rounded-xl p-1`}
```

Replace with:
```typescript
        <TabsList className={`grid w-full ${isAdmin ? "grid-cols-8" : "grid-cols-2"} rounded-xl p-1`}
```

- [ ] **Step 2: Add 4 new TabsTriggers**

Find the existing triggers block ending with:
```typescript
          <TabsTrigger value="password"><KeyRound className="w-4 h-4 mr-1.5" />Password</TabsTrigger>
```

Add these 4 lines immediately after it (still inside the `TabsList`):
```typescript
          {isAdmin && <TabsTrigger value="attendance"><Clock className="w-4 h-4 mr-1.5" />Attendance</TabsTrigger>}
          {isAdmin && <TabsTrigger value="shifts"><Calendar className="w-4 h-4 mr-1.5" />Shifts</TabsTrigger>}
          {isAdmin && <TabsTrigger value="leaves"><ClipboardList className="w-4 h-4 mr-1.5" />Leaves</TabsTrigger>}
          {isAdmin && <TabsTrigger value="payroll"><DollarSign className="w-4 h-4 mr-1.5" />Payroll</TabsTrigger>}
```

- [ ] **Step 3: Add 4 new TabsContent blocks**

Find the closing `</Tabs>` tag and add these 4 TabsContent blocks immediately before it:

```typescript
        {isAdmin && (
          <TabsContent value="attendance" className="mt-6">
            <AttendanceTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="shifts" className="mt-6">
            <ShiftsTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="leaves" className="mt-6">
            <LeavesTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="payroll" className="mt-6">
            <PayrollTab />
          </TabsContent>
        )}
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
npm run check
```

Expected: No TypeScript errors. If there are errors, fix them before continuing.

- [ ] **Step 5: Start dev server and verify all features**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
npm run dev
```

Manual test checklist:
- [ ] Go to `/admin` as admin — see 8 tabs: Users, Roles, Profile, Password, Attendance, Shifts, Leaves, Payroll
- [ ] Attendance tab: today's board shows all staff cards
- [ ] Manual mark attendance for a staff member — record appears
- [ ] Upload a test Excel with columns [Emp ID, Name, Date, In-Time, Out-Time] — see import count
- [ ] Switch to "Monthly" view — see summary table with per-staff rows
- [ ] Shifts tab: create "Morning" shift 09:00-17:00 — appears in definitions
- [ ] Weekly roster shows all staff × 7 days; assign a shift via dropdown
- [ ] Leaves tab: apply leave for a staff member — appears as pending
- [ ] Approve the leave — status changes to approved, badge clears
- [ ] Payroll tab: month picker loads all staff with Rs.0 salary
- [ ] Click salary cell — inline edit — save — net pay updates
- [ ] Set biometric ID in Payroll tab staff profile section — save
- [ ] Re-import same Excel — attendance maps correctly to that staff
- [ ] Print Register button — Blob URL opens in new tab, print dialog appears

- [ ] **Step 6: Final commit**

```bash
cd "E:\Claude Code\BagichaOrderMaster\BagichaOrderMaster\.claude\worktrees\happy-pasteur-47c427"
git add client/src/pages/Admin.tsx
git commit -m "feat: wire Attendance, Shifts, Leaves, Payroll tabs into Admin page — staff management complete"
```
