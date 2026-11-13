# Local-first Phase 3 — Local Server, Local Reads, Down-sync

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** On the shop PC, a local server answers every screen read from its own PGlite copy (instant, Jio-proof). Writes, login and everything not on the local-read list are forwarded unchanged to the cloud API. Cloud changes (phones, own writes) flow down through a change log.

**Architecture:**
- **Cloud:** a `change_log` table filled by triggers on 9 synced tables, a per-device token, `GET /api/sync/snapshot`, and `GET /api/sync/pull`.
- **Local server:** the same `server/index.ts` started with `BAGICHA_LOCAL_MODE=1` + `BAGICHA_DB=pglite`. It serves the read allow-list from PGlite, forwards everything else to `BAGICHA_CLOUD_URL` with that user's cloud cookies held server-side, and runs a sync worker: snapshot → pull on nudge, every 60 s, and after every forwarded write (read-your-writes).
- **Electron:** wiring is a separate later task (Task C).

Spec: `docs/superpowers/specs/2026-11-13-local-first-offline-design.md`. Phase 1 proved storage.ts runs on PGlite; phase 2 added the on-disk screen cache.

## Global rules (every task)
- `.env`'s `DATABASE_URL` is the shared PRODUCTION DB. Never run `npm run db:push`, `npm run seed`, or any migration against it — the controller (not you) runs the new migration after review and a backup. All SQL you write must first be proven on PGlite (in-memory) in a verify script.
- `tsconfig.json` has no `target`: no `for…of`/spread over `Map`/`Set` in `server/` `client/` `shared/`; use `Array.from`. `scripts/` aren't type-checked; run them with `tsx`.
- Any new cwd-relative file write goes through `dataPath()` (`server/dataDir.ts`).
- New server tables need `ENABLE ROW LEVEL SECURITY` in their migration.
- New list/GET client fetches use `apiJson`. Never edit `client/src/components/ui/`.
- Default behaviour (no `BAGICHA_LOCAL_MODE`) must be unchanged for Vercel, the dev server, the host build and browsers.
- Commit only on branch `local-first-phase3`; never touch/push `main`; never `git push`. Commit trailer: blank line + `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Stage files by name.
- `npm run check` and `npm run test:pure` must pass at the end of each task. Add every new DB-free/PGlite-only `verify-*.ts` to the `test:pure` chain.

## Synced tables
`users`, `staff_members`, `categories`, `menu_items`, `tables`, `restaurant_settings`, `orders`, `order_items`, `kot_tickets`.
Secret columns are **never** sent to the PC. They are stripped server-side; if a column is NOT NULL, the PC stores `''`:
- `users`: `password`, `pin`, `totp_secret`
- `staff_members`: `pin`

(Check the real column names in `shared/schema.ts`.)

---

## Task A (cloud side)

**Files:**
- Create: `scripts/migrate-change-log.mjs`, `shared/syncTables.ts`, `server/sync/changeLogSql.ts`, `server/sync/syncRoutes.ts`, `server/sync/deviceAuth.ts`, `scripts/verify-change-log.ts`
- Modify: `shared/schema.ts` (declare `change_log` + `sync_devices` so `db:push` never proposes dropping them), `server/routes.ts` (register the sync routes; publish nudges), and an Admin UI card (find where Admin → Settings cards live, e.g. `client/src/pages/Admin.tsx`)

### A1. `shared/syncTables.ts` (pure)

```ts
export const SYNC_TABLES = ["users","staff_members","categories","menu_items","tables",
  "restaurant_settings","orders","order_items","kot_tickets"] as const;
