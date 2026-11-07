# Network Stall Breaker + One-Time Request Keys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A KOT / Bill / Settle tap on the shop PC that hits a silently dead connection recovers in about 2–3.5 s instead of 10–20 s. A retried request can never save, print or charge anything twice.

**Architecture:**
- **Client.** `timedFetch` (`packages/api-client`) gets a watchdog that is only active in the desktop app.
  - If a request has no response headers after 1.5 s, it sends `GET /api/ping` on the same connection.
  - If that check is also silent for 1.5 s, it asks Electron to `closeAllConnections()` (open WebSockets such as Pusher survive this, as measured), aborts the request and retries it once.
  - Writes are retried only when they carry an `Idempotency-Key`.
- **Server.** A middleware on six hot routes stores each keyed request's answer in a new `request_keys` table, so a repeat of the same key gets the stored answer and the route never runs twice.
- **Supporting pieces:** better diagnostics, an Admin kill switch and a latency-report update.

**Tech Stack:**
- TypeScript, Express 4, Drizzle ORM 0.39 (node-postgres, Supabase)
- React 18 + TanStack Query 5, Electron 33
- Plain `tsx` verify scripts (`npm run test:pure`), esbuild

**Spec:** `docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md` (read it first).

---

## Ground rules for this repo (read before any task)

- **Worktree.** Work in `E:\Claude Code\Projects\BagichaOrderMaster\BagichaOrderMaster\.worktrees\stall-breaker` (branch `stall-breaker`). Never `cd` to the main checkout. Never use bare `git stash`.
- **Tests.** There is no test framework. Tests are `scripts/verify-*.ts` programs that print `PASS`/`FAIL` per check and exit non-zero on failure. DB-free ones are chained in `package.json` → `test:pure` (CI runs it). DB-touching ones stay manual.
- **`scripts/` is not type-checked** by `npm run check`. Validate a script by running it.
- **ES5 target.** `tsconfig.json` has no `target`, so it defaults to ES5. **Never `for…of` or spread a `Map`/`Set` in `client/`, `shared/`, `server/` or `packages/`.** Use `Array.from(...)`. `for…of` over an array is fine.
- **The DB is production.** `DATABASE_URL` is the one shared production Supabase DB. Only Task 15 touches it, and only after the owner says yes.
- **Timestamps** in the DB are naive UTC. Render IST in SQL with `+ interval '5 hours 30 minutes'`.
- **Commits.** Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **Commit messages: use a file, not a heredoc.** In this environment a quoted heredoc containing an apostrophe breaks. Write the message with the Write tool to the scratchpad and run `git commit -F <file>`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `shared/requestKeys.ts` | create | Pure rules for one-time keys: header names, limits, key validation, `decideRepeat`, path/body helpers, messages |
| `shared/schema.ts` | modify | `requestKeys` table |
| `scripts/migrate-request-keys.mjs` | create | Creates the table + index, **enables RLS** |
| `server/requestKeys.ts` | create | Express middleware: claim key → run → store answer, or replay / wait / refuse |
| `server/services/auditService.ts` | modify | Export `actorIdOf(req)` |
| `server/routes.ts` | modify | Mount `requestKeys` on 3 order routes; `POST /api/perf/stall-reset`; extra slow-print fields |
| `server/printRoutes.ts` | modify | Mount `requestKeys` on kot / bill / claim |
| `server/cors.ts` | modify | Allow `Idempotency-Key`, expose `Idempotent-Replayed` |
| `server/settingsStore.ts` | modify | `desktopFastReconnect` setting (default `true`) |
| `packages/api-client/stallBreaker.ts` | create | Pure breaker rules: timings, `decideAfterCheck`, `shouldRetry`, key helpers |
| `packages/api-client/index.ts` | modify | `timedFetch` watchdog, `setStallBreaker`, `stallResetCount`, `withIdempotencyKey` |
| `client/src/lib/api.ts` | modify | Re-export the new API |
| `client/src/lib/queryClient.ts` | modify | `apiRequest(..., { idempotent: true })` |
| `shared/electron/ipc.ts`, `desktop/main.ts`, `desktop/preload.ts`, `client/src/types/electron.d.ts` | modify | `resetConnections()` IPC |
| `shared/rollingBudget.ts` | create | "At most N reports per hour" helper |
| `client/src/lib/stallReset.ts` | create | Installs the breaker in the desktop app; reports `perf.stall_reset` |
| `client/src/main.tsx` | modify | Call `installStallBreaker()` |
| `client/src/lib/slowRequest.ts` | modify | 60/hour budget; skip hidden-window ping reports |
| `client/src/lib/printPerfClient.ts` | modify | `hidden`, `electron`, `resets`, `replayed` on `perf.slow_print` |
| `client/src/lib/auditFormat.ts` | modify | Label + summary for `perf.stall_reset`; slow-print extras |
| `client/src/pages/POS.tsx`, `components/NewOrderModal.tsx`, `pages/Billing.tsx`, `pages/Orders.tsx`, `pages/KOT.tsx`, `lib/printGateway.ts`, `lib/printStationCore.ts` | modify | Send one-time keys on the six routes; handle the new 409 codes |
| `client/src/pages/Settings.tsx` | modify | "Fast reconnect" toggle |
| `scripts/report-latency.ts` | modify | Fix IST day bucketing; add resets + slow prints |
| `scripts/verify-request-keys.ts` | create | Pure test (test:pure) |
| `scripts/verify-stall-breaker.ts` | create | Pure test of breaker rules + rolling budget (test:pure) |
| `scripts/verify-timed-fetch-breaker.ts` | create | `timedFetch` with a fake `fetch` and tiny timings (test:pure) |
| `scripts/verify-request-keys-db.ts` | create | Manual, DB: real middleware on a throwaway Express app |
| `scripts/lib/stall-breaker-page.ts` + `scripts/verify-stall-breaker-electron.cjs` | create | Manual, Electron: real breaker vs a silent-blackhole HTTP/2 proxy + real Pusher |
| `CLAUDE.md` | modify | Document the feature + "new tables need RLS" |

---

### Task 0: Worktree setup and baseline

**Files:** none committed.

- [ ] **Step 1: Link `node_modules` and copy `.env` into the worktree.** Both are gitignored. Never commit `.env`. Run in PowerShell:

```powershell
$wt = "E:\Claude Code\Projects\BagichaOrderMaster\BagichaOrderMaster\.worktrees\stall-breaker"
$main = "E:\Claude Code\Projects\BagichaOrderMaster\BagichaOrderMaster"
if (-not (Test-Path "$wt\node_modules")) { New-Item -ItemType Junction -Path "$wt\node_modules" -Target "$main\node_modules" | Out-Null }
if (-not (Test-Path "$wt\.env")) { Copy-Item "$main\.env" "$wt\.env" }
git -C $wt check-ignore -v .env node_modules
```

Expected: both paths are printed as ignored.

- [ ] **Step 2: Baseline must be green**

Run (worktree root): `npm run check` then `npm run test:pure`.
Expected: `tsc` prints nothing, and every verify script ends `RESULT: PASS` (exit 0). If anything fails, stop and report: the baseline is broken, not this work.

---

### Task 1: Pure one-time-key rules (`shared/requestKeys.ts`)

**Files:**
- Create: `shared/requestKeys.ts`
- Create: `scripts/verify-request-keys.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing test** `scripts/verify-request-keys.ts`:

```ts
/**
 * Verifies shared/requestKeys.ts — the pure rules behind the one-time request keys
 * (Idempotency-Key) that make a retried KOT/Bill/Settle safe. Pure: no DB, no Express.
 * Run: npx tsx scripts/verify-request-keys.ts
 */
import {
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  MAX_STORED_BODY_CHARS,
  isValidIdempotencyKey,
  decideRepeat,
  bodyHashInput,
  keyPath,
  storableBody,
  isMissingTableError,
  type KeyFingerprint,
  type StoredKey,
} from "../shared/requestKeys";

const checks: Array<[string, boolean]> = [];
const fp: KeyFingerprint = { actorId: "u:7", method: "PUT", path: "/api/orders/12/items", bodyHash: "abc" };
const row = (over: Partial<StoredKey>): StoredKey => ({ ...fp, state: "done", responseStatus: 200, responseBody: { id: 12 }, ...over });

// Header names (the client package keeps its own copy — they must match)
checks.push(["header name", IDEMPOTENCY_HEADER === "Idempotency-Key"]);
checks.push(["replayed header name", REPLAYED_HEADER === "Idempotent-Replayed"]);

// Key validation
checks.push(["a UUID is valid", isValidIdempotencyKey("3f2c9a1e-8b7d-4c3a-9e1f-0a1b2c3d4e5f")]);
checks.push(["the client fallback shape is valid", isValidIdempotencyKey("k-lq2x9a-abcdef123456ghijkl")]);
checks.push(["too short is invalid", !isValidIdempotencyKey("abc")]);
checks.push(["spaces/punctuation are invalid", !isValidIdempotencyKey("bad key!")]);
checks.push(["over 100 chars is invalid", !isValidIdempotencyKey("a".repeat(101))]);
checks.push(["a non-string is invalid", !isValidIdempotencyKey(42)]);

// decideRepeat
checks.push(["done + same fingerprint → replay with the stored answer", (() => {
  const d = decideRepeat(row({}), fp);
  return d.kind === "replay" && d.status === 200 && (d.body as any).id === 12;
})()]);
checks.push(["a stored error is replayed too (never re-run)", (() => {
  const d = decideRepeat(row({ responseStatus: 500, responseBody: { message: "x" } }), fp);
  return d.kind === "replay" && d.status === 500;
})()]);
checks.push(["processing → wait", decideRepeat(row({ state: "processing", responseStatus: null, responseBody: null }), fp).kind === "wait"]);
checks.push(["done but no stored body (too big) → replay_unavailable", decideRepeat(row({ responseBody: null }), fp).kind === "replay_unavailable"]);
checks.push(["other user → mismatch", decideRepeat(row({ actorId: "sm:7" }), fp).kind === "mismatch"]);
checks.push(["other method → mismatch", decideRepeat(row({ method: "POST" }), fp).kind === "mismatch"]);
checks.push(["other path → mismatch", decideRepeat(row({ path: "/api/orders/13/items" }), fp).kind === "mismatch"]);
checks.push(["other body → mismatch", decideRepeat(row({ bodyHash: "zzz" }), fp).kind === "mismatch"]);
checks.push(["mismatch wins over processing", decideRepeat(row({ state: "processing", actorId: "u:8" }), fp).kind === "mismatch"]);

