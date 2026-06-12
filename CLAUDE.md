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
- `whatsappRoutes.ts` — WhatsApp driver control, agent-inbox endpoints (`/api/whatsapp/*`), and the public Meta webhook.
- `services/whatsapp/` — WhatsApp automation subsystem (see "WhatsApp Automation" below).

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

## WhatsApp Automation

`server/services/whatsapp/` implements automated outbound sending, an inbound FAQ chatbot, and the agent inbox (Customers → Conversations tab):

- **Driver layer** — `types.ts` defines the `WhatsAppDriver` interface; `baileysDriver.ts` (unofficial, QR-paired via `@whiskeysockets/baileys`, version pinned **exactly** — never add a caret; all Baileys imports stay in this one file) and `metaDriver.ts` (official Cloud API, inbound fed by the webhook). `driverManager.ts` owns the singleton; **only `server/index.ts` may init it** (never a serverless entry). Active driver chosen by `whatsappDriver` in `automation-config.json` (`baileys | meta | none`).
- **Outbound** — `outboundQueue.ts` drains the `automation_jobs` table through the driver with `sendDelayMs` + jitter pacing, retries, and a `maxPerDay` cap. `customerAutomationService` enqueues when `whatsappAutoSend=true` (off = legacy manual wa.me flow). `messagingService` sends driver-first for the whatsapp channel. Opt-out is re-checked at send time.
- **Inbound** — `inboundService.ts` upserts `conversations` (per-phone threads; `customerId` is a best-effort last-10-digit match into `customers_master`), persists to `conversation_messages`, and runs `botService.ts` (pure keyword FAQ matcher — answers from `settingsStore` + config; STOP opts out via a *targeted* `doNotSendUpdate` update — never `upsertCustomerProfile`, which nulls the whole profile row). Human takeover silences the bot; it returns after `botReturnMinutes` idle.
- **Delivery tracking** — `deliveryService.ts` applies receipts to both `conversation_messages` and `customer_messages` by shared `waMessageId`, with a status-rank guard (pending<sent<delivered<read; failed terminal).
- **Realtime** — services publish `WA_MESSAGE | WA_STATUS | WA_CONVERSATION_UPDATE | WA_CONNECTION` via `publishRealtime()`. Client: `useConversations.ts` + `components/conversations/`. Local WS now connects in production LAN builds too (Pusher-only when `VITE_PUSHER_KEY` is set).
- **Footguns** — Baileys session lives in `baileys-auth/` (gitignored; wiped automatically on loggedOut). Ban avoidance: keep `sendDelayMs ≥ 3000`, low `maxPerDay`, warm up fresh numbers.

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
