/**
 * Verifies the table-section feature (spec: docs/superpowers/specs/2026-11-07-table-section-on-kot-bill-design.md):
 * the label helper, the in-process section cache, and the KOT / bill output that carries the section.
 * Pure — no printer, no DB, no network.
 * Run: npx tsx scripts/verify-table-section.ts
 */
import { tableSectionLabel, formatTableLabel } from "../shared/tableSection";

import { createTableSectionCache } from "../server/tableSectionCache";

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
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