// Helpers
checks.push(["bodyHashInput is stable JSON", bodyHashInput({ a: 1, b: [2] }) === '{"a":1,"b":[2]}']);
checks.push(["bodyHashInput of no body", bodyHashInput(undefined) === "null"]);
checks.push(["keyPath drops the query string", keyPath("/api/print/bill?x=1") === "/api/print/bill"]);
checks.push(["keyPath keeps a plain path", keyPath("/api/print/jobs/5/claim") === "/api/print/jobs/5/claim"]);
checks.push(["storableBody keeps a normal answer", (storableBody({ ok: true }) as any).ok === true]);
checks.push(["storableBody drops an answer over the limit", storableBody({ big: "x".repeat(MAX_STORED_BODY_CHARS) }) === null]);
checks.push(["missing table: pg error code", isMissingTableError({ code: "42P01" })]);
checks.push(["missing table: wrapped cause", isMissingTableError({ cause: { code: "42P01" } })]);
checks.push(["other DB errors are not 'missing table'", !isMissingTableError({ code: "23505" }) && !isMissingTableError(null)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/verify-request-keys.ts`
Expected: it fails to start with a module-not-found error for `../shared/requestKeys`.

- [ ] **Step 3: Implement** `shared/requestKeys.ts`:

```ts
/**
 * One-time request keys ("Idempotency-Key") — the pure rules used by the server middleware
 * (server/requestKeys.ts) and locked by scripts/verify-request-keys.ts.
 *
 * A request carrying a key runs at most once per (key, user). A repeat — the desktop stall breaker
 * retrying a stuck KOT/Bill/Settle on a fresh connection, or Chromium quietly resending — gets the
 * first run's stored answer instead of running the route again. Requests WITHOUT a key behave
 * exactly as before. Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 *
 * The client package keeps its own copy of the two header names
 * (packages/api-client/stallBreaker.ts — that package has no @shared alias); keep them equal.
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotent-Replayed";

/** A repeat that finds the first run still going waits up to this long, re-reading every REPLAY_POLL_MS. */
export const REPLAY_WAIT_MS = 8_000;
export const REPLAY_POLL_MS = 250;
/** Answers bigger than this (as JSON text) are not stored; a repeat then gets `replay_unavailable`. */
export const MAX_STORED_BODY_CHARS = 1_000_000;
/** Keys are kept this long, then pruned — at most once per PRUNE_EVERY_MS per server instance. */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const PRUNE_EVERY_MS = 10 * 60 * 1000;

export const IN_PROGRESS_MESSAGE = "This request is still being processed — refresh before trying again.";
export const REPLAY_UNAVAILABLE_MESSAGE = "This request already ran, but its answer is not available — refresh to see the result.";
export const MISMATCH_MESSAGE = "This request key was already used for a different request.";

const KEY_RE = /^[A-Za-z0-9-]{8,100}$/;

export function isValidIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && KEY_RE.test(v);
}

/** What makes two requests "the same": who sent it, where, and exactly what body. */
export interface KeyFingerprint {
  actorId: string;
  method: string;
  path: string;
  bodyHash: string;
}

/** A request_keys row, as far as the decision needs it. */
export interface StoredKey extends KeyFingerprint {
  /** "processing" | "done" */
  state: string;
  responseStatus: number | null;
  responseBody: unknown;
}

export type RepeatDecision =
  | { kind: "mismatch" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "replay_unavailable" }
  | { kind: "wait" };

/** A request arrived with a key that already has a row: what to do with it. */
export function decideRepeat(stored: StoredKey, incoming: KeyFingerprint): RepeatDecision {
  if (
    stored.actorId !== incoming.actorId ||
    stored.method !== incoming.method ||
    stored.path !== incoming.path ||
    stored.bodyHash !== incoming.bodyHash
  ) {
    return { kind: "mismatch" };
  }
  if (stored.state !== "done") return { kind: "wait" };
  if (stored.responseStatus == null || stored.responseBody == null) return { kind: "replay_unavailable" };
  return { kind: "replay", status: stored.responseStatus, body: stored.responseBody };
}

/** The text hashed into `bodyHash` (the server hashes it with sha256). */
export function bodyHashInput(body: unknown): string {
  return JSON.stringify(body ?? null);
}

/** `req.originalUrl` without its query string. */
export function keyPath(originalUrl: string): string {
  const q = originalUrl.indexOf("?");
  return q === -1 ? originalUrl : originalUrl.slice(0, q);
}

/** The answer body to store, or null when it is too big to keep. */
export function storableBody(body: unknown): unknown | null {
  const text = JSON.stringify(body ?? null);
  return text.length > MAX_STORED_BODY_CHARS ? null : body ?? null;
}

/** True for Postgres "relation does not exist" — the migration has not been run yet. */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx scripts/verify-request-keys.ts`
Expected: every line `PASS`, then `RESULT: PASS ✅`.

- [ ] **Step 5: Add it to `test:pure`.** In `package.json`, change the end of the `test:pure` value from
`&& tsx scripts/verify-db-ssl.ts"` to
`&& tsx scripts/verify-db-ssl.ts && tsx scripts/verify-request-keys.ts"`

Then run `npm run test:pure`. Expected: exit 0.

- [ ] **Step 6: Commit** `shared/requestKeys.ts`, `scripts/verify-request-keys.ts` and `package.json` with message `One-time request keys: pure rules + test`.

---

### Task 2: `request_keys` table (schema + migration script)

**Files:**
- Modify: `shared/schema.ts` (append after the `printJobs` block, around lines 394–412)
- Create: `scripts/migrate-request-keys.mjs`

- [ ] **Step 1: Add the table to `shared/schema.ts`.** Insert directly after the line `export type InsertPrintJob = z.infer<typeof insertPrintJobSchema>;`:

```ts

/**
 * request_keys — one row per one-time request key (Idempotency-Key header) on the hot write routes
 * (server/requestKeys.ts). Holds the route's answer so a repeat of the same key (the desktop stall
 * breaker's retry, a browser resend) replays it instead of running the route twice. Kept 24 h.
 * Created by scripts/migrate-request-keys.mjs, which also ENABLES ROW LEVEL SECURITY — every public
 * table has RLS on and the DB's default privileges would otherwise expose new tables to the anon key.
 */
export const requestKeys = pgTable("request_keys", {
  key:            text("key").primaryKey(),
  actorId:        text("actor_id").notNull(),   // "u:<id>" | "sm:<id>" (audit actorId convention)
  method:         text("method").notNull(),
  path:           text("path").notNull(),       // originalUrl without the query string
  bodyHash:       text("body_hash").notNull(),  // sha256 of JSON.stringify(req.body ?? null)
  state:          text("state").notNull(),      // 'processing' | 'done'
  responseStatus: integer("response_status"),
  responseBody:   json("response_body"),        // null when over 1 MB (replay_unavailable)
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  completedAt:    timestamp("completed_at"),
}, (t) => [
  index("idx_request_keys_created").on(t.createdAt),
]);

export type RequestKeyRecord = typeof requestKeys.$inferSelect;
```

- [ ] **Step 2: Create `scripts/migrate-request-keys.mjs`:**

```js
/**
 * Additive migration: the request_keys table for one-time request keys (server/requestKeys.ts).
 * Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 *
 * ROW LEVEL SECURITY is enabled on purpose: every table in `public` has RLS on, and this database's
 * default privileges grant anon/authenticated full rights on NEW tables — without RLS the stored order
 * answers would be readable/writable through Supabase's REST API with the public anon key. No policies:
 * the app connects as the table owner (postgres), which RLS does not restrict (not FORCEd).
 *
 * Idempotent (IF NOT EXISTS) and safe to re-run. Rollback: DROP TABLE IF EXISTS request_keys;
 * TLS: verifies the server certificate with the committed Supabase CA (certs/supabase-prod-ca-2021.crt).
 *
 * Run: node scripts/migrate-request-keys.mjs
 */
import 'dotenv/config';
import fs from 'fs';
import pkg from 'pg';
const { Pool } = pkg;

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const url = new URL(process.env.DATABASE_URL);
// pg lets a URL sslmode replace the ssl object below — strip it (same as server/dbSsl.ts).
for (const k of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(k);
const ca = fs.readFileSync(new URL('../certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
const pool = new Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000 });

const statements = [
  `CREATE TABLE IF NOT EXISTS request_keys (
     key text PRIMARY KEY,
     actor_id text NOT NULL,
     method text NOT NULL,
     path text NOT NULL,
     body_hash text NOT NULL,
     state text NOT NULL,
     response_status integer,
     response_body json,
     created_at timestamp NOT NULL DEFAULT now(),
     completed_at timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS idx_request_keys_created ON request_keys (created_at)`,
  `ALTER TABLE request_keys ENABLE ROW LEVEL SECURITY`,
];

try {
  for (const stmt of statements) {
    await pool.query(`BEGIN; SET LOCAL lock_timeout = '3s'; ${stmt}; COMMIT;`);
    console.log('  OK:', stmt.split('\n')[0]);
  }
  const { rows } = await pool.query(
    `SELECT c.relname, c.relrowsecurity AS rls,
            (SELECT count(*) FROM pg_indexes WHERE tablename = 'request_keys' AND indexname = 'idx_request_keys_created') AS idx
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'request_keys'`);
  console.log('Present:', rows);
  const ok = rows.length === 1 && rows[0].rls === true && Number(rows[0].idx) === 1;
  console.log(ok ? 'DONE' : 'INCOMPLETE — re-run');
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
```

- [ ] **Step 3: Type-check.** Run: `npm run check`. Expected: no output (pass). **Do not run the migration here**; Task 15 does that, with the owner's OK.

- [ ] **Step 4: Commit** `shared/schema.ts` and `scripts/migrate-request-keys.mjs` with message `request_keys table: schema + migration script (RLS on)`.

---

### Task 3: Server middleware `requestKeys` + mounting + CORS

**Files:**
- Create: `server/requestKeys.ts`
- Modify: `server/services/auditService.ts:7` (export an actor helper)
- Modify: `server/routes.ts:2032, 2267, 2673` (mount)
- Modify: `server/printRoutes.ts:242, 262, 285` (mount)
- Modify: `server/cors.ts:35-44`

- [ ] **Step 1: Export the actor id from `server/services/auditService.ts`.** Directly after the closing `}` of `function getActorFromReq` (it ends with `return { actorId, actorName: name, actorRole: role };\n}`), add:

```ts

/** "u:<id>" / "sm:<id>" for the signed-in principal (users and staffMembers share an id space). */
export function actorIdOf(req: Request): string {
  return getActorFromReq(req).actorId;
}
```

- [ ] **Step 2: Create `server/requestKeys.ts`:**

```ts
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "./db";
import { requestKeys as requestKeysTable } from "@shared/schema";
import { actorIdOf } from "./services/auditService";
import {
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  REPLAY_WAIT_MS,
  REPLAY_POLL_MS,
  KEY_TTL_MS,
  PRUNE_EVERY_MS,
  IN_PROGRESS_MESSAGE,
  REPLAY_UNAVAILABLE_MESSAGE,
  MISMATCH_MESSAGE,
  isValidIdempotencyKey,
  decideRepeat,
  bodyHashInput,
  keyPath,
  storableBody,
  isMissingTableError,
  type KeyFingerprint,
} from "@shared/requestKeys";

/**
 * One-time request keys — mount AFTER requireAuth on the hot write routes:
 *   POST /api/orders, PUT /api/orders/:id/items, POST /api/orders/:id/payment,
 *   POST /api/print/kot, POST /api/print/bill, POST /api/print/jobs/:id/claim.
 *
 * With an `Idempotency-Key` header the route runs at most once per (key, user): the first request
 * claims the key (INSERT … ON CONFLICT DO NOTHING — exactly one wins, across Vercel instances), its
 * JSON answer is stored BEFORE it is sent, and any repeat gets that stored answer (header
 * `Idempotent-Replayed: true`). Without the header nothing changes. Rules: shared/requestKeys.ts.
 * Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 */

let missingTableLogged = false;
let lastPruneAt = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function requestKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.get(IDEMPOTENCY_HEADER);
  if (key === undefined) return next();
  if (!isValidIdempotencyKey(key)) {
    res.status(400).json({ message: "Invalid Idempotency-Key header.", code: "bad_idempotency_key" });
    return;
  }
  const fp: KeyFingerprint = {
    actorId: actorIdOf(req),
    method: req.method,
    path: keyPath(req.originalUrl),
    bodyHash: crypto.createHash("sha256").update(bodyHashInput(req.body)).digest("hex"),
  };

  let claimed: boolean;
  try {
    const rows = await db
      .insert(requestKeysTable)
      .values({ key, ...fp, state: "processing" })
      .onConflictDoNothing()
      .returning({ key: requestKeysTable.key });
    claimed = rows.length > 0;
  } catch (err) {
    if (isMissingTableError(err)) {
      // Deploy-order safety net: never block a tap because the migration hasn't been run.
      if (!missingTableLogged) {
        missingTableLogged = true;
        console.error("[request-keys] table request_keys is missing — run scripts/migrate-request-keys.mjs. Keyed requests run WITHOUT replay protection until then.");
      }
      return next();
    }
    console.error("[request-keys] could not claim the key:", err);
    res.status(503).json({ message: "Could not start the request safely — try again.", code: "request_keys_unavailable" });
    return;
  }

  if (claimed) {
    storeAnswerBeforeSending(key, res);
    res.on("finish", maybePrune);
    return next();
  }
  await answerRepeat(key, fp, res);
}

/** Wraps res.json so the route's final status + body land in the key's row before the answer is sent. */
function storeAnswerBeforeSending(key: string, res: Response): void {
  const send = res.json.bind(res);
  res.json = ((body: unknown) => {
    const status = res.statusCode;
    void (async () => {
      try {
        await db
          .update(requestKeysTable)
          .set({ state: "done", responseStatus: status, responseBody: storableBody(body), completedAt: new Date() })
          .where(eq(requestKeysTable.key, key));
      } catch (err) {
        // The row stays "processing": a repeat gets request_in_progress (and refreshes) — never a re-run.
        console.error("[request-keys] could not store the answer:", err);
      } finally {
        send(body);
      }
    })();
    return res;
  }) as Response["json"];
}

/** A repeat of a claimed key: replay, wait for the first run, or refuse. */
async function answerRepeat(key: string, fp: KeyFingerprint, res: Response): Promise<void> {
  const deadline = Date.now() + REPLAY_WAIT_MS;
  try {
    for (;;) {
      const [row] = await db.select().from(requestKeysTable).where(eq(requestKeysTable.key, key));
      if (!row) {
        res.status(409).json({ message: IN_PROGRESS_MESSAGE, code: "request_in_progress" });
        return;
      }
      const d = decideRepeat(row, fp);
      if (d.kind === "mismatch") {
        res.status(422).json({ message: MISMATCH_MESSAGE, code: "idempotency_key_mismatch" });
        return;
      }
      if (d.kind === "replay") {
        res.setHeader(REPLAYED_HEADER, "true");
        res.status(d.status).json(d.body);
        return;
      }
      if (d.kind === "replay_unavailable") {
        res.status(409).json({ message: REPLAY_UNAVAILABLE_MESSAGE, code: "replay_unavailable" });
        return;
      }
      if (Date.now() >= deadline) {
        res.status(409).json({ message: IN_PROGRESS_MESSAGE, code: "request_in_progress" });
        return;
      }
      await sleep(REPLAY_POLL_MS);
    }
  } catch (err) {
    console.error("[request-keys] could not read the key:", err);
    if (!res.headersSent) {
      res.status(503).json({ message: "Could not check the earlier attempt — refresh before trying again.", code: "request_keys_unavailable" });
    }
  }
}

/** Best effort (Vercel has no schedulers): drop keys older than 24 h, at most every 10 min per instance. */
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  void (async () => {
    try {
      await db.delete(requestKeysTable).where(lt(requestKeysTable.createdAt, new Date(now - KEY_TTL_MS)));
    } catch (err) {
      console.error("[request-keys] prune failed:", err);
    }
  })();
}
```

- [ ] **Step 3: Mount it on the three order routes in `server/routes.ts`.**
  - Add the import next to the other `./` imports (e.g. after `import { registerPrintRoutes } from "./printRoutes";`):

    ```ts
    import { requestKeys } from "./requestKeys";
    ```

  - Then change exactly these three lines:
    - `  app.post("/api/orders", requireAuth, async (req, res) => {` → `  app.post("/api/orders", requireAuth, requestKeys, async (req, res) => {`
    - `  app.put("/api/orders/:id/items", requireAuth, async (req, res) => {` → `  app.put("/api/orders/:id/items", requireAuth, requestKeys, async (req, res) => {`
    - `  app.post("/api/orders/:id/payment", requireAuth, async (req, res) => {` → `  app.post("/api/orders/:id/payment", requireAuth, requestKeys, async (req, res) => {`

- [ ] **Step 4: Mount it on the three print routes in `server/printRoutes.ts`.**
  - Add `import { requestKeys } from "./requestKeys";` after `import { parseBillRequestFlags } from "@shared/printRequest";`.
  - Then change:
    - `  app.post("/api/print/kot", requireAuth, async (req, res) => {` → `  app.post("/api/print/kot", requireAuth, requestKeys, async (req, res) => {`
    - `  app.post("/api/print/bill", requireAuth, async (req, res) => {` → `  app.post("/api/print/bill", requireAuth, requestKeys, async (req, res) => {`
    - `  app.post("/api/print/jobs/:id/claim", requireAuth, async (req, res) => {` → `  app.post("/api/print/jobs/:id/claim", requireAuth, requestKeys, async (req, res) => {`

- [ ] **Step 5: CORS (`server/cors.ts`).**
  - Replace `      "Content-Type, Authorization, X-Requested-With",` with `      "Content-Type, Authorization, X-Requested-With, Idempotency-Key",`
  - Replace `    res.setHeader("Access-Control-Expose-Headers", "Server-Timing");` with:

    ```ts
    // Idempotent-Replayed: the answer came from server/requestKeys.ts's store (diagnostics only).
    res.setHeader("Access-Control-Expose-Headers", "Server-Timing, Idempotent-Replayed");
    ```

- [ ] **Step 6: Verify.** Run `npm run check` (expected: no output), then `npm run test:pure` (expected: exit 0).

- [ ] **Step 7: Commit** `server/requestKeys.ts`, `server/services/auditService.ts`, `server/routes.ts`, `server/printRoutes.ts` and `server/cors.ts` with message `requestKeys middleware on the six hot write routes`.

---

### Task 4: Pure stall-breaker rules + rolling budget

**Files:**
- Create: `packages/api-client/stallBreaker.ts`
- Create: `shared/rollingBudget.ts`
- Create: `scripts/verify-stall-breaker.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing test** `scripts/verify-stall-breaker.ts`:

```ts
/**
 * Verifies packages/api-client/stallBreaker.ts (the desktop stall breaker's pure rules) and
 * shared/rollingBudget.ts (the "at most N diagnostic reports per hour" budget). Pure: fake clock.
 * Run: npx tsx scripts/verify-stall-breaker.ts
 */
import {
  DEFAULT_STALL_TIMINGS,
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  decideAfterCheck,
  shouldRetry,
  hasIdempotencyKey,
  newIdempotencyKey,
} from "../packages/api-client/stallBreaker";
import { IDEMPOTENCY_HEADER as SERVER_HEADER, REPLAYED_HEADER as SERVER_REPLAYED, isValidIdempotencyKey } from "../shared/requestKeys";
import { createRollingBudget } from "../shared/rollingBudget";

const checks: Array<[string, boolean]> = [];
const T = DEFAULT_STALL_TIMINGS;

checks.push(["production timings: check after 1.5 s, check timeout 1.5 s, one reset per 10 s",
  T.checkAfterMs === 1500 && T.checkTimeoutMs === 1500 && T.resetMinGapMs === 10_000]);
checks.push(["worst-case detection (check after + check timeout) stays ≤ 3.5 s", T.checkAfterMs + T.checkTimeoutMs <= 3500]);
checks.push(["client and server agree on the key header", IDEMPOTENCY_HEADER === SERVER_HEADER]);
checks.push(["client and server agree on the replayed header", REPLAYED_HEADER === SERVER_REPLAYED]);

// decideAfterCheck
checks.push(["check answered → keep waiting (server just slow)", decideAfterCheck("answered", 50_000, null, T) === "keep_waiting"]);
checks.push(["check silent, no earlier reset → reset", decideAfterCheck("silent", 50_000, null, T) === "reset"]);
checks.push(["check silent, reset 3 s ago → keep waiting (connection just renewed)", decideAfterCheck("silent", 50_000, 47_000, T) === "keep_waiting"]);
checks.push(["check silent, reset exactly 10 s ago → reset", decideAfterCheck("silent", 50_000, 40_000, T) === "reset"]);

// shouldRetry
const R = (method: string, keyed: boolean, failure: "reset_by_this_request" | "network" | "timeout" | "caller_aborted", hasCallerSignal = false, breakerActive = true) =>
  shouldRetry({ method, keyed, hasCallerSignal, breakerActive, failure });
checks.push(["GET after its own reset → retry", R("GET", false, "reset_by_this_request")]);
checks.push(["GET after a timeout → retry (unchanged behaviour)", R("GET", false, "timeout")]);
checks.push(["GET after a network error → retry (unchanged behaviour)", R("GET", false, "network")]);
checks.push(["GET with a caller signal, network error → no retry (unchanged behaviour)", !R("GET", false, "network", true)]);
checks.push(["GET with a caller signal, reset by the breaker → retry", R("GET", false, "reset_by_this_request", true)]);
checks.push(["caller aborted → never retry", !R("GET", false, "caller_aborted")]);
checks.push(["keyed POST after its own reset → retry", R("POST", true, "reset_by_this_request")]);
checks.push(["keyed POST after a network error (another request's reset) → retry", R("POST", true, "network")]);
checks.push(["UNKEYED POST after a reset → never resent", !R("POST", false, "reset_by_this_request")]);
checks.push(["UNKEYED PUT after a network error → never resent", !R("PUT", false, "network")]);
checks.push(["keyed POST network error with the breaker OFF (browser) → no retry (unchanged)", !R("POST", true, "network", false, false)]);

// Key helpers
checks.push(["hasIdempotencyKey: plain object", hasIdempotencyKey({ [IDEMPOTENCY_HEADER]: "abcdefgh1" })]);
checks.push(["hasIdempotencyKey: case-insensitive", hasIdempotencyKey({ "idempotency-key": "abcdefgh1" })]);
checks.push(["hasIdempotencyKey: Headers instance", hasIdempotencyKey(new Headers({ [IDEMPOTENCY_HEADER]: "abcdefgh1" }))]);
checks.push(["hasIdempotencyKey: none", !hasIdempotencyKey({ "Content-Type": "application/json" }) && !hasIdempotencyKey(undefined)]);
const k1 = newIdempotencyKey();
const k2 = newIdempotencyKey();
checks.push(["new keys are valid for the server", isValidIdempotencyKey(k1) && isValidIdempotencyKey(k2)]);
checks.push(["new keys differ", k1 !== k2]);

// Rolling budget (60 per hour)
{
  const b = createRollingBudget(3, 60_000);
  const took = [b.tryTake(0), b.tryTake(1), b.tryTake(2), b.tryTake(3)];
  checks.push(["budget: first N allowed, then refused", took.join() === "true,true,true,false"]);
  // At 60_000 the report from t=0 has left the window (60_000 - 0 is not < 60_000); 1 and 2 have not.
  checks.push(["budget: refills as old reports age out of the window", b.tryTake(60_000) === true]);
  checks.push(["budget: still at most N in any window after refill", b.tryTake(60_000) === false]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it and watch it fail.** Run: `npx tsx scripts/verify-stall-breaker.ts`. Expected: module-not-found for `../packages/api-client/stallBreaker`.

- [ ] **Step 3: Implement `packages/api-client/stallBreaker.ts`:**

```ts
/**
 * Desktop stall breaker — the pure rules (no DOM, no timers), driven by a fake clock in
 * scripts/verify-stall-breaker.ts. timedFetch (./index.ts) applies them to every API request once
 * the desktop app installs a breaker (client/src/lib/stallReset.ts); in a browser nothing changes.
 *
 * Why: when the shop PC's connection to the API dies silently, Chromium waits 10 s (longer if the
 * connection was used moments before) before trying a new one. The breaker notices after
 * checkAfterMs, confirms with a tiny check request on the same connection, closes all connections
 * (Electron session.closeAllConnections — open WebSockets such as Pusher survive it, measured) and
 * retries once on a fresh one. Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 */
export interface StallTimings {
  /** No response headers after this long → send the check. */
  checkAfterMs: number;
  /** The check must answer within this long, else the connection is dead. */
  checkTimeoutMs: number;
  /** At most one reset per this long — a just-renewed connection is left alone. */
  resetMinGapMs: number;
}

export const DEFAULT_STALL_TIMINGS: StallTimings = { checkAfterMs: 1500, checkTimeoutMs: 1500, resetMinGapMs: 10_000 };

/** Kept equal to shared/requestKeys.ts (this package has no @shared alias) — verify-stall-breaker checks it. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotent-Replayed";

export const CONNECTION_DROPPED_MESSAGE =
  "The connection dropped while saving — check whether it was saved, then try again.";

export type CheckOutcome = "answered" | "silent";

/** A request still has no response headers and the check finished: reset the connections or keep waiting? */
export function decideAfterCheck(
  check: CheckOutcome,
  now: number,
  lastResetAt: number | null,
  t: StallTimings,
): "keep_waiting" | "reset" {
  if (check === "answered") return "keep_waiting";
  if (lastResetAt !== null && now - lastResetAt < t.resetMinGapMs) return "keep_waiting";
  return "reset";
}

/** Why the first attempt failed. "reset_by_this_request" = this request's own watchdog reset the connections. */
export type FailureKind = "reset_by_this_request" | "network" | "timeout" | "caller_aborted";

/** The first attempt failed: send it once more? Writes only with a one-time key (server replays a repeat). */
export function shouldRetry(r: {
  method: string;
  keyed: boolean;
  hasCallerSignal: boolean;
  breakerActive: boolean;
  failure: FailureKind;
}): boolean {
  if (r.failure === "caller_aborted") return false;
  const m = r.method.toUpperCase();
  if (m === "GET" || m === "HEAD") return !r.hasCallerSignal || r.failure === "reset_by_this_request";
  return r.keyed && r.breakerActive && (r.failure === "reset_by_this_request" || r.failure === "network");
}

export function hasIdempotencyKey(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  try {
    return new Headers(headers).has(IDEMPOTENCY_HEADER);
  } catch {
    return false;
  }
}

/** A fresh one-time key (UUID; a random fallback where crypto.randomUUID is missing). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const r = () => Math.random().toString(36).slice(2, 12);
  return `k-${Date.now().toString(36)}-${r()}${r()}`;
}
```

- [ ] **Step 4: Implement `shared/rollingBudget.ts`:**

```ts
/**
 * "At most `max` events per `windowMs`" — used to cap diagnostic reports (perf.slow_request,
 * perf.stall_reset) so a bad network can't flood the audit log, while the log can never go silent
 * for the rest of a session (the old 200-per-session cap went silent from ~20:00 on 6 Nov 2026).
 */
export interface RollingBudget {
  /** True (and counts it) if another event fits in the window ending at `now`. */
  tryTake(now: number): boolean;
}

export function createRollingBudget(max: number, windowMs: number): RollingBudget {
  let stamps: number[] = [];
  return {
    tryTake(now: number): boolean {
      stamps = stamps.filter((t) => now - t < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(now);
      return true;
    },
  };
}
```

- [ ] **Step 5: Run the test.** Run: `npx tsx scripts/verify-stall-breaker.ts`. Expected: all `PASS`, `RESULT: PASS ✅`.

- [ ] **Step 6: Add it to `test:pure`.** Append ` && tsx scripts/verify-stall-breaker.ts` at the end of the `test:pure` value, after `verify-request-keys.ts`. Run `npm run test:pure`. Expected: exit 0.

- [ ] **Step 7: Commit** `packages/api-client/stallBreaker.ts`, `shared/rollingBudget.ts`, `scripts/verify-stall-breaker.ts` and `package.json` with message `Stall breaker: pure rules + rolling report budget`.

---

### Task 5: `timedFetch` watchdog (`packages/api-client/index.ts`)

**Files:**
- Modify: `packages/api-client/index.ts` (top of file + the "Timed fetch" section, lines 73–168)
- Modify: `client/src/lib/api.ts`
- Create: `scripts/verify-timed-fetch-breaker.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing test** `scripts/verify-timed-fetch-breaker.ts`. It replaces the global `fetch` with a controllable fake and uses tiny timings.

```ts
/**
 * Verifies timedFetch's stall breaker (packages/api-client/index.ts) end to end in Node, with a fake
 * global fetch whose requests can answer, stall (until reset/abort) or fail, and tiny timings.
 * "reset" here rejects every stalled request, like Electron's closeAllConnections does to in-flight
 * HTTP/2 requests. Run: npx tsx scripts/verify-timed-fetch-breaker.ts
 */
import { setApiBaseUrl, setStallBreaker, timedFetch, withIdempotencyKey, stallResetCount, type StallResetInfo } from "../packages/api-client";
import { CONNECTION_DROPPED_MESSAGE, IDEMPOTENCY_HEADER } from "../packages/api-client/stallBreaker";

setApiBaseUrl("http://api.test"); // never touch import.meta.env in Node

type Mode = { kind: "ok"; afterMs: number; status?: number } | { kind: "stall" } | { kind: "network_error" };
interface Call { url: string; method: string; key: string | null }

let calls: Call[] = [];
let n = 0;
let pingMode: Mode = { kind: "ok", afterMs: 0 };
let plan: (nth: number) => Mode = () => ({ kind: "ok", afterMs: 0 });
const stalled = new Set<(e: Error) => void>();
let resetCalls = 0;
const infos: StallResetInfo[] = [];

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const isPing = url.endsWith("/api/ping");
  const mode = isPing ? pingMode : plan(++n);
  if (!isPing) calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), key: new Headers(init?.headers ?? undefined).get(IDEMPOTENCY_HEADER) });
  return new Promise<Response>((resolve, reject) => {
    const fail = (e: Error) => { stalled.delete(fail); reject(e); };
    const signal = init?.signal;
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => fail(new DOMException("Aborted", "AbortError")), { once: true });
    if (mode.kind === "network_error") return fail(new TypeError("Failed to fetch"));
    if (mode.kind === "stall") { stalled.add(fail); return; }
    setTimeout(() => { stalled.delete(fail); resolve(new Response(null, { status: mode.status ?? 200 })); }, mode.afterMs);
  });
}) as typeof fetch;

