# Local-first Phase 1 — PGlite Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove (or disprove) that the real server code — `server/storage.ts` and `server/settingsStore.ts` — runs correctly and fast on PGlite (Postgres in WASM, in-process), with no network and no Supabase.

**Architecture:** Add an opt-in driver switch to `server/db.ts` (`BAGICHA_DB=pglite` → `drizzle-orm/pglite`; default unchanged = node-postgres on `DATABASE_URL`). A spike script sets that env, builds the schema from `shared/schema.ts` into an in-memory PGlite via `drizzle-kit/api`, seeds minimal data, and drives the hot money/kitchen paths (create order, edit items + KOT, reconcile stock, settle twice, counters, settings save, list/fingerprint queries) including concurrent calls, with a 10 s hang detector on each. Output is a PASS/FAIL report plus timings.

**Tech Stack:** `@electric-sql/pglite@0.5.13`, `drizzle-orm@0.39.3` (`drizzle-orm/pglite`), `drizzle-kit@0.30.6` (`drizzle-kit/api`), `tsx`.

Design spec: `docs/superpowers/specs/2026-11-13-local-first-offline-design.md`.

## Hard safety rules (read first)

- **Never connect to Supabase.** `DATABASE_URL` in `.env` is the shared PRODUCTION database. The spike must not load dotenv (`-r dotenv/config` forbidden) and must set `BAGICHA_DB=pglite` **before** importing anything from `server/`. Task 4 asserts that `pg` is never used.
- Do not run `npm run db:push`, `npm run seed`, `npm run dev`, or any `scripts/migrate-*.mjs`.
- `tsconfig.json` has no `target` (ES5): in `server/` never `for…of` / spread a `Map`/`Set`; use `Array.from`.
- Default behaviour of `server/db.ts` (no `BAGICHA_DB` set) must stay byte-for-byte equivalent in effect: same Pool options, same `DATABASE_URL` error, same TLS handling.

## File structure

- Modify: `server/db.ts` — driver switch; exports `db`, `pool` (null in local mode), `localClient` (null in cloud mode), `withRetry` unchanged.
- Modify: `package.json` / `package-lock.json` — add `@electric-sql/pglite` `0.5.13` (exact, no caret) to `dependencies` (the local server will need it at runtime in phase 3).
- Create: `scripts/spike-pglite.ts` — the spike (manual, not in `test:pure`).
- Create: `scripts/lib/pgliteSchema.ts` — builds the CREATE statements from `shared/schema.ts` via `drizzle-kit/api` (reused in phase 3 for bootstrap).

---

### Task 1: Install PGlite

- [ ] **Step 1:** Run `npm install --save-exact @electric-sql/pglite@0.5.13`.
- [ ] **Step 2:** Confirm `package.json` has `"@electric-sql/pglite": "0.5.13"` (no `^`) and `node -e "import('@electric-sql/pglite').then(m=>console.log(typeof m.PGlite))"` prints `function`.
- [ ] **Step 3:** Commit: `git add package.json package-lock.json && git commit -m "chore: add @electric-sql/pglite for local-first spike"`.

### Task 2: Driver switch in `server/db.ts`

- [ ] **Step 1:** Check `package.json` has `"type": "module"` (top-level `await` needs ESM; esbuild builds `--format=esm`). If it does not, stop and report.
- [ ] **Step 2:** Restructure `server/db.ts` as below. Keep the existing pool-creation block (TLS warnings, Pool options, `pool.on("error")` handler) verbatim inside `createCloudDb()`. Keep `withRetry` unchanged.

```ts
import pkg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PGlite } from '@electric-sql/pglite';
import * as schema from "@shared/schema";
import { dbSslConfig, stripSslParams } from "./dbSsl";

const { Pool } = pkg;
type Db = NodePgDatabase<typeof schema>;

// BAGICHA_DB=pglite runs the same server code on an in-process Postgres (PGlite) for the
// local-first shop PC. Unset = the shared cloud database on DATABASE_URL, as before.
const USE_PGLITE = process.env.BAGICHA_DB === "pglite";

function createCloudDb(): { pool: pkg.Pool; db: Db } {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Check your .env file.");
  }
  // ... existing sslCfg checks, `new Pool({...})`, and pool.on("error", ...) moved here verbatim ...
  return { pool, db: drizzle(pool, { schema }) };
}

async function createLocalDb(): Promise<{ client: PGlite; db: Db }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  // No dir = in-memory (spike); phase 3 passes a userData path.
  const client = new PGlite(process.env.BAGICHA_PGLITE_DIR || undefined);
  await client.waitReady;
  // The PGlite Drizzle database has the same query API; the cast keeps every call site typed as before.
  return { client, db: drizzlePglite(client, { schema }) as unknown as Db };
}

const local = USE_PGLITE ? await createLocalDb() : null;
const cloud = USE_PGLITE ? null : createCloudDb();

export const pool: pkg.Pool | null = cloud ? cloud.pool : null;
export const localClient: PGlite | null = local ? local.client : null;
export const db: Db = (local ? local.db : cloud!.db);
```

- [ ] **Step 3:** `grep -rn "from \"./db\"\|from \"../db\"\|from './db'" server | grep pool` — confirm nothing imports `pool` (expected: no output). If something does, make it handle `null` and report it.
- [ ] **Step 4:** Run `npm run check`. Expected: exit 0. Fix only type errors caused by this change.
- [ ] **Step 5:** Run `npm run test:pure`. Expected: all PASS (unchanged behaviour).
- [ ] **Step 6:** Run `npm run build:api` and confirm `dist/app-bundle.js` keeps `@electric-sql/pglite` as an external dynamic import (it must not be bundled; `--packages=external` handles this). Delete nothing in `dist/` you did not create... (dist is build output; leaving it is fine).
- [ ] **Step 7:** Commit: `git add server/db.ts && git commit -m "feat(db): opt-in PGlite driver via BAGICHA_DB=pglite"`.

