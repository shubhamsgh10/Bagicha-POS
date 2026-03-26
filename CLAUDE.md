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
