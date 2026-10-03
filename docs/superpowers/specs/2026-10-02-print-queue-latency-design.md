# Print call → queue: one request per tap, and measured latency (KOT + Bill)

Date: 2026-10-02 · Branch: `Fixes` · Status: design approved (rev 2), awaiting spec review

## Goals

1. **Hard requirement: one print tap = one HTTP request.** No client-side chain of dependent calls
   (save → KOT check → bill → bill-requested) for any print.
2. **Measure, then reduce, tap → job-queued time** (tap in the POS → print job persisted and
   broadcast → UI has its response) for both KOT and Bill. **Target (agreed 2026-10-03 after the baseline):** at least **30% lower p50** than the recorded baseline,
   measured with the same bench harness, comparing like for like — KOT p50 ≤ ~140 ms on the baseline machine, and
   the single-request Bill at least 30% under the old KOT-then-Bill chain (~370 ms of print calls). Because absolute
   numbers depend on the deployment (Vercel is far closer to the database than the dev machine), the target is
   relative; the absolute Vercel figure is read from the `Server-Timing` header in real use.

Out of scope: the downstream hop after queueing (Pusher fan-out → desktop claim → physical print →
ack — claim/ack are what stop two stations printing the same job), the Electron executor
(`desktop/print/*`), and the ESC/POS buffer generators (`shared/print/generators.ts`). Printed bytes
do not change.

## Constraints

- **No physical printer is available** for testing. Nothing here may depend on one.
- **`DATABASE_URL` is the one shared production DB**, and the restaurant's Electron host may be
  online. A real `/api/print/kot|bill` call broadcasts `PRINT_JOB`; `GET /api/print/jobs/pending`
  returns any `pending` row from the last 24h, so a leftover test row could be picked up by the
  real host.
- Creating orders through `POST /api/orders` consumes the real bill/KOT counters
  (`incrementBillCounter`/`incrementKotCounter`) and would leave gaps in the GST bill sequence.
  Saving real menu items through `PUT /items` deducts real inventory.
- Bill reprints write `bill.reprint` audit rows that surface in Reports → KOT & Bill Activity.
- Vercel runs in `bom1` (30s limit). The repo has no `waitUntil` / `@vercel/functions` today.

## Current path

Nothing in `server/printRoutes.ts`, `client/src/lib/printGateway.ts`, `desktop/print/printQueue.ts`
or `usePrintJobBridge.ts` measures time today. Everything below is **unmeasured**.

**Calls per tap today** (`POS.tsx`, `Tables.tsx`):

| Tap | Calls |
|---|---|
| KOT, existing order | `PUT /items` → `POST /print/kot` |
| KOT, new order | `POST /orders` → `POST /print/kot` |
| Bill button | save → `POST /print/kot` (silent; runs even on `no_delta`) → `POST /print/bill` → `POST /bill-requested` (fire-and-forget, errors swallowed) |
| Save & Print | save → silent KOT check → `POST /print/bill` |
| Tables-card bill | `POST /print/bill` → `POST /bill-requested` |
| Auto-KOT timer | `PUT /items` → `POST /print/kot` |

Each save also fires about seven query invalidations, so a refetch burst follows every print.

**Why chains are a correctness problem, not only a speed one** (all already in CLAUDE.md): the bill
printed without an item because print read the DB before the cart was saved; Auto-KOT silently
no-op'd because it ran against an unsynced cart; a lost `bill-requested` leaves a table stuck
"running" because its failure is swallowed.

**Server stages inside `POST /api/print/kot`** (`printRoutes.ts:264`): `orders` select →
`order_items ⟕ menu_items` select → `kot_tickets` select → (menu lookup only when category routing
needs it) → per routed remote job: `print_jobs` INSERT then **awaited Pusher trigger**
(`dispatchRemotePrintJob` → `publishRealtime`) → `orders` UPDATE (`commitKotState`) → response. All
serial. `/api/print/bill` (`printRoutes.ts:562`) has the same shape.

