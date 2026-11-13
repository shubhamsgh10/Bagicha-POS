# Local-first shop PC (offline mode) — design

Date: 2026-11-13. Status: approved direction, phase 1 (PGlite spike) starting.

## Problem

The shop PC runs the Electron thin client: every screen reads from Vercel, which reads from
Supabase. When the internet drops, or the connection silently dies (the ~10 s Jio stall, see
"Request latency" in CLAUDE.md), every tap waits. Nothing works offline. `better-sqlite3` is a
dependency but nothing uses it — there is no local data layer.

## Goal

On the shop PC, every screen reads and writes a local copy and feels instant. Orders, KOT/bill
printing, settle, cancel, move table keep working with no internet. When the internet returns,
everything syncs in the background with no staff action. Supabase stays the shared record that
phones, Reports and other devices use.

## Decisions (approved 2026-11-13)

1. **Bill/KOT numbers offline: reserved blocks.** One continuous series; numbers from two devices
   may interleave out of time order. (Owner to confirm GST acceptability with the accountant.)
2. **Phones keep using the cloud.** A table edited on both sides during an outage is flagged on
   the Sync screen. LAN mode (phones talk to the PC over shop Wi-Fi) is a possible later phase.
3. **Loyalty and coupons are blocked offline** (they need the cloud balance; avoids double spend).
4. **Shop PC only.** Phones and Vercel behave as today.
5. **Build it ourselves on PGlite**, not a sync product (PowerSync puts data in client SQLite and
   can't run our server rules).

## Architecture

```
Shop PC (Electron)
  POS screen ──► local server (same Express routes) ──► PGlite (local Postgres)
                       │                                      │
                       └──► printers (already local)          ▼
                                                         sync worker ◄──► Cloud API (Vercel) ──► Supabase
Phones ───────────────────────────────────────────────────────────────► Cloud API
```

**Why a local server, not browser storage:** every money/kitchen rule (pricing, tax, KOT delta,
counters, PIN elevation, stock, settlement guards) lives in `server/`. Running the same code
against a local database keeps one implementation; a browser store would need a second copy that
drifts.

**Why PGlite:** the schema (`shared/schema.ts`) and all queries are Postgres (`jsonb_set`,
`FOR UPDATE`, advisory locks, `md5` fingerprints, `filter (where …)`). PGlite is Postgres compiled
to WASM, in-process, with a Drizzle driver (`drizzle-orm/pglite`). SQLite would mean a second
schema and rewriting storage.ts. **Phase 1 proves this before anything else is built.**

All DB access goes through `server/db.ts` (`db` only; `pool` is exported but unused elsewhere),
so the switch is contained to that file.

## Components

### 1. Local copy (PC only)
- Full: menu items, categories, tables, settings, printers, staff members/users (PINs as hashes
  only), customers, inventory, POS sections.
- Orders + order_items + kot_tickets: every open order, plus the last N business days (default 3)
  so Order History / Billing / KOT screen work offline.
- Older history and full reports stay cloud-only (online only).

### 2. Local server
- `server/index.ts` started inside Electron (the existing host-build path, `desktop/main.ts`
  `IS_EMBEDDED`) with `BAGICHA_DB=pglite`, data dir under `userData`.
- Renderer loads from `http://localhost:<port>` as the host build already does.
- Background jobs stay OFF in local mode (WhatsApp/automation remain cloud/host concerns);
  printing is local and works offline.

### 3. Up-sync (PC → cloud): event-driven outbox
- Every successful local write that mutates synced data also inserts an `outbox` row in the
  same local transaction: `{ seq, method, path, body, idempotencyKey, localIds, createdAt,
  status, attempts, lastError }`.
- The write wakes the sync worker immediately (in-process event, no timer).
- Offline: the worker sleeps until (a) the OS reports online **and** (b) `GET /api/ping`
  succeeds — `navigator.onLine`/OS events lie on the Jio dead-connection case.
- Sends strictly in `seq` order through the existing cloud routes with the existing one-time
  request keys (`server/requestKeys.ts`), so a resend can never duplicate.
- Retry backoff 1 s → 2 s → 5 s … capped at 30 s. A request the cloud **rejects** (4xx other than
  408/429) moves to `sync_problems` and stops blocking the rows behind it **unless** later rows
  depend on it (same order id), in which case those rows wait with it.
- Local ids → cloud ids: local rows use ids from a **reserved block** (below), identical on both
  sides, so no id remapping is needed.

### 4. Down-sync (cloud → PC): events as nudges + safety poll
- New server table `change_log (seq bigserial, table_name, row_id, op, changed_at)`, filled by
  Postgres triggers on synced tables (insert/update/delete). Captures deletes (merge deletes the
  source order) and commits that land out of timestamp order — both missed by `updatedSince`.
- `GET /api/sync/pull?after=<seq>&limit=500` → changed rows (full row, or tombstone for delete) +
  `nextSeq`. ETag'd like other polled lists, so "nothing new" costs ~32 bytes.
- Triggers: existing Pusher events (`NEW_ORDER`, `ORDER_UPDATE`, `TABLE_UPDATE`, `KOT_UPDATE`) +
  new `MENU_UPDATE` / `SETTINGS_UPDATE` → pull immediately (coalesced 500 ms).
- Safety poll every 60 s if no event; full catch-up pull on reconnect, **before** sending the
  outbox.
- Own changes coming back are applied idempotently (same row, same values); rows with a pending
  local outbox entry are not overwritten until that entry is acknowledged.

### 5. Reserved blocks (ids and numbers)
- Server table `device_leases (device_id, kind, start, end, issued_at)`; kinds: `order_id`,
  `bill_counter`, `kot_counter`, plus id kinds for order_items / kot_tickets.
- Issued by `POST /api/sync/lease` (admin-registered device token), taken atomically from the cloud
  sequences/counters so the cloud never issues those values itself.
- PC refills when < 25% of a block remains (default block: 200 numbers); offline it uses the
  remaining block; if a block runs out offline, new orders are blocked with a clear message (sized
  so a full offline day fits).
- Cloud routes accept a client-supplied id/number **only** inside a lease held by the calling
  device.

### 6. PINs offline
- PC stores PIN hashes (salted, never plaintext) synced from the cloud.
- Local `verify-pin` checks the hash and records the approver. The queued request carries a
  device-signed approval `{approverId, action, orderId, at}`; the cloud accepts it in place of a
  fresh 90 s grant when the signature and device token are valid.
- Local login session works offline (MemoryStore on the local server).

### 7. Sync status UI
- Badge in POS/TopNav: `Online` · `Offline · N waiting` · `Syncing`.
- Sync screen: outbox queue, `sync_problems` with the cloud's reason, Retry / Discard (admin PIN).

### 8. Security
- The PC never holds `DATABASE_URL`; sync goes only through authenticated API endpoints with a
  per-device token (issued from Admin, revocable).
- PGlite data dir encrypted at rest using a key from Electron `safeStorage`.
- New server tables get `ENABLE ROW LEVEL SECURITY` (see CLAUDE.md).

## Offline behaviour

| Works offline | Online only (queued or blocked) |
|---|---|
| Orders, item edits, tables, move/merge | WhatsApp messages, e-bill (queued / needs internet) |
| KOT + bill printing | Razorpay |
| Settle cash/UPI, Pay Later | Loyalty / coupon redeem (blocked) |
| Cancel, write-off, discount with PIN | Full Reports, old history |
| Today's Orders, Billing, KOT screen | Phones (unchanged, cloud) |

## Conflicts

- Same order edited on PC (offline) and phone (cloud): the PC's replay hits the cloud's existing
  guards (`updatedAt` tokens, `409 settled`, `table_busy`). Rejections land in `sync_problems`;
  the PC then pulls the cloud's version. No silent overwrite in either direction.
- Same table opened on both sides: cloud returns `409 table_busy` on replay → sync problem; staff
  merge or cancel one.

## Phases

1. **PGlite spike** — schema + real storage/settings functions on PGlite, incl. concurrency.
   Decides whether the plan holds. (Plan: `docs/superpowers/plans/2026-11-13-local-first-phase1-pglite-spike.md`.)
2. **Instant screens** — persist the PC's React Query cache to disk; read-only survival of an
   outage. Independent of PGlite.
3. **Local server + read path** — `BAGICHA_DB=pglite`, change_log + pull, bootstrap snapshot.
4. **Offline writes** — outbox, leases, offline PIN, sync problems UI.
5. **Hardening** — cable-pull mid-service, kill mid-sync, dual-edit tests; on test orders only
   (shared DB).

## Risks / open questions

- PGlite runs one transaction at a time. A query issued on the global `db` **inside** a
  `db.transaction` callback (instead of `tx`) would wait on its own transaction → hang. Spike
  checks the hot paths; any such site must be fixed for local mode.
- Raw `db.execute` result shape (`.rows`) must match between drivers (12 call sites).
- PGlite performance and data-dir size on the shop PC.
- Bill-number interleaving vs GST expectations (owner/accountant).
