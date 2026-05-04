# Staff Management Module — Design Spec
**Date:** 2026-05-02  
**Project:** BagichaOrderMaster POS  
**Scope:** Full Petpooj-parity Staff Management (Attendance via biometric import, Shifts, Leaves, Payroll)

---

## Context

The current POS system has a solid multi-role user system (admin/manager/cashier/kitchen/staff) with PIN-gated actions, but has **no staff management beyond authentication**. Competitor Petpooj's admin dashboard includes a full Staff module covering attendance, scheduling, leave workflow, and payroll.

The restaurant uses a **biometric fingerprint machine** that exports attendance in Excel format (`Employee ID | Name | Date | In-Time | Out-Time`). This replaces any PIN-based kiosk clock-in. All other gaps (shift scheduling, leave management, payroll) will be built fresh.

**Goal:** Add a `/staff` admin page with 4 tabs — Attendance, Shifts, Leaves, Payroll — that brings this system to feature parity with Petpooj's staff module.

---

## Database Schema (5 new tables)

Add to `shared/schema.ts`:

### `staffProfiles`
Extended employee information linked to existing `users` table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `userId` | integer FK → users | unique, cascade delete |
| `biometricId` | varchar | Employee ID from biometric machine (used for import mapping) |
| `department` | varchar | e.g. "Kitchen", "Service", "Cashier" |
| `designation` | varchar | e.g. "Head Chef", "Waiter", "Cashier" |
| `monthlySalary` | decimal(10,2) | Fixed monthly salary in ₹ |
| `joiningDate` | date | Date of joining |
| `emergencyContact` | varchar | Name + phone |
| `address` | text | Home address |
| `bankAccountNo` | varchar | For payroll reference |
| `bankName` | varchar | |
| `isActive` | boolean | Default true |
| `updatedAt` | timestamp | |

### `attendance`
One record per staff member per day.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `userId` | integer FK → users | |
| `date` | date | The calendar date |
| `clockIn` | timestamp | Null if absent |
| `clockOut` | timestamp | Null if not yet checked out |
| `status` | enum | `present` \| `absent` \| `half-day` \| `on-leave` \| `holiday` |
| `workingHours` | decimal(4,2) | Computed: (clockOut - clockIn) in hours |
| `overtimeHours` | decimal(4,2) | Hours beyond shift duration |
| `notes` | text | Admin override notes |
| `markedBy` | integer FK → users | Null = biometric import; set = admin who manually adjusted |
| `importedAt` | timestamp | When biometric import created this record |

Unique constraint: `(userId, date)` — upsert-safe.

### `leaves`
Leave request workflow.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `userId` | integer FK → users | Staff who requested |
| `leaveType` | enum | `sick` \| `casual` \| `earned` \| `unpaid` |
| `startDate` | date | |
| `endDate` | date | |
| `totalDays` | integer | Computed: endDate - startDate + 1 |
| `reason` | text | Staff's reason |
| `status` | enum | `pending` \| `approved` \| `rejected` |
| `reviewedBy` | integer FK → users | Manager/admin who acted |
| `reviewedAt` | timestamp | |
| `notes` | text | Reviewer's notes |
| `createdAt` | timestamp | |

### `shifts`
Reusable shift definitions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `name` | varchar | e.g. "Morning", "Evening", "Night" |
| `startTime` | time | e.g. "09:00" |
| `endTime` | time | e.g. "17:00" |
| `durationHours` | decimal(4,2) | Computed from start/end |
| `isActive` | boolean | Default true |

### `shiftAssignments`
Specific shift assigned to a staff member on a specific date.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `userId` | integer FK → users | |
| `shiftId` | integer FK → shifts | |
| `date` | date | Specific calendar date |
| `createdBy` | integer FK → users | Admin who created |

Unique constraint: `(userId, date)` — one shift per person per day.

---

## API Endpoints (18 new routes)

Add to `server/routes.ts`. All routes require `requireAuth`. Admin-only routes also require `requireAdmin`.

### Staff Profiles
```
GET    /api/staff                    # All users + staffProfiles + today's attendance status
GET    /api/staff/:id                # Single staff full profile
PUT    /api/staff/:id/profile        # Update staffProfile (salary, department, biometricId, etc.)
```