const TINY = { checkAfterMs: 40, checkTimeoutMs: 40, resetMinGapMs: 0 };
function install(enabled: boolean, timings: Partial<typeof TINY> = TINY) {
  setStallBreaker({
    enabled: () => enabled,
    reset: async () => { resetCalls++; Array.from(stalled).forEach((f) => f(new TypeError("Failed to fetch"))); },
    onReset: (i) => infos.push(i),
    timings,
  });
}
function fresh(p: (nth: number) => Mode, ping: Mode) {
  calls = []; n = 0; resetCalls = 0; infos.length = 0; stalled.clear(); plan = p; pingMode = ping;
}
const keyedPost = () => withIdempotencyKey({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const checks: Array<[string, boolean]> = [];
const t = () => performance.now();

async function main() {
  // A. Breaker disabled → unchanged: a fast answer passes, no ping, no reset.
  install(false); fresh(() => ({ kind: "ok", afterMs: 5 }), { kind: "ok", afterMs: 0 });
  checks.push(["disabled: fast answer passes", (await timedFetch("/api/x", keyedPost())).status === 200 && resetCalls === 0]);

  // K. Breaker disabled → a keyed POST network error is NOT retried (browsers unchanged).
  fresh(() => ({ kind: "network_error" }), { kind: "ok", afterMs: 0 });
  let threw = false;
  try { await timedFetch("/api/x", keyedPost()); } catch { threw = true; }
  checks.push(["disabled: keyed POST network error → thrown, sent once", threw && calls.length === 1]);

  install(true);

  // B. Fast answer → no check, no reset.
  fresh(() => ({ kind: "ok", afterMs: 5 }), { kind: "stall" });
  checks.push(["fast answer: no reset", (await timedFetch("/api/x", keyedPost())).status === 200 && resetCalls === 0 && calls.length === 1]);

  // C. Keyed POST on a dead connection → reset, same-key retry, success.
  fresh((i) => (i === 1 ? { kind: "stall" } : { kind: "ok", afterMs: 5 }), { kind: "stall" });
  let t0 = t();
  const c = await timedFetch("/api/save", keyedPost());
  const cMs = t() - t0;
  checks.push(["dead connection, keyed POST: recovers with 200", c.status === 200]);
  checks.push(["…after exactly one reset", resetCalls === 1]);
  checks.push(["…resent once with the SAME key", calls.length === 2 && !!calls[0].key && calls[0].key === calls[1].key]);
  checks.push(["…detected after check-after + check-timeout (≥ 80 ms, < 400 ms)", cMs >= 80 && cMs < 400]);
  checks.push(["…onReset reports retryOutcome ok", infos.length === 1 && infos[0].retryOutcome === "ok" && infos[0].keyed && infos[0].retryStatus === 200]);

  // D. Slow but alive → check answers → no reset.
  fresh(() => ({ kind: "ok", afterMs: 150 }), { kind: "ok", afterMs: 0 });
  checks.push(["slow but alive: 200, no reset, sent once", (await timedFetch("/api/x", keyedPost())).status === 200 && resetCalls === 0 && calls.length === 1]);

  // E. UNKEYED POST on a dead connection → reset, clear error, NOT resent.
  fresh(() => ({ kind: "stall" }), { kind: "stall" });
  let msg = "";
  try { await timedFetch("/api/x", { method: "POST", body: "{}" }); } catch (e) { msg = (e as Error).message; }
  checks.push(["unkeyed POST: clear 'connection dropped' error", msg === CONNECTION_DROPPED_MESSAGE]);
  checks.push(["…not resent", calls.length === 1 && resetCalls === 1]);
  checks.push(["…reported as not_retried", infos.length === 1 && infos[0].retryOutcome === "not_retried"]);

  // F. GET on a dead connection → reset + retry.
  fresh((i) => (i === 1 ? { kind: "stall" } : { kind: "ok", afterMs: 5 }), { kind: "stall" });
  checks.push(["dead connection, GET: recovers", (await timedFetch("/api/data")).status === 200 && calls.length === 2 && resetCalls === 1]);

  // H. Keyed POST, immediate network error (another request's reset) → resent once with the same key.
  fresh((i) => (i === 1 ? { kind: "network_error" } : { kind: "ok", afterMs: 5 }), { kind: "ok", afterMs: 0 });
  const h = await timedFetch("/api/save", keyedPost());
  checks.push(["keyed POST network error: resent with the same key", h.status === 200 && calls.length === 2 && calls[0].key === calls[1].key && resetCalls === 0]);

  // I. Unkeyed POST network error → original error, not resent.
  fresh(() => ({ kind: "network_error" }), { kind: "ok", afterMs: 0 });
  let iMsg = "";
  try { await timedFetch("/api/x", { method: "POST", body: "{}" }); } catch (e) { iMsg = (e as Error).message; }
  checks.push(["unkeyed POST network error: original error, sent once", iMsg === "Failed to fetch" && calls.length === 1]);

  // J. Caller aborts → not retried.
  fresh(() => ({ kind: "stall" }), { kind: "ok", afterMs: 0 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  let jThrew = false;
  try { await timedFetch("/api/data", { signal: ac.signal }); } catch { jThrew = true; }
  checks.push(["caller abort: thrown, not retried", jThrew && calls.length === 1]);

  // G. Gap: a second dead-connection stall within resetMinGapMs is left alone (keeps waiting).
  install(true, { ...TINY, resetMinGapMs: 10_000 });
  fresh((i) => (i === 1 ? { kind: "stall" } : i === 2 ? { kind: "ok", afterMs: 5 } : { kind: "ok", afterMs: 300 }), { kind: "stall" });
  await timedFetch("/api/save", keyedPost()); // resets once
  t0 = t();
  const g = await timedFetch("/api/save", keyedPost()); // answers at 300 ms; its silent check must NOT reset again
  checks.push(["gap: second stall within 10 s is not reset again", g.status === 200 && resetCalls === 1 && t() - t0 >= 250]);

  // L. Counter
  checks.push(["stallResetCount counts resets", stallResetCount() >= 4]);

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it and watch it fail.** Run: `npx tsx scripts/verify-timed-fetch-breaker.ts`. Expected: it fails because `setStallBreaker` / `withIdempotencyKey` / `stallResetCount` are not exported (SyntaxError / undefined is not a function).

- [ ] **Step 3: Implement it in `packages/api-client/index.ts`.**

  **3a.** Add at the very top of the file, before the `/**` header comment:

```ts
import {
  DEFAULT_STALL_TIMINGS,
  CONNECTION_DROPPED_MESSAGE,
  IDEMPOTENCY_HEADER,
  decideAfterCheck,
  shouldRetry,
  hasIdempotencyKey,
  newIdempotencyKey,
  type StallTimings,
  type CheckOutcome,
  type FailureKind,
} from "./stallBreaker";

export {
  DEFAULT_STALL_TIMINGS,
  CONNECTION_DROPPED_MESSAGE,
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  newIdempotencyKey,
  type StallTimings,
} from "./stallBreaker";
```

  **3b.** Replace the whole block from the comment line `// Every API call goes through timedFetch: it measures the time to response headers, reads the server's` down to the closing `}` of `export async function timedFetch` (just before `export async function apiFetch(`) with the code below. It keeps `GET_TIMEOUT_MS`, `RequestTiming`, `setRequestObserver`, `recentRequestTimings`, `notify` and `now` unchanged, and adds the breaker:

```ts
// Every API call goes through timedFetch: it measures the time to response headers, reads the server's
// `Server-Timing` header (see shared/requestTiming.ts) and hands both to an observer, so a slow request
// can say whether the time went to our handler, a cold start, or the network. Read-only requests
// (GET/HEAD) that get no response headers within GET_TIMEOUT_MS are aborted and retried once — a
// stalled connection otherwise waits as long as the network does. Writes are retried only when they
// carry a one-time key (Idempotency-Key, server/requestKeys.ts replays a repeat) AND the desktop stall
// breaker is active (see ./stallBreaker.ts and the StallBreaker section below).

/** Kept in sync with shared/requestTiming.ts (this package is client-only and has no @shared alias). */
export const GET_TIMEOUT_MS = 8_000;

export interface RequestTiming {
  method: string;
  url: string;
  /** performance.now() when the first attempt started. */
  startedAt: number;
  /** Time to response headers for the attempt that answered (or to the abort). */
  clientMs: number;
  status: number | null;
  serverTiming: string | null;
  /** 1 = first try; 2 = after a timeout/network retry. */
  attempt: number;
  /** No response within GET_TIMEOUT_MS (on the final attempt). */
  timedOut: boolean;
  /** A network error with no response (DNS, offline, connection reset). */
  failed: boolean;
}

type RequestObserver = (t: RequestTiming) => void;
let observer: RequestObserver | null = null;
/** Install the (single) observer — client/src/lib/slowRequest.ts. */
export function setRequestObserver(fn: RequestObserver | null): void {
  observer = fn;
}

const RECENT_MAX = 60;
const recent: RequestTiming[] = [];
/** The last ~60 request timings, oldest first (used to explain a slow Settle). */
export function recentRequestTimings(): readonly RequestTiming[] {
  return recent;
}

function notify(t: RequestTiming): void {
  recent.push(t);
  if (recent.length > RECENT_MAX) recent.shift();
  try {
    observer?.(t);
  } catch {
    /* diagnostics only */
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ── Stall breaker (desktop app only) ─────────────────────────────────────────────────────
// Installed by client/src/lib/stallReset.ts when window.electronAPI.resetConnections exists. While
// installed and enabled, every timedFetch attempt is watched: no response headers after checkAfterMs →
// GET /api/ping on the same connection; ping silent too → reset all connections (Electron
// closeAllConnections — open WebSockets survive), abort, retry once. Spec:
// docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md

export interface StallResetInfo {
  method: string;
  url: string;
  keyed: boolean;
  /** Request start → the moment this request's watchdog reset the connections. */
  detectMs: number;
  /** ok = the retry got response headers; failed = the retry failed too; not_retried = an unkeyed write. */
  retryOutcome: "ok" | "failed" | "not_retried";
  retryStatus: number | null;
  /** Retry start → its response headers (or failure); null when not retried. */
  retryMs: number | null;
}

export interface StallBreaker {
  /** Read per request: false = timedFetch behaves exactly as before (kill switch off). */
  enabled(): boolean;
  /** Close every connection of this app (desktop: session.closeAllConnections via IPC). */
  reset(): Promise<void>;
  /** Diagnostics, called after the retry finished (or was refused). Must not throw. */
  onReset?(info: StallResetInfo): void;
  /** Tests only — production uses DEFAULT_STALL_TIMINGS. */
  timings?: Partial<StallTimings>;
}

let breaker: StallBreaker | null = null;
let lastResetAt: number | null = null;
let resetsSoFar = 0;

/** Installed once by the desktop app (client/src/lib/stallReset.ts); null removes it. */
export function setStallBreaker(b: StallBreaker | null): void {
  breaker = b;
  lastResetAt = null;
}

/** Connection resets so far in this page session (printPerfClient diffs it per tap). */
export function stallResetCount(): number {
  return resetsSoFar;
}

/** Adds a fresh one-time key unless the request already carries one. */
export function withIdempotencyKey(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has(IDEMPOTENCY_HEADER)) headers.set(IDEMPOTENCY_HEADER, newIdempotencyKey());
  return { ...init, headers };
}

/** Is the connection alive? A tiny GET on the same connection pool (credentials: include). */
async function checkConnection(timeoutMs: number): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(apiUrl("/api/ping"), { cache: "no-store", credentials: "include", signal: controller.signal });
    return "answered";
  } catch {
    return "silent";
  } finally {
    clearTimeout(timer);
  }
}

/** Watches one attempt; returns a stop function (call it as soon as the attempt settles). */
function watchAttempt(b: StallBreaker, t: StallTimings, onReset: () => void, abort: () => void): () => void {
  let stopped = false;
  const timer = setTimeout(async () => {
    if (stopped) return;
    const check = await checkConnection(t.checkTimeoutMs);
    if (stopped || decideAfterCheck(check, now(), lastResetAt, t) === "keep_waiting") return;
    lastResetAt = now();
    resetsSoFar++;
    onReset();
    try {
      await b.reset();
    } catch {
      /* the abort below still frees this request */
    }
    abort(); // HTTP/2 requests already failed with the reset; this also covers HTTP/1.1
  }, t.checkAfterMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function reportReset(b: StallBreaker | null, info: StallResetInfo): void {
  try {
    b?.onReset?.(info);
  } catch {
    /* diagnostics only */
  }
}

export async function timedFetch(path: string, init?: RequestInit, opts?: { timeoutMs?: number }): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? GET_TIMEOUT_MS;
  const url = apiUrl(path);
  const method = (init?.method ?? "GET").toUpperCase();
  const readOnly = method === "GET" || method === "HEAD";
  const callerSignal = init?.signal ?? null;
  const readTimeout = readOnly && !callerSignal; // the 8 s read timeout — unchanged
  const keyed = hasIdempotencyKey(init?.headers);
  const b = breaker && breaker.enabled() ? breaker : null;
  const timings: StallTimings = { ...DEFAULT_STALL_TIMINGS, ...(b?.timings ?? {}) };
  const startedAt = now();
  // An object, not a `let`: it is written from the watchdog callback, which TS flow analysis can't see.
  const reset = { at: null as number | null };

  for (let attempt = 1; ; attempt++) {
    const t0 = now();
    const controller = readTimeout || b ? new AbortController() : null;
    let timedOut = false;
    const timer = readTimeout && controller
      ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
      : null;
    // Only the first attempt is watched: a retry that stalls on a brand-new connection is a real outage.
    const stopWatch = b && controller && attempt === 1
      ? watchAttempt(b, timings, () => { reset.at = now(); }, () => controller.abort())
      : null;
    const signal = controller
      ? (callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal)
      : undefined;
    try {
      const res = await fetch(url, {
        ...init,
        credentials: init?.credentials ?? "include",
        ...(signal ? { signal } : {}),
      });
      if (timer) clearTimeout(timer); // the timeout covers waiting for headers, not the body download
      stopWatch?.();
      notify({
        method, url, startedAt, clientMs: Math.round(now() - t0), status: res.status,
        serverTiming: res.headers.get("server-timing"), attempt, timedOut: false, failed: false,
      });
      if (reset.at !== null && attempt > 1) {
        reportReset(b, {
          method, url, keyed, detectMs: Math.round(reset.at - startedAt),
          retryOutcome: "ok", retryStatus: res.status, retryMs: Math.round(now() - t0),
        });
      }
      return res;
    } catch (err) {
      if (timer) clearTimeout(timer);
      stopWatch?.();
      const failure: FailureKind = callerSignal?.aborted
        ? "caller_aborted"
        : attempt === 1 && reset.at !== null
          ? "reset_by_this_request"
          : timedOut
            ? "timeout"
            : "network";
      if (attempt === 1 && shouldRetry({ method, keyed, hasCallerSignal: !!callerSignal, breakerActive: !!b, failure })) {
        continue; // once, on a fresh connection (same headers → same one-time key)
      }
      notify({
        method, url, startedAt, clientMs: Math.round(now() - t0), status: null,
        serverTiming: null, attempt, timedOut, failed: !timedOut,
      });
      if (reset.at !== null) {
        reportReset(b, {
          method, url, keyed, detectMs: Math.round(reset.at - startedAt),
          retryOutcome: attempt > 1 ? "failed" : "not_retried", retryStatus: null,
          retryMs: attempt > 1 ? Math.round(now() - t0) : null,
        });
        if (attempt === 1) throw new Error(CONNECTION_DROPPED_MESSAGE); // an unkeyed write: never resent
      }
      if (timedOut) throw new Error("Request timed out — check the internet connection and try again.");
      throw err;
    }
  }
}
```

  **3c.** In `client/src/lib/api.ts`, replace the export list with:

```ts
export {
  apiUrl,
  apiFetch,
  apiRequest,
  apiJson,
  getApiBaseUrl,
  setApiBaseUrl,
  resetApiBaseUrl,
  apiQueryKey,
  timedFetch,
  setRequestObserver,
  recentRequestTimings,
  GET_TIMEOUT_MS,
  setStallBreaker,
  stallResetCount,
  withIdempotencyKey,
  newIdempotencyKey,
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  CONNECTION_DROPPED_MESSAGE,
  type RequestTiming,
  type StallBreaker,
  type StallResetInfo,
} from "../../../packages/api-client";
```

- [ ] **Step 4: Run the test.** Run: `npx tsx scripts/verify-timed-fetch-breaker.ts`. Expected: all `PASS`, `RESULT: PASS ✅`.

- [ ] **Step 5: Type-check and the full chain.** Append ` && tsx scripts/verify-timed-fetch-breaker.ts` to `test:pure`, then run `npm run check` and `npm run test:pure`. Expected: both pass.

- [ ] **Step 6: Commit** `packages/api-client/index.ts`, `client/src/lib/api.ts`, `scripts/verify-timed-fetch-breaker.ts` and `package.json` with message `timedFetch: desktop stall breaker (check, reset, one keyed retry)`.

---

### Task 6: Electron `resetConnections()` IPC

**Files:**
- Modify: `shared/electron/ipc.ts` (IPC table)
- Modify: `desktop/main.ts` (next to `ipcMain.handle(IPC.APP_VERSION, …)`, line ~490)
- Modify: `desktop/preload.ts` (next to `getVersion`, line ~59)
- Modify: `client/src/types/electron.d.ts`

- [ ] **Step 1: `shared/electron/ipc.ts`.** Replace `  APP_VERSION: "app:version",` with:

```ts
  APP_VERSION: "app:version",
  /** renderer → main: close every connection of this window's session (stall breaker, packages/api-client). */
  NET_RESET_CONNECTIONS: "net:reset-connections",
```

- [ ] **Step 2: `desktop/main.ts`.** Directly after `ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());`, add:

```ts

// Stall breaker (packages/api-client/stallBreaker.ts): the renderer found its API connection dead
// (no answer, and a check request on the same connection silent too). Closing the session's
// connections fails the stuck HTTP/2 request at once so it can be retried on a fresh connection.
// Measured on Electron 33: open WebSockets — Pusher, which carries PRINT_JOB — are NOT closed by this.
ipcMain.handle(IPC.NET_RESET_CONNECTIONS, async (e) => {
  await e.sender.session.closeAllConnections();
});
```

- [ ] **Step 3: `desktop/preload.ts`.** Replace `  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),` with:

```ts
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),

  /** Close every connection of this window's session (stall breaker — see packages/api-client). */
  resetConnections: (): Promise<void> => ipcRenderer.invoke(IPC.NET_RESET_CONNECTIONS),
```

- [ ] **Step 4: `client/src/types/electron.d.ts`.** Replace `  getVersion: () => Promise<string>;` with:

```ts
  getVersion: () => Promise<string>;
  /** Close every connection of this window's session (stall breaker). Missing in desktop builds before it existed. */
  resetConnections?: () => Promise<void>;
```

- [ ] **Step 5: Verify.** Run `npm run check` (expected: pass) and `npm run build:desktop`. Expected: the desktop bundle builds with no error; it writes `desktop/dist/`, which is build output, so don't commit it if it shows in `git status`.

- [ ] **Step 6: Commit** `shared/electron/ipc.ts`, `desktop/main.ts`, `desktop/preload.ts` and `client/src/types/electron.d.ts` with message `Desktop IPC: resetConnections() for the stall breaker`.

---

### Task 7: Install the breaker in the app + stall-reset reporting + slow-request budget

**Files:**
- Create: `client/src/lib/stallReset.ts`
- Modify: `client/src/main.tsx`
- Modify: `client/src/lib/slowRequest.ts`

- [ ] **Step 1: Create `client/src/lib/stallReset.ts`:**

```ts
import { apiUrl, setStallBreaker, type StallResetInfo } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { msSinceLastApiResponse } from "@/lib/connectionKeepAlive";
import { loggablePath } from "@shared/requestTiming";
import { createRollingBudget } from "@shared/rollingBudget";

/**
 * Turns on the stall breaker (packages/api-client/stallBreaker.ts) in the desktop app — only where
 * the desktop shell can close connections (window.electronAPI.resetConnections; browsers and older
 * desktop builds lack it and keep today's behaviour). Admin → Settings → "Fast reconnect"
 * (settings.desktopFastReconnect, default on) is the kill switch, read per request from the cached
 * /api/settings query.
 *
 * Each reset is reported as `perf.stall_reset` (POST /api/perf/stall-reset; scripts/report-latency.ts)
 * — at most 60 per hour. Resets while the window is hidden (minimised: the once-a-minute keep-alive
 * ping often finds a dead connection) are not reported one by one; their count rides on the next
 * visible report as `hiddenResets`.
 */
const budget = createRollingBudget(60, 60 * 60 * 1000);
let hiddenResets = 0;
/** Quiet time on the connection when the reset fired; minus detectMs ≈ quiet time before the request. */
let quietAtResetMs: number | null = null;

export function installStallBreaker(): void {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  const resetConnections = api?.resetConnections;
  if (!resetConnections) return;
  setStallBreaker({
    enabled: () => queryClient.getQueryData<{ desktopFastReconnect?: boolean }>(["/api/settings"])?.desktopFastReconnect !== false,
    reset: async () => {
      quietAtResetMs = msSinceLastApiResponse();
      await resetConnections();
    },
    onReset: report,
  });
}

function report(info: StallResetInfo): void {
  try {
    if (document.visibilityState === "hidden") {
      hiddenResets++;
      return;
    }
    if (!budget.tryTake(Date.now())) return;
    const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
    const idleMs = quietAtResetMs == null ? null : Math.max(0, quietAtResetMs - info.detectMs);
    void fetch(apiUrl("/api/perf/stall-reset"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        method: info.method,
        path: loggablePath(info.url),
        keyed: info.keyed,
        detectMs: info.detectMs,
        retryOutcome: info.retryOutcome,
        retryStatus: info.retryStatus,
        retryMs: info.retryMs,
        idleMs,
        hiddenResets,
        connection: c ? `${c.effectiveType ?? "?"} rtt=${c.rtt ?? "?"} down=${c.downlink ?? "?"}` : null,
      }),
    }).catch(() => {});
    hiddenResets = 0;
  } catch {
    /* diagnostics only */
  }
}
```

- [ ] **Step 2: `client/src/main.tsx`.**
  - Replace the line `import { installSlowRequestReporter } from "./lib/slowRequest";` with:

    ```ts
    import { installSlowRequestReporter } from "./lib/slowRequest";
    import { installStallBreaker } from "./lib/stallReset";
    ```

  - Replace the line `installSlowRequestReporter();` with:

    ```ts
    installSlowRequestReporter();
    // Desktop app only: retry a request stuck on a silently dead connection after ~3 s instead of 10–20 s.
    installStallBreaker();
    ```

- [ ] **Step 3: `client/src/lib/slowRequest.ts`.** Swap the session cap for an hourly budget and skip hidden-window ping reports.
  - Replace

    ```ts
    import { SLOW_REQUEST_MS, parseServerTiming, classifySlowRequest, loggablePath } from "@shared/requestTiming";
    ```

    with

    ```ts
    import { SLOW_REQUEST_MS, parseServerTiming, classifySlowRequest, loggablePath } from "@shared/requestTiming";
    import { createRollingBudget } from "@shared/rollingBudget";
    ```

  - Replace

    ```ts
    const MIN_GAP_MS = 5_000;   // at most one report every 5s (a bad network can make everything slow at once)
    const MAX_PER_SESSION = 200;
    let lastSentAt = 0;
    let sent = 0;
    ```

    with

    ```ts
    const MIN_GAP_MS = 5_000;   // at most one report every 5s (a bad network can make everything slow at once)
    // At most 60 per hour. It was 200 per page session: on 6 Nov 2026 the shop PC used that up by 19:57 on
    // keep-alive pings from its minimised window, and the log was silent for the whole evening service.
    const budget = createRollingBudget(60, 60 * 60 * 1000);
    let lastSentAt = 0;
    ```

  - Replace

    ```ts
      const path = loggablePath(t.url);
      if (path.startsWith("/api/perf/")) return; // never report the reporter
      const nowMs = Date.now();
      if (nowMs - lastSentAt < MIN_GAP_MS || sent >= MAX_PER_SESSION) return;
      lastSentAt = nowMs;
      sent++;
    ```

    with

    ```ts
      const path = loggablePath(t.url);
      if (path.startsWith("/api/perf/")) return; // never report the reporter
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      // A keep-alive ping from a minimised window finding a dead connection is expected and never blocks
      // a tap (the stall breaker heals it). Reporting each one is what used up the old budget.
      if (hidden && path === "/api/ping") return;
      const nowMs = Date.now();
      if (nowMs - lastSentAt < MIN_GAP_MS || !budget.tryTake(nowMs)) return;
      lastSentAt = nowMs;
    ```

- [ ] **Step 4: Verify.** Run `npm run check`. Expected: pass.

- [ ] **Step 5: Commit** `client/src/lib/stallReset.ts`, `client/src/main.tsx` and `client/src/lib/slowRequest.ts` with message `Install the stall breaker in the desktop app; hourly report budget`.

---

### Task 8: Server diagnostics endpoint + slow-print fields + audit labels

**Files:**
- Modify: `server/routes.ts` (slow-print endpoint ~line 318; add stall-reset next to slow-request ~line 349)
- Modify: `client/src/lib/auditFormat.ts`

- [ ] **Step 1: Extra fields on `perf.slow_print`.** In `server/routes.ts`, inside `app.post("/api/perf/slow-print", …)`, replace

```ts
      onlineAtClick: typeof b.onlineAtClick === "boolean" ? b.onlineAtClick : null,
      connection: s(b.connection, 60),
    });
    res.status(204).end();
  });

  // Diagnostic only: any API request that took >= 4s
```

with

```ts
      onlineAtClick: typeof b.onlineAtClick === "boolean" ? b.onlineAtClick : null,
      connection: s(b.connection, 60),
      // Stall-breaker era (Nov 2026): window state, desktop vs browser, connection resets during the
      // tap, and whether the save's answer was replayed from server/requestKeys.ts's store.
      hidden: typeof b.hidden === "boolean" ? b.hidden : null,
      electron: typeof b.electron === "boolean" ? b.electron : null,
      resets: n(b.resets),
      replayed: typeof b.replayed === "boolean" ? b.replayed : null,
    });
    res.status(204).end();
  });

  // Diagnostic only: any API request that took >= 4s
```

- [ ] **Step 2: Add `POST /api/perf/stall-reset`.** Directly before the comment line `  // Pusher private-channel auth — only an authenticated session may subscribe to`, insert:

```ts
  // Diagnostic only: the desktop stall breaker (packages/api-client/stallBreaker.ts) found a dead
  // connection, reset all connections and retried (client/src/lib/stallReset.ts). Read with
  // scripts/report-latency.ts. idleMs ≈ how long the connection had been quiet before the request.
  app.post("/api/perf/stall-reset", requireAuth, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
    const s = (v: unknown, max = 60) => (typeof v === "string" ? v.slice(0, max) : null);
    const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
    await logAudit(req, "perf.stall_reset", "request", null, {
      method: s(b.method, 8),
      path: s(b.path, 120),
      keyed: bool(b.keyed),
      detectMs: n(b.detectMs),
      retryOutcome: s(b.retryOutcome, 12),
      retryStatus: n(b.retryStatus),
      retryMs: n(b.retryMs),
      idleMs: n(b.idleMs),
      hiddenResets: n(b.hiddenResets),
      connection: s(b.connection, 60),
    });
    res.status(204).end();
  });

```

- [ ] **Step 3: Audit label.** In `client/src/lib/auditFormat.ts`, replace

```ts
  "perf.slow_handler":    { label: "Slow Handler",   color: "bg-amber-100 text-amber-800" },
```

with

```ts
  "perf.slow_handler":    { label: "Slow Handler",   color: "bg-amber-100 text-amber-800" },
  // The desktop stall breaker reset a dead connection and retried (POST /api/perf/stall-reset).
  "perf.stall_reset":     { label: "Connection Reset", color: "bg-amber-100 text-amber-800" },
```

- [ ] **Step 4: Summaries.** In the `metaSummary` function in the same file:
  - Replace

    ```ts
        const net = meta.onlineAtClick === false ? " · browser was OFFLINE at click" : "";
        return `${String(meta.kind ?? "print").toUpperCase()} tap took ${secs(meta.totalMs)}${split}${idle}${net}`;
      }
    ```

    with

    ```ts
        const net = meta.onlineAtClick === false ? " · browser was OFFLINE at click" : "";
        const resets = Number(meta.resets) > 0 ? ` · ${meta.resets} connection reset${Number(meta.resets) > 1 ? "s" : ""}` : "";
        const replayed = meta.replayed === true ? " · answer replayed" : "";
        return `${String(meta.kind ?? "print").toUpperCase()} tap took ${secs(meta.totalMs)}${split}${idle}${net}${resets}${replayed}`;
      }
      if (action === "perf.stall_reset") {
        const secs = (ms: unknown) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "?");
        const outcome =
          meta.retryOutcome === "ok" ? `retry ok in ${secs(meta.retryMs)}`
          : meta.retryOutcome === "not_retried" ? "not retried (write without a key)"
          : `retry failed after ${secs(meta.retryMs)}`;
        const idle = typeof meta.idleMs === "number" ? ` · connection quiet ~${secs(meta.idleMs)} before` : "";
        const hidden = Number(meta.hiddenResets) > 0 ? ` · +${meta.hiddenResets} while minimised` : "";
        return `${meta.method} ${meta.path}: dead connection reset after ${secs(meta.detectMs)}, ${outcome}${idle}${hidden}`;
      }
    ```

- [ ] **Step 5: Verify.** Run `npm run check`. Expected: pass.

- [ ] **Step 6: Commit** `server/routes.ts` and `client/src/lib/auditFormat.ts` with message `perf.stall_reset audit action; slow-print reset/replay fields`.

---

### Task 9: `perf.slow_print` gets hidden / electron / resets / replayed

**Files:**
- Modify: `client/src/lib/printPerfClient.ts` (whole file shown)

- [ ] **Step 1: Replace the whole file** with:

```ts
import { createStageTimer, SLOW_PRINT_TAP_MS, type StageTimer } from "@shared/printPerf";
import { parseServerTimingStages } from "@shared/requestTiming";
import { timedFetch, stallResetCount, REPLAYED_HEADER } from "@/lib/api";
import { msSinceLastApiResponse } from "@/lib/connectionKeepAlive";

/**
 * POS tap → printed-response marks. One tap at a time (a POS has one cart). Logs a single
 * `[print-perf]` console line per tap so real-use numbers (Vercel, Electron host) can be read
 * from DevTools without any test data, and reports a tap that took >= SLOW_PRINT_TAP_MS to the
 * audit trail (`perf.slow_print`) with enough to tell WHERE the time went: the request's own time
 * vs the server's (Server-Timing), how long the connection had been quiet before the tap, how many
 * times the stall breaker reset the connection during it, and whether the answer was a replay.
 * Never throws, never affects the print flow.
 */
let current: {
  kind: string;
  timer: StageTimer;
  idleMs: number | null;
  online: boolean;
  serverTiming: string | null;
  resetsAtStart: number;
  replayed: boolean;
} | null = null;

export function startPrintTap(kind: string): void {
  current = {
    kind,
    timer: createStageTimer(),
    idleMs: msSinceLastApiResponse(),
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    serverTiming: null,
    resetsAtStart: stallResetCount(),
    replayed: false,
  };
}

export function timePrintStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return current ? current.timer.time(name, fn) : fn();
}

/** Keeps the save response's Server-Timing (the server's own stage breakdown) and replay flag for the report. */
export function notePrintResponse(res: Response): void {
  try {
    if (current) {
      current.serverTiming = res.headers.get("Server-Timing");
      current.replayed = res.headers.get(REPLAYED_HEADER) === "true";
    }
  } catch {
    /* diagnostics only */
  }
}

export function endPrintTap(orderId?: number): void {
  if (!current) return;
  const tap = current;
  current = null;
  try {
    console.log(tap.timer.toLogLine(`tap:${tap.kind}`));
    const totalMs = tap.timer.totalMs();
    if (totalMs < SLOW_PRINT_TAP_MS) return;
    const server = parseServerTimingStages(tap.serverTiming);
    const c = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
    // timedFetch like every API call (lib/slowRequest.ts never reports /api/perf/*, so no loop).
    void timedFetch("/api/perf/slow-print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true, // survives the navigate("/tables") that follows Save & Print
      body: JSON.stringify({
        orderId: orderId ?? null,
        kind: tap.kind,
        totalMs,
        stages: tap.timer.stages(),
        server: server.dur,
        instance: server.inst,
        idleMs: tap.idleMs,
        onlineAtClick: tap.online,
        connection: c ? `${c.effectiveType ?? "?"} rtt=${c.rtt ?? "?"} down=${c.downlink ?? "?"}` : null,
        hidden: typeof document !== "undefined" ? document.visibilityState === "hidden" : null,
        electron: typeof window !== "undefined" ? !!window.electronAPI?.isElectron : null,
        resets: stallResetCount() - tap.resetsAtStart,
        replayed: tap.replayed,
      }),
    }).catch(() => {});
  } catch {
    /* diagnostics only */
  }
}
```

- [ ] **Step 2: Verify.** Run `npm run check`. Expected: pass.

- [ ] **Step 3: Commit** `client/src/lib/printPerfClient.ts` with message `Slow-print report: window state, desktop flag, resets, replay`.

---

### Task 10: Send one-time keys from every caller of the six routes

**Files:**
- Modify: `client/src/lib/queryClient.ts` (`apiRequest`, lines 15–30 + the import on line 3)
- Modify: `client/src/pages/POS.tsx` (lines 1, 366, 889–909, 971, 1044–1050, 1057, 1140, 1153–1170)
- Modify: `client/src/components/NewOrderModal.tsx:92`
- Modify: `client/src/pages/Billing.tsx` (lines 2, 176, 181, 233, 390)
- Modify: `client/src/pages/Orders.tsx` (lines 1, 126)
- Modify: `client/src/pages/KOT.tsx` (lines 1, 50)
- Modify: `client/src/lib/printGateway.ts` (lines 2, 175)
- Modify: `client/src/lib/printStationCore.ts` (lines 1, 195)

- [ ] **Step 1: `apiRequest` option** in `client/src/lib/queryClient.ts`.
  - Replace `import { timedFetch } from "./api";` with `import { timedFetch, IDEMPOTENCY_HEADER, newIdempotencyKey } from "./api";`
  - Replace the whole `export async function apiRequest(…) { … }` with:

```ts
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  opts?: { idempotent?: boolean },
): Promise<Response> {
  // timedFetch: timed + reported when slow (lib/slowRequest.ts). A write is resent (once, by the
  // desktop stall breaker) only when it carries a one-time key — opts.idempotent, used on the six
  // routes server/requestKeys.ts protects. One call = one key; a new tap makes a new call.
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  if (opts?.idempotent) headers[IDEMPOTENCY_HEADER] = newIdempotencyKey();
  const res = await timedFetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}
```

- [ ] **Step 2: POS.tsx keyed calls.**
  - Line 1: replace `import { apiUrl } from '@/lib/api';` with `import { apiUrl, timedFetch, withIdempotencyKey } from '@/lib/api';`
  - `saveCartBeforeOrderAction`: replace

    ```ts
            cancelledKotItems: buildCancelledKotItemsPayload(),
          });
          queryClient.invalidateQueries({ queryKey: ["/api/orders", String(activeOrderId)] });
          return true;
    ```

    with

    ```ts
            cancelledKotItems: buildCancelledKotItemsPayload(),
          }, { idempotent: true });
          queryClient.invalidateQueries({ queryKey: ["/api/orders", String(activeOrderId)] });
          return true;
    ```

  - Auto-KOT: replace

    ```ts
            const res = await fetch(apiUrl(`/api/orders/${activeOrderId}/items`), {
              method: 'PUT',
    ```

    with

    ```ts
            // timedFetch + one-time key: covered by the desktop stall breaker, and a resend can't double-save.
            const res = await timedFetch(`/api/orders/${activeOrderId}/items`, withIdempotencyKey({
              method: 'PUT',
    ```

    then replace

    ```ts
              credentials: 'include',
            });
            if (!res.ok) return;
            const saved = await res.json();
    ```

    with

    ```ts
              credentials: 'include',
            }));
            if (!res.ok) return;
            const saved = await res.json();
    ```

  - Create: replace `const res = await timePrintStage("save_http", () => apiRequest("POST", "/api/orders", data));` with `const res = await timePrintStage("save_http", () => apiRequest("POST", "/api/orders", data, { idempotent: true }));`
  - Update: replace ``const res = await timePrintStage("save_http", () => apiRequest("PUT", `/api/orders/${data.orderId}/items`, data));`` with ``const res = await timePrintStage("save_http", () => apiRequest("PUT", `/api/orders/${data.orderId}/items`, data, { idempotent: true }));``
  - Settle: replace ``const res = await apiRequest("POST", `/api/orders/${orderId}/payment`, body);`` with ``const res = await apiRequest("POST", `/api/orders/${orderId}/payment`, body, { idempotent: true });``

- [ ] **Step 3: POS.tsx error handling for the new 409 codes.**
  - In `createOrderMutation`, replace

    ```ts
        onError: (error: any) => {
          if (submitModeRef.current === "settle") finishSettleTiming(0, "error");
          toast({ title: "Failed to place order", description: describeApiError(error).message, variant: "destructive" });
    ```

    with

    ```ts
        onError: (error: any) => {
          if (submitModeRef.current === "settle") finishSettleTiming(0, "error");
          const info = describeApiError(error);
          // request_in_progress / replay_unavailable (server/requestKeys.ts): the order may exist already —
          // refresh so staff see it before tapping again.
          if (info.code === "request_in_progress" || info.code === "replay_unavailable") {
            queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
          }
          toast({ title: "Failed to place order", description: info.message, variant: "destructive" });
    ```

  - In `settleMutation`, replace the whole `onError` body:

    ```ts
        onError: (error: any, vars: any) => {
          finishSettleTiming(Number(vars?.orderId), "error");
          setSettlePhase("idle");
          // apiRequest() throws `${status}: ${rawBodyText}` — for our JSON error
          // responses that body is `{"error": "..."}`; pull the message back out so
          // an already-settled order shows its actual cause, not a raw status dump.
          let description = error.message || "Something went wrong";
          const jsonStart = description.indexOf("{");
          if (jsonStart !== -1) {
            try {
              const parsed = JSON.parse(description.slice(jsonStart));
              if (parsed?.error) description = parsed.error;
            } catch {
              /* leave the raw message as-is */
            }
          }
          toast({ title: "Settlement failed", description, variant: "destructive" });
        },
    ```

    with

    ```ts
        onError: (error: any, vars: any) => {
          finishSettleTiming(Number(vars?.orderId), "error");
          setSettlePhase("idle");
          // describeApiError reads both {"error"} and {"message"} bodies (the hand-rolled parse here read
          // only "error", so a {"message"} answer showed as a raw "409: {…}" dump).
          const info = describeApiError(error);
          if (info.code === "request_in_progress" || info.code === "replay_unavailable" || info.status === 409) {
            queryClient.invalidateQueries({ queryKey: ["/api/orders", String(vars?.orderId)] });
            queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
          }
          toast({ title: "Settlement failed", description: info.message || "Something went wrong", variant: "destructive" });
        },
    ```

  - `updateOrderMutation.onError` already refreshes on any 409 and shows `describeApiError(...).message`. No change.

- [ ] **Step 4: NewOrderModal.tsx.** Replace `return await apiRequest("POST", "/api/orders", orderData);` with `return await apiRequest("POST", "/api/orders", orderData, { idempotent: true });`

- [ ] **Step 5: Billing.tsx.**
  - Line 2: replace `import { apiUrl, apiJson } from '@/lib/api';` with `import { apiUrl, apiJson, timedFetch, withIdempotencyKey } from '@/lib/api';`
  - Payment: replace ``apiRequest("POST", `/api/orders/${id}/payment`, { paymentMethod: method }),`` with ``apiRequest("POST", `/api/orders/${id}/payment`, { paymentMethod: method }, { idempotent: true }),``
  - **Bill print after "Mark as Paid" (line ~181).** Replace

    ```ts
          fetch(apiUrl('/api/print/bill'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: vars.id }),
            credentials: 'include',
          })
    ```

    with

    ```ts
          timedFetch('/api/print/bill', withIdempotencyKey({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: vars.id }),
            credentials: 'include',
          }))
    ```

  - **`fetchAndPrint` (line ~233).** Replace

    ```ts
          const res = await fetch(apiUrl('/api/print/bill'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id }),
            credentials: 'include',
          });
    ```

    with

    ```ts
          const res = await timedFetch('/api/print/bill', withIdempotencyKey({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id }),
            credentials: 'include',
          }));
    ```

  - **Bill print after a Razorpay payment (line ~390).** Billing's Razorpay flow is out of scope; only this bill-print call changes. Replace

    ```ts
                  fetch(apiUrl('/api/print/bill'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: payingOrder.id }),
                    credentials: 'include',
                  })
    ```

    with

    ```ts
                  timedFetch('/api/print/bill', withIdempotencyKey({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: payingOrder.id }),
                    credentials: 'include',
                  }))
    ```

- [ ] **Step 6: Orders.tsx** (`reprintBill`).
  - Line 1: replace `import { apiUrl, apiJson } from '@/lib/api';` with `import { apiUrl, apiJson, timedFetch, withIdempotencyKey } from '@/lib/api';`
  - Replace

    ```ts
          const res = await fetch(apiUrl('/api/print/bill'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id }),
            credentials: 'include',
          });
          const data = await res.json().catch(() => ({} as any));
    ```

    with

    ```ts
          const res = await timedFetch('/api/print/bill', withIdempotencyKey({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id }),
            credentials: 'include',
          }));
          const data = await res.json().catch(() => ({} as any));
    ```

- [ ] **Step 7: KOT.tsx** (`reprintKOT`).
  - Line 1: replace `import { apiUrl, apiJson } from '@/lib/api';` with `import { apiUrl, apiJson, timedFetch, withIdempotencyKey } from '@/lib/api';`
  - Replace

    ```ts
          const res = await fetch(apiUrl('/api/print/kot'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: ticket.orderId, reprint: true }),
            credentials: 'include',
          });
    ```

    with

    ```ts
          const res = await timedFetch('/api/print/kot', withIdempotencyKey({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: ticket.orderId, reprint: true }),
            credentials: 'include',
          }));
    ```

- [ ] **Step 8: printGateway.ts** (`printBillDirect`, used by the Tables-card print).
  - Line 2: replace `import { apiUrl } from "@/lib/api";` with `import { apiUrl, timedFetch, withIdempotencyKey } from "@/lib/api";`
  - Replace

    ```ts
      const res = await fetch(apiUrl("/api/print/bill"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, ...(markBilled ? { markBilled } : {}) }),
        credentials: "include",
      });
    ```

    with

    ```ts
      const res = await timedFetch("/api/print/bill", withIdempotencyKey({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, ...(markBilled ? { markBilled } : {}) }),
        credentials: "include",
      }));
    ```

- [ ] **Step 9: printStationCore.ts** (`claimJob`, which the shop PC uses to take a phone's job).
  - Line 1: replace `import { apiUrl } from "@/lib/api";` with `import { apiUrl, timedFetch, withIdempotencyKey } from "@/lib/api";`
  - Replace

    ```ts
        const res = await fetch(apiUrl(`/api/print/jobs/${jobId}/claim`), {
          method: "POST",
          credentials: "include",
        });
    ```

    with

    ```ts
        // One-time key: a claim whose answer got lost would otherwise answer {claimed:false} on a resend
        // and strand the job for the 2-minute stale-claim window.
        const res = await timedFetch(`/api/print/jobs/${jobId}/claim`, withIdempotencyKey({
          method: "POST",
          credentials: "include",
        }));
    ```

- [ ] **Step 10: Check that no unkeyed raw `fetch` to these routes is left.** Run:

  ```bash
  git grep -nE "fetch\(apiUrl\(.*(/api/print/(kot|bill)|/claim|/items|/payment)" -- client/src
  ```

  - **Before this task:** 9 matches (printGateway, printStationCore, Billing ×3, KOT, Orders, POS ×2).
  - **Expected now:** exactly one, `client/src/pages/POS.tsx: … const legacy = await fetch(apiUrl('/api/print/kot'), {`. That is the Auto-KOT release-skew fallback, which only runs against an old server that ignores keys anyway.
  - Any other match is a missed conversion.

- [ ] **Step 11: Verify.** Run `npm run check` and `npm run test:pure`. Expected: both pass.

- [ ] **Step 12: Commit** all eight client files with message `Send one-time keys on save/settle/print/claim; handle request_in_progress`.

---

### Task 11: Kill switch (`desktopFastReconnect`)

**Files:**
- Modify: `server/settingsStore.ts` (interface ~line 97–123, defaults ~line 170–197)
- Modify: `client/src/pages/Settings.tsx` (interface ~line 27–41, `RestaurantConfigPanel` ~line 476, defaults ~line 895–904)

- [ ] **Step 1: Server setting.** In `server/settingsStore.ts`:
  - Replace

    ```ts
      /** Quick-POS sections (e.g. South Indian counter) — filtered menu + optional dedicated bill printer. */
      posSections: PosSection[];
    }
    ```

    with

    ```ts
      /** Quick-POS sections (e.g. South Indian counter) — filtered menu + optional dedicated bill printer. */
      posSections: PosSection[];
      /** Desktop app "Fast reconnect" — the stall breaker (packages/api-client/stallBreaker.ts). On by default; Admin kill switch. */
      desktopFastReconnect: boolean;
    }
    ```

  - Replace

    ```ts
      attendanceDevice: DEFAULT_ATTENDANCE_DEVICE,
      posSections: [],
    };
    ```

    with

    ```ts
      attendanceDevice: DEFAULT_ATTENDANCE_DEVICE,
      posSections: [],
      desktopFastReconnect: true,
    };
    ```

  `buildSettings` spreads `DEFAULT_SETTINGS` under the saved blob, so no migration is needed.

- [ ] **Step 2: Settings page.** In `client/src/pages/Settings.tsx`:
  - In `interface RestaurantSettings`, replace `  posRoleTimeout: number;\n}` (the first occurrence, which closes that interface) with:

    ```ts
      posRoleTimeout: number;
      desktopFastReconnect: boolean;
    }
    ```

  - In the `useState<RestaurantSettings>` default, replace `    posRoleTimeout: 2,\n  });` with:

    ```ts
        posRoleTimeout: 2,
        desktopFastReconnect: true,
      });
    ```

  - In `RestaurantConfigPanel`, replace

    ```tsx
          {/* Save */}
          <div className="pt-2">
            <button
              onClick={onSave}
    ```

    with

    ```tsx
          <Separator />

          {/* Desktop app */}
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Monitor className="w-4 h-4 text-emerald-600" />
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Desktop App</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm text-gray-700">Fast reconnect</Label>
                <p className="text-xs text-gray-500">
                  When the shop PC's internet connection silently drops, retry a KOT, Bill or Settle on a fresh
                  connection after about 3 seconds instead of waiting 10–20. Leave on; turn off only if the
                  desktop app misbehaves.
                </p>
              </div>
              <Switch
                checked={formData.desktopFastReconnect !== false}
                onCheckedChange={(v) => set("desktopFastReconnect", v)}
              />
            </div>
          </div>

          {/* Save */}
          <div className="pt-2">
            <button
              onClick={onSave}
    ```

  `Monitor`, `Label`, `Switch` and `Separator` are already imported in this file. `handleSave` sends only changed fields.

- [ ] **Step 3: Verify.** Run `npm run check`. Expected: pass.

- [ ] **Step 4: Commit** `server/settingsStore.ts` and `client/src/pages/Settings.tsx` with message `Admin kill switch: Settings → Fast reconnect (desktop)`.

---

### Task 12: Latency report (fix IST day + resets + slow prints)

**Files:**
- Modify: `scripts/report-latency.ts`

- [ ] **Step 1: Fix the IST day.** The columns are naive UTC; `created_at at time zone 'Asia/Kolkata'` shifts the wrong way.
  - Line 37. Replace

    ```ts
      const day = `to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
    ```

    with

    ```ts
      // created_at is naive UTC: IST = + 5:30 (`at time zone 'Asia/Kolkata'` on a naive column shifts the WRONG way).
      const day = `to_char(created_at + interval '5 hours 30 minutes', 'YYYY-MM-DD')`;
    ```

  - Line 86. Replace

    ```ts
        select to_char(created_at at time zone 'Asia/Kolkata','MM-DD HH24:MI') t, metadata::jsonb m from audit_logs
    ```

    with

    ```ts
        select to_char(created_at + interval '5 hours 30 minutes','MM-DD HH24:MI') t, metadata::jsonb m from audit_logs
    ```

- [ ] **Step 2: Add stall resets and slow prints to the per-day query.**
  - Replace

    ```ts
        with a as (select ${day} d, action, metadata::jsonb m from audit_logs
                   where created_at > ${since} and action in ('order.payment','perf.slow_settle','perf.slow_request','perf.slow_handler'))
    ```

    with

    ```ts
        with a as (select ${day} d, action, metadata::jsonb m from audit_logs
                   where created_at > ${since} and action in ('order.payment','perf.slow_settle','perf.slow_request','perf.slow_handler','perf.slow_print','perf.stall_reset'))
    ```

  - Replace

    ```ts
          count(*) filter (where action='perf.slow_handler') slow_handler
        from a group by d order by d`);
    ```

    with

    ```ts
          count(*) filter (where action='perf.slow_handler') slow_handler,
          count(*) filter (where action='perf.slow_print') slow_prints,
          count(*) filter (where action='perf.stall_reset') resets,
          percentile_cont(0.5) within group (order by (m->>'detectMs')::int + coalesce((m->>'retryMs')::int, 0))
            filter (where action='perf.stall_reset') reset_p50
        from a group by d order by d`);
    ```

  - Replace the header line `  console.log("date        settles  slow(>=4s)  rate  slow p50 | slow requests: total net cold srv tmo retried | slow handlers | print n  p50   p90");` with:

    ```ts
      console.log("date        settles  slow(>=4s)  rate  slow p50 | slow requests: total net cold srv tmo retried | slow handlers | slow prints | resets  recover p50 | print n  p50   p90");
    ```

  - In the row template, replace

    ```ts
          `${String(r.slow_handler).padStart(14)} | ${String(p?.n ?? 0).padStart(7)} ${s(p?.p50).padStart(5)} ${s(p?.p90).padStart(5)}`,
    ```

    with

    ```ts
          `${String(r.slow_handler).padStart(14)} | ${String(r.slow_prints).padStart(11)} | ${String(r.resets).padStart(6)}  ${s(r.reset_p50).padStart(11)} | ${String(p?.n ?? 0).padStart(7)} ${s(p?.p50).padStart(5)} ${s(p?.p90).padStart(5)}`,
    ```

- [ ] **Step 3: Run it (read-only).** Run: `npx tsx -r dotenv/config scripts/report-latency.ts --days 5`

  Expected:
  - a table with dates up to today, `slow prints` = 8 on 2026-11-06 and `resets` = 0 (nothing reports resets yet)
  - no SQL error
  - the script sets `default_transaction_read_only`, so it cannot write

- [ ] **Step 4: Commit** `scripts/report-latency.ts` with message `report-latency: IST day fix, slow prints, stall resets`.

---

### Task 13: Electron end-to-end check of the real breaker (manual script)

**Files:**
- Create: `scripts/lib/stall-breaker-page.ts`
- Create: `scripts/verify-stall-breaker-electron.cjs`

- [ ] **Step 1: Create the page entry `scripts/lib/stall-breaker-page.ts`.** It is bundled by esbuild into the test window and runs the REAL `timedFetch` breaker:

```ts
/**
 * Page script for scripts/verify-stall-breaker-electron.cjs — runs the REAL timedFetch stall breaker
 * (packages/api-client) in an Electron window. Bundled with esbuild at test time; not part of the app.
 */
import { setApiBaseUrl, setStallBreaker, timedFetch, withIdempotencyKey, stallResetCount, type StallResetInfo } from "../../packages/api-client";

type Win = Window & {
  electronAPI?: { resetConnections?: () => Promise<void> };
  __PUSHER__?: { key: string; cluster: string } | null;
  runCase?: (name: string) => Promise<Record<string, unknown>>;
  pusherState?: () => Promise<string>;
};
const w = window as Win;
const resets: StallResetInfo[] = [];

setApiBaseUrl(""); // same origin: the test page is served by the test server
setStallBreaker({
  enabled: () => true,
  reset: () => w.electronAPI!.resetConnections!(),
  onReset: (i) => resets.push(i),
  // Production check timings; no minimum gap so consecutive cases can each reset (the gap is unit-tested).
  timings: { resetMinGapMs: 0 },
});

let pusher: WebSocket | null = null;
let pong = false;
if (w.__PUSHER__) {
  pusher = new WebSocket(`wss://ws-${w.__PUSHER__.cluster}.pusher.com/app/${w.__PUSHER__.key}?protocol=7&client=js&version=8.4.0&flash=false`);
  pusher.onmessage = (e) => {
    try { if (JSON.parse(String(e.data)).event === "pusher:pong") pong = true; } catch { /* ignore */ }
  };
}

const json = { "Content-Type": "application/json" };
w.runCase = async (name: string) => {
  const t0 = performance.now();
  const before = stallResetCount();
  const ms = () => Math.round(performance.now() - t0);
  try {
    let status = 0;
    if (name === "warm" || name === "get") status = (await timedFetch("/api/data")).status;
    if (name === "keyed") status = (await timedFetch("/api/save", withIdempotencyKey({ method: "POST", headers: json, body: "{}" }))).status;
    if (name === "unkeyed") status = (await timedFetch("/api/save", { method: "POST", headers: json, body: "{}" })).status;
    if (name === "slow") status = (await timedFetch("/api/slow")).status;
    return { ok: true, status, ms: ms(), resets: stallResetCount() - before, last: resets[resets.length - 1] ?? null };
  } catch (e) {
    return { ok: false, error: String((e as Error).message), ms: ms(), resets: stallResetCount() - before };
  }
};
w.pusherState = async () => {
  if (!pusher) return "skipped (no VITE_PUSHER_KEY / VITE_PUSHER_CLUSTER in .env)";
  if (pusher.readyState !== WebSocket.OPEN) return `NOT OPEN (readyState ${pusher.readyState})`;
  pong = false;
  pusher.send(JSON.stringify({ event: "pusher:ping", data: {} }));
  for (let i = 0; i < 30 && !pong; i++) await new Promise((r) => setTimeout(r, 100));
  return pong ? "OPEN + pong" : "OPEN but no pong";
};
```

- [ ] **Step 2: Create `scripts/verify-stall-breaker-electron.cjs`:**

```js
/**
 * Manual check (Windows, Git Bash): the REAL timedFetch stall breaker in a REAL Electron 33 window
 * against a local HTTP/2 server behind a TCP proxy that can silently blackhole established connections
 * (no bytes, no close — the shop's dead-connection case), plus a real Pusher WebSocket.
 *
 * Run from the repo root (needs openssl on PATH — Git Bash has it):
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/verify-stall-breaker-electron.cjs
 * (VS Code's terminal sets ELECTRON_RUN_AS_NODE=1, which turns Electron into plain Node.)
 * Pass = every line PASS and "RESULT: PASS". Touches no database.
 */
const { app, BrowserWindow, ipcMain, session } = require("electron");
const http2 = require("http2");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");
require("dotenv").config({ quiet: true });

const ROOT = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "stall-breaker-"));

// Throwaway self-signed cert, trusted for 127.0.0.1 only (setCertificateVerifyProc below).
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", path.join(TMP, "key.pem"), "-out", path.join(TMP, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"],
  { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });

const bundle = esbuild.buildSync({
  entryPoints: [path.join(ROOT, "scripts/lib/stall-breaker-page.ts")],
  bundle: true, format: "iife", platform: "browser", target: "chrome120", write: false,
  define: { "import.meta.env.VITE_API_BASE_URL": '""' },
  logLevel: "error",
}).outputFiles[0].text;

const pusherCfg = process.env.VITE_PUSHER_KEY && process.env.VITE_PUSHER_CLUSTER
  ? { key: process.env.VITE_PUSHER_KEY, cluster: process.env.VITE_PUSHER_CLUSTER } : null;
const PAGE = `<!doctype html><meta charset=utf-8><script>window.__PUSHER__=${JSON.stringify(pusherCfg)};</script><script>${bundle}</script>`;

fs.writeFileSync(path.join(TMP, "preload.cjs"),
  `const { contextBridge, ipcRenderer } = require("electron");
   contextBridge.exposeInMainWorld("electronAPI", { isElectron: true, resetConnections: () => ipcRenderer.invoke("net:reset-connections") });`);

// ── HTTP/2 server ──
const seen = { keyed: new Map(), unkeyed: 0 };
const h2 = http2.createSecureServer({ key: fs.readFileSync(path.join(TMP, "key.pem")), cert: fs.readFileSync(path.join(TMP, "cert.pem")) });
h2.on("stream", (stream, headers) => {
  stream.resume();
  const p = String(headers[":path"]).split("?")[0];
  const json = (body, status = 200) => { stream.respond({ ":status": status, "content-type": "application/json" }); stream.end(JSON.stringify(body)); };
  if (p === "/") { stream.respond({ ":status": 200, "content-type": "text/html" }); return stream.end(PAGE); }
  if (p === "/api/ping") { stream.respond({ ":status": 204 }); return stream.end(); }
  if (p === "/api/data") return json({ ok: true });
  if (p === "/api/save") {
    const key = headers["idempotency-key"];
    if (key) seen.keyed.set(key, (seen.keyed.get(key) || 0) + 1); else seen.unkeyed++;
    return json({ ok: true });
  }
  if (p === "/api/slow") return void setTimeout(() => json({ ok: true }), 2500);
  stream.respond({ ":status": 404 }); stream.end();
});

// ── TCP proxy: blackholeExisting() silently stops forwarding on every connection opened so far ──
let connSeq = 0, blackholeUpTo = 0;
const proxy = net.createServer((client) => {
  const id = ++connSeq;
  const upstream = net.connect(h2.address().port, "127.0.0.1");
  const dead = () => id <= blackholeUpTo;
  client.on("data", (d) => { if (!dead()) upstream.write(d); });
  upstream.on("data", (d) => { if (!dead()) client.write(d); });
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
  client.on("error", () => {}); upstream.on("error", () => {});
});
const blackholeExisting = () => { blackholeUpTo = connSeq; };

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  — ${detail}` : ""}`);
};

