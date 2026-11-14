# Local-first Phase 4 — Proper Offline (all reads local, saves local + background replay)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** On the shop PC in local mode, every screen reads locally and every POS action (create order, edit items, KOT, Bill, settle, cancel, hold, move table, discount/write-off with PIN, login) runs **locally and instantly**. It keeps working with no internet. When the internet is available, a background worker replays each action to the cloud in order, and the cloud stays the shared record.

**Builds on:**
- Phase 3, branch `local-first-phase3`: the PGlite local server, the read gate, the cloud proxy, the snapshot-cursor pull, device tokens, and Electron local mode.
- The spec: `docs/superpowers/specs/2026-11-13-local-first-offline-design.md`.
- The phase 3 plan: `docs/superpowers/plans/2026-11-14-local-first-phase3-local-reads.md` (read its "as built" notes).

## Core design (decided)

1. **Same route code runs locally.**
   - In local mode, writes are no longer proxied. They run through the normal `registerRoutes` handlers against PGlite, so every money/KOT rule applies offline.
   - Every successful local write on the replay list (below) also appends an **outbox** row in the same request.
2. **Replay = the original request, re-sent to the cloud by the device.**
   - The worker sends `{method, path, body}` with headers:
     - `Authorization: Bearer <device token>`
     - `X-Bagicha-Replay: 1`
     - `X-Replay-Actor: u:<id>|sm:<id>`
     - `X-Replay-Approver: u:<id>|sm:<id>` (when a PIN was typed)
     - `X-Replay-Base: <cloud updatedAt the edit was based on, ISO>` (for edits of an existing order)
     - the entry's `Idempotency-Key`
     - `x-vercel-protection-bypass` when configured
   - The cloud runs its own handler, so the cloud recomputes and validates everything.
3. **Trust model.** A valid, non-revoked device token may act as any user and assert a PIN approval. The token is admin-issued and revocable, and the PC already verified the PIN locally against a synced hash. Every replayed action is audited with `metadata.replayedBy = device <id>`.
4. **IDs and printed numbers come from leases.**
   - The cloud hands the device blocks (`device_leases`) for `order_id`, `bill_counter` and `kot_counter`.
   - Locally, new orders take `id` and `orderNumber` from the lease, and KOT numbers from the KOT lease, so paper printed offline is final.
   - On replay the cloud accepts the client-supplied `id` / `orderNumber` / `kotNumber` **only inside a lease held by that device**, else `409 lease_violation`.
   - `order_items` / `kot_tickets` ids are local-temporary: the local sequences start at 1,000,000,000. They're replaced by the cloud's rows on acknowledgement (see 7).
5. **Printing happens locally only.**
   - Local routes print exactly as today. Network printers are sent direct; USB printers return a `printJob` that the Electron renderer executes.
   - Replay carries no dispatch: with `X-Bagicha-Replay`, the cloud print step **commits print state only** (`kotPrintCount`, `lastKotSnapshot`, `billPrintCount`, kitchen ticket, table → billed) and never creates `print_jobs` or sends to a printer.
6. **Conflicts: the cloud wins, and the problem is surfaced, never hidden.**
   - Edits replay with `X-Replay-Base`. If the cloud order's `updatedAt` differs (a phone edited it meanwhile), the cloud answers `409 conflict`.
   - Any 4xx except 408/429 moves the entry to `sync_problems`, together with every later entry for the same order. Entries for other orders keep flowing.
   - The order is refreshed from the cloud, and staff see it on the Sync screen.
7. **Acknowledgement refresh.**
   - When the cloud acknowledges entries for an order, the worker fetches that order's cloud rows (`GET /api/sync/order/:id` → order + items + kot_tickets) and replaces the local rows for that order in one transaction. That removes the temporary item/ticket ids.
   - While an order has pending entries, pulls **skip** that order's rows and those of its table, so newer local edits aren't overwritten by older cloud state.