### Attendance
```
GET    /api/attendance               # Records — query: ?userId=&date=&month=YYYY-MM
GET    /api/attendance/today         # All staff status for today (present/absent/not-marked)
POST   /api/attendance/import        # Upload Excel from biometric machine (multipart/form-data)
PUT    /api/attendance/:id           # Admin override: change status, correct timestamps
GET    /api/attendance/report        # Monthly report — query: ?month=YYYY-MM
                                     # Returns: per-user summary (daysPresent, daysAbsent, leaveDays, totalHours)
```

### Leaves
```
GET    /api/leaves                   # List — query: ?userId=&month=&status=
POST   /api/leaves                   # Submit leave request (staff self-service)
PUT    /api/leaves/:id               # Approve/reject (admin/manager only)
GET    /api/leaves/balance/:userId   # Leave balance: each type (sick=12/yr, casual=12/yr, earned=15/yr) minus used
```

### Shifts
```
GET    /api/shifts                   # List shift definitions
POST   /api/shifts                   # Create shift (admin)
PUT    /api/shifts/:id               # Update shift (admin)
GET    /api/shifts/roster            # Weekly roster — query: ?week=YYYY-WW (ISO week)
POST   /api/shifts/roster            # Assign staff to shift on date (admin)
DELETE /api/shifts/roster/:id        # Remove assignment
```

### Payroll
```
GET    /api/payroll/report/:month    # All-staff payroll for YYYY-MM
GET    /api/payroll/:userId/:month   # Single staff payroll breakdown
```

---

## Payroll Calculation Formula

```
workingDaysInMonth = calendar days in month - holidays
daysPresent       = COUNT(attendance WHERE status='present')
halfDays          = COUNT(status='half-day') * 0.5
approvedLeaves    = COUNT(leaves WHERE status='approved' AND overlaps month)
paidDays          = daysPresent + halfDays + approvedLeaves
absentDays        = workingDaysInMonth - paidDays

dailyRate         = monthlySalary / workingDaysInMonth
deductions        = absentDays * dailyRate
overtimePay       = SUM(overtimeHours) * (dailyRate / 8)   // hourly = daily/8

netSalary         = monthlySalary - deductions + overtimePay
```

Holidays are not tracked separately. `workingDaysInMonth` is computed as: total calendar days in month minus Sundays. (Weekly-off = Sunday by default; a future iteration can make this configurable in restaurant settings.)

---

## Biometric Excel Import Flow

### Excel Format Expected
```
| Emp ID | Name         | Date       | In-Time  | Out-Time |
|--------|--------------|------------|----------|----------|
| 101    | Ravi Kumar   | 2026-05-01 | 09:02 AM | 05:15 PM |
| 102    | Priya Sharma | 2026-05-01 | 08:55 AM | 05:00 PM |
```

### Import Logic (`POST /api/attendance/import`)
1. Parse Excel using `xlsx` npm package
2. For each row: look up `staffProfiles.biometricId` matching `Emp ID`
3. If no match → flag row as **unmatched** (show in preview, skip import)
4. Compute `workingHours = clockOut - clockIn`
5. Compute `overtimeHours = max(0, workingHours - shift.durationHours)` (if shift assigned for that date)
6. **Upsert** into `attendance` on `(userId, date)` — re-importing same file is safe
7. Set `status = 'present'` if both times exist; `'absent'` if row has no times; `'half-day'` if workingHours < 4
8. Return summary: `{ imported: N, skipped: M, unmatched: [...names] }`

### Frontend Import UX (Attendance Tab)
- "Import Biometric Data" button → file picker (`.xlsx`, `.xls`, `.csv`)
- Inline preview table showing parsed rows with match status (green = matched, orange = unmatched)
- "Confirm Import" button → calls API, shows success toast

---

## Frontend: `/staff` Page

### Layout
Full-page admin route (sidebar + TopNav layout). 4 tabs rendered as shadcn `<Tabs>`.

### Tab 1: Attendance
- **Today's Board** (top): grid of staff cards — name, avatar/initials, status chip (Present/Absent/Not Marked), clock-in time
- **Import Button**: top-right — opens file picker for biometric Excel
- **Historical View**: date picker switches board to any past date; below shows table with: `Name | Status | Clock In | Clock Out | Hours | Override`
- **Monthly Summary**: toggle to month view — table with per-staff row totals

### Tab 2: Shifts
- **Shift Definitions** panel (left sidebar): list of shifts (Morning / Evening / Night) with edit inline, "+ New Shift" button
- **Weekly Roster** (main area): grid where rows = staff names, columns = Mon–Sun, cells = shift chip or "—". Click cell to assign a shift from dropdown.
- Week navigator: "< Prev Week" / "Next Week >" with ISO week label