async function run(win) {
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await exec("new Promise((r) => setTimeout(r, 1500))"); // let Pusher connect

  let r = await exec(`runCase("warm")`);
  check("warm-up request works (HTTP/2 session up)", r.ok && r.status === 200, JSON.stringify(r));

  blackholeExisting();
  r = await exec(`runCase("keyed")`);
  const keyed = Array.from(seen.keyed.values());
  check("keyed save on a dead connection recovers", r.ok && r.status === 200, `${r.ms} ms`);
  check("…within 3.5 s", r.ok && r.ms < 3500, `${r.ms} ms`);
  check("…with exactly one connection reset", r.resets === 1, `resets ${r.resets}`);
  check("…and the server saw it exactly once", keyed.length === 1 && keyed[0] === 1, JSON.stringify(keyed));

  blackholeExisting();
  r = await exec(`runCase("unkeyed")`);
  check("unkeyed save fails with the clear message", !r.ok && /connection dropped/i.test(String(r.error)), r.error);
  check("…and is never resent", seen.unkeyed === 0, `server saw ${seen.unkeyed}`);

  blackholeExisting();
  r = await exec(`runCase("get")`);
  check("GET on a dead connection recovers within 3.5 s", r.ok && r.status === 200 && r.ms < 3500, `${r.ms} ms`);

  r = await exec(`runCase("slow")`);
  check("slow but alive request: no reset", r.ok && r.status === 200 && r.resets === 0, `${r.ms} ms, resets ${r.resets}`);

  const p = await exec("pusherState()");
  check("Pusher WebSocket survives the resets", p === "OPEN + pong" || p.startsWith("skipped"), p);
}

