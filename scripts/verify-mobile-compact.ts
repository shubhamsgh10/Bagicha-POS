/**
 * Verifies the pure helpers behind the compact mobile Tables + POS screens:
 * - filterTablesByStatus: Running filter = every occupied table (running + billed), Free = free only.
 * - floorStaffChips: running tables grouped by server, unknown server → "—", order of first appearance.
 * - settleButtonLabel / cartTotalsHint: the text on the compact Settle button and totals handle.
 * Run: npx tsx scripts/verify-mobile-compact.ts
 */
import { filterTablesByStatus, floorStaffChips } from "../client/src/lib/tablesMobile";
import { settleButtonLabel, cartTotalsHint } from "../client/src/lib/posMobile";

const checks: Array<[string, boolean]> = [];
const fmt = (n: number) => `₹${n.toFixed(0)}`;

const tables = [
  { id: 1, name: "1", status: "free", servedByName: null },
  { id: 2, name: "2", status: "running", servedByName: "Raj" },
  { id: 3, name: "3", status: "billed", servedByName: "Raj" },
  { id: 4, name: "G1", status: "running", servedByName: "Asha" },
  { id: 5, name: "G2", status: "running", servedByName: "Raj" },
  { id: 6, name: "G3", status: "running", servedByName: "  " },
];

checks.push(["no filter returns every table", filterTablesByStatus(tables, null).length === 6]);
checks.push(["free filter returns only free",
  filterTablesByStatus(tables, "free").map(t => t.id).join(",") === "1"]);
checks.push(["running filter returns running + billed",
  filterTablesByStatus(tables, "running").map(t => t.id).join(",") === "2,3,4,5,6"]);

const chips = floorStaffChips(tables);
checks.push(["chips group running tables by server in first-seen order",
  JSON.stringify(chips) === JSON.stringify([
    { name: "Raj", tables: ["2", "G2"] },
    { name: "Asha", tables: ["G1"] },
    { name: "—", tables: ["G3"] },
  ])]);
checks.push(["billed tables are not on the floor list", !chips.some(c => c.tables.indexOf("3") >= 0)]);
checks.push(["no running tables → no chips", floorStaffChips([tables[0]]).length === 0]);

checks.push(["settle label, empty cart", settleButtonLabel({ phase: "idle", busy: false, total: 0, lines: 0, fmt }) === "Settle"]);
checks.push(["settle label, one line", settleButtonLabel({ phase: "idle", busy: false, total: 149, lines: 1, fmt }) === "Settle ₹149 · 1 item"]);
checks.push(["settle label, many lines", settleButtonLabel({ phase: "idle", busy: false, total: 1312.6, lines: 5, fmt }) === "Settle ₹1313 · 5 items"]);
checks.push(["settle label while printing", settleButtonLabel({ phase: "printing", busy: false, total: 10, lines: 1, fmt }) === "Printing…"]);
checks.push(["settle label while processing", settleButtonLabel({ phase: "processing", busy: false, total: 10, lines: 1, fmt }) === "…"]);
checks.push(["settle label while the mutation runs", settleButtonLabel({ phase: "idle", busy: true, total: 10, lines: 1, fmt }) === "…"]);

checks.push(["totals hint collapsed", cartTotalsHint({ open: false, subtotal: 1276, tax: 64, fmt }) === "Subtotal ₹1276 · tax ₹64 · discount & charges"]);
checks.push(["totals hint open", cartTotalsHint({ open: true, subtotal: 1276, tax: 64, fmt }) === "Bill details"]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
if (failed) process.exit(1);