export type SyncTable = typeof SYNC_TABLES[number];
export const SECRET_COLUMNS: Record<string, string[]> = { users: ["password","pin","totp_secret"], staff_members: ["pin"] };
export const SNAPSHOT_ORDER_DAYS = 3;
export const PULL_RESET_THRESHOLD = 5000;
```

### A2. `server/sync/changeLogSql.ts`

Exports SQL text used by **both** the migration script and the verify script, so they can't drift.

- `CHANGE_LOG_DDL`:
  - `change_log(seq bigserial primary key, txid xid8 not null default pg_current_xact_id(), table_name text not null, row_id text not null, op char(1) not null, changed_at timestamptz not null default now())`
  - index on `(txid)` and on `(changed_at)`
  - `ENABLE ROW LEVEL SECURITY`
- `sync_devices(id serial primary key, name text not null, token_hash text not null unique, created_at timestamptz default now(), last_seen_at timestamptz, revoked_at timestamptz)`, also with `ENABLE ROW LEVEL SECURITY`.
- The trigger function `change_log_capture()`:
  - inserts `(TG_TABLE_NAME, COALESCE(NEW.id, OLD.id)::text, left(TG_OP,1))`
  - returns NULL
  - runs `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW`
- `triggerDdl(table)`: `DROP TRIGGER IF EXISTS change_log_capture ON <t>; CREATE TRIGGER change_log_capture AFTER INSERT OR UPDATE OR DELETE ON <t> FOR EACH ROW EXECUTE FUNCTION change_log_capture();`
- `ROLLBACK_SQL`: drop the 9 triggers, the function and both tables.
- `rowJsonSql(table)`: `to_jsonb(t) - <secret cols>` with `|| '{"password":""}'`-style fills for stripped NOT NULL columns.

**Pull query (snapshot cursor; correct under out-of-order commits).** The cursor is the text of a `pg_snapshot`. Changes are those whose transaction was not visible in the previous snapshot and is visible now:

```sql
SELECT seq, table_name, row_id, op
FROM change_log
WHERE txid >= pg_snapshot_xmin($prev::pg_snapshot)
  AND NOT pg_visible_in_snapshot(txid, $prev::pg_snapshot)
  AND pg_visible_in_snapshot(txid, $cur::pg_snapshot)
ORDER BY seq
```

- Take `$cur` with `SELECT pg_current_snapshot()::text` in the same request, first.
- A bare seq cursor would skip a row whose transaction committed after a later seq.

### A3. `scripts/verify-change-log.ts` (PGlite in-memory, add to `test:pure`)

Build the full schema (`scripts/lib/pgliteSchema.ts`), apply `CHANGE_LOG_DDL` + function + all triggers, then assert:
- an insert, an update and a delete on `orders` each add a change_log row with the right `op` / `row_id`
- a write to a non-synced table adds nothing
- snapshot-cursor pull:
  - s0 = snapshot; insert order A; s1 = snapshot; pull(s0, s1) returns A
  - pull(s1, s1) returns nothing
- the secret strip: a `users` row JSON has no `password` / `pin` / `totp_secret` keys
- `ROLLBACK_SQL` leaves no `change_log` table and no trigger (`pg_trigger` query)

### A4. Device auth (`server/sync/deviceAuth.ts`)

- `createDeviceToken(name)` returns `{ id, token }`. The token is 32 random bytes as hex; only its sha256 is stored.
- `requireDeviceToken` middleware:
  - reads `Authorization: Bearer <token>`
  - hashes it and looks up a non-revoked row; 401 if none
  - updates `last_seen_at` at most once per minute
- Admin routes (`requireAdmin`):
  - `POST /api/sync/devices {name}` returns the token once (an audit row via `logAudit`)
  - `GET /api/sync/devices` lists them, never with the hash
  - `DELETE /api/sync/devices/:id` revokes

### A5. `GET /api/sync/snapshot` (`requireDeviceToken`)

Run in ONE `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` on a single pool client, so every table and the cursor come from the same moment. Never use a session-level `SET` (transaction pooler leaks it — CLAUDE.md).

Response:

```json
{ "cursor": "<pg_current_snapshot text>", "tables": { "<name>": ["<row json>", "..."] } }
```

- **Full tables:** all synced tables except the three below.
- **`orders`:** open (`status <> 'cancelled' AND (payment_status='pending' OR status IN ('pending','preparing','ready','hold'))`) **or** `created_at >= now() - SNAPSHOT_ORDER_DAYS days`.
- **`order_items` / `kot_tickets`:** those of the selected orders.

Rows come from `rowJsonSql`.

### A6. `GET /api/sync/pull?cursor=<text>` (`requireDeviceToken`)

- Run the pull query, collapse to the last op per `(table_name, row_id)`, then fetch the current rows, one query per table: `WHERE id = ANY($ids)`.
- A row that is missing now becomes a tombstone.
- Response: `{ cursor: <cur>, changes: [{ table, id, row: <json>|null }] }`
- If the pull query returns more than `PULL_RESET_THRESHOLD` rows, or `$prev` is older than the prune horizon (`pg_snapshot_xmin($prev)` < the oldest `txid` kept), return `{ reset: true }`.
- Prune `change_log` rows older than 7 days at most once an hour (module-level timestamp).
- Send `Cache-Control: no-store`.

### A7. Nudges

After successful writes to menu items, categories, tables (CRUD) and settings (`PUT /api/settings` and the print-settings save), call `publishRealtime({ type: "SYNC_NUDGE" })` fire-and-forget (check the `RealtimeEvent` type in `server/realtime/publisher.ts` and add the variant). Order/table/KOT writes already publish events.

### A8. Admin UI

A small "Shop PC sync devices" card (admin only):
- name input + Create → shows the token once with a Copy button
- a list with last seen + Revoke

Use existing card/button components.

### A9. Finish

`npm run check`, `npm run test:pure`, commit per sub-step. **Do NOT run the migration.**

`scripts/migrate-change-log.mjs` must:
- follow the existing `scripts/migrate-*.mjs` connection pattern
- run everything in one transaction with `SET LOCAL lock_timeout='3s'`
- be idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS`)
- support `--rollback` (runs `ROLLBACK_SQL`) and `--dry-run` (prints SQL)