app.whenReady().then(() => {
  session.defaultSession.setCertificateVerifyProc((req, cb) => cb(req.hostname === "127.0.0.1" ? 0 : -3));
  ipcMain.handle("net:reset-connections", (e) => e.sender.session.closeAllConnections());
  h2.listen(0, "127.0.0.1", () => proxy.listen(0, "127.0.0.1", async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(TMP, "preload.cjs"), contextIsolation: true, sandbox: false } });
    const killer = setTimeout(() => { console.log("FAIL  timed out after 60 s"); app.exit(1); }, 60_000);
    try {
      await win.loadURL(`https://127.0.0.1:${proxy.address().port}/`);
      await run(win);
    } catch (e) {
      check("script error", false, e && e.stack ? e.stack : String(e));
    }
    clearTimeout(killer);
    const failed = results.filter((ok) => !ok).length;
    console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    app.exit(failed === 0 ? 0 : 1);
  }));
});
```

- [ ] **Step 3: Run it** from the worktree root, in Git Bash:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/verify-stall-breaker-electron.cjs 2>&1 | grep -E "^(PASS|FAIL|RESULT)"
```

Expected: 10 `PASS` lines, then `RESULT: PASS ✅`. The keyed save should recover in about 3000 ms: a 1500 ms check-after plus a 1500 ms check timeout, plus a few ms locally.

  If `keyed … within 3.5 s` fails at about 3000–3500 ms because the machine is busy, re-run once. If it still fails, report it; do not loosen the threshold silently.