### Task 3: Schema builder

**Files:** Create `scripts/lib/pgliteSchema.ts`.

- [ ] **Step 1:** Write:

```ts
import * as schema from "../../shared/schema";

// CREATE statements for every table/index/enum in shared/schema.ts, diffed from an empty
// snapshot. Same source of truth the cloud DB is pushed from.
export async function schemaStatements(): Promise<string[]> {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const empty = generateDrizzleJson({});
  const target = generateDrizzleJson(schema as Record<string, unknown>);
  return generateMigration(empty, target);
}
```

- [ ] **Step 2:** Quick check: `npx tsx -e "import('./scripts/lib/pgliteSchema.ts').then(async m => { const s = await m.schemaStatements(); console.log(s.length, s[0].slice(0,80)); })"`. Expected: a positive count and a `CREATE TABLE` line. If `drizzle-kit/api` is not exported in 0.30.6 or the call signatures differ, read `node_modules/drizzle-kit/api.d.ts` and adapt; report what changed.
- [ ] **Step 3:** Commit: `git add scripts/lib/pgliteSchema.ts && git commit -m "feat(spike): build schema SQL from shared/schema for PGlite"`.

### Task 4: The spike script

**Files:** Create `scripts/spike-pglite.ts`. Read `shared/schema.ts` for the exact required columns of `categories`, `menuItems`, `inventory`, `tables`, `orders`, `orderItems`, `kotTickets`, `restaurantSettings`, and the `storage.ts` method signatures (lines ~113–260) before writing the seed/insert objects.

- [ ] **Step 1:** Skeleton (fill seed objects from the schema; every check uses `check()`):

```ts
// MANUAL spike — never in test:pure. Runs the real storage layer on in-memory PGlite.
// Never loads .env: the production DATABASE_URL must not be reachable from here.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.BAGICHA_DB = "pglite";
delete process.env.DATABASE_URL;
process.env.BAGICHA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bagicha-spike-"));
// Pusher must never fire from the spike.
for (const k of Object.keys(process.env)) if (k.startsWith("PUSHER") || k.startsWith("VITE_PUSHER")) delete process.env[k];

let failures = 0;
const timings: Array<[string, number]> = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}
async function timed<T>(name: string, fn: () => Promise<T>, ms = 10_000): Promise<T> {
  const t0 = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`HANG >${ms}ms (global db used inside a transaction?)`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
    timings.push([name, performance.now() - t0]);
  }
}

async function main() {
  const { db, localClient, pool } = await import("../server/db");
  check("pg pool never created", pool === null);
  check("PGlite client created", localClient !== null);

  const { schemaStatements } = await import("./lib/pgliteSchema");
  const stmts = await schemaStatements();
  for (const s of stmts) await localClient!.exec(s);
  check("schema applied", true, `${stmts.length} statements`);

  const { initSettings, incrementBillCounter, incrementKotCounter, saveSettings, getSettings } = await import("../server/settingsStore");
  const { storage } = await import("../server/storage");
  // seed: one category, two menu items (one with sizes + inventoryLinks), one inventory row,
  // one table — insert via storage.createCategory / createMenuItem / createInventoryItem / createTable.

  // 1. settings + counters
  // 2. 20 concurrent incrementBillCounter → 20 distinct values
  // 3. saveSettings concurrently with 10 counter bumps → counter not rolled back
  // 4. createOrderWithItems (2 lines + kot)
  // 5. replaceOrderItems with a kot (kotNumber: incrementKotCounter().then(String))
  // 6. reconcileOrderInventory, then 2 concurrent reconciles on the same order → stock equals one deduction
  // 7. settleOrderIfUnpaid twice concurrently → exactly one returns an order
  // 8. findOrders({ open: true }), findOrdersQuery + queryFingerprint via db.execute (rows[0] has a value),
  //    getOpenTabsByCustomer(), getDashboardStats(), kotTicketsQuery({}), getOpenOrderStats()
  // 9. 50 sequential getOrderById → report avg ms

  console.log("\nTimings (ms):");
  for (const [n, ms] of timings) console.log(`  ${ms.toFixed(1).padStart(8)}  ${n}`);
  console.log(`\n${failures === 0 ? "SPIKE PASSED" : `SPIKE FAILED (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("SPIKE CRASHED:", e); process.exit(2); });
```

Each numbered comment becomes real code wrapped in `timed(...)` with explicit `check(...)` assertions on the returned values (exact expected numbers: e.g. counters `1..N` distinct; stock after reconcile = initial − qty × link amount; one of two settles returns `undefined`).

- [ ] **Step 2:** Run `npx tsx scripts/spike-pglite.ts`. Record full output.
- [ ] **Step 3:** For every FAIL/HANG: find the cause (file:line). A HANG inside a `db.transaction` callback that calls the global `db` is the expected class of bug; **do not fix storage.ts in this spike** — list each site.
- [ ] **Step 4:** Static scan: list every `db.transaction(` / `.transaction(async (tx` block in `server/storage.ts` and `server/settingsStore.ts` that contains a call on the global `db` or calls another `storage`/`this.` method (which would use the global `db`) inside the callback. Report as `file:line — what`.
- [ ] **Step 5:** Commit the script: `git add scripts/spike-pglite.ts && git commit -m "test(spike): run storage hot paths on PGlite"`.

### Task 5: Report

- [ ] Write the results (PASS/FAIL list, timings, hang sites, any driver-shape differences such as `db.execute` result `.rows`) into `docs/superpowers/specs/2026-11-13-local-first-offline-design.md` under a new `## Phase 1 results` section, and commit.
