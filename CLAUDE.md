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
- `dataDir.ts` — `dataDir()`/`dataPath(name)` resolve the writable base for server-managed files (`restaurant-settings.json`, `automation-config.json`, `baileys-auth/`, …). Returns `process.env.BAGICHA_DATA_DIR || process.cwd()`. **Any new cwd-relative file write must go through `dataPath()`**, or it breaks in the packaged Electron host build (read-only cwd). `settingsStore.ts`, `automationStore.ts`, `baileysDriver.ts` use it.
- `whatsappRoutes.ts` — WhatsApp driver control, agent-inbox endpoints (`/api/whatsapp/*`), and the public Meta webhook.
- `services/whatsapp/` — WhatsApp automation subsystem (see "WhatsApp Automation" below).
- `printRoutes.ts` / `printService.ts` — KOT/bill printing endpoints (see "Printing (KOT/Bill)" below).

### `client/src/`
- `App.tsx` — Wouter router with auth guard. POS is full-screen (no TopNav). All other pages use TopNav + sidebar layout.
- `pages/` — One file per route. `POS.tsx` is the most complex page (order management, role switching, PIN gates).
- **Live tables** (`pages/LiveTablesDashboard.tsx` + `components/live-tables/OrderCard.tsx`): dine-in cards source data from `useLiveTableOperations.ts` (fetches `/api/tables` + full `/api/orders/:id` per running table; WS `NEW_ORDER`/`ORDER_UPDATE` diff). "Assigned staff" = `orders.createdByName` (set at order create, exposed by `getTables()` as `servedByName`, same value the "Staff on Floor" panel in `Tables.tsx` uses); the card also shows `customerName`. There is no separate table→waiter assignment field. **Never re-set `createdByName` outside order creation** — `PUT /api/orders/:id/items` used to stamp it to the *current* actor on every item edit, so a long-running table edited the next day by a different logged-in user would silently flip "served by" to them (fixed; see [routes.ts](server/routes.ts) `items` route).
- `components/ui/` — shadcn/ui components (do not edit these manually).
- **Horizontal-scroll tab rows** (e.g. Customers page tabs in `CustomerDashboard.tsx`): use `shrink-0 sm:flex-1` on the buttons, never `flex-1 min-w-0` — `min-w-0` lets nowrap labels collapse below content width and visually overlap on mobile instead of scrolling.
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

## WhatsApp Automation

`server/services/whatsapp/` implements automated outbound sending, an inbound FAQ chatbot, and the agent inbox (Customers → Conversations tab):

- **Driver layer** — `types.ts` defines the `WhatsAppDriver` interface; `baileysDriver.ts` (unofficial, QR-paired via `@whiskeysockets/baileys`, version pinned **exactly** — never add a caret; all Baileys imports stay in this one file) and `metaDriver.ts` (official Cloud API, inbound fed by the webhook). `driverManager.ts` owns the singleton; **only `server/index.ts` may init it** (never a serverless entry). Active driver chosen by `whatsappDriver` in `automation-config.json` (`baileys | meta | none`).
- **Outbound** — `outboundQueue.ts` drains the `automation_jobs` table through the driver with `sendDelayMs` + jitter pacing, retries, and a `maxPerDay` cap. `customerAutomationService` enqueues when `whatsappAutoSend=true` (off = legacy manual wa.me flow). `messagingService` sends driver-first for the whatsapp channel. Opt-out is re-checked at send time.
- **Inbound** — `inboundService.ts` upserts `conversations` (per-phone threads; `customerId` is a best-effort last-10-digit match into `customers_master`), persists to `conversation_messages`, and runs `botService.ts` (pure keyword FAQ matcher — answers from `settingsStore` + config; STOP opts out via a *targeted* `doNotSendUpdate` update — never `upsertCustomerProfile`, which nulls the whole profile row). Human takeover silences the bot; it returns after `botReturnMinutes` idle. `detectIntent` uses whole-word regex with an **optional trailing `s` for keywords ≥4 chars** so plurals match ("hour"→"hours") while short words stay strict ("hi"≠"his").
- **Delivery tracking** — `deliveryService.ts` applies receipts to both `conversation_messages` and `customer_messages` by shared `waMessageId`, with a status-rank guard (pending<sent<delivered<read; failed terminal).
- **Realtime** — services publish `WA_MESSAGE | WA_STATUS | WA_CONVERSATION_UPDATE | WA_CONNECTION` via `publishRealtime()`. Client: `useConversations.ts` + `components/conversations/`. Local WS now connects in production LAN builds too (Pusher-only when `VITE_PUSHER_KEY` is set).
- **Footguns** — Baileys session lives in `baileys-auth/` (gitignored; wiped automatically on loggedOut). Ban avoidance: keep `sendDelayMs ≥ 3000`, low `maxPerDay`, warm up fresh numbers. **Benign log noise (not bugs):** `Bad MAC` / "Failed to decrypt message with any known session" come from `libsignal` trying to decrypt WhatsApp **Status updates** (`status@broadcast`) and messages from stale pre-restart sessions — undecryptable and irrelevant; can't be silenced without patching `node_modules`. `baileysDriver.ts` skips non-`@s.whatsapp.net` JIDs (groups/broadcasts/newsletters) silently.