**Behaviour difference found:** the POS Bill button fires `bill-requested` regardless of outcome,
while the Tables-card print only flips on `"hardware"`/`"dispatched"` (browser/noop deliberately
don't). The server-side fold below must pick one rule (see Open items).

Suspects, to be confirmed or killed by the baseline: the inline Pusher await, serial Neon round
trips from Vercel, the redundant KOT pre-check on Bill, and the refetch burst competing for the
same server.

## Design

### A. Measurement (no behaviour change; built first)

**A1. Permanent instrumentation.**
- Server: a tiny pure stage-timer helper (wraps `performance.now()`, unit-testable).
  - KOT stages: `db_order`, `db_items`, `db_tickets`, `db_cat` (only when category routing
    applies), `build`, `direct_send`, `insert_job` and `pusher` (per routed job), `commit`, `total`.
  - Bill stages: the same minus KOT-specific ones. After Phase 2, the combined call adds `save`
    plus the print stages.
  - Emitted as a `Server-Timing` response header and one `[print-perf]` log line per request. No PII.
    Always on.
- Client: `performance.now()` marks in `POS.tsx` (tap → response → `handlePrintResponse` done), one
  `[print-perf]` console line per tap.
- This is the source of the **real Vercel numbers**: normal service at the restaurant produces them
  with no printer and no test data needed here.

**A2. Isolated bench harness** (`scripts/bench-print-latency.ts`, manual-only, not in `test:pure`).
Runs the real print handlers in a local Express app, with layered protection:
1. **Settings isolation**: a small test seam in `settingsStore` supplies fake remote-dispatch
   printers (a single-printer case and a two-printer category-routing case). Production settings are
   never read for the run and never written.
2. **No physical ticket via the Electron host**: printer ids are `bench-*` and exist in no real configuration,
   so an Electron host fails on them harmlessly (unknown printer). **Not true for a RawBT print station:** with the
   default `ownedPrinterIds = []` it claims any pending job and RawBT ignores `printerId`, so a stray bench job could
   print. Hence layer 5 (rows flipped to `printed` immediately, and on SIGINT/SIGTERM), an activity guard (the harness
   refuses to run if non-bench `print_jobs` were created in the last 15 minutes, `--force` overrides), and the stated
   precondition: run outside service hours or with no `/print-station` device open.
3. **Separate Pusher channel** (`private-bagicha-bench-<random>`, via `PUSHER_CHANNEL` for the
   harness process only) so the restaurant's host does not hear the broadcast.
4. **Bench orders** are inserted directly (`orderNumber` like `BENCH-<n>`, `createdAt` backdated to
   2020, served + paid): they appear in no report or live view and consume no real counters.
5. **Rows never stay `pending`**: latency-only mode flips each `print_jobs` row to `printed` right
   after the call; virtual-station mode (A4) claims and acks them.
6. **Cleanup**: `backups/` snapshot first (per CLAUDE.md), then one transactional delete of the bench
   orders, `order_items`, `kot_tickets`, `print_jobs`, `audit_logs`. Dry-run by default, `--confirm`
   to execute.
Output: p50 / p95 per stage, KOT and Bill, single- and multi-printer.

**A3. Stage probe** (`scripts/probe-print-stages.ts`, manual-only). Times the same queries, a Pusher
trigger to the throwaway channel, and a `print_jobs` insert inside a rolled-back transaction. This
machine is not `bom1`, so it gives each stage's share and the Neon/Pusher RTT; absolute Vercel numbers
come from A1.

**A4. Virtual print station** (`scripts/virtual-print-station.ts`, manual-only). Subscribes to the
bench channel, claims each job via `/api/print/jobs/:id/claim`, no-ops the "print", acks. Proves the
delivery chain still works after any change to how jobs are published; stands in for the printer.

**A5. Baseline.** Run A2 + A3, collect A1 from real use, record the table in this spec, then agree
the numeric target before changing production code.

### B. Phase 1 — each print endpoint becomes a single call

1. **Extract the print step** from the route handlers into a service
   (`server/services/printDispatch.ts`): `runKotPrint(...)` and `runBillPrint(...)`, each taking the
   order id, flags (`reprint`, `auto`), the actor, and **optionally a preloaded order + items** so the
   Phase 2 caller doesn't re-read what it just wrote. Handlers become thin wrappers. Response shapes
   stay exactly what `handlePrintResponse` consumes today.
2. **`/api/print/bill` absorbs the silent KOT catch-up.** It runs the delta check server-side
   before the bill and returns any resulting KOT jobs and the bill job in one `printJobs` list (each
   entry already carries its own `ackType`/`printerId`). The client keeps its existing "KOT sent"
   toast when a catch-up actually dispatched something, and stays quiet on `no_delta`, preserving the
   safety net CLAUDE.md documents.
3. **`/api/print/bill` absorbs `bill-requested`.** The table-status flip happens server-side after
   a successful dispatch, non-fatal (same pattern as other post-commit table writes). The two
   client-side `POST /bill-requested` calls are deleted.
4. **One request does all printer work**: the multi-printer `print_jobs` rows go in as one
   multi-row INSERT, and all `PRINT_JOB` events go out as one Pusher batch trigger (a
   `publishMany` on the realtime publisher; the local WS publisher just loops).
5. **Independent reads run in parallel** (`orders`, `order_items`, `kot_tickets`).

### C. Phase 2 — the save carries the print (exactly one request per tap)

1. `PUT /api/orders/:id/items` and `POST /api/orders` accept an optional `print: "kot" | "bill"`
   (plus `auto: true` for the Auto-KOT timer). After the save transaction commits and the existing
   best-effort inventory/table steps run, the handler calls the Phase 1 service passing the order row
   it already holds; the items are still read by the single join query, which also resolves menu names
   and category ids for routing. It returns `{ ...savedOrder, print: PrintResult }`.
2. **Failure semantics.** The print step has its own try/catch. A print failure comes back as
   `print: { error }` and **never** turns a committed save into a 5xx (the documented anti-pattern
   for post-commit best-effort work). The client shows today's "KOT print failed" toast and preview
   fallback from `print.error`.
3. **Ordering guarantees preserved.** Validation, discount/cancelled-item elevation checks and
   pricing run before anything is saved, exactly as now; if they reject, nothing is saved or printed
   (same as today, where the PUT failed so the print never ran). The KOT ticket row for new items is
   created by the save before the print step reads `kotNumber`.
4. **Client.** `triggerSubmit` payloads gain `print`; the mutations' `onSuccess` hands `data.print`
   straight to `handlePrintResponse` instead of calling `triggerKOTPrint`/`triggerBillPrint` (which
   fetch). Auto-KOT rides `PUT /items { print: "kot", auto: true }`. The standalone
   `/api/print/*` endpoints stay for already-single-call callers (Tables card, Billing, Orders, the
   KOT page reprint).
5. **Refetch burst.** Non-essential query invalidations are deferred until the print result is
   handled so they don't compete with the print request (a candidate; the baseline decides).

## Further optimization candidates (chosen from the baseline)

| Change | Risk |
|---|---|
| Publish after responding via `waitUntil` (adds `@vercel/functions`) | Medium — only if the baseline shows Pusher dominates; the catch-up poll runs only on mount/reconnect, so a failed post-response publish needs a retry story; virtual station must pass |
| Server skips the delete-all/reinsert when the incoming items equal the persisted ones | Low–Medium |

Ordering rule: changes that do **not** alter delivery semantics or printed bytes come first.

## Verification

- Same harness before and after each change; compare per-stage tables. Phase 1 can be exercised
  end to end (the print endpoints touch no counters or inventory).
- **Phase 2 caveat:** a full end-to-end run of the combined save+print route would consume real KOT
  counters or deduct real inventory. The plan will check whether an open-item-only, unchanged-items
  payload is side-effect-free for the harness; if not, Phase 2's save-path wiring is verified by pure
  tests on the extracted service, code review, and A1 numbers from real use rather than a live run.
- New DB-free `scripts/verify-*.ts` in `test:pure` for: the stage-timer helper, and the pure parts of
  the Phase 1/2 logic (combined `printJobs` assembly, `print.error` shape).
- `npm run check`, `npm run test:pure`, `npm run build` stay clean.
- Not verifiable here: real ESC/POS output on hardware — mitigated by not touching generators or the
  Electron executor.

## Open items (settle in the implementation plan)

- **`bill-requested` rule — resolved:** both existing rules are kept, selected per request:
  `markBilled: "always"` (POS Bill button — flips for any request that gets past dispatch) and
  `markBilled: "on_send"` (Tables card — flips only when `printed`/`dispatched`). A hard failure (the
  print throws) no longer flips the table, unlike the old fire-and-forget POS call.
- **Mixed outcomes in one response** (Bill's KOT catch-up goes to hardware but the bill itself falls
  back to browser print, or the reverse): the combined response needs a per-part outcome
  (`kot` / `bill`) alongside the merged `printJobs` list, so `handlePrintResponse` can toast and fall
  back for each part independently.
- Exact shape of the `settingsStore` test seam (must not be reachable from production request paths).
- Whether `Server-Timing` should sit behind an env flag if judged too chatty.
- Whether the harness drives handlers over HTTP (preferred, exercises `requireAuth`) or in-process.
- Whether a client-supplied idempotency key is worth adding for double-tap protection on the
  combined call (today's guards: `isPrinting`, commit-once-at-dispatch).

## Baseline

Recorded 2026-10-03 (Sat Oct 3 04:28 IST), before any Part B change.

**Machine / network:** dev machine → Neon (shared DB) and Pusher; NOT Vercel bom1.
Commands: `bench-print-latency.ts --iterations 20 --label baseline`,
`... --iterations 20 --station --label baseline-station`, `probe-print-stages.ts --iterations 20`.
All times in ms, n = 20 per scenario. Bench rows were cleaned up after each run
(`--cleanup-only` afterwards: "cleanup: no bench orders found").

### Request-side stages (run 1, no station)

**kot-1-printer**

| metric | p50 | p95 |
|---|---|---|
| wall(client) | 202.8 | 220.5 |
| db_order | 32.8 | 38.8 |
| db_items | 33.0 | 33.7 |
| db_tickets | 32.0 | 33.1 |
| build | 0.7 | 1.1 |
| insert_job | 33.1 | 34.9 |
| pusher | 33.2 | 36.8 |
| commit | 32.6 | 36.4 |
| total | 198.5 | 216.3 |

**kot-2-printers** (`insert_job` / `pusher` are sums over both routed jobs)

| metric | p50 | p95 |
|---|---|---|
| wall(client) | 265.7 | 269.5 |
| db_order | 31.5 | 34.2 |
| db_items | 32.0 | 33.1 |
| db_tickets | 32.0 | 33.2 |
| build | 1.0 | 1.1 |
| insert_job | 66.6 | 68.6 |
| pusher | 66.2 | 69.1 |
| commit | 32.0 | 33.7 |
| total | 261.9 | 266.4 |

**bill** (no `db_tickets` stage)

| metric | p50 | p95 |
|---|---|---|
| wall(client) | 167.0 | 178.7 |
| db_order | 31.6 | 34.6 |
| db_items | 33.0 | 33.4 |
| build | 0.9 | 1.2 |
| insert_job | 32.6 | 33.9 |
| pusher | 32.2 | 41.2 |
| commit | 31.9 | 33.5 |
| total | 163.7 | 175.5 |

### Station rows (run 2, `--station`)

Request-side stages in this run matched run 1 within noise (kot-1 total p50 196.5, kot-2 270.6, bill 165.0).
`station:request→event` is request start to the `PRINT_JOB` event reaching the virtual station.
For kot-2-printers n = 40 (two jobs per iteration).

| scenario | station:request→event p50 / p95 | station:event→claim p50 / p95 | station:claim→ack p50 / p95 |
|---|---|---|---|
| kot-1-printer | 167.7 / 179.4 | 36.2 / 41.0 | 35.2 / 39.0 |
| kot-2-printers | 195.1 / 255.0 | 36.1 / 39.2 | 35.5 / 38.7 |
| bill | 134.8 / 140.2 | 35.1 / 37.5 | 34.1 / 40.1 |

### Stage probe (run 3, isolated operations)

| stage | p50 | p95 |
|---|---|---|
| neon: SELECT 1 (RTT floor) | 32.7 | 33.8 |
| db_order: orders by id | 32.9 | 38.1 |
| db_items: order_items ⟕ menu_items | 32.8 | 36.8 |
| db_tickets: kot_tickets by order | 32.5 | 37.1 |
| insert_job: 1 row (rolled back) | 33.0 | 38.2 |
| insert_job: 2 rows, one statement (rolled back) | 32.8 | 37.8 |
| pusher: trigger x1 | 33.1 | 36.1 |
| pusher: trigger x2 sequential (today's multi-printer cost) | 65.2 | 70.4 |
| pusher: triggerBatch x2 (one call) | 32.3 | 34.7 |

### Reading the numbers

Every network operation costs one ~33 ms round trip (the probe's `SELECT 1` floor is 32.7 ms), and the pipeline is fully serial, so `total` is essentially (number of round trips) x 33 ms; `build` is under 1.5 ms everywhere.

- **kot-1-printer:** the largest stage is `pusher` at 33.2 ms, 16.7% of `total` (198.5 ms), but it is tied within noise with all five other round trips (each 32.0-33.1 ms, 16-17% of `total`).
- **kot-2-printers:** the largest stage is `insert_job` at 66.6 ms, 25.4% of `total` (261.9 ms), with `pusher` (66.2 ms, 25.3%) a statistical tie; both are two sequential round trips that the probe shows collapse to one (32.8 ms for a 2-row insert, 32.3 ms for `triggerBatch` x2).
- **bill:** the largest stage is `db_items` at 33.0 ms, 20.2% of `total` (163.7 ms), tied within noise with `insert_job`, `pusher`, `db_order` and `commit` (each 31.6-32.6 ms, about 19-20%).

Caveats:

- (a) `wall(client)` minus `total` is the time spent in auth/session handling and HTTP; `Server-Timing`'s `total` starts after login checks.
- (b) These numbers are from a dev machine, so they show stage SHARES and the relative cost of a round trip, not absolute Vercel numbers.
- (c) `insert_job`/`pusher` in the two-printer scenario are sums over both routed jobs.

## After Phase 1

> **Superseded:** the network round trip differed from the baseline (≈79 ms vs 32.7 ms) — see
> "After Phase 1 (re-run, RTT-normalised)" below.

Recorded 2026-10-03 (Sat Oct 3, ~09:35 IST), after Part B (Tasks 8-12: `printDispatch.ts`, parallel
reads, one-insert / `triggerBatch` dispatch, Bill absorbs the KOT catch-up).

**Machine / network:** the same dev machine → Neon and Pusher as the baseline, but the network was
much slower at the time: the stage probe run in the same session (`probe-print-stages.ts --iterations 20`)
measured the Neon `SELECT 1` round-trip floor at **79.0 ms p50 / 120 ms p95** (baseline: 32.7 / 33.8),
`insert_job` 1 row 121.1 ms and `pusher: trigger x1` 151.4 ms; a second short probe a few minutes later
read 92.5 ms p50 / 778 ms p95. Every round trip therefore cost roughly 2.4x what it cost in the baseline,
so the absolute numbers below are **not** like for like with the Baseline section.

Command: `bench-print-latency.ts --iterations 20 --label after-phase1` → `RESULT: PASS ✅` (every response
had the expected shape; the failure-path check passed). n = 20 per scenario (2 warm-up calls discarded).
`--cleanup-only` afterwards: "cleanup: no bench orders found"; bench `print_jobs` rows: 0.

New bench scenarios (all on a fresh bench order per iteration):
- `legacy-chain` — replays the OLD client behaviour: `POST /api/print/kot`, then `POST /api/print/bill`,
  sequentially; `wall(2 calls)` is the sum the old POS tap paid in print calls.
- `bill+catchup (KOT already printed)` / `legacy-chain (KOT already printed)` — the realistic case: an
  untimed `POST /api/print/kot` first (its job flipped to printed, not counted anywhere), then the timed
  step(s); the catch-up / the old KOT call finds nothing new (`no_delta`).

### p50 / p95 per scenario (ms)

| scenario | metric | p50 | p95 |
|---|---|---|---|
| kot-1-printer | wall(client) | 327.2 | 395.6 |
| kot-1-printer | total | 317.9 | 391.0 |
| kot-2-printers | wall(client) | 361.1 | 560.2 |
| kot-2-printers | total | 358.3 | 556.7 |
| bill | wall(client) | 345.2 | 418.3 |
| bill | total | 342.9 | 415.3 |
| bill+catchup | wall(client) | 781.1 | 1235.7 |
| bill+catchup | total | 776.8 | 1231.9 |
| bill+catchup (KOT already printed) | wall(client) | 511.7 | 641.0 |
| bill+catchup (KOT already printed) | total | 507.7 | 637.7 |
| legacy-chain | wall(2 calls) | 719.3 | 1008.2 |
| legacy-chain | wall(kot call) / wall(bill call) | 360.7 / 355.7 | 624.5 / 431.6 |
| legacy-chain (KOT already printed) | wall(2 calls) | 515.6 | 681.1 |
| legacy-chain (KOT already printed) | wall(kot call) / wall(bill call) | 108.1 / 398.7 | 136.3 / 566.9 |

Stage detail (p50): in every scenario the three reads now overlap (kot-1: `db_order` 84.0, `db_tickets`
78.9, `db_items` 85.0 — each is ONE round trip, not three in a row), and kot-2's `insert_job` (87.6) and
`pusher` (82.2) are one round trip each instead of two. Serial round trips per call: kot-1 6 → 4,
kot-2 8 → 4, bill 5 → 4, Bill tap 11 (old chain) → 8 (`bill+catchup`, fresh) / 5 (KOT already printed).

### Comparison with the Baseline (p50, as measured)

| scenario | metric | baseline | after Phase 1 | change |
|---|---|---|---|---|
| kot-1-printer | wall(client) | 202.8 | 327.2 | +61.3% |
| kot-1-printer | total | 198.5 | 317.9 | +60.2% |
| kot-2-printers | wall(client) | 265.7 | 361.1 | +35.9% |
| kot-2-printers | total | 261.9 | 358.3 | +36.8% |
| bill (no catch-up) | wall(client) | 167.0 | 345.2 | +106.7% |
| bill (no catch-up) | total | 163.7 | 342.9 | +109.5% |

Bill tap, (a) versus the ORIGINAL baseline chain (KOT 202.8 + Bill 167.0 = 369.8 ms p50):

| scenario | p50 | change vs 369.8 |
|---|---|---|
| bill+catchup | 781.1 | +111.2% |
| bill+catchup (KOT already printed) | 511.7 | +38.4% |

Bill tap, (b) versus the current `legacy-chain` rows (same run, same network, same server code):

| scenario | p50 | legacy-chain p50 | change |
|---|---|---|---|
| bill+catchup | 781.1 | 719.3 (`legacy-chain`) | +8.6% |
| bill+catchup (KOT already printed) | 511.7 | 515.6 (`legacy-chain (KOT already printed)`) | −0.8% |

Reading (b): the bench client is on localhost, so the request that the single call eliminates costs
almost nothing here; server-side the combined call still runs the KOT half and the bill half one after
the other, so it does the same number of round trips as the two old calls (8 or 5). The +8.6% / −0.8% are
within this run's noise (probe p95 120 ms per round trip). The single-call win on a real tap is the one
client → server round trip that no longer happens (phone → Vercel), which this bench cannot see.

Projection, NOT a measurement: at the baseline's ~33 ms per round trip the serial round-trip counts above
would give about 4 x 33 ≈ 132 ms for kot-1-printer, 8 x 33 ≈ 264 ms (−29% vs 369.8) for a fresh
`bill+catchup` and 5 x 33 ≈ 165 ms (−55%) for `bill+catchup (KOT already printed)`, before the saved
client round trip. A re-run under baseline-like RTT (probe `SELECT 1` ≈ 33 ms) is needed to measure this.

### Target verdict (as measured, not adjusted)

- **KOT p50 ≤ ~140 ms: NOT MET** — kot-1-printer measured 327.2 ms `wall(client)` / 317.9 ms `total` p50
  (+61% vs 202.8 / 198.5) on a network whose round trip was ~79 ms instead of ~33 ms, so this run is not
  like for like; the round-trip count fell from 6 to 4 (projected ≈ 132 ms at baseline RTT, unmeasured).
- **Bill single request ≥ 30% under the ~370 ms baseline chain: NOT MET** — `bill+catchup` measured 781.1 ms
  p50 (+111%) and `bill+catchup (KOT already printed)` 511.7 ms (+38%), and against the same-run old chain
  they are +8.6% / −0.8% (no server-side gain); even projected to baseline RTT the fresh case (≈ −29%) would
  fall just short, and only the KOT-already-printed case (≈ −55%) would clear it.

## After Phase 1 (re-run, RTT-normalised)

> **Reading these tables:** stage timings OVERLAP from Phase 1 on (the KOT reads run concurrently, and the bill's
> reads run concurrently with the KOT catch-up), so stages no longer add up to `total`, and under pool contention a stage can include
> connection wait. The network-independent measure is the count of SERIAL round trips per tap (KOT 6→4, two-printer KOT 8→4,
> Bill tap on a fresh order 13→8, Bill tap with the KOT already printed 10→5, counting the per-request auth lookup). The dev-machine
> round trip was unstable during this run (SELECT 1 p95 up to ~640 ms, DNS failures), so absolute percentages here are not a clean verdict.
> **Decision to record:** the bill-read overlap in `runBillPrint` is a production-code change made during Task 13; it raises peak DB
> connections for a Bill-with-catch-up tap from 3 to 5 (pool max 10) in exchange for one fewer serial round trip.

Recorded 2026-10-03 (Sat Oct 3, 09:54–10:00 IST), same dev machine, after three changes:

1. **In-run RTT floor.** Each scenario samples `SELECT 1` through the pool 20x at its start and 20x at its
   end (n = 40) and reports `rtt(SELECT 1)`; RTT units = p50(metric) / p50(rtt) of that scenario. The
   baseline's RTT units use the baseline probe's `neon: SELECT 1` p50 = 32.7 ms.
2. **Per-request auth cost emulated.** The bench's stub auth middleware now does what
   `passport.deserializeUser` does on every real request — one users lookup (read-only
   `SELECT * FROM users WHERE id = $1`). It runs before the handler, so it is in `wall(client)` /
   `wall(2 calls)` but NOT in `total` (Server-Timing starts after auth). The baseline had a free stub, so
   its `wall` figures carry no auth round trip; the comparison below also shows an "auth-adjusted" baseline
   (+1 RTT unit per request) for the `wall` rows.
3. **Server: the bill's reads overlap the KOT catch-up** (`runBillPrint` in `server/services/printDispatch.ts`)
   — safe because the catch-up only writes `print_jobs` and `kotPrintCount`/`lastKotSnapshot`, none of which
   the bill renders. Visible in the stage tables: `db_order` ≈ `kot_db_order`.

Command: `bench-print-latency.ts --iterations 20 --label after-phase1b` → `RESULT: PASS ✅` (failure-path check
passed). A first attempt aborted on a DNS failure (`getaddrinfo ENOTFOUND` for the DB host) and cleaned up after
itself. `--cleanup-only` afterwards: "cleanup: no bench orders found"; bench `print_jobs` rows: 0.
The network was still slow and unstable: rtt p50 81.5–85.9 ms for the first five scenarios, 116–125 ms for
the two legacy-chain scenarios, with p95 spikes up to 644 ms.

### p50 / p95 (ms) and p50 in RTT units

| scenario | rtt p50 / p95 | metric | p50 | p95 | p50 in RTT units |
|---|---|---|---|---|---|
| kot-1-printer | 81.5 / 147.9 | wall(client) | 623.9 | 958.6 | 7.66 |
| | | total | 512.6 | 767.9 | 6.29 |
| kot-2-printers | 85.9 / 160.0 | wall(client) | 652.1 | 938.3 | 7.59 |
| | | total | 519.8 | 845.7 | 6.05 |
| bill | 83.8 / 178.4 | wall(client) | 672.5 | 797.5 | 8.02 |
| | | total | 520.7 | 699.5 | 6.21 |
| bill+catchup | 83.7 / 162.3 | wall(client) | 1037.6 | 1194.7 | 12.40 |
| | | total | 916.0 | 1075.8 | 10.94 |
| bill+catchup (KOT already printed) | 84.3 / 643.7 | wall(client) | 658.5 | 984.9 | 7.81 |
| | | total | 532.5 | 829.0 | 6.31 |
| legacy-chain | 116.3 / 363.6 | wall(2 calls) | 1357.0 | 3231.6 | 11.66 |
| | | wall(kot call) / wall(bill call) | 648.0 / 760.8 | 1917.2 / 1124.2 | 5.57 / 6.54 |
| legacy-chain (KOT already printed) | 124.7 / 269.8 | wall(2 calls) | 1114.8 | 2022.5 | 8.94 |
| | | wall(kot call) / wall(bill call) | 292.4 / 794.5 | 788.8 / 1558.4 | 2.35 / 6.37 |

Serial round trips, from the stage tables (auth lookups in brackets): kot-1 6 → 4 (+1); kot-2 8 → 4 (+1);
bill 5 → 4 (+1); a Bill tap on a fresh order 11 (+2, old two-call chain) → 7 (+1, `bill+catchup`, was 8 before
the overlap); a Bill tap with the KOT already printed 3 + 5 = 8 (+2, old chain on the baseline code: a
no-delta KOT call was three sequential reads) → 4 (+1). (On today's server code the same-run legacy chain
needs 1 + 4 = 5 (+2) for that case.)

A short station run (`--iterations 5 --station --label after-phase1b-station`) passed on its second attempt
(every job claimed + acked; event→claim and claim→ack ≈ 200–240 ms p50, i.e. about 2.5–3 RTT, since each now
includes the auth lookup). The first attempt failed 2 `bill+catchup` calls with the pool's
`timeout exceeded when trying to connect` during a network spike (rtt p50 242 ms in that scenario); the second
of those 500s correctly carried the already-committed `kotCatchUp` (dispatched KOT job), so the
catch-up-on-error path works under a real read failure.

### Comparison with the baseline in RTT units (p50)

Baseline RTT units (÷ 32.7): kot-1 wall 6.20 / total 6.07; kot-2 wall 8.13 / total 8.01; bill wall 5.11 /
total 5.01; old chain KOT + Bill 369.8 ms = 11.31. Auth-adjusted (+1 per request): kot-1 wall 7.20, kot-2 wall
9.13, bill wall 6.11, chain 13.31.

| scenario | metric | baseline | after (re-run) | change | change vs auth-adjusted |
|---|---|---|---|---|---|
| kot-1-printer | total | 6.07 | 6.29 | +3.6% | — |
| kot-1-printer | wall(client) | 6.20 | 7.66 | +23.5% | +6.4% (vs 7.20) |
| kot-2-printers | total | 8.01 | 6.05 | −24.5% | — |
| kot-2-printers | wall(client) | 8.13 | 7.59 | −6.6% | −16.9% (vs 9.13) |
| bill (alone) | total | 5.01 | 6.21 | +24.0% | — |
| bill (alone) | wall(client) | 5.11 | 8.02 | +56.9% | +31.3% (vs 6.11) |

Bill single request, (a) versus the baseline chain (11.31 RTT units; 13.31 auth-adjusted):

| scenario | RTT units | vs 11.31 | vs 13.31 |
|---|---|---|---|
| bill+catchup | 12.40 | +9.6% | −6.8% |
| bill+catchup (KOT already printed) | 7.81 | −30.9% | −41.3% |

(b) versus the same-run `legacy-chain` rows (both sides pay the emulated auth lookup per request):

| scenario | single request | legacy chain | change in RTT units | change in ms |
|---|---|---|---|---|
| fresh order | 12.40 (1037.6 ms) | 11.66 (1357.0 ms) | +6.3% | −23.5% |
| KOT already printed | 7.81 (658.5 ms) | 8.94 (1114.8 ms) | −12.6% | −40.9% |

How to read this: the RTT floor moved between scenarios (≈84 ms for the single-request rows, 116–125 ms for the
legacy rows), so the ms column flatters the new path and the RTT-unit column is the fairer one. Even RTT units
are biased against the re-run: in the baseline each stage cost ≈1.0x the `SELECT 1` floor, while now each
stage costs ≈1.3–1.8x it (e.g. kot-1 `commit` 118.6 ms vs rtt 81.5 ms; three parallel reads take as long as
the slowest of the three, which jitter makes visibly longer than one median round trip). The serial
round-trip counts above (−33% kot-1, −50% kot-2, −20% bill, −38% (13 → 8) / −50% (10 → 5) for the fresh / KOT-already-printed Bill tap with auth) are the
network-independent measure of the change; the RTT-unit p50s are what was actually measured.

### Target verdict (RTT units, as measured — target not adjusted)

- **KOT p50 ≥ 30% lower: NOT MET** — kot-1-printer `total` 6.29 vs 6.07 RTT units (+3.6%) and `wall(client)`
  7.66 vs 6.20 (+23.5%; +6.4% against the auth-adjusted 7.20); kot-2-printers `total` 6.05 vs 8.01 (−24.5%) and
  `wall(client)` 7.59 vs 8.13 (−6.6%; −16.9% auth-adjusted). Structurally the serial round trips fell 6 → 4
  and 8 → 4, but the measured RTT-unit p50 does not show a 30% drop on this network.
- **Single-request Bill ≥ 30% lower than the old KOT-then-Bill chain: NOT MET as a whole** — met only in the
  realistic KOT-already-printed case against the baseline chain (7.81 vs 11.31 RTT units, −30.9%; −41.3%
  auth-adjusted). On a fresh order it is 12.40 vs 11.31 (+9.6%; −6.8% auth-adjusted), and against the same-run
  legacy chain −12.6% (KOT already printed) and +6.3% (fresh) in RTT units (−40.9% / −23.5% in ms, flattered
  by the network getting slower during the legacy rows). A re-run at a baseline-like RTT (probe `SELECT 1`
  ≈ 33 ms, stable) is still needed for a like-for-like verdict.

## Final

Recorded 2026-10-03 (~11:50 IST), same dev machine → Neon / Pusher (NOT Vercel bom1), after Parts A–C
(Tasks 1–16). Command: `bench-print-latency.ts --iterations 20 --station --label final` → `RESULT: PASS ✅`
(every response had the expected shape, every station job was claimed + acked, and the failure-path check passed:
a bill that fails after its catch-up returns a 500 carrying `kotCatchUp`). Then `--cleanup-only` → "cleanup: no
bench orders found"; a direct count found 0 `BENCH-%` orders, 0 `bench-%` `print_jobs` and 0 pending `print_jobs`
in the last 24h. `npm run check`, `npm run test:pure` (all 17 scripts PASS, incl. the three new ones) and
`npm run build` exited 0.

**The network was baseline-like this time:** in-run `rtt(SELECT 1)` p50 was 29.7–33.0 ms in every scenario except
`bill+catchup (KOT already printed)` (42.9 ms p50, 327.5 ms p95 — a spike during that scenario). So, unlike the two
Phase 1 runs, the ms figures are roughly comparable with the baseline (32.7 ms floor). Caveats that still apply:
each stage now costs ≈1.1–1.25x the floor at p50 (e.g. kot-1 stages 34–37 ms vs rtt 29.9 ms); `wall` now includes
the emulated per-request auth lookup (+1 round trip) that the baseline's free stub did not; and the bench cannot see
the client → server round trip each eliminated request saves, nor the Phase 2 save+print merge (the save route
can't be benched without consuming real counters/inventory).

### p50 / p95 (ms) and p50 in RTT units (this run)

| scenario | rtt p50 | metric | p50 | p95 | RTT units |
|---|---|---|---|---|---|
| kot-1-printer | 29.9 | wall(client) | 182.6 | 492.6 | 6.10 |
| | | total | 147.1 | 258.5 | 4.92 |
| kot-2-printers | 30.1 | wall(client) | 173.1 | 293.6 | 5.74 |
| | | total | 138.8 | 196.5 | 4.60 |
| bill | 29.7 | wall(client) | 167.5 | 179.1 | 5.65 |
| | | total | 131.5 | 144.2 | 4.43 |
| bill+catchup | 31.5 | wall(client) | 342.3 | 584.9 | 10.85 |
| | | total | 283.8 | 549.4 | 9.00 |
| bill+catchup (KOT already printed) | 42.9 (p95 327.5) | wall(client) | 242.3 | 388.6 | 5.65 (8.10 at a 29.9 ms floor) |
| | | total | 199.4 | 348.5 | 4.65 |
| legacy-chain | 33.0 | wall(2 calls) | 439.8 | 1299.0 | 13.31 |
| legacy-chain (KOT already printed) | 29.9 | wall(2 calls) | 239.9 | 413.4 | 8.03 |

Station (p50 ms): request→event kot-1 179.2, kot-2 140.3, bill 134.1, bill+catchup 241.3 (baseline 167.7 / 195.1 /
134.8 / —); event→claim 66.6–73.7 and claim→ack 65.5–77.8 (≈2–2.5 RTT each, as each now includes the auth lookup;
baseline ≈36 / ≈35 with a free auth stub).

### Against the baseline (p50)

| scenario | metric | baseline ms | final ms | change (ms) | change (RTT units) |
|---|---|---|---|---|---|
| kot-1-printer | total | 198.5 | 147.1 | −25.9% | −18.9% (4.92 vs 6.07) |
| kot-1-printer | wall(client) | 202.8 | 182.6 | −10.0% | −1.6% (6.10 vs 6.20); −15.3% vs auth-adjusted 7.20 |
| kot-2-printers | total | 261.9 | 138.8 | −47.0% | −42.6% (4.60 vs 8.01) |
| kot-2-printers | wall(client) | 265.7 | 173.1 | −34.9% | −29.4% (5.74 vs 8.13); −37.1% vs auth-adjusted 9.13 |
| bill (alone) | total | 163.7 | 131.5 | −19.7% | −11.6% (4.43 vs 5.01) |
| bill (alone) | wall(client) | 167.0 | 167.5 | +0.3% | +10.6% (5.65 vs 5.11); −7.5% vs auth-adjusted 6.11 |
| Bill tap, fresh order (`bill+catchup`) | wall | 369.8 (old chain) | 342.3 | −7.4% | −4.1% (10.85 vs 11.31); −18.5% vs auth-adjusted 13.31 |
| Bill tap, KOT already printed | wall | 369.8 (old chain) | 242.3 | −34.5% | −28.4% at a 29.9 ms floor (8.10 vs 11.31); −39.1% vs auth-adjusted 13.31 |

Against the same-run `legacy-chain` rows (today's server code; both sides pay the auth lookup): fresh order 342.3 vs
439.8 ms (−22.2%; −18.5% in RTT units); KOT already printed 242.3 vs 239.9 ms (+1.0%, no measured gain — that
single-request scenario is the one that hit the network spike: its `total` p50 of 199.4 ms is ≈6.7 RTT for four
serial steps).

Serial round trips per tap (network-independent; auth lookups counted): KOT 6 → 4 (+1 auth each side), two-printer
KOT 8 → 4, Bill alone 5 → 4, Bill tap on a fresh order 13 → 8, Bill tap with the KOT already printed 10 → 5.

### Requirement status

- **One print tap = one HTTP request: implemented, not demonstrated in a browser.** POS taps send the save with
  `print` (Phase 2); the Tables card and reprints use one `/api/print/*` call that absorbs the KOT catch-up and the
  table flip. Covered by code review, `scripts/verify-print-request.ts` and the bench's single-call scenarios. The
  DevTools check (Task 15 Step 8) and the other manual app checks (Tasks 12, 15, 16) were **not performed** and remain
  for a human, following the safety rules at the top of the plan.
- **KOT p50 ≥ 30% lower (≤ ~140 ms): NOT demonstrated for the single-printer case** — kot-1-printer `total` 147.1 ms
  (−25.9%; −18.9% in RTT units), `wall(client)` 182.6 ms (−10.0%; −15.3% vs auth-adjusted). **Met for the two-printer
  case** (`total` −47.0%, `wall` −34.9%; −42.6% / −37.1% in RTT units).
- **Single-request Bill ≥ 30% under the old KOT-then-Bill chain (~370 ms): met only in the KOT-already-printed case**
  (242.3 ms, −34.5%; −28.4% to −39.1% in RTT units depending on the auth adjustment — borderline on the stricter
  reading, and not shown against the same-run legacy chain). **NOT met on a fresh order** (342.3 ms, −7.4%; −4.1% in
  RTT units, −18.5% auth-adjusted).
- **Overall: the agreed target is NOT demonstrated by the dev-machine runs.** The structural change is in place (serial
  round trips per tap cut 20–50%, one client request per tap instead of 2–4), but the part of the gain the bench
  cannot see — each removed phone → Vercel request, and the save+print merge — is where the single-request design
  should pay off most. The real verdict needs `Server-Timing` (and the POS `[print-perf] tap:` line) read from Vercel
  during real service.

### Deviations and decisions made during execution

- **Bill reads overlap the KOT catch-up** in `runBillPrint` (made during Task 13, production code): one fewer serial
  round trip, at the cost of 5 concurrent DB connections for a Bill-with-catch-up tap (pool max 10; since reduced to 4
  by folding the bill's two reads into one — see "Done after review" below). Safe only because
  the bill renders nothing the catch-up writes (`kotPrintCount` is declared, not printed — comment in
  `shared/print/generators.ts`). Task 14's "`p.order && !kotCatchUp`" rule became "use the preloaded order".
- **`kotCatchUp` survives a failed bill:** `runBillPrint` attaches it to the thrown error; `/api/print/bill`'s 500 body
  is `{ message, kotCatchUp }` and `executePrintStep` returns `print: { error, kotCatchUp }`. POS processes it first via
  `handleKotCatchUpPart`, which never throws.
- **`bill-requested` rule:** both old rules kept, per request (`markBilled: "always" | "on_send"`); a bill that throws no
  longer flips the table. `POST /api/orders/:id/bill-requested` is kept but unused.
- **Publisher fallback:** `publishMany` chunks at Pusher's 10-event `triggerBatch` limit and retries a failed batch
  event by event.
- **Phase 2 passes the saved order row only**; items are still read by the single join query (menu names + category ids
  for routing). Design C.1 wording updated accordingly.
- **Bench hardening beyond the plan:** activity guard (`--force` override), pending/claimed bench jobs flipped to
  `printed` after every call and on SIGINT/SIGTERM, single-flight signal-safe cleanup, `bench-%` sweep, strict argument
  parsing, a failed cleanup reported as FAIL, in-run RTT sampling, an emulated per-request auth lookup and a functional
  failure-path check; the virtual station needed a `pusher-js` ESM/CJS import fix.
- **ES5 target:** `tsconfig.json` has no `target`, so no `for…of`/spread over a `Map`/`Set` in `client/`, `shared/`,
  `server/` (`Array.from` instead).
- `Server-Timing` is always on (no env flag); no idempotency key was added (existing guards: `isPrinting`,
  commit-once-at-dispatch).

### Follow-ups left unbuilt

- Publish after responding via `waitUntil` (`@vercel/functions`) — only if Vercel `Server-Timing` shows `pusher`
  dominating; needs a retry story, because the catch-up poll only runs on mount/reconnect.
- Skip the delete-all/reinsert in `PUT /api/orders/:id/items` when the incoming items equal the persisted ones.
- Keep watching DB pool pressure under concurrent load (mitigated, see "Done after review" below: peak is now 4 of 10).
- Read `Server-Timing` / `[print-perf]` from Vercel in real use and record the like-for-like verdict here.

### Done after review (previously listed as open)

- **PUT-without-items bug: FIXED.** `PUT /api/orders/:id/items` now rejects a missing/non-array `items` with
  `400 { error: "items must be an array" }` before any write (it used to replace the order's items with nothing,
  commit, then throw at `items.filter` — a committed wipe returned as a 500). An intentional clear still sends
  `items: []`; the post-commit delta-KOT step uses `lineItems`.
- **Connection-pressure mitigation: DONE.** The bill's two reads (order row + items) are one left-joined query (timer
  stage `db_bill`) when no order row is preloaded; with a preloaded order (save-with-print) only the items are read
  (stage `db_items`). A Bill-with-KOT-catch-up tap therefore peaks at 4 concurrent DB connections (catch-up's 3 + the
  bill's 1), not 5 (pool max 10). Items are ordered by `order_items.id` in both paths.
- **Release-order skew fallback: DONE.** If a save response has no `print` key (a new client against an old server,
  e.g. an Electron thin client updated before the Vercel API is deployed), `handleSavedPrint` in POS.tsx falls back to
  the legacy chained calls (`/api/print/kot`; for Bill: silent `/api/print/kot` catch-up, then `/api/print/bill`, then
  best-effort `POST /api/orders/:id/bill-requested` when `markBilled` was requested), and the Auto-KOT path falls back
  to `POST /api/print/kot { orderId, auto: true }`. Deploy the server first anyway; the fallback exists so a skewed
  release degrades to the old behaviour instead of "print failed", and can be deleted once every client and server is
  on the new version.
