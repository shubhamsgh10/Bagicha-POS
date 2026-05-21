# Unified Role & User Management — Design Spec
**Date:** 2026-05-21  
**Status:** Approved by user

---

## Context

The app currently has role/user management scattered across two pages in a confusing, partially-duplicate way:

- **Admin page → Users tab**: "Add New User" (username + password + role, no PIN)
- **Admin page → Roles tab**: "Add Role" (username + password + role + PIN) — calls the same API, just a more complete form. Duplicate.
- **Settings page → Staff Selector**: Separate staff members (name + PIN only) for a dedicated mobile URL (`192.168.x.x:5000`)
- **Settings page → Manager Page Access**: Toggles for which pages the manager role can see. No equivalent exists for staff.

Additionally, there is no proper "staff" login role — staff members only exist as PIN-only entries in a separate `staffMembers` table with their own login URL, not as full system accounts.

**Goal:** Consolidate everything into the Admin page with a clean 3-tab layout, add a proper staff login role, retire the separate staff URL, and redesign the mobile login page to show staff name cards while leaving the desktop login page untouched.

---

## Two Distinct Systems (this distinction is intentional and correct)

| | System Accounts (`users` table) | Staff Members (`staffMembers` table) |
|---|---|---|
| Login method | Username + Password | PIN only (tap name card on mobile) |
| Roles | admin / manager / staff | No role — PIN grants staff-level session |
| Purpose | Full app access with role permissions | Quick mobile identification for order-taking |
| Who creates | Admin | Admin |

These remain separate but are now displayed together in the Admin page for clarity.

---

## Design Decisions

### 1. Admin Page — 3-Tab Layout

Replace the current Users/Roles tab confusion with two clear tabs:

**Tab 1 — Accounts** (system accounts + staff members combined)  
**Tab 2 — Role Permissions**

#### Tab 1: Accounts

A single unified table showing ALL user types in one place:

| Column | Notes |
|---|---|
| Name / Username | Display name |
| Role | Badge: ADMIN (amber) / MANAGER (blue) / STAFF (green) / STAFF MEMBER (purple) |
| Login Type | "Username + Password" or "PIN only" |
| Mobile Card | "✓ Shown" for staff members who appear on login screen |
| Actions | Edit / Delete |

**System accounts** (admin, manager, staff): created via unified "Add Account" dialog with fields: username, password, role (dropdown: admin/manager/staff), optional PIN.

**Staff members** (Balawant, Deep): created via "Add Staff Member" button — separate simpler dialog with fields: name, PIN (4–6 digits), confirm PIN. These appear as purple rows in the same table, clearly labelled "STAFF MEMBER".

**The shared staff account**: Admin creates exactly one account with role="staff" (any username/password they choose). This is a normal account creation via `+ Add Account`. Admin can share these credentials with any floor staff who need username+password access. It appears in the table like any other account, labelled with the STAFF badge.

**Add buttons at top-right:**
- `+ Add Account` → opens full account dialog (username/password/role/PIN)
- `+ Add Staff Member` → opens simple name+PIN dialog

Removes: the duplicate "Add User" / "Add Role" dialogs from the current Admin page.

#### Tab 2: Role Permissions

Three columns side by side:

| Admin | Manager | Staff (new) |
|---|---|---|
| Locked — full access always | Existing toggles (10 pages) + Save | New toggles (10 pages) + Save |

Pages available for toggle: Tables, Orders, Billing, KOT, Staff, Menu, Inventory, Live Tables, Kitchen, Customers.

Admin column is shown but locked/greyed with a note "Admin always has full access."

**Backend:** Add `staffAllowedPages: string[] | null` to `settingsStore.ts` alongside existing `managerAllowedPages`. Add `GET/POST /api/settings/staff-pages` endpoints. Enforce in `TopNav.tsx` using the same pattern as manager pages.

### 2. Staff Role — Full Login Account

Add "staff" as a proper selectable role in the "Add Account" dialog. Staff accounts:
- Log in with username + password (the shared staff credentials)
- Are restricted to pages admin allows via the Staff Page Access panel
- Appear in the POS role switcher as a switchable role (same mechanism as manager)
- Can have an optional PIN for POS role-switching

The `users` table already has `role` as a text column — no schema migration needed. The UI just needs to expose "staff" as a role option in the add/edit dialogs (currently the dialogs only offer admin/manager).

### 3. Settings Page — Remove Migrated Sections

Remove from `client/src/pages/Settings.tsx`:
- **Staff Selector panel** (lines ~864–1112) — now lives in Admin page Tab 1
- **Manager Page Access panel** (lines ~1129–1198) — now lives in Admin page Tab 2