### Settlement-time messaging

Customer-facing messages fire at **bill settlement** (`POST /api/orders/:id/payment`), **not** at order-save. Order-save (`POST /api/orders`) only records the visit (`logOrderPlaced` + segmentation) — no message. Dispatchers live in `automationRuleEngine.ts`:
- `triggerSettlementMessage(key,name,phone)` — paid branch. New customer (`totalVisits ≤ 1`) → WELCOME (gated by `settlementWelcomeEnabled`); returning → per `settlementReturningMode` (`off | auto | vip_reward | favorite_item | thank_you`). `auto` = VIP→VIP_REWARD, Regular+fav→FAVORITE_ITEM, else thank-you (`settlementReturningText`).
- `triggerDueBillMessage(orderId,name,phone)` — `else` (due/unpaid) branch. Sends an itemized reminder built from `storage.getOrderItems` + amounts; `dueMessageTemplate` wraps it with `{name} {restaurant} {due} {bill}` tokens (`{bill}` = item list).
- Both: one message per customer per day (`hasJobToday` guard on `automation_jobs`), then `dispatchSettlement` → `enqueueWhatsApp` when `whatsappAutoSend` + driver, else legacy `sendMessage`. Blank templates fall back to defaults in `automationStore` / `automationRuleEngine`.
- Per-customer snapshot: `buildSnapshotForKey` (exported from `customerAutomationService.ts`). Admin UI: "Checkout messages" card in `AutomationPanel.tsx` SetupTab (5 config fields, persisted via `/api/automation/config`).
- **Ownership split (avoid duplicates):** settlement owns WELCOME / VIP_REWARD / FAVORITE_ITEM / THANK_YOU / due-reminder. The background engines do **lapsed re-engagement only** — `evaluateTrigger` (`customerAutomationService.ts`, hourly) and `evaluateDefaultTriggers` (`automationRuleEngine.ts`, daily) emit only WIN_BACK / AT_RISK / INACTIVITY_*. Do not re-add welcome/VIP/favourite to either engine.
- **Same-day dedup = resolved `customerId` on `automation_jobs`** (never the phone-vs-name `key`). Every send path resolves via `resolveCustomerId` then checks `automation_jobs` for today: settlement `hasJobToday`, daily engine's `recentJob`, and `enqueueWhatsApp` (which also blocks a same-day **sent** job for the same `customerId+trigger`, not just pending/sending).

### Customer identity

`resolveCustomerId(key,name,phone)` (`customerIdService.ts`) matches by `key` first, then **falls back to last-10-digit phone match** before inserting — prevents duplicate `customers_master` rows when a person was created by name then later referenced by phone (or vice-versa). The CSV import route applies the same phone dedup. `key` = `phone || name`.

## Printing (KOT/Bill)

Two **parallel implementations** render the same KOT/bill text — keep them in sync when changing format:
- `shared/print/generators.ts` (`generateKOTBuffer`/`generateBillBuffer`) — builds the real ESC/POS byte buffer sent to the hardware printer via `/api/print/kot` and `/api/print/bill` (`server/printRoutes.ts`, re-exported through `server/printService.ts`).
- `server/printRoutes.ts` (`kotTextLines`/`billTextLines`) — plain-text lines for the `/api/print/preview` JSON endpoint only.

**Time:** always format via `formatISTDateTime()` (`shared/print/formatDate.ts`, `Intl.DateTimeFormat` pinned to `Asia/Kolkata`) — never read `.getHours()`/`.getDate()` off a raw `Date` for printed output. The server process's ambient timezone is not guaranteed to be IST even though the restaurant is; the client-side HTML bill (`client/src/lib/printBill.ts`) gets this right via the browser's local clock, the server paths didn't until fixed.

**Cashier name:** bill print's `cashierName` prefers `order.createdByName` (who actually created/served the order — same field as the live-tables "served by", see above), falling back to the printing user's username only for legacy orders without it. Don't pass `req.user.username` alone — that's whoever happens to click print, not who served the table.

**Customer name:** when `billSettings.showNameField` is on, print `order.customerName` if present; only fall back to the blank `Name:____` line when no name was captured on the order.

**Header centering (`generateBillBuffer` only):** native ESC/POS `E.ALIGN_CENTER` is active for the whole restaurant-header block — print lines with plain `E.line(str)`, never `E.centered(str, W)` underneath an active `ALIGN_CENTER`. `E.centered` manually left-pads using the *assumed* printer width `W`, and centering that padded string again via the native command double-centers it, drifting away from lines (like the restaurant name) that rely on native centering alone. `generateKOTBuffer` has no `E.centered` calls and isn't affected; `printRoutes.ts`'s plain-text preview uses one consistent manual-centering function throughout (no native commands), so it isn't affected either.