- [ ] **Step 4: Commit** `scripts/lib/stall-breaker-page.ts` and `scripts/verify-stall-breaker-electron.cjs` with message `Electron e2e check: real breaker vs a silent-drop HTTP/2 proxy + Pusher`.

---

### Task 14: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** In `CLAUDE.md`, directly after the bullet that begins `- Locked by \`scripts/verify-request-timing.ts\` and \`scripts/verify-settings-cache.ts\` (in \`test:pure\`).` (end of the "Request latency" section), add:

```markdown

### Stall breaker + one-time request keys (Nov 2026)

The remaining slow KOT/Bill/Settle taps on the shop PC were silently dead connections (Wi-Fi to JioFiber, then Vercel). Chromium waits 10 s before retrying, and longer when the connection was used moments earlier. Spec: `docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md`.

- **Stall breaker (desktop app only)** — `packages/api-client/stallBreaker.ts` (pure rules) + `timedFetch`. Installed by `client/src/lib/stallReset.ts` only when `window.electronAPI.resetConnections` exists.
  - **Detection:** no response headers after 1.5 s → `GET /api/ping` on the same connection. Ping silent for 1.5 s → IPC `net:reset-connections` → `session.closeAllConnections()`, abort, retry once. At most one reset per 10 s.
  - **Retries:** reads always; writes only with an `Idempotency-Key`. An unkeyed write caught in a reset throws `CONNECTION_DROPPED_MESSAGE` and is never resent.
  - **Measured on Electron 33:** open WebSockets (Pusher → `PRINT_JOB`) survive `closeAllConnections`. An in-flight HTTP/2 request fails at once; HTTP/1.1 does not, hence the extra abort.
  - **Kill switch:** Admin → Settings → "Fast reconnect" (`desktopFastReconnect`, default on).
  - **Tests:** `scripts/verify-stall-breaker.ts`, `scripts/verify-timed-fetch-breaker.ts` (test:pure). Manual: `scripts/verify-stall-breaker-electron.cjs` (run with `env -u ELECTRON_RUN_AS_NODE` from VS Code's terminal).
- **One-time request keys** — `server/requestKeys.ts` + `shared/requestKeys.ts`. Mounted after `requireAuth` on `POST /api/orders`, `PUT /api/orders/:id/items`, `POST /api/orders/:id/payment`, `POST /api/print/kot`, `POST /api/print/bill` and `POST /api/print/jobs/:id/claim`.
  - **Claim:** a keyed request claims the key in `request_keys` (`INSERT … ON CONFLICT DO NOTHING`).
  - **Store:** the route's JSON answer is stored before it is sent.
  - **Repeats:** a repeat replays the stored answer (`Idempotent-Replayed: true`); one still running waits up to 8 s, then gets `409 request_in_progress`.
  - **Errors:** mismatch → `422`; no table → pass-through + loud log; any other DB error → `503`.
  - Requests without a key are unchanged.
  - **Every client caller of those routes must send a key:** `apiRequest(…, { idempotent: true })` or `timedFetch(path, withIdempotencyKey(init))`.
  - **Tests:** `scripts/verify-request-keys.ts` (test:pure). Manual, DB: `scripts/verify-request-keys-db.ts`.
- **⚠️ Every new table needs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in its migration.** All `public` tables have RLS on, and this DB's default privileges grant `anon` / `authenticated` full rights on new tables, so a table without RLS is readable and writable through Supabase's REST API with the public anon key. See `scripts/migrate-request-keys.mjs`.
- **Diagnostics:**
  - `perf.stall_reset` (POST `/api/perf/stall-reset`; hidden-window resets ride along as `hiddenResets`)
  - `perf.slow_print` gains `hidden` / `electron` / `resets` / `replayed`
  - `perf.slow_request` is capped at 60/hour instead of 200/session (the old cap silenced the log from ~20:00 on 6 Nov 2026) and skips hidden-window pings
  - `scripts/report-latency.ts` shows resets and slow prints per IST day
```

