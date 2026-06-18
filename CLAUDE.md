# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (Vite frontend + Express backend together)
npm run build      # Build client (Vite) + bundle server (esbuild → ESM)
npm run start      # Run production build
npm run check      # TypeScript type checking (no emit)
npm run db:push    # Push Drizzle schema changes to the database
npm run seed       # Seed the database with initial data
```

There are no automated tests in this project.

## Architecture

This is a monorepo restaurant POS system. All dependencies live in the root `package.json`. The three main layers are:

### `shared/`
- `schema.ts` — Single source of truth for all database tables (Drizzle ORM + Zod). Core tables: `users`, `categories`, `menuItems`, `inventory`, `orders`, `orderItems`, `kotTickets`, `tables`, `sales`. TypeScript types are inferred directly from the schema and shared between client and server via the `@shared/*` path alias.

### `server/`
- `index.ts` — Express app setup: sessions (MemoryStore, 24h), Passport, body parsing, Vite dev integration.
- `routes.ts` — All API endpoints (~47KB). Includes: Passport-local auth strategy, WebSocket server (order + KOT real-time updates), and all REST handlers. Auth middleware: `requireAuth` (session), `requireAdmin` (role check).
- `storage.ts` — `IStorage` interface + `DatabaseStorage` implementation. All DB access goes through this abstraction (repository pattern). Drizzle queries live here, not in routes.
- `settingsStore.ts` — Restaurant settings persisted to `restaurant-settings.json` (not DB). Includes `posRoleTimeout` (minutes before elevated POS role auto-reverts).
- `db.ts` — Neon serverless PostgreSQL connection via `DATABASE_URL` env var.

### `client/src/`
- `App.tsx` — Wouter router with auth guard. POS is full-screen (no TopNav). All other pages use TopNav + sidebar layout.
- `pages/` — One file per route. `POS.tsx` is the most complex page (order management, role switching, PIN gates).
- `components/ui/` — shadcn/ui components (do not edit these manually).
- `hooks/` — Custom hooks:
  - `useAuth` — Auth session state via React Query (`/api/auth/me`)
  - `useRole` — Reads login role from auth session (`admin | manager | staff`)
  - `useActiveRole` — POS role switcher state with countdown timer; elevating above login role starts auto-revert
  - `usePermission(activeRole)` — Returns `can(action)`, `requirePin(label, fn)`, `isLocked()` for role-gated POS actions
  - `useManagerAuth` — PIN popup state machine (60s unlock window after correct PIN)
- `lib/queryClient.ts` — TanStack Query client + `apiRequest` helper (wraps fetch with session cookies).

## Role / PIN System

Three POS roles: `admin > manager > staff` (defined in `useRole.ts` as `ROLE_LEVEL`).

- **Admin** — full access, no PIN ever required.
- **Manager** — restricted actions need admin PIN.
- **Staff** — most restricted; saving an order requires manager PIN; restricted actions need manager PIN.

Restricted actions (admin-only without PIN override): `discount`, `complimentary`, `clearCart`, `newOrder`, `cancelOrder`, `moveTable`, `mergeTable`, `splitBill`.

PIN verification endpoint: `POST /api/auth/verify-pin` accepts `{ pin, requiredRole }`. `requiredRole="admin"` only accepts admin PINs; `requiredRole="manager"` accepts manager or admin PINs.

The `RoleSwitcher` component in the POS top bar lets any logged-in user temporarily elevate their role via PIN. Switching to a higher role than the current **active** role (not login role) triggers a PIN prompt.

## Path Aliases

| Alias | Resolves to |
|-------|-------------|
| `@/*` | `client/src/*` |
| `@shared/*` | `shared/*` |
| `@assets/*` | `attached_assets/*` |

## Database

- PostgreSQL via Neon serverless (connection string in `.env` as `DATABASE_URL`)
- Schema changes: edit `shared/schema.ts`, then run `npm run db:push`
- Drizzle config: `drizzle.config.ts`; migrations output to `./migrations/`
- **⚠️ Do NOT `npm run db:push` from this `ui-redesign` worktree.** The shared DB is **ahead** of this
  branch (it carries the `whatsapp-automation` tables: `sessions`, `conversations`,
  `conversation_messages`, extra `customer_messages`/`automation_jobs` columns) which this branch's
  `schema.ts` doesn't define — so a full push proposes to **DROP them**. Apply additive changes with a
  targeted `ALTER TABLE` script instead (see `scripts/migrate-staff-hr.mjs`).

## Staff, Attendance & Payroll

Two identity systems (see `docs/superpowers/specs/2026-05-21-unified-role-user-management-design.md`), **both created in Admin → Accounts**:
- **`users`** (`username/password`, roles admin/manager/staff) — login + POS permissions. HR fields live in `staffProfiles` (`designation`, `biometricId`, `monthlySalary`).
- **`staffMembers`** — PIN name-card mobile login **and** attendance-only staff. Carries `designation`, `biometricId`, `monthlySalary`, `excludeFromPayroll`. **PIN is optional** — a `pin == null` member is *attendance-only* and never appears as a login card (clocks in by fingerprint).

**Mobile name-card login** (`showOnMobile` boolean on **both** `users` (default false) + `staffMembers` (default true)):
- Public `GET /api/staff-members` returns **unified login cards** — staff members **and** non-admin accounts that have `showOnMobile` ON + a PIN, each tagged `kind:"staff"|"user"`. Admins/owner are never card-eligible.
- `POST /api/auth/card-login {kind,id,pin}` logs in either a staff member (staff-tier session) or an account (its real role); admins blocked. `Login.tsx` calls it with the card's `kind`.
- Admin → Accounts shows a **Mobile Card on/off `Switch`** per row (`toggleUserCard`/`toggleStaffCard` → `PUT /api/users/:id`|`/api/staff-members/:id {showOnMobile}`); disabled for admins and for anyone without a PIN. Smoke test: `scripts/verify-mobile-card.ts`.

**⚠️ Id-collision gotcha:** `users` and `staffMembers` share the integer id space, and a staff-member session is `{ id: sm.id, _isStaffMember: true }`. Any "self" endpoint that keys on `req.user.id` MUST disambiguate by `_isStaffMember` (→ `staffMemberId` vs `userId`) or it's a cross-table IDOR. Already guarded: `/api/attendance/me`, `/api/payroll/me/:month`.

**Payroll + biometric run on a UNION of both** (`storage.getPayrollPeople()`):
- `users` with role ∈ {manager, staff} (admins/owner excluded) via `staffProfiles`, **plus** `staffMembers` (skip `excludeFromPayroll`). Each person is `{ kind:'user'|'staff', id, name, role, biometricId, monthlySalary }`.
- `attendance` rows key on **either** `userId` **or** `staffMemberId` (`userId` nullable; `upsertAttendanceForStaffMember` mirrors the user version; `getAttendance({ staffMemberId })` + `displayName` resolve either).
- `deviceAttendanceService.ts` maps `biometricId → staffMemberId` (primary) then `→ userId` (fallback) and writes via the matching path.
- `getPayrollReport(month)` computes over `getPayrollPeople()`; rows carry `kind`, `userId?`, `staffMemberId?`, `name`, `designation` (+ `username`/`role` aliases for the table UI). Owner/admins absent by construction (shown as an **"Owner"** badge in Admin).
- The Staff page **Attendance/Summary** tabs read the device `attendance` table over the roster:
  `getAttendanceRange({from,to,key?})` (`GET /api/attendance/range`, fields mirror the old UI:
  `employeeName/punchIn/punchOut/hoursWorked`) and `getAttendanceSummary({from,to})`
  (`GET /api/attendance/summary`). The **Google-Sheet importer is gone** (staffRoutes gsheet endpoints +
  `attendanceService.ts` deleted; `attendanceRecords` table left dormant). The **Today** board + EMPLOYEE
  filter use `GET /api/payroll/people`. **Shifts/Leaves** stay account-keyed and list `GET /api/staff/accounts`
  (manager/staff users; owner/admins excluded). Biometric/salary **`StaffBiometricSetup`** lives in the
  **Device** tab now (not Payroll). Smoke test: `scripts/verify-attendance-tabs.ts`.

**UI split (the user's chosen model):**
- **Admin → Accounts** = the *only* create/edit/delete place. The **Add Staff Member** dialog sets name + **Role** (`STAFF_ROLE_OPTIONS`: Service/Cook/Cleaning/Cashier/Other — Manager is the separate tier) + optional PIN; role → `designation` → payroll.
- **Staff page → "Staff & Biometric Setup"** = *annotate-only* list over `GET /api/payroll/people`: read-only **name** + read-only **role** + **Biometric ID** + **Salary** (`PersonRow`). Saves route by `kind` → `PUT /api/staff/:id/profile` (user) or `PUT /api/staff-members/:id` (staff). No add/delete/role-edit here. Payroll salary edit routes the same way.
- Smoke tests (no HTTP): `scripts/verify-staff-payroll.ts`, `scripts/verify-union-payroll.ts`.

## Page access (per-person, staff tier) — `shared/pageAccess.ts`
Page **visibility** only — does NOT touch login, PINs, or the permission/role engine. The pre-existing
per-tier `managerAllowedPages`/`staffAllowedPages` is replaced **for the staff tier** by per-person access:
- **`settingsStore.staffPageAccess`**: `{ "sm:<id>" | "u:<id>": string[] }` (allowed page hrefs). Endpoints
  `GET/POST /api/settings/staff-page-access` + `.../apply-role` (copies one person's pages to everyone who
  shares their role). Owner/admins not listed; managers use the Manager card.
- **Resolution** (`resolveStaffAllowedPages`): per-person override → `ROLE_PAGE_DEFAULTS[role]` seed → none.
  My Attendance is `alwaysVisible` (never stored). The staff session now carries `designation`
  (`deserializeUser`) so the client resolves the role default.
- **Enforcement**: `useAllowedPages()` (Set for staff tier, null for admin/manager) drives `TopNav` +
  `BottomNav` nav filtering **and** `RouteGuard` (redirects a staff-tier user off a disallowed page to
  `/my-attendance`). Admin/manager unaffected.
- **Admin → Role Permissions**: Admin card removed; **Manager** card left (tier-wide); **Staff** = per-person
  `StaffPageAccessCard` (pick by name → toggle pages → Save / "Apply to all <role>").
- Smoke test: `scripts/verify-page-access.ts`.