---

## Task B (local server)

**Files:**
- Create:
  - `server/local/localMode.ts` (env parsing + `isLocalMode()`)
  - `server/local/localSchema.ts` (applies `server/local/schema.generated.sql`)
  - `scripts/gen-local-schema.ts` (writes that file from `scripts/lib/pgliteSchema.ts`)
  - `server/local/syncWorker.ts`, `server/local/applyChanges.ts`, `server/local/cloudProxy.ts`, `server/local/localReadGate.ts`, `server/local/sessionStore.ts`
  - `scripts/verify-local-apply.ts`, `scripts/verify-local-read-gate.ts`
- Modify:
  - `server/index.ts` (local-mode branch)
  - `client/src/hooks/RealtimeProvider.tsx` (nudge)

### B1. Env (`localMode.ts`)

- Variables: `BAGICHA_LOCAL_MODE=1`, `BAGICHA_DB=pglite`, `BAGICHA_PGLITE_DIR` (required in local mode; on disk), `BAGICHA_CLOUD_URL` (e.g. `https://<app>.vercel.app`, no trailing slash), `BAGICHA_DEVICE_TOKEN`.
- Missing any → boot fails with a clear message.
- Local mode never needs and never reads `DATABASE_URL`; delete it from `process.env` at the top of the local-mode branch.

### B2. Local schema

- Runtime can't use `drizzle-kit` (devDependency), so `scripts/gen-local-schema.ts` writes the statements to `server/local/schema.generated.sql` (committed).
- `verify-local-apply.ts` asserts that this file equals a fresh generation (drift check).
- On boot, a `local_meta(key text primary key, value text)` table stores `schema_hash`.
  - If it differs from the hash of the generated SQL (or is missing), drop every table in `public` and re-create.
  - Phase 3's local DB is a pure cache with no local writes, so this is safe.
  - Then clear `sync_cursor` so a fresh snapshot runs.

### B3. Applying rows (`applyChanges.ts`)

Generic, using Postgres itself for typing. For each table, read its column list from `information_schema.columns` (cache it).
- **Upsert:** `INSERT INTO <t> SELECT * FROM jsonb_populate_record(NULL::<t>, $1) ON CONFLICT (id) DO UPDATE SET (<cols>) = ROW(EXCLUDED.<cols>...)`
- **Delete:** `DELETE FROM <t> WHERE id = $1` (cast per column type)
- **Snapshot apply:**
  - one transaction: truncate all synced tables, insert all rows, store the cursor in `local_meta`
  - reset each table's serial sequence to `max(id)` (harmless now, needed in phase 4)
- **Changes apply:** one transaction applying all changes in order, then store the new cursor.

`verify-local-apply.ts` (PGlite in-memory) asserts:
- snapshot apply
- upsert of an existing row changes it
- a tombstone deletes
- a `users` row with `password: ""` applies
- timestamps and json columns round-trip

### B4. Sync worker (`syncWorker.ts`)