All their functionality is preserved in the new location. No API changes needed for these — the same endpoints are reused.

### 4. Login Page — Responsive Split

**Desktop (≥ 768px): NO CHANGES**  
The current illustrated wide-view login (restaurant art left + wood-fire oven right, centered Sign In card) stays exactly as-is. Staff name cards never appear here.

**Mobile (< 768px): NEW design**  
Replace the current mobile login with the staff-card screen:

```
[ Restaurant banner image (wood-fire oven) ]
[ Bagicha logo icon ]
WHO ARE YOU?
[ Balawant card ]  [ Deep card ]
[ + more staff cards in a responsive grid ]
────────────────────────────
Manager / Admin Login →
```

- Staff cards pulled from `GET /api/staff-members` (existing public endpoint — no auth needed)
- Tap a card → PIN entry dialog (4–6 digit numpad or input) → `POST /api/auth/staff-pin-login` → logged in with staff-level session
- "Manager / Admin Login →" slides in the username+password form (same fields, just toggled view)
- "← Back" returns to the staff card screen
- If no staff members exist yet, show only the "Manager / Admin Login" form on mobile too (graceful fallback)

**File to modify:** `client/src/pages/Login.tsx` (or wherever the login page lives)

---

## Files to Modify

| File | Change |
|---|---|
| `client/src/pages/Admin.tsx` | Full rewrite — 3-tab layout (Accounts + Role Permissions). Merge Users tab + Roles tab + Staff Selector into Tab 1. Add Staff Page Access to Tab 2. |
| `client/src/pages/Settings.tsx` | Remove Staff Selector panel (~lines 864–1112) and Manager Page Access panel (~lines 1129–1198) |
| `client/src/pages/Login.tsx` | Add mobile-only branch: staff card grid + PIN entry + "Manager/Admin Login →" toggle |
| `server/routes.ts` | Add `GET /api/settings/staff-pages` and `POST /api/settings/staff-pages` endpoints (same pattern as manager-pages) |
| `server/settingsStore.ts` | Add `staffAllowedPages: string[] | null` field |
| `client/src/components/TopNav.tsx` | Enforce `staffAllowedPages` for staff role (same pattern as `managerAllowedPages`) |

---

## Reused Existing Patterns & APIs

- `POST /api/users` — create/edit system accounts (already exists)
- `GET /api/users` — list all system accounts (already exists)
- `PUT /api/users/:id` — edit account (already exists)
- `DELETE /api/users/:id` — delete account (already exists)
- `PUT /api/users/:id/pin` — set/clear PIN (already exists)
- `GET /api/staff-members` — public list of active staff (already exists, used by login page)
- `POST /api/staff-members` — create staff member (already exists)
- `PUT /api/staff-members/:id` — edit staff member (already exists)
- `DELETE /api/staff-members/:id` — delete staff member (already exists)
- `POST /api/auth/staff-pin-login` — PIN login (already exists, used by new mobile login)
- `GET/POST /api/settings/manager-pages` — existing; new staff-pages endpoints mirror this pattern
- `managerAllowedPages` in settingsStore — new `staffAllowedPages` mirrors this exactly
- TopNav manager enforcement logic — staff enforcement copies this pattern

---

## What Does NOT Change

- Desktop login page (untouched)
- All POS role-switching logic (`useActiveRole`, `usePermission`, `RoleSwitcher`)
- All other Settings page sections (print settings, restaurant info, etc.)
- All existing API endpoints (additions only, no modifications)
- `staffMembers` table schema (no migration needed)
- `users` table schema (no migration needed — `role` column already accepts any string)
- The separate staff URL (`/staff-login`) — can be deprecated silently, existing functionality moves to main login

---

## Verification

1. `npm run dev` — start dev server
2. **Admin page → Accounts tab**: create an admin, manager, and staff account; create a staff member (name+PIN); verify all appear in the unified table with correct role badges
3. **Admin page → Role Permissions tab**: toggle pages for manager and staff separately; save each; verify TopNav hides/shows pages correctly when logged in as each role
4. **Settings page**: confirm Staff Selector and Manager Page Access sections are gone
5. **Login page on mobile (375px viewport)**: verify staff name cards appear, tap a card, enter PIN, confirm staff session established with correct page access
6. **Login page on desktop (1280px viewport)**: confirm no staff cards appear, standard username+password form works for all roles
7. **"Manager / Admin Login →" on mobile**: confirm it toggles to username+password form; "← Back" returns to staff cards
8. `npm run check` — TypeScript clean