8. **Not available offline**, with a clear "Needs internet" message from the local server (`503 code:"ONLINE_ONLY"`):
   - merge and split
   - Razorpay
   - WhatsApp send / e-bill
   - coupon and loyalty redeem
   - menu/category/table/inventory/staff/settings admin writes
   All of these still work online (proxied as in phase 3).

   (Due settle and payment-method correction were moved to the replay list at the owner's request, 2026-11-14.)
9. **Offline login.**
   - Snapshot and pull rows for `users` / `staff_members` carry `_auth: { pw?: <users.password scrypt hash as stored>, pin?: <scrypt(pin) with random salt, "salt:hash"> }`, computed in JS on the cloud.
   - Plaintext PINs never leave the cloud. Local mode stores `_auth` in a local-only table `local_auth(kind, id, pw, pin)`.
   - Local `/api/auth/login`, `card-login` and `verify-pin` verify against it with the same scrypt routine `routes.ts` uses.
10. **All reads local.**
    - The sync set grows to every business table needed by GET routes. Orders, items and KOT tickets are synced as full history (about 15k rows total today, fine).
    - The read gate sends every GET to the local routes except a short cloud-only list.

## Tables

- **Synced (cloud → PC):** `users`, `staff_members`, `categories`, `menu_items`, `tables`, `restaurant_settings`, `orders`, `order_items`, `kot_tickets`, `inventory`, `inventory_categories`, `customers_master`, `customer_profiles`, `coupons`, `loyalty_points`, `staff_profiles`, `attendance`, `leaves`, `shifts`, `shift_assignments`, `audit_logs`.
  - Keep the existing secret stripping and settings redaction.
  - Do not sync `print_jobs`, `request_keys`, `sessions`, `change_log`, `sync_devices`, `device_leases`, the WhatsApp/automation/conversation tables, `daily_digests` or `payment_transactions`.
- **Local-only, never uploaded as rows:** whatever the local routes write besides the synced tables (`stock_movements`, `print_jobs`, `request_keys`, `local_*`). The cloud recreates its own when the request replays.

## Replay list

Local writes appended to the outbox, as the method and path of the original request:
- `POST /api/orders`
- `PUT /api/orders/:id/items`
- `PUT /api/orders/:id` (status only)
- `POST /api/orders/:id/payment`
- `PUT /api/orders/:id/cancel`
- `POST /api/orders/:id/hold`, `/recall` (check the real hold/recall routes)
- `PUT /api/orders/:id/move-table`
- `POST /api/tables/:id/shift`
- `POST /api/print/kot`
- `POST /api/print/bill`
- `POST /api/orders/:id/bill-requested`
- `PUT /api/kot/:id`
- `POST /api/orders/:id/settle-due` (manager PIN; carries `X-Replay-Approver`)
- `POST /api/orders/:id/payment-method` (manager PIN; carries `X-Replay-Approver`)

**Action time on replay.** Every replayed request carries `X-Replay-At: <ISO time the action ran on the PC>`.
- The cloud uses it, instead of "now", for business-date rules: `planPaymentEdit`'s "money received today" check, and `paid_at` / `updated_at` stamps where the route sets "now" for the action, so a due settled offline at 11 pm is still that day's money.
- It is accepted only if it's not in the future (+2 min skew) and not older than 48 h; otherwise "now" is used.

`POST /api/auth/verify-pin` is not replayed; its approval rides on the request it unlocked. Anything else that writes in local mode is either proxied (online) or returns ONLINE_ONLY (offline).

---

## Task 4A — cloud side

**Files:**
- `server/sync/*`
- `shared/syncTables.ts`
- a new migration `scripts/migrate-sync-phase4.mjs`
- `server/routes.ts` / `server/printRoutes.ts` / `server/services/printDispatch.ts` (replay hooks only)
- `server/settingsStore.ts` (lease-aware counter acceptance)
- verify scripts

- [ ] **Extend the sync set.** Extend `SYNC_TABLES` (snapshot = full tables; drop the 3-day order filter). The migration adds the `change_log_capture` trigger to the new tables (idempotent; `--dry-run` / `--rollback`; RLS rule; `SET LOCAL lock_timeout`).
- [ ] **`_auth` on user rows.** Add `_auth` to `users` / `staff_members` rows in snapshot, pull and `GET /api/sync/order` responses: computed in JS from the DB values, `pin` scrypt-hashed with a fresh random salt, never plaintext.
- [ ] **`device_leases`.**
  - Table `device_leases(id serial, device_id int, kind text, start_value bigint, end_value bigint, next_value bigint, issued_at, exhausted_at)` with RLS on.
  - `POST /api/sync/lease {kind, size?}` (device token) issues the next block atomically:
    - **`order_id`:** `SELECT setval(seq, last + size)` style under `LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE`, so cloud inserts can never land inside the block.
    - **counters:** the same `jsonb_set` row-locked `UPDATE` as `issueCounter`, but `+ size`.
  - Default size 200; returns `{kind, start, end}`.
- [ ] **`GET /api/sync/order/:id`** (device token) returns `{order, items, kotTickets}` rows in the same JSON shape as pull rows, or `{deleted:true}`.
- [ ] **Replay middleware** `server/sync/replay.ts`, mounted in BOTH `server/index.ts` and `server-fn.ts` before the routes / CSRF / auth checks it needs to satisfy. When `X-Bagicha-Replay: 1` plus a valid device token are present:
  - load the actor (user or staff member, exactly the principal shape passport produces) and set `req.user`
  - set `req.isAuthenticated = () => true`
  - if an approver is given, grant elevation on a per-request basis so `requireElevation` / `hasElevation` / `requireFreshPin` pass and `freshPinApprover` returns the approver
  - set `req.replay = { deviceId, base }`
  - never create a session or set a cookie
  - CSRF: these requests carry no Origin, so they already pass; confirm.
  - Without a valid token, the replay headers are ignored entirely: it's a normal request.
- [ ] **Base check.** For replayed requests on `/api/orders/:id/...`, `/api/print/*` (body `orderId`) and `/api/tables/:id/shift`: if `X-Replay-Base` is set and the order's `updatedAt` ≠ base → `409 {code:"conflict"}`. Order creation has no base.
- [ ] **Client ids.**
  - `POST /api/orders` with `req.replay` accepts `body.clientId`, `body.clientOrderNumber` and `body.clientKotNumber`, and uses them only if they fall inside a lease of that device for the right kind (else `409 lease_violation`).
  - Saves with a delta-KOT (`PUT /items`) and print-commit paths accept `clientKotNumber` the same way.
  - Find where the counters are issued (`incrementBillCounter` / `incrementKotCounter` call sites) and add the replay branch there, not in `issueCounter`.
- [ ] **Print on replay.** `runKotPrint` / `runBillPrint` / save-with-print commit state but skip every dispatch: no `print_jobs`, no direct send, no Pusher `PRINT_JOB`. Keep `markBilled`, the kitchen ticket, the counters (client-supplied) and audit rows.
- [ ] **Audit.** Every `logAudit` during a replayed request adds `replayedBy: deviceId` to its metadata (one place: `auditService`, reading `req.replay`).
- [ ] **Verify script.** `scripts/verify-replay.ts` (PGlite, in `test:pure`):
  - the lease-range rule (pure)
  - the base-conflict rule (pure)
  - `_auth` never contains a plaintext PIN and verifies with scrypt
  - the migration SQL applies and rolls back on PGlite
  - the lease SQL issues non-overlapping blocks, and cloud serial inserts land after the block

## Task 4B — local side

**Files:**
- `server/local/*`
- `server/settingsStore.ts` + `server/storage.ts` (local-mode branches for ids/counters)
- `server/routes.ts` (local auth verification branch)
- `client` (sync badge + Sync screen)
- verify scripts

- [ ] **Read gate.** Every GET is local, except a cloud-only list:
  - `/api/auth/context`
  - `/api/pusher/auth`
  - `/api/realtime/config`
  - `/api/whatsapp/*`, `/api/automation/*`, `/api/crm/*`
  - `/api/razorpay*`
  - `/api/sync/devices`
  - `/api/print/jobs/pending` (local)

  Decide each with its route; document the list.
- [ ] **Write gate.**
  - The replay-list routes run locally and append to the outbox.
  - ONLINE_ONLY routes: proxied when the cloud is reachable (`worker.status().online`), else `503 {code:"ONLINE_ONLY", message:"Needs internet"}`.
  - Login / logout / verify-pin: local first; when online, also sign in to the cloud in the background (cookie jar as today) so proxied online-only calls still work.
- [ ] **Outbox.**
  - Table `local_outbox(seq bigserial, order_id int null, method, path, body jsonb, idem_key, actor, approver, base text null, status pending|sent|problem, attempts, last_error, created_at)`.
  - Append inside the same response cycle, after the handler's 2xx. Use `res.json` interception, the way `server/requestKeys.ts` captures answers.
  - Record `actor` from `req.user`, `approver` from `freshPinApprover`/elevation, and `base` = the local order's `cloud_updated_at`.
  - Keep `cloud_updated_at` per order in `local_order_meta(order_id, cloud_updated_at)`, set on every pull/refresh of that order.
  - For an order created locally, base is null, and later entries for it take their base from the create's acknowledgement.
- [ ] **Leases.**
  - `local_leases(kind, start, end, next)`. Refill when fewer than 25% remain (online).
  - Local `createOrder`/`createOrderWithItems` take `id` from the order lease.
  - The bill/KOT counters in local mode take from their leases instead of `issueCounter`'s `jsonb_set`. Keep the local settings counter display in step.
  - Exhausted offline → `503 {code:"LEASE_EXHAUSTED"}`, with a clear message.
  - Local `order_items`/`kot_tickets` sequences start at 1,000,000,000 (set once after the snapshot).
- [ ] **Replay worker** (extend `syncWorker`):
  - Sends pending entries in `seq` order with the headers above and `clientId` / `clientOrderNumber` / `clientKotNumber` added to the body where the local result produced them.
  - Store those in the outbox row at append time from the local response.
  - On a 2xx: mark sent, update base for later entries of that order (chain), then the acknowledgement refresh via `GET /api/sync/order/:id`.
  - On a 409 or other 4xx: problem, together with every later entry for that order, then refresh that order from the cloud.
  - Network / 5xx: back off and retry, never reorder.
  - Wakes on every append, on pull success and on reconnect.
- [ ] **Pull skip.** Skip rows of orders with pending entries (orders / order_items / kot_tickets keyed by order id) and of their table.
- [ ] **Local auth.**
  - `local_auth` is filled from `_auth`.
  - In local mode the login, card-login and verify-pin handlers verify against it (the same scrypt verify as `routes.ts` `verifyPassword`; the PIN uses its own "salt:hash").
  - Lockout/limiters still apply.
- [ ] **UI.**
  - A small badge in the POS top bar and TopNav:
    - `Online` (green)
    - `Offline · N waiting` (amber)
    - `Syncing…`
    - `N problems` (red, links to `/sync`)

    It reads from `GET /api/local/status`, extended with `outboxPending`, `problems` and `online`; poll every 5 s only in local mode.
  - A `/sync` page lists problems (order #, action, the cloud's message, time). Its actions are:
    - **Retry** (re-queue)
    - **Discard** (admin PIN; marks it resolved, local order already refreshed from the cloud)
  - Hidden entirely in cloud mode.
- [ ] **Tests.**
  - `scripts/verify-local-offline.ts` (stub cloud on 127.0.0.1, PGlite) covers:
    - create → KOT → settle offline, then cloud back: replay in order with the right headers / client ids, then acknowledgement refresh replacing the temp ids
    - a conflict entry goes to problems along with later same-order entries, while other orders still flow
    - lease use and exhaustion
    - offline login and PIN against `local_auth`
    - an ONLINE_ONLY route offline gives 503
    - a pull skips pending orders
  - Add it to `test:pure`.

## Task 4C — controller end-to-end

1. Back up, then run `migrate-sync-phase4.mjs`.
2. Run the cloud dev server (private Pusher channel) and the local server.
3. Online: test order → instant, replayed, acknowledged.
4. Offline (block the cloud): create, KOT, settle, plus cancel of a second order. Bring the cloud back → replay, cloud rows match, numbers unchanged.
5. A conflict case from a "phone" edit.
6. Clean up the `ZZTEST` rows, the sequence and counters, revoke the lease ranges (leftover unused lease numbers are a gap in bill numbers — note for the owner).
7. Build installer `1.0.42-localfirst.3`.

## Accepted trade-offs

- **The device token may act as any user.** It is admin-issued and revocable; every replayed action is audited with `replayedBy = device id` and the real actor/approver. Only the replay list is accepted, and only with an existing actor (and an existing manager/admin approver when a PIN is asserted).
- **PIN/password verifiers on the PC are brute-forceable offline.** The local `local_auth` table holds scrypt hashes (PINs are 4-6 digits, so the keyspace is tiny). This is the price of an offline PIN. On-disk encryption of the local database is planned; until then treat the PC's disk as sensitive. Online rate limits do not apply to an attacker who has copied the files.
- **The base check is skipped only for a true retry:** the route mounts requestKeys and the stored key row matches actor + method + path + body hash (`server/sync/replay.ts`).

## Task 4B - as built (local side)

- **Gate** (`server/local/localReadGate.ts`, `bootstrap.ts`): every GET is local except `CLOUD_ONLY_GET_PREFIXES` (whatsapp, automation, crm, razorpay, feedback, digest, `/api/sync/`, pusher, realtime, `/api/auth/2fa`, `/api/admin/backups`, `/api/coupons/redemptions`): proxied online, 503 `ONLINE_ONLY` "Needs internet" offline. `/api/auth/context` is cloud-first with a local fallback. Writes are classified by `classifyWrite`: login (cloud first, local check when unreachable), verify-pin (always local), logout (proxy, tolerant), replay list (local + outbox), `/api/print/*` (local), `/api/perf/*` (quiet), everything else online-only.
- **Outbox** (`outbox.ts`, `outboxCapture.ts`): `local_outbox(seq, order_id, method, path, body, idem_key, actor, approver, base, numbers, status pending|sent|problem|discarded, attempts, last_error, last_code, override)`. Appended in `res.json` before the answer is sent; key = the client's own Idempotency-Key or a fresh UUID, re-sent on every attempt. `base` is captured BEFORE the handler runs, only for the first unreplayed edit of an order; later entries take the base from `local_order_meta` (refreshed on pull and after each acknowledgement).
- **Replay** (`replayWorker.ts`, run at the start of each sync cycle): strict `seq` order; network error stops the drain (PC counts as offline); 5xx/408/429/refused token is `ReplayDeferred` (cloud reachable, pull still runs and skips pending orders); any other 4xx is a problem for that entry and the later pending entries of the order, then the order is refreshed. Acknowledgement: `GET /api/sync/order/:id` replaces the order's rows once no pending entry remains (otherwise only the base is learned). Temporary kitchen-ticket ids are mapped by KOT number for `PUT /api/kot/:id`.
- **Leases** (`localNumbers.ts`): blocks held in memory, position persisted asynchronously (never a DB query in `take`: PUT items awaits its KOT number INSIDE a PGlite transaction and PGlite has one connection). Refill below 50 left while online. Exhausted offline -> 503 `LEASE_EXHAUSTED`. Hooks: `setLocalCounterIssuer` (settingsStore), `setLocalOrderIdIssuer` (storage).
- **Local-mode side effects skipped** (the cloud does them at replay): audit rows, CRM events, loyalty, settlement WhatsApp, feedback.
- **Auth** (`localAuth.ts`): scrypt verify against `local_auth`; same limiters; verify-pin grants the local elevation with the approver and, online, tells the cloud too. A session that signed in offline has no cloud login: proxied calls answer 401 `CLOUD_SESSION_NEEDED` instead of signing out.
- **Sync screen** (`/sync`, local mode only): Retry and Discard are manager/admin + a fresh PIN. Retry keeps the entry's original base; a `conflict` problem only goes again as an explicit override (confirm dialog), with the order's current cloud base, a `local_audit` row and `X-Replay-Override` (cloud audit metadata `overrideOf`).
- **Schema rebuild** never drops a non-empty outbox (refused, `schemaBlocked` in status) and carries `local_leases` across.
