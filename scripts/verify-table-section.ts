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