- [ ] **Step 2: Commit** `CLAUDE.md` with message `CLAUDE.md: stall breaker, one-time keys, RLS for new tables`.

---

### Task 15: Run the migration + DB check of the middleware (ASK THE OWNER FIRST)

This task writes to the shared production database: one additive table, plus throwaway rows that it deletes afterwards. **Stop and ask the owner before Step 2.** If they decline, skip this task. Requests without the table still work: the middleware passes them through and logs.

**This replaces the spec's real-route end-to-end run.** It exercises the same middleware without creating orders, consuming KOT/bill counters or deducting stock. The real routes only add the mount lines from Task 3; `instrumentJson` wraps `res.json` inside the handler, on top of this middleware's wrapper, so both still run. A real-route run (throwaway in-process server, `ZZTEST-…` orders, private Pusher channel; see the memory playbook) stays optional. It needs the owner's OK and a working login.

**Files:**
- Create: `scripts/verify-request-keys-db.ts`

- [ ] **Step 1: Create `scripts/verify-request-keys-db.ts`:**

```ts
/**
 * Manual, touches the shared DB — ONLY the request_keys table, rows keyed "zztest-…", deleted at the end.
 * Runs the real server/requestKeys.ts middleware on a throwaway in-process Express app (no orders,
 * no printing, no realtime). Needs the migration first: node scripts/migrate-request-keys.mjs
 * Run: npx tsx -r dotenv/config scripts/verify-request-keys-db.ts
 */
import express from "express";
import type { AddressInfo } from "net";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { requestKeys } from "../server/requestKeys";

const prefix = `zztest-${Date.now().toString(36)}-`;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).user = { id: Number(req.get("x-test-user") ?? 990001), username: "zztest", role: "staff" };
  next();
});
let runs = 0;
app.post("/api/zz-keyed", requestKeys, async (req, res) => {
  runs++;
  const run = runs;
  await new Promise((r) => setTimeout(r, Number(req.body?.delayMs ?? 0)));
  res.status(Number(req.body?.status ?? 200)).json({ run, echo: req.body?.echo ?? null });
});

const checks: Array<[string, boolean]> = [];

async function main() {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (body: unknown, key?: string, user?: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key !== undefined) headers["Idempotency-Key"] = key;
    if (user !== undefined) headers["x-test-user"] = String(user);
    const r = await fetch(`${base}/api/zz-keyed`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: r.status, replayed: r.headers.get("idempotent-replayed") === "true", body: await r.json() as any };
  };

  try {
    let before = runs;
    await post({ echo: "a" }); await post({ echo: "a" });
    checks.push(["no key: runs every time (unchanged)", runs - before === 2]);

    before = runs;
    const k1 = `${prefix}seq`;
    const s1 = await post({ echo: "x" }, k1);
    const s2 = await post({ echo: "x" }, k1);
    checks.push(["same key twice: route ran once", runs - before === 1]);
    checks.push(["…the repeat is a replay with the same answer", s2.replayed && !s1.replayed && s2.body.run === s1.body.run && s2.status === 200]);

    before = runs;
    const k2 = `${prefix}conc`;
    const [c1, c2] = await Promise.all([post({ echo: "c", delayMs: 600 }, k2), post({ echo: "c", delayMs: 600 }, k2)]);
    checks.push(["same key at the same time: route ran once", runs - before === 1]);
    checks.push(["…both got the same answer, exactly one replayed", c1.body.run === c2.body.run && (c1.replayed !== c2.replayed)]);

    const m1 = await post({ echo: "DIFFERENT" }, k1);
    checks.push(["same key, different body → 422 mismatch", m1.status === 422 && m1.body.code === "idempotency_key_mismatch"]);
    const m2 = await post({ echo: "x" }, k1, 990002);
    checks.push(["same key, different user → 422 mismatch", m2.status === 422]);

    const bad = await post({ echo: "x" }, "bad key!");
    checks.push(["malformed key → 400", bad.status === 400 && bad.body.code === "bad_idempotency_key"]);

    before = runs;
    const k3 = `${prefix}err`;
    const e1 = await post({ status: 500, echo: "e" }, k3);
    const e2 = await post({ status: 500, echo: "e" }, k3);
    checks.push(["a stored error is replayed, never re-run", e1.status === 500 && e2.status === 500 && e2.replayed && runs - before === 1]);

    const k4 = `${prefix}slow`;
    const first = post({ echo: "s", delayMs: 9500 }, k4);
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    const second = await post({ echo: "s", delayMs: 9500 }, k4);
    const waited = Date.now() - t0;
    checks.push(["repeat while the first still runs past 8 s → 409 request_in_progress", second.status === 409 && second.body.code === "request_in_progress"]);
    checks.push(["…after waiting about 8 s", waited >= 7500 && waited < 9500]);
    checks.push(["…and the first still completes", (await first).status === 200]);

    const rls = await db.execute(sql`select relrowsecurity as rls from pg_class where relname = 'request_keys' and relnamespace = 'public'::regnamespace`);
    checks.push(["request_keys has row-level security on", (rls as any).rows?.[0]?.rls === true]);
  } finally {
    await db.execute(sql`delete from request_keys where key like ${prefix + "%"}`);
    const left = await db.execute(sql`select count(*)::int as n from request_keys where key like ${prefix + "%"}`);
    checks.push(["cleanup: no zztest rows left", Number((left as any).rows?.[0]?.n) === 0]);
    server.close();
  }

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: ASK THE OWNER.** "Run `scripts/migrate-request-keys.mjs` on the shared database now? It adds one empty table, `request_keys`, with row-level security on. It is idempotent, and the rollback is `DROP TABLE IF EXISTS request_keys`." Proceed only on a yes.

- [ ] **Step 3: Run the migration.** Run: `node scripts/migrate-request-keys.mjs`. Expected: three `OK:` lines, `Present: [ { relname: 'request_keys', rls: true, idx: '1' } ]`, then `DONE`.

- [ ] **Step 4: Run the DB check.** Run: `npx tsx -r dotenv/config scripts/verify-request-keys-db.ts`. Expected: all `PASS` (it takes about 10 s because of the wait case), then `RESULT: PASS ✅`.

- [ ] **Step 5: Commit** `scripts/verify-request-keys-db.ts` with message `Manual DB check for the requestKeys middleware`.

---

### Task 16: Final verification

- [ ] **Step 1:** `npm run check` → no output.
- [ ] **Step 2:** `npm run test:pure` → exit 0, including the three new scripts.
- [ ] **Step 3:** `npm run build` → Vite and esbuild succeed. `npm run build:desktop` → succeeds. Don't commit build output.
- [ ] **Step 4:** Re-run `scripts/verify-stall-breaker-electron.cjs` (Task 13 Step 3) → `RESULT: PASS`.
- [ ] **Step 5:** `git status` shows a clean tree, and `git log --oneline main..stall-breaker` lists the task commits.
- [ ] **Step 6:** Hand back to the owner with the release checklist below. **Do not deploy, push, publish a desktop release or merge without the owner's explicit OK.**

## Release checklist (owner actions, in this order)

1. **Migration:** `node scripts/migrate-request-keys.mjs` on the shared DB, if Task 15 didn't already run it.
2. **Server + web:** merge `stall-breaker` → `main`, push, and let Vercel deploy. Phones start sending keys. Old desktop builds keep working: no keys, no change.
3. **Desktop:** publish a new desktop version (the usual release flow). The shop PC auto-updates and gets the breaker, keys and diagnostics.
4. **Smoke test on the shop PC after the update:**
   - Open DevTools (Ctrl+Shift+I) → Console → `await window.electronAPI.resetConnections()` → resolves to `undefined`.
   - Live updates still arrive: a phone order appears.
   - A test KOT prints.
5. **After 2–3 days:** `npx tsx -r dotenv/config scripts/report-latency.ts --days 7 --deployed <desktop release time ISO>`. Compare slow prints per day (6 Nov: 8), resets per day and their recovery p50, and the slow-settle rate.
6. **Cable:** plug the shop PC into the JioFiber router by LAN (spec → "Cable checklist") and note the date for the comparison.