- `start()`: if no cursor → snapshot. Then pull every 60 s **and** on `requestPull()`. Calls are serialized: one in flight; requests during a run set a "again" flag.
- `{ reset: true }` → snapshot.
- `pullNow(timeoutMs)` returns a promise that resolves when a pull **that started after the call** finishes, or on timeout (never rejects).
- Cloud fetch: `Authorization: Bearer` + a 10 s abort. Errors → log + exponential backoff 1 s→60 s for the timer path only (`requestPull` still tries immediately).
- `status()` returns `{ cursor?, lastPullAt, lastError, online }`.

### B5. Session store (`sessionStore.ts`)

- An `express-session` `Store` on PGlite table `local_sessions(sid text primary key, sess jsonb, expire timestamptz)` (get / set / destroy / touch), so sign-in survives a local-server restart.
- `server/index.ts` uses it in local mode instead of MemoryStore. Same cookie settings, `secure:false` (http://localhost).

### B6. Cloud proxy (`cloudProxy.ts`)

Express middleware for every `/api/*` request that the read gate (B7) did not keep local.
- **Forwards:** method, path + query, body (raw bytes — mount it before `express.json` for proxied paths, or re-serialise `req.body` JSON with the original content-type), and the headers `content-type`, `idempotency-key`, `x-requested-with`, `accept`. **No** `origin`/`host`/`cookie` from the browser.
- **Cloud cookies:** stored per local session in `req.session.cloudCookies` (name→value, from the cloud's `Set-Cookie`), sent as `Cookie`. Cloud `Set-Cookie` is never passed to the browser.
- **Response:** status, body and content-type pass back as-is. Network failure → `502 {error:"Cloud unreachable", code:"CLOUD_UNREACHABLE"}`.
- **Login** (`POST /api/auth/login`, `/api/auth/card-login`), on 2xx:
  - also `req.login(...)` locally with the principal from the local DB: a `users` row by id, or staff member (`_isStaffMember:true`, as `routes.ts` card-login builds it — mirror the existing serialize/deserialize shape)
  - if that row isn't synced yet, `await worker.pullNow(3000)` first
- **Logout:** forwards, then `req.logout` + session destroy locally.
- **Read-your-writes:** after any forwarded non-GET with a 2xx response, `await worker.pullNow(1500)` before responding.

### B7. Read gate (`localReadGate.ts`)

Pure `isLocalRead(method, path, query): boolean`. GET only, these paths:
- `/api/auth/me`, `/api/menu`, `/api/categories`, `/api/tables`, `/api/settings`, `/api/staff-members`, `/api/live-status`, `/api/kot`, `/api/orders/customers`, `/api/orders/hold`
- `/api/orders` **only** with a date or `open`/`unpaid`/`due`/`updatedSince` filter (an unfiltered `/api/orders` = whole history → proxy)
- `/api/orders/<digits>`

Everything else proxies, including `/api/auth/context`, reports, `/api/print/*`, `/api/pusher/auth` and any GET not listed.

`verify-local-read-gate.ts` covers each case.

### B8. `server/index.ts` local-mode wiring

In local mode:
- PGlite on disk, local schema, session store
- `app.use("/api", localGateMiddleware)`: local reads fall through to the normal `registerRoutes` handlers; everything else → `cloudProxy`
- start `syncWorker`
- **Never start:** background jobs, WhatsApp driver, outbound queue, print-station code (keep `BACKGROUND_JOBS` off), CSRF same-host rules still apply
- `GET /api/local/status` (local only) returns `{ localMode:true, ...worker.status() }`
- `POST /api/local/sync-now` (local only, requireAuth) does `await worker.pullNow(1500)` and returns 204

Not local mode: none of this code runs. The `server/local/*` modules can be imported lazily (`await import`) so the cloud bundle stays lean.

### B9. Client nudge (`RealtimeProvider.tsx`)

- On mount, `GET /api/local/status` once (tolerate 404 = cloud mode).
- In local mode, when an order/table/KOT/`SYNC_NUDGE` event arrives, `await fetch(apiUrl("/api/local/sync-now"), {method:"POST", credentials:"include", headers:{"X-Requested-With":"fetch"}})` (catch everything) **before** the existing coalesced invalidation fires. Keep the 1.5 s coalescing; only the ordering changes.
- Cloud mode: zero behaviour change.

### B10. Finish

`npm run check`, `npm run test:pure`, commit per sub-step.

---

## Task C (Electron wiring) — separate dispatch, after A + B are reviewed

- `host-config.json` gets `localMode: true`, `cloudUrl` and `deviceToken`.
- `desktop/main.ts` spawns `dist/index.js` (same mechanism as the embedded host build) with:
  - the local-mode env
  - `BAGICHA_PGLITE_DIR = userData/localdb`
  - **no `DATABASE_URL`**
- It loads `http://localhost:<port>`. The packaged thin client must ship `dist/index.js` + `@electric-sql/pglite` (check `electron-builder.yml`, `asar`).
- Details are planned after A/B land.

## Task D (end-to-end, controller)

1. Back up, run the migration.
2. Start the cloud dev server (port 5000) and a local-mode server (port 5179), both on a private Pusher channel.
3. Browser on 5179: login, Tables/POS instant from local, then save a `ZZTEST-` order (Save only, no KOT/Bill) → it appears locally.
4. Edit it from a 5000 tab → it arrives on 5179 via the nudge.
5. Cancel it, restore the `orders` id sequence, remove the test rows.

## Task C - as built (Electron wiring)

- **Config** (`userData/host-config.json`, other fields untouched, atomic write, mode 0600): `localMode`, `cloudUrl` (https, or http only for localhost), `deviceToken` (64 hex). Rules are in `desktop/localMode.ts` (pure, no Electron); `scripts/verify-local-mode-config.ts` (in `test:pure`) covers validation, the child env, the fallback rules and the supervisor with fake children.
- **Start-up** (`desktop/main.ts`, thin-client build only; the embedded host build ignores it; dev needs `BAGICHA_LOCAL_DEV=1`): `desktop/localServer.ts` spawns `<app>/dist/index.js` with Electron-as-Node, env from `buildLocalChildEnv` (no `DATABASE_URL`, `DATABASE_CA_CERT`, `BACKGROUND_JOBS`, host `SESSION_SECRET`/`HOST`; `BAGICHA_LOCAL_MODE=1`, `BAGICHA_DB=pglite`, `BAGICHA_PGLITE_DIR=<userData>/localdb`, `PORT=5179`, `HOST=127.0.0.1`, random `SESSION_SECRET` kept in `userData/local-session-secret`). Ready = `GET /api/local/status` answers `{localMode:true}`. A small splash page shows meanwhile.
- **Fallback**: not ready within 45 s, or more than 3 unexpected exits in 5 min (restart backoff 1/2/4 s) -> the window loads the normal cloud client (`loadFile`) for that run, `resolveApiBase()` goes back to the cloud, the printer cache is dropped. A child that is merely slow (first snapshot) is left running in the background and only logged as ready later; the next launch uses it.
- **Renderer -> local server**: under `http://localhost:5179` `packages/api-client/index.ts` `isLocalDevOrigin()` (hostname localhost/127.0.0.1) makes `readBaseFromEnv()` return `""`, so every `apiUrl()` is same-origin; hash routing is already chosen for any Electron renderer (`appRouter.tsx`). Main-process fetches (print queue, attendance agent) use `resolveApiBase()` = the local URL while active. Print bridge, attendance agent, updater and the stall breaker are renderer/main code keyed on `window.electronAPI` / `isElectron`, unchanged.
- **IPC** (`local:status`, `local:enable`, `local:disable`; preload `localStatus()/enableLocalMode()/disableLocalMode()`): enable/disable validate in main, accept only a `file://`, localhost:5179 or dev-URL sender, write host-config, stop the child and `app.relaunch(); app.exit(0)`. The token is never logged. Disable clears the stored token.
- **UI**: `SyncDevicesCard` shows "Use on this PC" next to a freshly created token (desktop app only) and, when configured, a status row with "Turn off local mode on this PC".
- **Packaging**: `build:electron` now also runs the new `build:server` script, so `dist/index.js` is in the thin-client package. No `asar` change was needed: Electron-as-Node reads `app.asar` (checked with `electron-builder --dir`: the child ran `dist/index.js` and PGlite's `.wasm`/`.data` from inside the asar, snapshot applied in about 5 s, crash fallback reached `file://`). `pack:win:host` is unchanged.
- **Manual tool**: `scripts/dev-stub-cloud.ts [port]` is an in-memory stand-in cloud (token 64 x `a`) for smoke tests.