**Settlement vs. printing are separate actions, by design.** The intended flow: staff prints the bill first (main "Print Bill" button, before any payment method is chosen) → customer decides how to pay → staff opens the settlement dialog (`SettlementDialog.tsx`), enters the matching amount, and hits "Settle Now". `SettlementDialog` has no print button of its own (removed — it was redundant with this flow and tempted staff into settling before the customer had actually decided). `order.paymentMethod` stays `null` until "Settle Now" — printing a bill on an unsettled order correctly omits the payment-method line.

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
- **⚠️ Before `npm run db:push`, review the proposed diff.** The shared Neon DB carries columns applied
  outside Drizzle migrations (staff-HR + `show_on_mobile`, applied via the `scripts/migrate-*.mjs` ALTER
  scripts). If `schema.ts` ever drifts behind the live DB, a blind push can propose destructive **DROP**s —
  prefer a targeted `ALTER TABLE` script (see `scripts/migrate-staff-hr.mjs`) for additive changes.

## Staff, Attendance & Payroll

Two identity systems (see `docs/superpowers/specs/2026-05-21-unified-role-user-management-design.md`), **both created in Admin → Accounts**:
- **`users`** (`username/password`, roles admin/manager/staff) — login + POS permissions. HR fields live in `staffProfiles` (`designation`, `biometricId`, `monthlySalary`).
- **`staffMembers`** — PIN name-card mobile login **and** attendance-only staff. Carries `designation`, `biometricId`, `monthlySalary`, `excludeFromPayroll`. **PIN is optional** — a `pin == null` member is *attendance-only* and never appears as a login card (clocks in by fingerprint).

**Mobile name-card login** (`showOnMobile` boolean on **both** `users` (default false) + `staffMembers` (default true)):
- Public `GET /api/staff-members` returns **unified login cards** — staff members **and** non-admin accounts that have `showOnMobile` ON + a PIN, each tagged `kind:"staff"|"user"`. Admins/owner are never card-eligible.
- `POST /api/auth/card-login {kind,id,pin}` logs in either a staff member (staff-tier session) or an account (its real role); admins blocked. `Login.tsx` calls it with the card's `kind`.
- Admin → Accounts shows a **Mobile Card on/off `Switch`** per row (`toggleUserCard`/`toggleStaffCard` → `PUT /api/users/:id`|`/api/staff-members/:id {showOnMobile}`); disabled for admins and for anyone without a PIN. Smoke test: `scripts/verify-mobile-card.ts`.

**⚠️ Id-collision gotcha:** `users` and `staffMembers` share the integer id space, and a staff-member session is `{ id: sm.id, _isStaffMember: true }`. Any "self" endpoint that keys on `req.user.id` MUST disambiguate by `_isStaffMember` (→ `staffMemberId` vs `userId`) or it's a cross-table IDOR. Already guarded: `/api/attendance/me`, `/api/payroll/me/:month`.

**Authorization:** payroll/roster reads expose salaries → gated by **`requireManagerOrAdmin`** (`/api/payroll/people`, `/api/payroll/report/:month`, `/api/staff/accounts`) so staff-tier (PIN) sessions can't read them; managers keep Staff-page access. Admin-only config (`GET/POST /api/settings/staff-page-access` + `apply-role`) is `requireAdmin`. Self-service `/api/*/me` stays `requireAuth`.

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

## Deployment modes

The same app ships three ways. **Baileys (and the outbound worker + schedulers) only run inside a persistent process — never serverless.** The driver/worker start *only* in `server/index.ts`'s `server.listen` callback.

- **Vercel (web + API):** `vercel.json` → `api/index.ts` → `dist/app-bundle.js` (built from `server-fn.ts`). This is a stateless request handler — it does **not** call `server.listen`/`initWhatsAppDriver`/`startOutboundWorker`. So Vercel has **no Baileys, no inbound bot, no queue draining** (Meta Cloud API would work there — it's stateless HTTPS + webhook).
- **Persistent process (`npm run dev`/`npm start` = `server/index.ts`):** full stack incl. Baileys. This is the only place auto-send works.
- **Electron host build (`pack:win:host`, flag `BAGICHA_EMBEDDED=1`):** `desktop/main.ts` spawns the bundled server (`dist/index.js`) as an `ELECTRON_RUN_AS_NODE` child with `BAGICHA_DATA_DIR=app.getPath("userData")` + baked `DATABASE_URL` (override via `userData/host-config.json`), waits for `/api/auth/context`, then loads the window from `http://localhost:5179` (renderer/WS auto-target localhost). Makes the admin desktop the always-on WhatsApp host **while the app is open**. Uses `asar:false` (so the child Node resolves `dist/index.js` + node_modules from disk). **Baileys is a singleton — only ONE host build per number.** Normal Electron builds (`pack:win`) stay thin clients → remote API.
