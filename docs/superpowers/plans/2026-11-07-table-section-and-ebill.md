# Table Section on KOT/Bill + POS E-Bill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the table's section (Inner / Outer / …) next to its number on every dine-in KOT, thermal bill and e-bill, and put a WhatsApp E-Bill button back in the POS cart.

**Architecture:** A pure label helper (`shared/tableSection.ts`) and a per-process stale-while-revalidate cache of `tables.section` (`server/tableSectionCache.ts`, wired in `server/tableSections.ts`) feed an optional `tableSection` field into the KOT/bill generators and the print pipeline. A new `POST /api/orders/:id/ebill` builds the customer text from the saved order and returns a `wa.me` link; the POS cart saves, calls it, and opens WhatsApp.

**Tech Stack:** TypeScript, Express, Drizzle/Postgres, React + TanStack Query, hand-rolled `tsx` verify scripts (`npm run test:pure`).

**Spec:** `docs/superpowers/specs/2026-11-07-table-section-on-kot-bill-design.md` (branch `table-section-on-kot-bill`).

**Conventions for every task:** no DB migration; no `for…of`/spread over `Map`/`Set` in `client/`, `shared/`, `server/` (ES5 target — use `Array.from`); `scripts/` is not type-checked by `npm run check`, so validate scripts by running them; commit with two `-m` flags (no heredocs — apostrophes break them in this shell); the server half of `npm run dev` does not hot-reload.

---

## File map

| File | Change |
|---|---|
| `shared/tableSection.ts` | **new** — `tableSectionLabel`, `formatTableLabel` (pure) |
| `server/tableSectionCache.ts` | **new** — `createTableSectionCache` factory (pure, no DB import) |
| `server/tableSections.ts` | **new** — module singleton on the DB + `tableSectionFor`, `forgetTableSections` |
| `scripts/verify-table-section.ts` | **new** — label, cache, KOT text/image, bill checks; added to `test:pure` |
| `package.json` | append the new script to `test:pure` |
| `shared/print/generators.ts` | `tableSection` on KOT params + bill order; section line / `Table:` line |
| `shared/print/kotImage.ts` | `tableSection` param; section line in the image header |
| `shared/ebillText.ts` | `Table: Inner - 3` via `formatTableLabel` |
| `scripts/verify-ebill-text.ts` | section cases |
| `server/services/printDispatch.ts` | look the section up once per KOT/bill; export `markTableBilled` |
| `server/printRoutes.ts` | preview twins print the section / table line |
| `server/routes.ts` | `forgetTableSections()` on table writes; new `POST /api/orders/:id/ebill` |
| `client/src/pages/POS.tsx` | E-Bill button + flow; delete dead `sendWhatsAppBill` / `handleSaveEBill` |
| `CLAUDE.md` | two paragraphs under "Printing (KOT/Bill)" |
| `docs/superpowers/specs/2026-11-07-table-section-on-kot-bill-design.md` | sync three details decided while planning |

---

### Task 0: Sync the spec with decisions made while planning

Three details changed once the code was read: the cache is stale-while-revalidate (a print never waits on a refresh) with no miss-reload; `runKotPrint` has **two** `generateKOTBuffer` call sites, not three; the plain-text twins can't be imported by a pure script (they live in `printRoutes.ts`, which imports the DB pool); the E-Bill pre-opens its window the way Reports' dues e-bill does.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-07-table-section-on-kot-bill-design.md`

- [ ] **Step 1: Replace the cache-behaviour bullet**

Edit, `old_string`:
```
- Loads the **whole** `tables` list once (~15 rows) and serves `get(tableId)` from memory for 60 s. A miss on an
  id (new table) or an expired entry triggers one reload. A failed reload keeps serving the last good map; with
  no map at all it returns `null` — **a lookup failure must never fail or delay a print**, the ticket just
  prints without the section.
```
`new_string`:
```
- Loads the **whole** `tables` list once (~15 rows). The first lookup on an instance waits for that load; after
  that `get(tableId)` is answered from memory and, once the map is older than 60 s, answers with the old value
  immediately while one background reload runs (stale-while-revalidate — a print never waits on a refresh).
  An unknown id returns `null` without reloading (a table created on another instance shows up within 60 s).
  A failed load keeps the last good map and is not retried for 10 s; with no map at all `get` returns `null` —
  **a lookup failure must never fail or delay a print**, the ticket just prints without the section. A load
  still unfinished after 15 s is treated as lost (a frozen serverless instance) and replaced.
```

- [ ] **Step 2: Replace the forget bullet**

`old_string`:
```
- `forgetTableSections()` is called from `POST /api/tables`, `PUT /api/tables/:id` and
  `DELETE /api/tables/:id` (`routes.ts`), so the instance that handled the edit is correct immediately; other
  Vercel instances are stale for ≤ 60 s (a section is edited about never).
```
`new_string`:
```
- `forgetTableSections()` is called from `POST /api/tables`, `PUT /api/tables/:id` and
  `DELETE /api/tables/:id` (`routes.ts`). It drops the map (a load already running is discarded), so the next
  lookup on the instance that handled the edit reloads and is correct immediately; other Vercel instances are
  stale for ≤ 60 s (a section is edited about never).
```

- [ ] **Step 3: Fix the call-site count**

`old_string`:
```
  first `generateKOTBuffer`; pass it to all three call sites (browser-fallback ticket, per-routed-printer direct
  tickets, remote-dispatched tickets). A cache hit costs no I/O, so it doesn't change the snapshot path's
  "reads nothing" property in steady state.
```
`new_string`:
```
  first `generateKOTBuffer`; pass it to both call sites (the browser-fallback ticket, and the per-routed-printer
  tickets, which cover direct and remote-dispatched printers alike). A cache hit costs no I/O, so it doesn't
  change the snapshot path's "reads nothing" property in steady state.
```

- [ ] **Step 4: Fix the Part A bill test line**

`old_string`:
```
- bill: `Table: Inner - 3`; `Table: 3` without a section; no line without a table; the plain-text twins agree
  with the buffers.
```
`new_string`:
```
- bill: `Table: Inner - 3`; `Table: 3` without a section; no line without a table; the line prints with every
  optional bill flag switched off (compulsory). The plain-text twins in `printRoutes.ts` import the DB pool, so
  they are covered by `npm run check` and the manual preview check instead of the pure script.