### Tab 3: Leaves
- **Pending Approvals** (top card): count badge + list of pending requests with Approve/Reject buttons + notes field
- **All Leaves Table**: filters for staff, type, month, status; sortable columns
- **Leave Balance** column: earned/sick/casual taken vs. allowed

### Tab 4: Payroll
- **Month picker** (top right)
- **Summary table**: `Staff | Salary | Working Days | Days Present | Absent Deduction | Overtime | Net Pay`
- **Row expand**: individual payroll breakdown
- **Print/Export** button: generates printable payroll register (browser print or PDF via `window.print()`)

### Staff Leave Self-Service (POS top bar)
- Small calendar icon next to the role-switcher in POS top bar
- Opens a shadcn `<Sheet>` (slide-over): shows staff's own leave balance + list of their leaves + "Apply Leave" form
- Submit calls `POST /api/leaves`; creates a pending request → admin sees it in Tab 3 with badge

---

## Storage Methods (new in `server/storage.ts`)

```typescript
// Staff Profiles
getStaffProfiles(): Promise<StaffProfileWithUser[]>
getStaffProfile(userId: number): Promise<StaffProfile | null>
upsertStaffProfile(userId: number, data: InsertStaffProfile): Promise<StaffProfile>

// Attendance
getAttendance(filters: { userId?, date?, month? }): Promise<Attendance[]>
getTodayAttendance(): Promise<AttendanceWithUser[]>
upsertAttendance(userId: number, date: string, data: InsertAttendance): Promise<Attendance>
updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance>
getAttendanceReport(month: string): Promise<AttendanceReportRow[]>

// Leaves
getLeaves(filters: { userId?, month?, status? }): Promise<LeaveWithUser[]>
createLeave(data: InsertLeave): Promise<Leave>
updateLeave(id: number, data: Partial<InsertLeave>): Promise<Leave>
getLeaveBalance(userId: number): Promise<LeaveBalance>

// Shifts
getShifts(): Promise<Shift[]>
createShift(data: InsertShift): Promise<Shift>
updateShift(id: number, data: Partial<InsertShift>): Promise<Shift>
getRoster(week: string): Promise<RosterRow[]>   // week = "YYYY-WW"
upsertShiftAssignment(userId: number, date: string, shiftId: number, createdBy: number): Promise<ShiftAssignment>
deleteShiftAssignment(id: number): Promise<void>

// Payroll
getPayrollReport(month: string): Promise<PayrollRow[]>
getStaffPayroll(userId: number, month: string): Promise<PayrollBreakdown>
```

---

## Dependencies to Add

```bash
npm install xlsx        # Parse biometric Excel exports
npm install date-fns    # Date utilities for working days, ISO weeks, month ranges
```

Both are lightweight; `xlsx` is the standard for parsing `.xlsx`/`.xls`/`.csv` in Node.js.

---

## Routing Changes

**`client/src/App.tsx`** — Add new routes:
```tsx
<Route path="/staff" component={Staff} />   // admin/manager only
```

**Sidebar navigation** — Add "Staff" link (icon: `Users`) between Admin and Settings, visible only to admin/manager.

---

## Verification Plan

1. **Schema**: Run `npm run db:push` — all 5 tables created without errors
2. **Import**: Upload a sample biometric Excel → verify records upserted correctly, unmatched rows flagged
3. **Attendance override**: Admin manually changes a status → change persists and shows "markedBy" label
4. **Leave workflow**: Staff submits leave → appears in Tab 3 pending → Admin approves → badge clears → payroll reflects it
5. **Shift roster**: Create Morning/Evening shifts → assign to staff for a week → verify roster grid renders correctly
6. **Payroll**: Set staff salary, import attendance for a month, mark some absences → verify net pay calculation matches formula
7. **Self-service leave**: From POS top bar, submit leave → appears in admin Tab 3
8. **Re-import safety**: Import same Excel twice → no duplicate records (upsert check)

---

## Implementation Order

1. `shared/schema.ts` — Add 5 tables + run `db:push`
2. `server/storage.ts` — Add all storage methods
3. `server/routes.ts` — Add 18 API endpoints
4. `client/src/pages/Staff.tsx` — Build page with 4 tabs
5. Sidebar + App.tsx routing
6. POS top bar leave self-service sheet
7. Manual QA per verification plan above
