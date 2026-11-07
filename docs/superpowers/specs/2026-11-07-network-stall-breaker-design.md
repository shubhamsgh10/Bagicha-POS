# Network stall breaker + one-time request keys (KOT / Bill / Settle on the shop PC)

Date: 2026-11-07 · Branch: `stall-breaker` · Status: design approved in chat (parts 1–3), awaiting spec review

## Problem

Some KOT / Bill / Settle taps on the shop PC take 10–20 s although the server answers in ~0.1–0.3 s
and the printer prints ~0.4 s after the job is queued. Example (6 Nov 2026, 22:46 IST, order 2334 KOT,
`perf.slow_print` #3341): tap 9.97 s, server `app` 127 ms, job queued → claimed 72 ms → printed 322 ms.
About 9.8 s passed before the request reached the server.

The time is lost on the network path between the shop PC and Vercel:

- When an HTTP/2 connection dies silently (no FIN/RST reaches the PC), Chromium (the Electron desktop
  app) keeps sending on it. It notices only through its 10 s ping timeout, and only if the connection
  had been idle > 10 s. If the connection was used moments earlier, nothing checks it, and the request
  hangs much longer (slow taps with `idleMs` < 1 s took ~20 s).
- Measured from a JioFiber connection (raw HTTP/2, no pings): a connection to `bagicha-pos.vercel.app`
  survived 10–120 s idle, but after 240 s idle it was silently dead (request hung, no GOAWAY/close).
  Google over IPv4 and IPv6 survived 240 s and then closed politely. 3 of 12 new Vercel connections
  took ~3.3 s to open (lost SYN); 0 of 24 Google ones did.
- The 15 s keep-warm ping (shipped Nov 2026) covers the few-minute idle drop. But taps still stall:
  8 slow prints and 2 slow settles on 6 Nov, some after only 15–27 s of quiet and some right after a
  successful request. That fits a link that briefly drops out. **The shop PC reaches the JioFiber
  router over Wi-Fi**, the prime suspect.
- Staff tap KOT / Bill / Settle almost only on the shop PC (Electron thin client, which is also the
  print host). Phones send print jobs through Vercel → Pusher → shop PC, which works and must keep working.

### Diagnostics gap found on the way

`client/src/lib/slowRequest.ts` caps reports at 200 per page session. On 6 Nov the shop PC used it up
by 19:57 IST on keep-alive pings sent while the window was minimised. Those pings fire about once a
minute and roughly half stall. So `perf.slow_request` was silent 20:00 → 00:29, the whole busy service.

## Goals

1. A KOT / Bill / Settle tap on the shop PC that hits a dead connection recovers in ~2–3.5 s
   (today 10–20 s). If the new connection's first packet is also lost, add ~3 s (Windows SYN retry).
2. A retried request can never save, print or charge anything twice.
3. Phone → Vercel → Pusher → shop PC printing keeps working exactly as today.
4. The audit log shows how often a reset happened and how long recovery took. It must not go silent
   during service.
5. The breaker can be switched off from Admin without a desktop release.

## Non-goals

- Making phone browsers recover faster: a browser cannot close its own connections. Phones still get
  the one-time keys, so a resend there cannot duplicate either.
- Covering the desktop main process's own requests (print ack / release via Node `fetch`). They are a
  separate network stack, the paper prints before the ack, and the ack is already retried and idempotent.
- Local-first / offline printing, a custom domain, IPv6, HTTP/3.
- Surviving a full outage longer than a few seconds. That is what the LAN cable is for.

## Decisions (from the chat)

- Fix both layers: **LAN cable for the shop PC** (owner, no code) **plus the stall breaker** (code).
- Two Electron 33 facts were checked in a real Electron 33 window
  (scratchpad test, see "Evidence" at the end):
  - `session.defaultSession.closeAllConnections()` **does not close open WebSockets**. A real Pusher
    socket stayed OPEN and answered `pusher:ping` → `pusher:pong` after the reset.
  - It **fails an in-flight HTTP/2 request at once**, and the retry opens a new session and succeeds
    (1.51 s in total in the test). It does **not** fail an in-flight HTTP/1.1 request, so the breaker
    also aborts its own request.
- Add a kill switch in Admin.

---

## Part 1: the stall breaker (desktop app only)

### Where it lives

- `packages/api-client/index.ts`, `timedFetch`. Every `apiFetch` / `apiJson` / `apiRequest` call
  already goes through it.
- The pure timing rules go in a new `packages/api-client/stallBreaker.ts`, with no DOM or timers, so a
  script can drive them with a fake clock. The package has no `@shared` alias, so the rules live in the
  package itself.
- The app installs the breaker at startup (`client/src/main.tsx`, next to `installSlowRequestReporter`)
  through `setStallBreaker({ reset, enabled, onReset })`, the same injection style as
  `setRequestObserver`.
- The breaker is active only when both hold:
  - `window.electronAPI?.resetConnections` exists (a desktop build that has the new IPC)
  - the kill switch is on (Part 3)
- In a browser `timedFetch` behaves exactly as today.

### Desktop IPC

- New channel `NET_RESET_CONNECTIONS` in `desktop/main.ts`. Its handler calls
  `await session.defaultSession.closeAllConnections()`.
- Exposed in `desktop/preload.ts` as `electronAPI.resetConnections(): Promise<void>`, and typed in
  `client/src/types/electron.d.ts`.

### Behaviour of one watched request

Constants, tunable from real data: `CHECK_AFTER_MS = 1500`, `CHECK_TIMEOUT_MS = 1500`,
`RESET_MIN_GAP_MS = 10000`.

1. Start the request with its own `AbortController`, combined with a caller-supplied signal via
   `AbortSignal.any` (Chromium 130 has it).
2. **Response headers arrive within `CHECK_AFTER_MS`:** done. This is the normal case and adds nothing.
3. **No headers by `CHECK_AFTER_MS`:** send a check, `GET /api/ping` with `cache: "no-store"` and
   `credentials: "include"`, so it rides the same connection pool. The check is never itself watched.
   - **The check answers within `CHECK_TIMEOUT_MS`:** the connection is alive and the server is just
     slow (e.g. Settle's WhatsApp step, a cold start). Keep waiting. No reset.
   - **The check gets no answer:** the connection is dead. Do steps 4–6.
4. **Reset**, unless another reset happened in the last `RESET_MIN_GAP_MS`. Within that gap the
   connection was just renewed, so the request is left alone and keeps waiting (no abort, no retry):
   - call `electronAPI.resetConnections()`
   - abort the stalled request (covers HTTP/1.1, which the reset alone does not fail)
   - abort the check
5. **Retry once** on the fresh connection:
   - reads (GET / HEAD): always
   - writes: only if the request carries an `Idempotency-Key` header (Part 2), resent with the
     **same** key
   - a write without a key is not resent. It throws `"The connection dropped while saving — check
     whether it was saved, then try again."`
6. The retry is not watched again. If the fresh connection also stalls (a real outage), it waits like
   today. The existing 8 s read timeout + one retry still bounds reads.

### Requests to the six keyed routes

Every client caller of the six keyed routes (Part 2) sends a key through `timedFetch`. Where a caller
uses a raw `fetch(apiUrl(...))` today, it is converted.

| Route | Callers |
|---|---|
| `POST /api/orders`, `PUT /api/orders/:id/items` | `POS.tsx` save-with-print and plain saves, including the Auto-KOT background PUT (raw `fetch` today) and `saveCartBeforeOrderAction` |
| `POST /api/orders/:id/payment` | `POS.tsx` settle |
| `POST /api/print/kot`, `POST /api/print/bill` | `printGateway.ts` (Tables card), `KOT.tsx`, `Billing.tsx`, `Orders.tsx` reprints |
| `POST /api/print/jobs/:id/claim` | `printStationCore.ts` `claimJob` |

- POS.tsx's release-skew legacy fallback (`legacyPrintFallback`, the Auto-KOT `/api/print/kot`
  fallback) stays as is: it only runs against an old server.
- `apiRequest(method, path, data, { idempotent: true })` adds the header. The key is
  `crypto.randomUUID()`: one per logical action, created when the request is built and reused only by
  the automatic retry. A new tap gets a new key.

### Side effects (accepted)

- A reset also fails other in-flight requests:
  - polls: they retry
  - unkeyed writes: they show their normal error instead of Chromium's eventual resend
- Open WebSockets (Pusher) are not affected (measured).
- While the window is minimised, the keep-alive ping is watched too. A stalled ping now heals the
  connection in ~3 s instead of 10 s, before the next tap lands on it. Resets are rate-limited to one
  per 10 s.

---

## Part 2: one-time request keys (server)

### Guarantee

The same `Idempotency-Key` from the same signed-in user runs the route **at most once**. A repeat gets
the stored answer of the first run.

### Table `request_keys`

Created by `scripts/migrate-request-keys.mjs` (`CREATE TABLE IF NOT EXISTS`, idempotent) and declared
in `shared/schema.ts` so `db:push` never proposes dropping it.

| column | type | notes |
|---|---|---|
| `key` | text, primary key | client UUID |
| `actor_id` | text, not null | `"u:<id>"` / `"sm:<id>"` (same convention as the audit `actorId`) |
| `method` | text, not null | |
| `path` | text, not null | `req.originalUrl` without the query string |
| `body_hash` | text, not null | sha256 of `JSON.stringify(req.body ?? null)` |
| `state` | text, not null | `processing` \| `done` |
| `response_status` | integer | set when done |
| `response_body` | json | set when done; null when over 1 MB (see below) |
| `created_at` | timestamp, not null, default now() | indexed, for pruning |
| `completed_at` | timestamp | |

### Middleware `requestKeys`

`server/requestKeys.ts`. The pure decision is `decideKeyedRequest` in `shared/requestKeys.ts`. It is
mounted after `requireAuth` on exactly these routes:

- `POST /api/orders`
- `PUT /api/orders/:id/items`
- `POST /api/orders/:id/payment`
- `POST /api/print/kot`
- `POST /api/print/bill`
- `POST /api/print/jobs/:id/claim`

Steps:

1. **No `Idempotency-Key` header:** `next()`. Unchanged for old clients and every other caller.
2. **Malformed key** (must be 8–100 chars `[A-Za-z0-9-]`): `400 {code:"bad_idempotency_key"}`.
3. **Claim the key:** `INSERT … (state='processing') ON CONFLICT (key) DO NOTHING RETURNING key`.
   - **Inserted:** wrap `res.json` so the final status + body are written to the row
     (`state='done'`, `completed_at=now()`) **before** the response is sent, then `next()`. If that
     write fails, log it and still send the response; the row stays `processing` (see 6).
   - **Conflict:** read the row and act on `decideKeyedRequest`:
     - **actor / method / path / body hash differ:** `422 {code:"idempotency_key_mismatch"}`, a client bug.
     - **`done`:** replay the stored status + body with header `Idempotent-Replayed: true`. The route
       does not run.
     - **`processing`:** re-read every 250 ms for up to 8 s. If it becomes `done`, replay; otherwise
       `409 {code:"request_in_progress", message:"This request is still being processed — refresh
       before trying again."}`.
4. Errors are stored and replayed like successes, so a retry never re-runs a half-finished request.
   A new tap uses a new key, so staff can always try again.
5. A body over 1 MB is not stored (`response_body` null). Replaying such a key answers
   `409 {code:"replay_unavailable"}`. Only possible for an unusual multi-ticket browser-print fallback.
6. Database errors:
   - **Table missing** (`42P01`, migration not run yet): `next()` without a key, plus one loud
     `console.error` per instance. Taps are never blocked by a missing migration.
   - **Any other error on the claim insert:** `503 {message:"Could not start the request safely — try
     again."}`. Never silently drop the guarantee.
7. **Pruning:** `DELETE FROM request_keys WHERE created_at < now() - interval '24 hours'`, at most once
   per 10 min per instance, started after the response finishes. Best effort, since Vercel has no
   schedulers.

- **CORS** (`server/cors.ts`): add `Idempotency-Key` to `Access-Control-Allow-Headers` and
  `Idempotent-Replayed` to `Access-Control-Expose-Headers`.
- **CSRF:** unchanged. A custom header only makes a cross-origin request stricter (preflight).

### Client handling

- A replayed answer is handled exactly like a first answer: the client never saw the first one.
  `Idempotent-Replayed` is only recorded in diagnostics.
- `409 request_in_progress` / `replay_unavailable` on a keyed POS write shows the message and refreshes
  the order (`["/api/orders", id]`, tables). Staff check, then tap again.
- `422 idempotency_key_mismatch` is shown as a normal error (it means a bug).

### Interaction with existing guards (unchanged, still in place)

- `settleOrderIfUnpaid`'s conditional write, `409 table_busy`, the KOT delta claim and `no_delta`
  still protect requests without keys.
- With a key, the repeat gets the original success instead of `alreadySettled` / `table_busy`.
- Audit rows, print jobs, stock movements, loyalty and WhatsApp side effects happen once, because the
  route runs once.

### Cost

Two small writes per keyed request (claim insert, completion update), a few ms each from Vercel.
Stored bodies are usually 2–5 KB, kept for 24 h. Replays read a row back only in the rare retry case,
so egress barely changes.

---

## Part 3: diagnostics, kill switch, testing, release

### Diagnostics

- **`client/src/lib/slowRequest.ts`:**
  - `MAX_PER_SESSION = 200` becomes a rolling budget of 60 reports per hour.
  - `/api/ping` stalls are no longer reported while the window is hidden.
- **New `POST /api/perf/stall-reset`** (`requireAuth`) writes audit action `perf.stall_reset`, one per
  reset while the window is visible. Metadata:
  - `method`, `path`, `keyed`
  - `detectMs` (request start → reset)
  - `retryMs`, `retryOutcome` (`ok` | `failed` | status)
  - `idleMs` (time since the last API response, from `connectionKeepAlive.msSinceLastApiResponse`)
  - `hiddenResets` (resets while hidden since the last report)
  - `connection`
  - Budget: 60 per hour, separate from slow-request.
- **`perf.slow_print`** gains `hidden`, `electron`, `resets` (resets during the tap) and `replayed`.
- **`client/src/lib/auditFormat.ts`:** label + one-line summary for `perf.stall_reset`.
- **`scripts/report-latency.ts`:**
  - Add resets per day and the median `detectMs + retryMs`.
  - Fix the day bucketing. The columns are naive UTC, so the IST day is
    `(created_at + interval '5 hours 30 minutes')`, not `created_at at time zone 'Asia/Kolkata'`
    (that shifts the wrong way).

### Kill switch

- **Setting:** `desktopFastReconnect: boolean`, default `true`.
  - `server/settingsStore.ts`: type + `DEFAULT_SETTINGS`. The merge-under-defaults means no migration.
- **UI:** Admin → Settings toggle "Fast reconnect on the desktop app".
  - Saves only that field (settings pages already send only changed fields).
- **Client:** `enabled()` reads the cached `["/api/settings"]` query. Missing means on.

### Testing

- **Pure, in `npm run test:pure` (CI):**
  - **`scripts/verify-request-keys.ts`:** `decideKeyedRequest`
    - a new key runs
    - done → replay
    - processing → wait / in-progress
    - mismatch on actor / method / path / body
    - malformed key; missing-table pass-through decision
  - **`scripts/verify-stall-breaker.ts`:** `stallBreaker.ts` on a fake clock
    - no check before 1.5 s
    - check answers → no reset
    - check silent → reset + one retry
    - unkeyed write → no retry, clear error
    - same key on retry
    - at most one reset per 10 s
    - disabled → today's behaviour
- **Electron (manual, Windows), `scripts/verify-stall-breaker-electron.cjs`:** today's scratchpad test
  turned into a repo script. A local HTTP/2 server sits behind a proxy that silently blackholes
  established connections, plus the real Pusher socket, driving the real `timedFetch` breaker. Pass:
  - a stuck keyed save recovers in < 3.5 s
  - the server sees it once
  - Pusher stays OPEN (ping/pong)
  - an HTTP/1.1 stall recovers too
  Run it with `env -u ELECTRON_RUN_AS_NODE` from VS Code's terminal.
- **End-to-end on a throwaway in-process server** (memory playbook: real routes and session, shared DB,
  private Pusher channel):
  - Send the same keyed save, KOT, bill, settle and claim twice, sequentially and concurrently.
    Expect exactly one order / print job / payment / audit row each.
  - Test orders are `ZZTEST-…` with no customer, deleted afterwards (snapshot to `backups/` first),
    and the `orders.id` sequence is restored.
  - **Ask the owner first** (it writes to the live DB, and the dev login may be stale).
- `npm run check`.

### Release order

1. Run `scripts/migrate-request-keys.mjs` on the shared DB.
2. Deploy to Vercel (server + web UI):
   - the server accepts keys
   - phones start sending keys (no breaker in browsers)
   - nothing else changes
3. Release a new desktop version. The shop PC auto-updates and gets the breaker, the keys and the
   logging fix together, because the thin client's UI is bundled in the desktop app.
4. After 2–3 days, run `npx tsx -r dotenv/config scripts/report-latency.ts --deployed <time>` and
   compare:
   - slow prints / slow settles per day
   - resets per day and recovery time
   - whether any `request_in_progress` answers appear

**Rollback:**
- breaker: Admin toggle off
- keys: a client without keys behaves as today; the table can stay

### Cable checklist (owner, no code; can be done before any of the above)

1. Run an Ethernet cable (Cat6) from the shop PC to a LAN port on the JioFiber router. If the router is
   too far, use a powerline adapter pair.
2. Make sure Windows shows "Ethernet: Connected", then turn Wi-Fi off on that PC so it can't quietly
   switch back.
3. If a cable is impossible:
   - Wi-Fi adapter → Power Management: untick "Allow the computer to turn off this device to save power"
   - adapter power-saving option: maximum performance
   - Windows power plan: High performance
   - use the 5 GHz network
4. Note the date. Existing `perf.slow_print` rows give the before/after (8 slow taps on 6 Nov).

## Risks

- **False resets:** the server is slow and the check also hits a cold start. With keys the retry
  waits or replays, so it is harmless. It is measured by `perf.stall_reset`, and the thresholds can be
  tuned.
- **Unkeyed writes caught in a reset** (hold / move / merge / cancel / settings at the same moment)
  fail with their normal error instead of being resent. They are rare on the shop PC during a stall.
- **Real outages** (Wi-Fi down for several seconds): the breaker cannot help. The cable is the fix.
- **New table:** if the migration is skipped, keys silently do nothing (logged), so the guarantee
  only exists after step 1.

## Evidence (2026-11-07, scratchpad, not in the repo)

- **DB queries:** `print_jobs` / `audit_logs` for 6 Nov:
  - 43 jobs 21:30–23:30 IST, all printed, pickup p50 90 ms, host p50 364 ms
  - `perf.slow_print` rows with `idleMs`
  - 204 `perf.slow_request` rows from the shop IP, then a 3 h 56 min silence
- **`idle-drop-test.mjs`:** HTTP/2 idle survival, Vercel v4 vs Google v4/v6.
- **`ws-reset-test/main.cjs`:** `closeAllConnections()` keeps WebSockets (local + real Pusher) open;
  it does not fail an in-flight HTTP/1.1 request.
- **`ws-reset-test/h2-blackhole.cjs`:** HTTP/2 through a silent-blackhole proxy.
  - With the reset: the stuck POST failed at 1.50 s, the retry used session #2 and succeeded (total
    1.51 s), and Pusher stayed OPEN with ping/pong.
  - Without it: still stuck at 40 s.