```

- [ ] **Step 5: Fix the E-Bill popup description**

`old_string`:
```
   Settle usually follows. It then calls `POST /api/orders/:id/ebill` and `window.open(waUrl, "_blank")`.
   If the browser blocks the popup (the click → save → response gap can outlast the click's activation) a toast
   with an **Open WhatsApp** action opens it from a fresh click. Success toast: "E-bill ready — tap Send in
   WhatsApp".
```
`new_string`:
```
   Settle usually follows. It then calls `POST /api/orders/:id/ebill` and points a window at the returned
   `waUrl`. That window is opened **during the tap** (blank), the pattern Reports' dues e-bill already uses, so
   popup blockers allow it (Electron allows `about:blank`); on failure it is closed again. If no window could be
   opened (a PIN-gated tap loses the click's activation), a toast with an **Open WhatsApp** action opens it from
   a fresh click. Success toast: "E-bill ready — tap Send in WhatsApp".
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-07-table-section-on-kot-bill-design.md
git commit -m "Spec: sync cache, call-site and popup details with the implementation plan" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

If an Edit's `old_string` does not match (line wrapping), `Read` the spec section and adjust — the intent is what matters.

---

### Task 1: Label helper (`shared/tableSection.ts`) + the verify script

**Files:**
- Create: `shared/tableSection.ts`
- Create: `scripts/verify-table-section.ts`
- Modify: `package.json` (the `test:pure` script)

- [ ] **Step 1: Record the baseline**

Run: `npm run check`
Expected: note the result. If it already reports errors, write them down — later tasks must not add any.

- [ ] **Step 2: Write the failing test**

Create `scripts/verify-table-section.ts`:
```ts
/**
 * Verifies the table-section feature (spec: docs/superpowers/specs/2026-11-07-table-section-on-kot-bill-design.md):
 * the label helper, the in-process section cache, and the KOT / bill output that carries the section.
 * Pure — no printer, no DB, no network.
 * Run: npx tsx scripts/verify-table-section.ts
 */
import { tableSectionLabel, formatTableLabel } from "../shared/tableSection";

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);
const asyncBlocks: Array<() => Promise<void>> = [];

// ── 1. Label helper ───────────────────────────────────────────────────────────
check("known sections get their display label", tableSectionLabel("inner") === "Inner" && tableSectionLabel("outer") === "Outer" && tableSectionLabel("terrace") === "Terrace" && tableSectionLabel("hall") === "Hall");
check("VIP keeps its capitals", tableSectionLabel("vip") === "VIP");
check("lookup ignores case and surrounding spaces", tableSectionLabel(" INNER ") === "Inner");
check("an unknown section is capitalised", tableSectionLabel("rooftop") === "Rooftop");
check("empty / blank / null / undefined → null", tableSectionLabel("") === null && tableSectionLabel("  ") === null && tableSectionLabel(null) === null && tableSectionLabel(undefined) === null);
check("formatTableLabel: section + name", formatTableLabel("3", "inner") === "Inner - 3" && formatTableLabel("G1", "outer") === "Outer - G1");
check("formatTableLabel: unknown section → name only", formatTableLabel("3", null) === "3" && formatTableLabel("3", "") === "3");
check("formatTableLabel: no table name → null", formatTableLabel(null, "inner") === null && formatTableLabel("", "inner") === null && formatTableLabel("  ", "inner") === null);
check("formatTableLabel: trims the name", formatTableLabel(" 3 ", "inner") === "Inner - 3");

(async () => {
  for (const block of asyncBlocks) await block();
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run it and see it fail**

Run: `npx tsx scripts/verify-table-section.ts`
Expected: FAIL — a module-not-found error for `../shared/tableSection`.

- [ ] **Step 4: Implement**

Create `shared/tableSection.ts`:
```ts
/**
 * Table sections (`tables.section`: inner | outer | vip | terrace | hall | anything an admin typed) as they are
 * PRINTED. Pure. The thermal bill, its plain-text preview twin and the WhatsApp e-bill all print
 * `Table: ${formatTableLabel(...)}` so the three cannot drift; the KOT prints the section on its own line,
 * uppercased (`tableSectionLabel(x)?.toUpperCase()`).
 */
const LABELS: Record<string, string> = {
  inner: "Inner",
  outer: "Outer",
  vip: "VIP",
  terrace: "Terrace",
  hall: "Hall",
};

/** `inner` → "Inner", `vip` → "VIP", `rooftop` → "Rooftop"; blank / null → null. */
export function tableSectionLabel(section: string | null | undefined): string | null {
  const s = (section ?? "").trim();
  if (!s) return null;
  return LABELS[s.toLowerCase()] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Inner - 3"; just "3" when the section is unknown; null when there is no table name. */
export function formatTableLabel(
  tableName: string | null | undefined,
  section: string | null | undefined,
): string | null {
  const name = (tableName ?? "").trim();
  if (!name) return null;
  const label = tableSectionLabel(section);
  return label ? `${label} - ${name}` : name;
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `npx tsx scripts/verify-table-section.ts`
Expected: every line `PASS`, final `RESULT: PASS ✅`.

- [ ] **Step 6: Add the script to `test:pure`**

Edit `package.json`, `old_string`: `tsx scripts/verify-db-ssl.ts"` → `new_string`: `tsx scripts/verify-db-ssl.ts && tsx scripts/verify-table-section.ts"`.
(If that does not match, run `node -e "console.log(require('./package.json').scripts['test:pure'].split('&&').pop())"` to see the real last entry and append after it.)

Run: `node -e "const s=require('./package.json').scripts['test:pure'];console.log(s.trim().endsWith('verify-table-section.ts'))"`
Expected: `true`

- [ ] **Step 7: Commit**

```bash
git add shared/tableSection.ts scripts/verify-table-section.ts package.json
git commit -m "Add table section label helper and its verify script" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Section cache + table-write invalidation

**Files:**
- Create: `server/tableSectionCache.ts`
- Create: `server/tableSections.ts`
- Modify: `scripts/verify-table-section.ts`
- Modify: `server/routes.ts` (import + three table routes)

- [ ] **Step 1: Write the failing cache tests**

In `scripts/verify-table-section.ts`:

(a) Edit, `old_string`: `const checks: Array<[string, boolean]> = [];` → `new_string`:
```ts
import { createTableSectionCache } from "../server/tableSectionCache";

const checks: Array<[string, boolean]> = [];
```

(b) Edit, `old_string`: `(async () => {\n  for (const block of asyncBlocks) await block();` → `new_string` (the same two lines preceded by this block):
```ts
// ── 2. Section cache ──────────────────────────────────────────────────────────
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const rows = (...pairs: Array<[number, string | null]>) => pairs.map(([id, section]) => ({ id, section }));
/** A cache over `loadImpl` with a controllable clock and a load counter. */
const mkCache = (loadImpl: () => Promise<Array<{ id: number; section: string | null }>>) => {
  const clock = { t: 0 };
  let loads = 0;
  const c = createTableSectionCache({ load: () => { loads++; return loadImpl(); }, now: () => clock.t });
  return { c, clock, loads: () => loads };
};

asyncBlocks.push(async () => {
  {
    const { c, loads } = mkCache(async () => rows([1, "inner"], [2, "outer"]));
    check("cache: the first lookup loads and returns the section", (await c.get(1)) === "inner" && loads() === 1);
    check("cache: a later lookup (another table) is served from memory — no new load", (await c.get(2)) === "outer" && loads() === 1);
  }
  {
    const { c, loads } = mkCache(async () => rows([1, "inner"]));
    await c.get(1);
    check("cache: an unknown table id → null, without reloading", (await c.get(99)) === null && loads() === 1);
  }
  {
    const { c, loads } = mkCache(async () => rows([1, "inner"]));
    check("cache: a null / undefined id → null and never touches the database", (await c.get(null)) === null && (await c.get(undefined)) === null && loads() === 0);
  }
  {
    const { c } = mkCache(async () => rows([1, ""], [2, null], [3, "vip"]));
    check("cache: rows without a section map to null", (await c.get(1)) === null && (await c.get(2)) === null && (await c.get(3)) === "vip");
  }
  {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { c, loads } = mkCache(async () => { await gate; return rows([1, "inner"]); });
    const p1 = c.get(1);
    const p2 = c.get(1);
    release();
    check("cache: two simultaneous first lookups share one load", (await p1) === "inner" && (await p2) === "inner" && loads() === 1);
  }
  {
    let data = rows([1, "inner"]);
    const { c, clock, loads } = mkCache(async () => data);
    await c.get(1);
    data = rows([1, "outer"]);
    clock.t = 59_000;
    check("cache: inside the 60 s TTL the cached value is served and nothing reloads", (await c.get(1)) === "inner" && loads() === 1);
    clock.t = 61_000;
    check("cache: past the TTL the OLD value is still answered immediately (a print never waits on a refresh)", (await c.get(1)) === "inner");
    await tick();
    check("cache: …and exactly one background reload ran", loads() === 2);
    check("cache: the next lookup sees the refreshed value", (await c.get(1)) === "outer");
  }
  {
    let data = rows([1, "inner"]);
    const { c, loads } = mkCache(async () => data);
    await c.get(1);
    data = rows([1, "vip"]);
    c.forget();
    check("cache: forget() makes the very next lookup reload and see the new value", (await c.get(1)) === "vip" && loads() === 2);
  }
  {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const { c } = mkCache(async () => { n++; if (n === 1) { await gate; return rows([1, "OLD"]); } return rows([1, "new"]); });
    const first = c.get(1); // load #1 is held open
    c.forget();             // an edit lands while it is running
    release();
    await first;
    check("cache: a load that was running when forget() was called does not install stale data", (await c.get(1)) === "new");
  }
  {
    let fail = true;
    const { c, clock, loads } = mkCache(async () => { if (fail) throw new Error("db down"); return rows([1, "inner"]); });
    let threw = false;
    let v: string | null = "x";
    try { v = await c.get(1); } catch { threw = true; }
    check("cache: a failing first load never throws — the lookup is just null", !threw && v === null);
    await c.get(1);
    check("cache: a failed load is not retried within 10 s", loads() === 1);
    fail = false;
    clock.t = 11_000;
    check("cache: after the retry window it loads again and recovers", (await c.get(1)) === "inner" && loads() === 2);
  }
  {
    let fail = false;
    const { c, clock } = mkCache(async () => { if (fail) throw new Error("db down"); return rows([1, "inner"]); });
    await c.get(1);
    fail = true;
    clock.t = 61_000;
    await c.get(1);
    await tick();
    clock.t = 62_000;
    check("cache: a failing refresh keeps serving the last good map", (await c.get(1)) === "inner");
  }
  {
    let n = 0;
    const clock = { t: 0 };
    const c = createTableSectionCache({
      load: () => { n++; return n === 1 ? new Promise<never>(() => {}) : Promise.resolve(rows([1, "inner"])); },
      now: () => clock.t,
    });
    void c.get(1);       // load #1 never finishes (a frozen serverless instance)
    clock.t = 16_000;
    check("cache: a load stuck for 15 s is replaced by a fresh one", (await c.get(1)) === "inner" && n === 2);
  }
});

(async () => {
  for (const block of asyncBlocks) await block();
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx scripts/verify-table-section.ts`
Expected: FAIL — module-not-found for `../server/tableSectionCache`.

- [ ] **Step 3: Implement the cache factory**

Create `server/tableSectionCache.ts`:
```ts
/**
 * Per-process cache of `tables.section` by table id — what the KOT / bill print path uses to print
 * "Inner" / "Outer" next to a table number WITHOUT a database read on every tap (print latency was tuned
 * hard; see CLAUDE.md "Printing"). Pure: the loader is injected (server/tableSections.ts wires the real one),
 * so scripts/verify-table-section.ts runs it without a database.
 *
 *  - The first lookup on an instance waits for one load of the whole `tables` list (~15 rows).
 *  - After that, answers come from memory. Once the map is older than the TTL the OLD value is still answered
 *    immediately while one background reload runs (stale-while-revalidate) — a print never waits on a refresh.
 *  - An unknown id answers null without reloading (a table created on another instance appears within the TTL).
 *  - A failed load keeps the last good map and is not retried for RETRY_AFTER_FAILURE_MS. `get` NEVER throws:
 *    a lookup problem must never fail or delay a print — the ticket just prints without the section.
 *  - A load still unfinished after STUCK_LOAD_MS is treated as lost (a frozen serverless instance never
 *    resumes the promise) and replaced, so one frozen refresh cannot stop all future refreshes.
 *  - forget() drops the map (the next lookup reloads) and discards any load already running, so a stale
 *    answer that was in flight cannot overwrite what an edit just changed.
 */
export const TABLE_SECTION_TTL_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 10_000;
const STUCK_LOAD_MS = 15_000;

export interface TableSectionRow {
  id: number;
  section: string | null;
}

export interface TableSectionCache {
  get(tableId: number | null | undefined): Promise<string | null>;
  forget(): void;
}

export function createTableSectionCache(opts: {
  load: () => Promise<TableSectionRow[]>;
  ttlMs?: number;
  now?: () => number;
}): TableSectionCache {
  const ttl = opts.ttlMs ?? TABLE_SECTION_TTL_MS;
  const now = opts.now ?? Date.now;
  let map: Map<number, string> | null = null;
  let loadedAt = 0;
  let nextTryAt = 0;
  let generation = 0;
  let inflight: { promise: Promise<void>; startedAt: number } | null = null;

  const refresh = (): Promise<void> => {
    const startedAt = now();
    if (inflight && startedAt - inflight.startedAt < STUCK_LOAD_MS) return inflight.promise;
    const myGeneration = generation;
    const promise: Promise<void> = Promise.resolve()
      .then(() => opts.load())
      .then(
        (rows) => {
          if (myGeneration !== generation) return; // forget() ran while this load was in flight
          const next = new Map<number, string>();
          for (const r of rows) if (r.section) next.set(Number(r.id), String(r.section));
          map = next;
          loadedAt = now();
        },
        () => {
          if (myGeneration !== generation) return;
          nextTryAt = now() + RETRY_AFTER_FAILURE_MS; // keep the last good map
        },
      )
      .then(() => {
        if (inflight?.promise === promise) inflight = null;
      });
    inflight = { promise, startedAt };
    return promise;
  };

  return {
    async get(tableId) {
      if (tableId == null) return null;
      const id = Number(tableId);
      if (!Number.isFinite(id)) return null;
      const t = now();
      if (!map) {
        if (t >= nextTryAt) await refresh();
      } else if (t - loadedAt >= ttl && t >= nextTryAt) {
        void refresh();
      }
      return map?.get(id) ?? null;
    },
    forget() {
      generation++;
      map = null;
      loadedAt = 0;
      nextTryAt = 0;
      inflight = null;
    },
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx scripts/verify-table-section.ts`
Expected: every `cache:` line PASS, `RESULT: PASS ✅`.

- [ ] **Step 5: Wire the singleton**

Create `server/tableSections.ts`:
```ts
import { db } from "./db";
import { tables } from "@shared/schema";
import { createTableSectionCache } from "./tableSectionCache";

/**
 * The process-wide table-section cache (the pure logic and its rules live in tableSectionCache.ts).
 * `tableSectionFor` never throws; call `forgetTableSections()` after any write to the `tables` table.
 */
const cache = createTableSectionCache({
  load: () => db.select({ id: tables.id, section: tables.section }).from(tables),
});

export const tableSectionFor = (tableId: number | null | undefined): Promise<string | null> => cache.get(tableId);
export const forgetTableSections = (): void => cache.forget();
```

- [ ] **Step 6: Invalidate on table writes**

In `server/routes.ts`:

(a) Add the import. Edit, `old_string`: `import { registerPrintRoutes } from "./printRoutes";` → `new_string`:
```ts
import { registerPrintRoutes } from "./printRoutes";
import { tableSectionFor, forgetTableSections } from "./tableSections";
```

(b) `POST /api/tables` — `old_string`:
```
        section: String(section || "inner"),
      });
      res.json(table);
```
`new_string`:
```
        section: String(section || "inner"),
      });
      forgetTableSections();
      res.json(table);
```

(c) `PUT /api/tables/:id` — `old_string`:
```
      const table = await storage.updateTable(id, data);
      res.json(table);
```
`new_string`:
```
      const table = await storage.updateTable(id, data);
      forgetTableSections();
      res.json(table);
```

(d) `DELETE /api/tables/:id` — `old_string`:
```
      await storage.deleteTable(id);
      res.json({ success: true });
```
`new_string`:
```
      await storage.deleteTable(id);
      forgetTableSections();
      res.json({ success: true });
```

(`tableSectionFor` is imported now and used in Tasks 6 and 8; an unused import is not an error under this repo's `tsc` settings — if `npm run check` flags it, add the use in Task 8 first.)

- [ ] **Step 7: Type-check**

Run: `npm run check`
Expected: no new errors versus the Task 1 baseline.

- [ ] **Step 8: Commit**

```bash
git add server/tableSectionCache.ts server/tableSections.ts server/routes.ts scripts/verify-table-section.ts
git commit -m "Add table-section cache (stale-while-revalidate) and invalidate it on table edits" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: KOT, text style

**Files:**
- Modify: `shared/print/generators.ts` (KOT params + header)
- Modify: `scripts/verify-table-section.ts`

- [ ] **Step 1: Write the failing tests**

In `scripts/verify-table-section.ts`:

(a) Edit, `old_string`: `const checks: Array<[string, boolean]> = [];` → `new_string`:
```ts
import * as E from "../shared/print/escpos";
import { generateKOTBuffer } from "../shared/print/generators";

const checks: Array<[string, boolean]> = [];
```

(b) Edit, `old_string`: `(async () => {\n  for (const block of asyncBlocks) await block();` → `new_string`:
```ts
// ── 3. KOT, text style ────────────────────────────────────────────────────────
const kotSettings = { printAddons: true, printModifiedItemsOnly: true, printCancelledKOT: true, showDuplicateWatermark: true, kotNumbering: true } as any; // no kotStyle → the text ticket
const kotBase = {
  orderNumber: "1", tableNumber: "3", kotNumber: 12, isReprint: false, isDelta: false,
  newItems: [{ name: "Hakka Noodles", quantity: 1, serviceMode: "dinein" }],
  modifiedItems: [], cancelledItems: [], kotSettings, width: 48,
};
const latin = (b: Buffer) => b.toString("latin1");
{
  const withSection = generateKOTBuffer({ ...kotBase, tableSection: "inner" });
  const t = latin(withSection);
  check("KOT text: the section is printed uppercased", t.includes("INNER\n"));
  check("KOT text: the section line sits directly above the table line", /INNER\nTABLE - 3\n/.test(t));
  check("KOT text: both lines are double-size (one DOUBLE_SIZE_ON … OFF run)", withSection.indexOf(Buffer.concat([E.DOUBLE_SIZE_ON, Buffer.from("INNER\nTABLE - 3\n"), E.DOUBLE_SIZE_OFF])) >= 0);
  check("KOT text: VIP prints as VIP", latin(generateKOTBuffer({ ...kotBase, tableSection: "vip" })).includes("VIP\nTABLE - 3\n"));
  const plain = generateKOTBuffer({ ...kotBase });
  check("KOT text: no section → the header is exactly the old double-size TABLE line", plain.indexOf(Buffer.concat([E.DOUBLE_SIZE_ON, Buffer.from("TABLE - 3\n"), E.DOUBLE_SIZE_OFF])) >= 0 && !latin(plain).includes("INNER"));
  check("KOT text: null section is identical to no section", plain.equals(generateKOTBuffer({ ...kotBase, tableSection: null })));
  check("KOT text: takeaway ignores a section", generateKOTBuffer({ ...kotBase, tableNumber: null, tableSection: "inner" }).equals(generateKOTBuffer({ ...kotBase, tableNumber: null })));
}

(async () => {
  for (const block of asyncBlocks) await block();
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx scripts/verify-table-section.ts`
Expected: the `KOT text: the section is printed uppercased` and the next three checks FAIL (the generator ignores `tableSection`); the "no section" checks already PASS.

- [ ] **Step 3: Implement**

In `shared/print/generators.ts`:

(a) Import. `old_string`: `import { generateKOTImageBuffer } from "./kotImage";` → `new_string`:
```ts
import { generateKOTImageBuffer } from "./kotImage";
import { tableSectionLabel, formatTableLabel } from "../tableSection";
```

(b) KOT params. `old_string`:
```
export function generateKOTBuffer(params: {
  orderNumber: string;
  tableNumber: string | null;
```
`new_string`:
```
export function generateKOTBuffer(params: {
  orderNumber: string;
  tableNumber: string | null;
  /** tables.section for tableNumber's table (inner | outer | …). Printed above the table line; ignored for takeaway. */
  tableSection?: string | null;
```

(c) Header. `old_string`:
```
  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : "TAKEAWAY";
  parts.push(E.ALIGN_CENTER);
  parts.push(E.DOUBLE_SIZE_ON, E.line(tableHeader), E.DOUBLE_SIZE_OFF);
```
`new_string`:
```
  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : "TAKEAWAY";
  // Inner / Outer on its own double-size line directly above the table, so a ticket for "3" can't be mistaken
  // for another section's "3". Takeaway has no table, so it never carries one.
  const sectionHeader = params.tableNumber ? tableSectionLabel(params.tableSection)?.toUpperCase() : undefined;
  parts.push(E.ALIGN_CENTER);
  parts.push(E.DOUBLE_SIZE_ON, ...(sectionHeader ? [E.line(sectionHeader)] : []), E.line(tableHeader), E.DOUBLE_SIZE_OFF);
```

(`formatTableLabel` is imported now and used in Task 5; if `npm run check` flags it as unused, move the import into Task 5.)

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx scripts/verify-table-section.ts && npx tsx scripts/verify-kot-style.ts`
Expected: both end with `RESULT: PASS ✅` (the existing KOT style checks must be unaffected).

- [ ] **Step 5: Commit**

```bash
git add shared/print/generators.ts scripts/verify-table-section.ts
git commit -m "KOT (text style): print the table section above the table line" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: KOT, image style

**Files:**
- Modify: `shared/print/kotImage.ts`
- Modify: `scripts/verify-table-section.ts`

- [ ] **Step 1: Write the failing tests**

In `scripts/verify-table-section.ts`:

(a) Edit, `old_string`: `import { generateKOTBuffer } from "../shared/print/generators";` → `new_string`:
```ts
import { generateKOTBuffer } from "../shared/print/generators";
import { renderKotBitmap, KOT_IMAGE_STYLE } from "../shared/print/kotImage";
```

(b) Edit, `old_string`: `(async () => {\n  for (const block of asyncBlocks) await block();` → `new_string`:
```ts
// ── 4. KOT, image style ───────────────────────────────────────────────────────
{
  const imgBase = { ...kotBase, kotSettings: { ...kotSettings, kotStyle: "image" } as any, now: new Date("2026-11-07T07:30:00Z") };
  const plain = renderKotBitmap(imgBase)!;
  const withSection = renderKotBitmap({ ...imgBase, tableSection: "inner" })!;
  const oneBigLine = Math.round(KOT_IMAGE_STYLE.big * KOT_IMAGE_STYLE.lineHeight) + 4;
  check("KOT image: renders (the face covers the text)", !!plain && !!withSection);
  check("KOT image: a section adds exactly one big line", withSection.heightDots - plain.heightDots === oneBigLine);
  check("KOT image: null section is bit-identical to no section", Buffer.from(renderKotBitmap({ ...imgBase, tableSection: null })!.bits).equals(Buffer.from(plain.bits)));
  check("KOT image: takeaway ignores a section", renderKotBitmap({ ...imgBase, tableNumber: null, tableSection: "inner" })!.heightDots === renderKotBitmap({ ...imgBase, tableNumber: null })!.heightDots);
  check("KOT image: through generateKOTBuffer it is still the raster ticket", generateKOTBuffer({ ...imgBase, tableSection: "outer" }).indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00])) >= 0);
}

(async () => {
  for (const block of asyncBlocks) await block();
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx scripts/verify-table-section.ts`
Expected: `KOT image: a section adds exactly one big line` FAILS (height difference is 0).

- [ ] **Step 3: Implement**

In `shared/print/kotImage.ts`:

(a) Import. `old_string`: `import type { KOTPrintSettings } from "./types";` → `new_string`:
```ts
import type { KOTPrintSettings } from "./types";
import { tableSectionLabel } from "../tableSection";
```

(b) Params. `old_string`:
```
export interface KotImageParams {
  orderNumber: string;
  tableNumber: string | null;
```
`new_string`:
```
export interface KotImageParams {
  orderNumber: string;
  tableNumber: string | null;
  /** tables.section for tableNumber's table; drawn as its own line under "Dine In". Ignored for takeaway. */
  tableSection?: string | null;
```

(c) One helper, used by both the "can the face draw it?" pre-check and the header. `old_string`:
```
/** Every string the ticket will draw — used to decide up front whether the face can render it. */
function allStrings(p: KotImageParams): string[] {
  const s: string[] = [String(p.tableNumber ?? ""), String(p.kotNumber ?? "")];
```
`new_string`:
```
/** The uppercased section line ("INNER"), or null — only a dine-in ticket (one with a table) has one. */
const sectionLineOf = (p: KotImageParams): string | null =>
  (p.tableNumber ? tableSectionLabel(p.tableSection)?.toUpperCase() : undefined) ?? null;

/** Every string the ticket will draw — used to decide up front whether the face can render it. */
function allStrings(p: KotImageParams): string[] {
  const s: string[] = [String(p.tableNumber ?? ""), String(p.kotNumber ?? ""), sectionLineOf(p) ?? ""];
```

(d) Header. `old_string`:
```
  line(p.tableNumber ? "Dine In" : "Take Away", "bold", S.big, "center", 4);
  if (p.tableNumber) line(`Table No: ${p.tableNumber}`, "bold", S.big, "center", 4);
```
`new_string`:
```
  line(p.tableNumber ? "Dine In" : "Take Away", "bold", S.big, "center", 4);
  const sectionLine = sectionLineOf(p);
  if (sectionLine) line(sectionLine, "bold", S.big, "center", 4);
  if (p.tableNumber) line(`Table No: ${p.tableNumber}`, "bold", S.big, "center", 4);
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx scripts/verify-table-section.ts && npx tsx scripts/verify-kot-image.ts`
Expected: both end with `RESULT: PASS ✅`.

- [ ] **Step 5: Commit**

```bash
git add shared/print/kotImage.ts scripts/verify-table-section.ts
git commit -m "KOT (image style): draw the table section under Dine In" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Thermal bill — compulsory `Table:` line

**Files:**
- Modify: `shared/print/generators.ts` (bill order type + line)
- Modify: `scripts/verify-table-section.ts`

- [ ] **Step 1: Write the failing tests**

In `scripts/verify-table-section.ts`:

(a) Edit, `old_string`: `import { generateKOTBuffer } from "../shared/print/generators";` → `new_string`:
```ts
import { generateKOTBuffer, generateBillBuffer } from "../shared/print/generators";
```

(b) Edit, `old_string`: `(async () => {\n  for (const block of asyncBlocks) await block();` → `new_string`:
```ts
// ── 5. Thermal bill ───────────────────────────────────────────────────────────
// Fixtures: this restaurant's real configuration (same as scripts/verify-escpos-interpret.ts).
const billSettings: any = {
  showLogo: true, showFssai: false, showAddons: true, taxDisplay: "none", showRoundOff: true,
  billPrinterId: "p1", itemPriceMode: "exclusive", showDuplicate: true, showNameField: true,
  showKotAsToken: false, showBackwardTax: true, showOrderBarcode: false, mergeDuplicateItems: true,
  showCustomerPayment: false, showQuantityBreakdown: false,
};
const billRestaurant = {
  restaurantName: "Bagicha Restaurant", businessName: "Salasar Trading",
  address: "Dhimrapur Road, Raigarh (CG), 496001", phone: "9770022221", gstNumber: "22BOQPR9570B1ZN",
  fssaiNumber: "", taxRate: 5, currencySymbol: "₹", footerNote: "Thank you for dining with us!",
};
const billOrder = {
  orderNumber: "ORD0388", tableNumber: "3" as string | null, customerName: null, orderType: "Dine In",
  totalAmount: "387.45", taxAmount: "18.45", discountAmount: "0.00", subtotalAmount: "369.00",
  containerCharge: "0.00", paymentMethod: null, billPrintCount: 0, createdAt: new Date("2026-10-04T14:54:00Z"),
};
const billItems = [{ name: "Mix Sauce Pasta", quantity: 1, price: "299" }];
const billText = (order: Record<string, unknown> = {}, settings: any = billSettings) =>
  latin(generateBillBuffer({
    order: { ...billOrder, ...order } as any, items: billItems, restaurant: billRestaurant,
    billSettings: settings, cashierName: "rajbhaghel", width: 48,
  }));
{
  const t = billText({ tableSection: "inner" });
  check("bill: the Table line carries the section", t.includes("Table: Inner - 3\n"));
  check("bill: the Table line sits after the Date line and before the Cashier line", t.indexOf("Date:") < t.indexOf("Table: Inner - 3") && t.indexOf("Table: Inner - 3") < t.indexOf("Cashier:"));
  check("bill: no section → 'Table: 3'", billText().includes("Table: 3\n") && !billText().includes(" - 3"));
  check("bill: no table → no Table line (pickup / delivery)", !billText({ tableNumber: null, tableSection: "inner" }).includes("Table:"));
  // Compulsory: not behind any bill setting.
  const allOff = Object.fromEntries(Object.keys(billSettings).map((k) => [k, typeof billSettings[k] === "boolean" ? false : billSettings[k]]));
  check("bill: the Table line prints with every optional bill flag switched off (compulsory)", billText({ tableSection: "outer", tableNumber: "G1" }, allOff).includes("Table: Outer - G1\n"));
}

(async () => {
  for (const block of asyncBlocks) await block();
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx scripts/verify-table-section.ts`
Expected: the first, second, third and fifth bill checks FAIL (the bill prints no table line); `no table → no Table line` PASSES.

- [ ] **Step 3: Implement**

In `shared/print/generators.ts`:

(a) Order type. `old_string`:
```
  order: {
    orderNumber: string;
    tableNumber: string | null;
    customerName: string | null;
    orderType: string;
    totalAmount: string;
    taxAmount: string;
    discountAmount: string | null;
    subtotalAmount?: string | null;
    containerCharge?: string | null;
    deliveryCharge?: string | null;
    paymentMethod: string | null;
    billPrintCount: number;
    // NOT rendered.
```
`new_string`:
```
  order: {
    orderNumber: string;
    tableNumber: string | null;
    /** tables.section for tableNumber's table — printed as "Table: Inner - 3". */
    tableSection?: string | null;
    customerName: string | null;
    orderType: string;
    totalAmount: string;
    taxAmount: string;
    discountAmount: string | null;
    subtotalAmount?: string | null;
    containerCharge?: string | null;
    deliveryCharge?: string | null;
    paymentMethod: string | null;
    billPrintCount: number;
    // NOT rendered.
```

(b) The line. `old_string`:
```
  parts.push(bodyLine(timeStr));
  parts.push(tw(`Cashier: ${params.cashierName ?? "Admin"}`, `Bill No.: ${order.orderNumber}`));
```
`new_string`:
```
  parts.push(bodyLine(timeStr));
  // Compulsory — no bill setting hides it. The bill used to print no table at all, so staff couldn't tell
  // which table (or which section: Inner / Outer) a paper bill belonged to.
  const tableLabel = formatTableLabel(order.tableNumber, order.tableSection);
  if (tableLabel) parts.push(bodyLine(`Table: ${tableLabel}`));
  parts.push(tw(`Cashier: ${params.cashierName ?? "Admin"}`, `Bill No.: ${order.orderNumber}`));
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx scripts/verify-table-section.ts && npx tsx scripts/verify-escpos-interpret.ts`
Expected: both `RESULT: PASS ✅`. (If a `verify-escpos-interpret` bill check asserts an exact line count, it passes a table order — read its failure message and update that expectation only if it is purely the extra `Table:` line.)

- [ ] **Step 5: Commit**

```bash
git add shared/print/generators.ts scripts/verify-table-section.ts
git commit -m "Thermal bill: always print the Table line, with its section" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Print pipeline wiring + plain-text previews

No pure test can reach this (it needs the DB pool); `npm run check` covers the types and Task 11's render check covers the output.

**Files:**
- Modify: `server/services/printDispatch.ts`
- Modify: `server/printRoutes.ts`

- [ ] **Step 1: `printDispatch.ts` — import and look the section up**

(a) `old_string`: `import { logAudit } from "./auditService";` → `new_string`:
```ts
import { logAudit } from "./auditService";
import { tableSectionFor } from "../tableSections";
```

(b) In `runKotPrint`, after the order is resolved. `old_string`:
```
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  const currentSnapshot: SnapshotItem[] = rawItems.map((i) => ({
```
`new_string`:
```
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  // Inner / Outer for the ticket header. Served from the in-process cache (no I/O in steady state) and it
  // never throws — a lookup problem just prints the ticket without the section.
  const tableSection = await tableSectionFor(order.tableId);

  const currentSnapshot: SnapshotItem[] = rawItems.map((i) => ({
```

(c) Browser-fallback ticket. `old_string`:
```
    const fallbackTicket = generateKOTBuffer({
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
```
`new_string`:
```
    const fallbackTicket = generateKOTBuffer({
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      tableSection,
```

(d) Routed-printer tickets. `old_string`:
```
      buffer: generateKOTBuffer({
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
```
`new_string`:
```
      buffer: generateKOTBuffer({
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        tableSection,
```

(e) In `runBillAfterCatchUp`. `old_string`:
```
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  /** Every success exit goes through here: attach the catch-up result, then the optional flip. */
```
`new_string`:
```
  if (!order) return { ok: false, status: 404, message: "Order not found" };

  // Same cached, never-throwing lookup as the KOT — the bill's "Table: Inner - 3" line.
  const tableSection = await tableSectionFor(order.tableId);

  /** Every success exit goes through here: attach the catch-up result, then the optional flip. */
```

(f) The bill's order object. `old_string`:
```
    generateBillBuffer({
      order: {
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
```
`new_string`:
```
    generateBillBuffer({
      order: {
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        tableSection,
```

(g) Export the billed-flip helper for Task 8. `old_string`: `async function markTableBilled(order: OrderRow): Promise<void> {` → `new_string`: `export async function markTableBilled(order: OrderRow): Promise<void> {`

- [ ] **Step 2: `printRoutes.ts` — the plain-text twins and the preview route**

(a) Imports. `old_string`: `import * as E from "./escpos";` → `new_string`:
```ts
import * as E from "./escpos";
import { tableSectionFor } from "./tableSections";
import { tableSectionLabel, formatTableLabel } from "@shared/tableSection";
```

(b) `kotTextLines` params. `old_string`:
```
function kotTextLines(params: {
  orderNumber: string;
  tableNumber: string | null;
```
`new_string`:
```
function kotTextLines(params: {
  orderNumber: string;
  tableNumber: string | null;
  tableSection?: string | null;
```

(c) `kotTextLines` header. `old_string`:
```
  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : "TAKEAWAY";
  lines.push(center(`[ ${tableHeader} ]`));
```
`new_string`:
```
  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : "TAKEAWAY";
  const sectionHeader = params.tableNumber ? tableSectionLabel(params.tableSection)?.toUpperCase() : undefined;
  if (sectionHeader) lines.push(center(`[ ${sectionHeader} ]`));
  lines.push(center(`[ ${tableHeader} ]`));
```

(d) `billTextLines` order type. `old_string`:
```
function billTextLines(params: {
  order: {
    orderNumber: string;
    tableNumber: string | null;
```
`new_string`:
```
function billTextLines(params: {
  order: {
    orderNumber: string;
    tableNumber: string | null;
    tableSection?: string | null;
```

(e) `billTextLines` line. `old_string`:
```
  lines.push(body(timeStr));
  lines.push(two(`Cashier: ${params.cashierName ?? "Admin"}`, `Bill No.: ${order.orderNumber}`));
```
`new_string`:
```
  lines.push(body(timeStr));
  const tableLabel = formatTableLabel(order.tableNumber, order.tableSection);
  if (tableLabel) lines.push(body(`Table: ${tableLabel}`));
  lines.push(two(`Cashier: ${params.cashierName ?? "Admin"}`, `Bill No.: ${order.orderNumber}`));
```

(f) KOT preview call. `old_string`:
```
        const lines = kotTextLines({
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          kotNumber: kotNumStr,
```
`new_string`:
```
        const lines = kotTextLines({
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          tableSection: await tableSectionFor(order.tableId),
          kotNumber: kotNumStr,
```

(g) Bill preview call. `old_string`:
```
      const lines = billTextLines({
        order: {
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
```
`new_string`:
```
      const lines = billTextLines({
        order: {
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          tableSection: await tableSectionFor(order.tableId),
```
(`await` inside an object literal passed to a call is valid inside the enclosing `async` route handler.)

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors versus the baseline.

- [ ] **Step 4: Run the print-related pure scripts**

Run: `npx tsx scripts/verify-table-section.ts && npx tsx scripts/verify-kot-image.ts && npx tsx scripts/verify-kot-style.ts && npx tsx scripts/verify-escpos-interpret.ts`
Expected: four `RESULT: PASS ✅`.

- [ ] **Step 5: Commit**

```bash
git add server/services/printDispatch.ts server/printRoutes.ts
git commit -m "Print pipeline: look up the table section once and pass it to KOT, bill and previews" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: E-bill text carries the section

**Files:**
- Modify: `shared/ebillText.ts`
- Modify: `scripts/verify-ebill-text.ts`

- [ ] **Step 1: Write the failing tests**

In `scripts/verify-ebill-text.ts`, Edit, `old_string`: `let failed = 0;` → `new_string`:
```ts
// Table + section — the same "Table: Inner - 3" the thermal bill prints.
{
  const t = buildEbillText({ orderNumber: "S", tableNumber: "3", tableSection: "inner", totalAmount: "10", taxAmount: "0" }, []);
  checks.push(["table and section: 'Table: Inner - 3'", t.includes("Table: Inner - 3")]);
  const noSection = buildEbillText({ orderNumber: "S2", tableNumber: "3", totalAmount: "10", taxAmount: "0" }, []);
  checks.push(["no section: 'Table: 3'", noSection.includes("Table: 3") && !noSection.includes(" - 3")]);
  const noTable = buildEbillText({ orderNumber: "S3", tableSection: "inner", totalAmount: "10", taxAmount: "0" }, []);
  checks.push(["no table: no Table line even if a section is passed", !noTable.includes("Table:")]);
}

let failed = 0;
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx scripts/verify-ebill-text.ts`
Expected: `table and section: 'Table: Inner - 3'` FAILS.

- [ ] **Step 3: Implement**

In `shared/ebillText.ts`:

(a) Import. `old_string`: `import { deriveBillTotals } from "./orderPricing";` → `new_string`:
```ts
import { deriveBillTotals } from "./orderPricing";
import { formatTableLabel } from "./tableSection";
```

(b) Label. `old_string`:
```
  const { subtotal, discount, tax, containerCharge, deliveryCharge, total } = deriveBillTotals(order);
  return [
```
`new_string`:
```
  const { subtotal, discount, tax, containerCharge, deliveryCharge, total } = deriveBillTotals(order);
  // Same label as the thermal bill ("Inner - 3"); `order.tableSection` comes from the caller (the e-bill route).
  const tableLabel = formatTableLabel(order.tableNumber, order.tableSection);
  return [
```

(c) Line. `old_string`: ``    order.tableNumber ? `Table: ${order.tableNumber}` : null,`` → `new_string`: ``    tableLabel ? `Table: ${tableLabel}` : null,``

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx scripts/verify-ebill-text.ts`
Expected: `RESULT: PASS ✅` (the existing `Table: 7` check still passes — no section → name only).

- [ ] **Step 5: Commit**

```bash
git add shared/ebillText.ts scripts/verify-ebill-text.ts
git commit -m "E-bill text: print Table with its section" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `POST /api/orders/:id/ebill`

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: Imports**

(a) `old_string`: `import { getSettings, getSettingsFresh, saveSettings, incrementBillCounter, incrementKotCounter } from "./settingsStore";` → `new_string`:
```ts
import { getSettings, getLiveSettings, getSettingsFresh, saveSettings, incrementBillCounter, incrementKotCounter } from "./settingsStore";
```

(b) `old_string`: `import { runPrintStep, runKotPrint, instrumentJson, savedOrderSnapshot } from "./services/printDispatch";` → `new_string`:
```ts
import { runPrintStep, runKotPrint, instrumentJson, savedOrderSnapshot, markTableBilled } from "./services/printDispatch";
import { normalizeWaPhone, isValidWaPhone } from "./services/whatsapp/types";
import { buildEbillText } from "@shared/ebillText";
```

- [ ] **Step 2: Add the route** (directly after the `bill-requested` route, before "Table Action: Hold Order")

`old_string`:
```
  // ── Table Action: Hold Order ──────────────────────────────────────────────────
  app.put("/api/orders/:id/hold", requireAuth, async (req, res) => {
```
`new_string`:
```
  // ── WhatsApp e-bill (the POS cart's E-Bill button) ───────────────────────────
  // Builds the customer's bill text from the SAVED order — persisted numbers only, never anything the client
  // computed — and returns a wa.me link for staff to open and press Send. It sends nothing itself: no driver, no
  // outbound queue, no automation_jobs row, so staff can re-send after adding an item and the same-day
  // duplicate guard never gets involved. Deliberately not a print: billPrintCount (the paper "DUPLICATE"
  // watermark) is untouched; no loyalty, no audit row (it is not a deviation).
  app.post("/api/orders/:id/ebill", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid order id" });
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.status === "cancelled") return res.status(409).json({ error: "This order was cancelled", code: "cancelled" });
      const rawPhone = String(order.customerPhone ?? "");
      if (!isValidWaPhone(rawPhone)) {
        return res.status(400).json({ error: "Enter a valid customer WhatsApp number", code: "bad_phone" });
      }
      // A bill is a money document: real settings or a 503, never the built-in defaults (see settingsCache).
      const settings = getLiveSettings();
      const [items, tableSection] = await Promise.all([
        db
          .select({
            name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
            quantity: orderItems.quantity,
            price: orderItems.price,
          })
          .from(orderItems)
          .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
          .where(eq(orderItems.orderId, id))
          .orderBy(orderItems.id),
        tableSectionFor(order.tableId),
      ]);
      const text = buildEbillText(
        { ...order, tableSection },
        items,
        { restaurantName: settings.restaurantName, address: settings.address, footerNote: settings.footerNote },
      );
      const phone = normalizeWaPhone(rawPhone);
      // The same non-fatal "billed" flip the Bill button does: a table whose bill went out on WhatsApp reads
      // as billed on the Tables page (only a running order still holding its table flips).
      await markTableBilled(order);
      res.json({ text, phone, waUrl: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` });
    } catch (error: any) {
      res.status(error?.status ?? 500).json({ error: error?.message || "Failed to build e-bill" });
    }
  });

  // ── Table Action: Hold Order ──────────────────────────────────────────────────
  app.put("/api/orders/:id/hold", requireAuth, async (req, res) => {
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors. If it complains that `order.customerPhone` / `order.tableId` / `order.status` don't exist, `storage.getOrderById` returns a differently-typed row — read its return type in `server/storage.ts` and cast `(order as any)` the same way the neighbouring routes do (`(order as any).tableId`).

- [ ] **Step 4: No live probe (deliberate)**

Do **not** start `npm run dev` just to curl the route: a second full server on the shared DB double-starts the WhatsApp driver and the print/outbound workers (CLAUDE.md, "Database egress" and "Observability"). The route is a plain `app.post(..., requireAuth, ...)` covered by `npm run check`; its behaviour is exercised by Task 11's owner-gated manual check.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "Add POST /api/orders/:id/ebill: wa.me link built from the saved order" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: POS cart E-Bill button

**Files:**
- Modify: `client/src/pages/POS.tsx`

All edits are in this one file. Do them in order, then type-check once at the end.

- [ ] **Step 1: Imports**

(a) `old_string`: `import { Plus, Minus, X, ShoppingCart, Search, Trash2, Edit2, ArrowLeft, LayoutGrid, Printer, ChevronDown, Lock, User, Phone, Clock, MapPin } from "lucide-react";` → `new_string`: the same line with `MessageCircle` added after `Printer,`:
```ts
import { Plus, Minus, X, ShoppingCart, Search, Trash2, Edit2, ArrowLeft, LayoutGrid, Printer, MessageCircle, ChevronDown, Lock, User, Phone, Clock, MapPin } from "lucide-react";
```

(b) `old_string`: `import { useToast } from "@/hooks/use-toast";` → `new_string`:
```ts
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
```

(c) Remove the now-unused import. `old_string`: `import { buildEbillText } from "@shared/ebillText";\n` → `new_string`: (empty).

- [ ] **Step 2: Replace the dead `sendWhatsAppBill` helper with `openWaWindow`**

`old_string`:
```
function sendWhatsAppBill(order: any, items: any[] = [], settings?: any, targetWindow?: Window | null) {
  const phone = order.customerPhone?.replace(/\D/g, "");
  if (!phone) {
    if (targetWindow) targetWindow.close();
    return false;
  }
  // Built from the order's persisted numbers (shared/ebillText.ts) — the old inline version derived
  // Subtotal as total − tax, which folded the container charge into it and never printed the charge.
  const lines = buildEbillText(order, items, settings);
  const url = `https://wa.me/${phone.startsWith("91") ? phone : "91" + phone}?text=${encodeURIComponent(lines)}`;
  if (targetWindow) {
    targetWindow.location.href = url;
  } else {
    window.open(url, "_blank");
  }
  return true;
}
```
`new_string`:
```
/**
 * Points the window the E-Bill tap opened at the WhatsApp link, or opens one. false = nothing could be opened
 * (the caller then offers an "Open WhatsApp" action that runs from a fresh click).
 */
function openWaWindow(popup: Window | null, url: string): boolean {
  if (popup && !popup.closed) { popup.location.href = url; return true; }
  const w = window.open(url, "_blank");
  // Electron denies window.open() and hands the link to the system browser itself, so a null return there is
  // not "blocked".
  return !!w || !!window.electronAPI?.isElectron;
}
```

- [ ] **Step 3: A ref for the pre-opened window**

`old_string`: `  const submitModeRef = useRef<"kot" | "kot-print" | "save" | "save-print" | "save-ebill" | "settle" | "bill-print">("save");` → `new_string`:
```
  const submitModeRef = useRef<"kot" | "kot-print" | "save" | "save-print" | "save-ebill" | "settle" | "bill-print">("save");
  // The blank window an E-Bill tap opens synchronously (so popup blockers allow it); sendEbill() points it at
  // the wa.me link once the server has built the text, or closes it on failure.
  const ebillPopupRef = useRef<Window | null>(null);
```

- [ ] **Step 4: Both mutations' `save-ebill` branches**

(a) Create mutation. `old_string`:
```
      } else if (mode === "save-ebill") {
        toast({ title: "Order saved!", description: "WhatsApp bill sent" });
        setCartItems([]); setDiscountPercent(0); setContainerCharge(0); setDeliveryCharge(0); pendingKotCancellationsRef.current = {};
        navigate("/tables");
```
`new_string`:
```
      } else if (mode === "save-ebill") {
        // Stay on screen like Bill (Settle usually follows) and hand the SAVED order to the e-bill route.
        setActiveOrderId(order.id);
        setCartLoaded(false);
        void sendEbill(order.id);
```

(b) Update mutation. `old_string`:
```
      } else if (mode === "save-ebill") {
        toast({ title: "Order updated!", description: "WhatsApp bill sent" });
        setCartItems([]); setDiscountPercent(0); setContainerCharge(0); setDeliveryCharge(0); pendingKotCancellationsRef.current = {};
        navigate("/tables");
```
`new_string`:
```
      } else if (mode === "save-ebill") {
        void sendEbill(vars.orderId);
```

(c) Close the blank window when a save fails. Create's onError: `old_string`: `      setIsPrinting(false); // a failed create must not leave KOT/Bill buttons frozen either` → `new_string`:
```
      setIsPrinting(false); // a failed create must not leave KOT/Bill buttons frozen either
      if (submitModeRef.current === "save-ebill") closeEbillPopup();
```
Update's onError: `old_string`: `      setIsPrinting(false); // a failed update must not leave KOT/Bill buttons frozen either` → `new_string`:
```
      setIsPrinting(false); // a failed update must not leave KOT/Bill buttons frozen either
      if (submitModeRef.current === "save-ebill") closeEbillPopup();
```

- [ ] **Step 5: Replace the dead `handleSaveEBill` with the new handlers**

The old function spans from `  const handleSaveEBill = () => {` to its closing `  };`, with a blank line inside its message array that may carry trailing spaces — so remove it in two exact chunks, leaving that one blank line behind (harmless).

(a) Chunk A → the new code. `old_string`:
```
  const handleSaveEBill = () => {
    const go = () => {
      cancelPendingAutoKot();
      // Build and open WhatsApp URL right here — synchronous with user click, browser never blocks it
      const formData = form.getValues();
      const rawPhone = formData.customerPhone?.replace(/\D/g, "");
      if (!rawPhone) {
        toast({ title: "No phone number", description: "Enter a customer phone number first", variant: "destructive" });
        return;
      }
      const rName = settings?.restaurantName || "Bagicha Restaurant";
      const addr = settings?.address ? `\n${settings.address}` : "";
      const itemLines = cartItems.map(c => `  • ${c.name} × ${c.quantity}  ₹${(c.totalPrice * c.quantity).toFixed(0)}`).join("\n");
      const msgLines = [
        `🧾 *${rName}*${addr}`,
        ``,
        existingOrder?.orderNumber ? `Order: *${existingOrder.orderNumber}*` : null,
        formData.tableNumber ? `Table: ${formData.tableNumber}` : null,
        formData.customerName ? `Name: ${formData.customerName}` : null,
        ``,
        `*ITEMS*`,
        itemLines || "—",
        ``,
        `Subtotal: ₹${subtotal.toFixed(0)}`,
        discountAmt > 0 ? `Discount: -₹${discountAmt.toFixed(0)}` : null,
        `Tax: ₹${tax.toFixed(0)}`,
```
`new_string`:
```
  // ── E-Bill: save the cart, then open WhatsApp with the SAVED order's bill text ready ────────────────────────
  // The window is opened right here, during the tap, so popup blockers allow it (the pattern Reports' dues
  // e-bill uses); it is pointed at the wa.me link once the server has built the text, or closed on failure.
  const closeEbillPopup = () => {
    try { ebillPopupRef.current?.close(); } catch { /* ignore */ }
    ebillPopupRef.current = null;
  };
  const sendEbill = async (orderId: number) => {
    const popup = ebillPopupRef.current;
    ebillPopupRef.current = null;
    try {
      const res = await apiRequest("POST", `/api/orders/${orderId}/ebill`);
      const { waUrl } = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      if (openWaWindow(popup, waUrl)) {
        toast({ title: "E-bill ready", description: "Tap Send in WhatsApp" });
      } else {
        toast({
          title: "E-bill ready",
          description: "Your browser blocked the WhatsApp window.",
          action: <ToastAction altText="Open WhatsApp" onClick={() => window.open(waUrl, "_blank")}>Open WhatsApp</ToastAction>,
        });
      }
    } catch (err: any) {
      try { popup?.close(); } catch { /* ignore */ }
      toast({ title: "E-bill not sent", description: describeApiError(err).message, variant: "destructive" });
    } finally {
      setIsPrinting(false);
    }
  };
  const handleEBill = () => {
    const digits = (form.getValues("customerPhone") || "").replace(/\D/g, "");
    if (digits.length < 10) {
      toast({ title: "Customer number needed", description: "Enter the customer's WhatsApp number first", variant: "destructive" });
      return;
    }
    cancelPendingAutoKot();
    try { ebillPopupRef.current = window.open("", "_blank"); } catch { ebillPopupRef.current = null; }
    submitModeRef.current = "save-ebill";
    setIsPrinting(true);
    triggerSubmit();
  };
```

(b) Chunk B → delete the rest. `old_string`:
```
        containerCharge > 0 ? `Container Charge: ₹${containerCharge.toFixed(0)}` : null,
        deliveryCharge > 0 ? `Delivery Charge: ₹${deliveryCharge.toFixed(0)}` : null,
        `*TOTAL: ₹${grandTotal.toFixed(0)}*`,
        ``,
        settings?.footerNote || "Thank you for dining with us!",
      ].filter(l => l !== null).join("\n");
      const phone = rawPhone.startsWith("91") ? rawPhone : "91" + rawPhone;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msgLines)}`, "_blank");
      submitModeRef.current = "save-ebill";
      triggerSubmit();
    };
    go();
  };
```
`new_string`: (empty)

If chunk A's `old_string` does not match because of a whitespace difference, `Read` `client/src/pages/POS.tsx` around the `handleSaveEBill` definition and adapt the chunk boundaries; the end state is: no `handleSaveEBill`, `handleEBill`/`sendEbill`/`closeEbillPopup` present once each.

- [ ] **Step 6: The button — third column in the KOT | Bill row**

`old_string`:
```
            {/* KOT / Bill row */}
            <div className="grid grid-cols-2 gap-1">
```
`new_string`:
```
            {/* KOT / Bill / E-Bill row */}
            <div className="grid grid-cols-3 gap-1">
```

`old_string`:
```
                <Printer className="w-3 h-3" />
                Bill
                {isOff("printBill") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
            </div>
```
`new_string`:
```
                <Printer className="w-3 h-3" />
                Bill
                {isOff("printBill") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
              {/* WhatsApp e-bill: reuses the printBill permission (no new CartAction). Not in Section POS —
                  that mode has no customer-phone box to send to. */}
              <button
                disabled={!hasItems || isPending || isOff("printBill")}
                onClick={() => go("printBill", "Send E-Bill", handleEBill)}
                className="py-1.5 rounded text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                style={{ border: "1px solid var(--green-700)", color: "var(--green-800)", background: "var(--paper-100)" }}
              >
                <MessageCircle className="w-3 h-3" />
                E-Bill
                {isOff("printBill") && <Lock className="w-2.5 h-2.5 opacity-50" />}
              </button>
            </div>
```

- [ ] **Step 7: Confirm nothing dead is left, then type-check**

Run: `grep -n "handleSaveEBill\|sendWhatsAppBill\|buildEbillText" client/src/pages/POS.tsx`
Expected: no output.

Run: `npm run check`
Expected: no new errors versus the baseline. Likely fix-ups: if `ToastAction`'s `onClick` typing complains, wrap as `onClick={() => { window.open(waUrl, "_blank"); }}`; if `form.getValues("customerPhone")` is flagged, use `form.getValues().customerPhone`.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/POS.tsx
git commit -m "POS cart: E-Bill button (save, build text server-side, open WhatsApp); remove dead e-bill code" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the two paragraphs before "Header centering"**

Edit, `old_string`: ``**Header centering (`generateBillBuffer` only):**`` → `new_string`:
```
**Table section (Inner / Outer / …) is printed on every dine-in KOT, bill and e-bill — compulsory on the bill.** `tables.section` is looked up by `order.tableId` at print time (`server/tableSections.ts`'s `tableSectionFor`), **not** snapshotted on `orders`: no migration, and Move Table / table shift (which rewrite `tableId`) are followed for free. The lookup goes through `server/tableSectionCache.ts` — a per-process, **stale-while-revalidate** map of the whole `tables` list (60 s TTL; the first lookup on an instance waits for one load, afterwards a print never waits on a refresh; a failed load keeps the last good map and retries after 10 s; a load stuck 15 s is replaced; `get` **never throws** — a failure just prints the ticket without the section). `forgetTableSections()` runs after `POST/PUT/DELETE /api/tables` (it also discards a load already in flight); other Vercel instances are stale for ≤ 60 s. `runKotPrint` and `runBillAfterCatchUp` call it once and pass `tableSection` to `generateKOTBuffer` (text style: an uppercased double-size `INNER` line above `TABLE - 3`; image style: a bold `INNER` line between "Dine In" and "Table No") and `generateBillBuffer` (a `Table: Inner - 3` line after the time, before Cashier — **no bill setting hides it; the bill used to print no table at all**). `shared/tableSection.ts`'s `formatTableLabel(name, section)` is the one formatter for the thermal bill, its plain-text twin (`billTextLines`) and `buildEbillText`, so they can't drift. Takeaway/pickup/delivery tickets (no `tableNumber`) never carry a section. Locked by `scripts/verify-table-section.ts` (in `test:pure`); the plain-text twins in `printRoutes.ts` import the DB pool and are covered by `npm run check` plus the `/api/print/preview` output.

**E-Bill button (POS cart) — a manual `wa.me` send, not a driver send.** `POST /api/orders/:id/ebill` (`requireAuth`) builds the customer's WhatsApp text from the **saved** order (persisted numbers via `buildEbillText`/`deriveBillTotals`, item names `order_items.name`-first, `getLiveSettings()` for the restaurant block → 503 rather than defaults, `Table: Inner - 3` via the section cache) and returns `{ text, phone, waUrl }`; it sends nothing, enqueues no `automation_jobs` row, writes no audit row, and does **not** bump `billPrintCount` (that drives the paper "DUPLICATE" watermark) — so staff can re-send after adding an item and the outbound queue's same-day duplicate guard is never involved. It does flip a running table to `billed` through the same non-fatal helper the Bill button uses (`markTableBilled`, exported from `printDispatch.ts`). The cart's `E-Bill` button (KOT | Bill | E-Bill row, **reuses the `printBill` `CartAction`** — no new permission; absent from Section POS, which has no customer-phone box) requires a phone of ≥ 10 digits, opens a blank window **during the tap** (popup-blocker-safe, same pattern as Reports' dues e-bill; Electron allows `about:blank`), saves the cart exactly as Bill does (`submitModeRef = "save-ebill"` → create or `PUT /items`, no print), then calls the route and points that window at `waUrl`; it **stays on screen like Bill** (the dead pre-redesign handler cleared the cart and navigated to /tables). If no window could be opened (a PIN-gated tap loses the click's activation) a toast offers an "Open WhatsApp" action. The old `handleSaveEBill`/`sendWhatsAppBill` — which built the text from the *cart* with its own inline layout — are deleted; don't resurrect a client-built e-bill.

**Header centering (`generateBillBuffer` only):**
```

- [ ] **Step 2: Verify the edit landed once**

Run: `grep -c "Table section (Inner / Outer" CLAUDE.md && grep -c "E-Bill button (POS cart)" CLAUDE.md`
Expected: `1` and `1`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: document the table-section print line and the POS E-Bill button" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verify everything

**Files:** none are committed in this task (the render script is deleted).

- [ ] **Step 1: Full pure suite and type-check**

Run: `npm run check`
Expected: no errors beyond the Task 1 baseline.

Run: `npm run test:pure`
Expected: the whole chain exits 0 (the new script is last). Any failure in an older script is a regression from this branch — investigate before continuing.

- [ ] **Step 2: Look at the actual printed output (no printer, no DB)**

Create `scripts/tmp-render-table-section.ts`:
```ts
import { generateKOTBuffer, generateBillBuffer } from "../shared/print/generators";
import { buildEbillText } from "../shared/ebillText";

const strip = (b: Buffer) => b.toString("latin1").replace(/\x1b[!E@a-z][\x00-\x7f]?|\x1d\x56..|\x1d\x76.{7}[\s\S]*/g, "");
const kotSettings = { printAddons: true, printModifiedItemsOnly: true, printCancelledKOT: true, showDuplicateWatermark: true, kotNumbering: true } as any;
const kot = (tableNumber: string | null, tableSection: string | null) =>
  generateKOTBuffer({ orderNumber: "1", tableNumber, tableSection, kotNumber: 12, isReprint: false, isDelta: false, newItems: [{ name: "Hakka Noodles", quantity: 1, serviceMode: "dinein" }], modifiedItems: [], cancelledItems: [], kotSettings, width: 48 });
console.log("---- KOT inner 3 ----\n" + strip(kot("3", "inner")).split("\n").slice(0, 6).join("\n"));
console.log("---- KOT outer G1 ----\n" + strip(kot("G1", "outer")).split("\n").slice(0, 6).join("\n"));
console.log("---- KOT takeaway ----\n" + strip(kot(null, "inner")).split("\n").slice(0, 4).join("\n"));
const billSettings: any = { showLogo: false, showFssai: false, showAddons: true, taxDisplay: "none", showRoundOff: true, billPrinterId: "p1", itemPriceMode: "exclusive", showDuplicate: true, showNameField: false, showKotAsToken: false, showBackwardTax: true, showOrderBarcode: false, mergeDuplicateItems: true, showCustomerPayment: false, showQuantityBreakdown: false };
const restaurant = { restaurantName: "Bagicha Restaurant", businessName: "", address: "Raigarh", phone: "", gstNumber: "", fssaiNumber: "", taxRate: 5, currencySymbol: "₹", footerNote: "Thank you!" };
const order = { orderNumber: "ORD0388", tableNumber: "3", tableSection: "inner", customerName: null, orderType: "Dine In", totalAmount: "387.45", taxAmount: "18.45", discountAmount: "0.00", subtotalAmount: "369.00", containerCharge: "0.00", paymentMethod: null, billPrintCount: 0, createdAt: new Date() };
console.log("---- BILL head ----\n" + strip(generateBillBuffer({ order, items: [{ name: "Mix Sauce Pasta", quantity: 1, price: "299" }], restaurant, billSettings, cashierName: "rajbhaghel", width: 48 })).split("\n").slice(0, 9).join("\n"));
console.log("---- E-BILL ----\n" + buildEbillText(order, [{ name: "Mix Sauce Pasta", quantity: 1, price: "299" }], { restaurantName: "Bagicha Restaurant", footerNote: "Thank you!" }).split("\n").slice(0, 6).join("\n"));
```
Run: `npx tsx scripts/tmp-render-table-section.ts`
Expected, visually: the KOT heads show `INNER` / `TABLE - 3` and `OUTER` / `TABLE - G1` on separate lines, the takeaway KOT shows `TAKEAWAY` with no section, the bill head shows `Table: Inner - 3` between the time and Cashier lines, and the e-bill shows `Table: Inner - 3`.

Then delete it: `rm scripts/tmp-render-table-section.ts` and confirm `git status --short` shows nothing untracked.

- [ ] **Step 3: Manual browser verification — ONLY with the owner's go-ahead**

Do **not** run this unprompted: it writes real rows to the shared production DB, and during service a test order on a real table shows as occupied on the Tables page. Ask the owner first and agree a quiet moment. If approved, follow CLAUDE.md's "Verifying a UI change in a real browser" and "Removing a few test orders by hand":
1. Restart the server (`npm run dev` has no server hot-reload) on a private Pusher channel: `$env:PUSHER_CHANNEL="private-bagicha-dev-<random>"; npm run dev`.
2. Log in with the dev login from `.claude.local.md`; open a **pickup** order (no table, so no real table is occupied) and add one item; mark it `ZZTEST-` in the order notes, no customer name, a dummy 10-digit phone.
3. Check: with the phone box empty the E-Bill button toasts "Customer number needed" and saves nothing; with the phone filled it saves, a WhatsApp window opens with the bill text (items, subtotal, tax, total match the saved order), the cart stays open, and Settle is still available.
4. For the section line on a real table order: only if the owner also approves occupying one table briefly — confirm the e-bill text and the `/api/print/preview` KOT/bill show `Inner - <name>`; then Cancel Order through the app.
5. Clean up through the app's own Cancel Order; if a scripted delete is needed, snapshot to `backups/` first and restore the `orders.id` sequence with the max-based transaction in CLAUDE.md.

- [ ] **Step 4: Final state check**

Run: `git status --short && git log --oneline main..HEAD`
Expected: a clean tree and the commits from Tasks 0–10 on `table-section-on-kot-bill`.

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Section label helper + `formatTableLabel` shared by bill, twin, e-bill | 1, 5, 6, 7 |
| In-process cache, stale-while-revalidate, never throws, forget on table writes | 2 |
| KOT text: section line above the table line, takeaway unchanged | 3 |
| KOT image: section line between Dine In and Table No | 4 |
| Bill: compulsory `Table: Inner - 3`, fallback `Table: 3`, none without a table | 5 |
| `runKotPrint` (2 sites), `runBillAfterCatchUp`, previews wired | 6 |
| E-bill text prints the same line | 7 |
| `POST /api/orders/:id/ebill` (persisted numbers, phone validation, billed flip, no print/audit/queue) | 8 |
| POS button (third column, `printBill` gate, phone required, save → route → wa.me, stays on screen, dead code removed) | 9 |
| CLAUDE.md docs for both parts | 10 |
| Tests (`verify-table-section`, `verify-ebill-text`), `npm run check`, `test:pure`, manual browser check | 1–7, 11 |
| Spec corrections found while planning | 0 |
