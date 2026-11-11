/**
 * Verifies KOT kitchen stations (shared/kotStations.ts): skip rules, station membership, grouping order,
 * per-printer job assembly. Pure — no printer, no DB.
 * Run: npx tsx scripts/verify-kot-stations.ts
 */
import {
  isKotSkipped, filterKotSkipped, hasSkipRules, stationFor, groupByStation, assemblePrinterJobs, GENERAL_STATION_KEY,
} from "../shared/kotStations";
import { computeDelta } from "../shared/kotDelta";
import type { KitchenStationsSettings, SkipKotSettings } from "../shared/print/types";

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

// Categories: 1 Main Course, 2 Combos, 3 Indian Bread, 4 Woodfire Pizza, 5 Wok Style, 6 Beverages, 7 Desserts
const CAT: Record<number, number> = { 10: 1, 11: 2, 12: 3, 20: 4, 30: 5, 40: 6, 41: 6, 50: 7 };
const catOf = (id: number) => CAT[id];
const cfg: KitchenStationsSettings = {
  enabled: true,
  generalName: "General",
  stations: [
    { id: "a", name: "Main Course", categoryIds: [1, 2, 3] },
    { id: "b", name: "Pizza", categoryIds: [4] },
    { id: "c", name: "Chinese", categoryIds: [5, 1] }, // 1 duplicated: first station wins
  ],
};
const skip: SkipKotSettings = { categoryIds: [7], itemIds: [40] }; // Desserts category + Mineral Water item

// ── Skip rules ──
check("an item in skip.itemIds is skipped", isKotSkipped(40, 6, skip));
check("another item of the same category is not", !isKotSkipped(41, 6, skip));
check("an item whose category is skipped is skipped", isKotSkipped(50, 7, skip));
check("an open item (negative id) is never skipped", !isKotSkipped(-5, undefined, { categoryIds: [], itemIds: [-5] }));
check("no skip settings → nothing skipped", !isKotSkipped(40, 6, undefined));
check("hasSkipRules false for empty lists", !hasSkipRules({ categoryIds: [], itemIds: [] }));
check("hasSkipRules true with an item", hasSkipRules(skip));
check("filterKotSkipped drops only skipped items", filterKotSkipped(
  [{ itemId: 10 }, { itemId: 40 }, { itemId: 50 }, { itemId: 41 }], catOf, skip,
).map((i) => i.itemId).join(",") === "10,41");

// ── Station membership ──
check("category in a station → that station", stationFor(4, cfg).name === "Pizza");
check("several categories map to one station", stationFor(2, cfg).key === stationFor(3, cfg).key && stationFor(3, cfg).name === "Main Course");
check("duplicated category → first station in list", stationFor(1, cfg).name === "Main Course");
check("unassigned category → General", stationFor(6, cfg).key === GENERAL_STATION_KEY && stationFor(6, cfg).name === "General");
check("no category (open item) → General", stationFor(null, cfg).key === GENERAL_STATION_KEY);
check("custom General name is used", stationFor(6, { ...cfg, generalName: "Counter" }).name === "Counter");
check("blank General name falls back to 'General'", stationFor(6, { ...cfg, generalName: "  " }).name === "General");
check("stations disabled → one group, no header", stationFor(4, { ...cfg, enabled: false }).name === null);
check("enabled with no stations → no header", stationFor(4, { ...cfg, stations: [] }).name === null);

// ── Grouping ──
const groups = groupByStation(
  {
    newItems: [{ itemId: 41 }, { itemId: 20 }, { itemId: 10 }, { itemId: 12 }, { itemId: -3 }],
    modifiedItems: [{ itemId: 30 }],
    cancelledItems: [{ itemId: 20 }],
  },
  catOf,
  cfg,
);
check("groups come in station-list order, General last", groups.map((g) => g.name).join("|") === "Main Course|Pizza|Chinese|General");
check("Main Course ticket holds both of its categories", groups[0].newItems.map((i) => i.itemId).join(",") === "10,12");
check("a VOID goes to its own station's ticket", groups[1].cancelledItems.length === 1 && groups[1].newItems.length === 1);
check("a modified line goes to its station", groups[2].modifiedItems[0]?.itemId === 30 && groups[2].newItems.length === 0);
check("open item + unassigned category on General", groups[3].newItems.map((i) => i.itemId).join(",") === "41,-3");
check("only stations with something get a ticket", groupByStation({ newItems: [{ itemId: 20 }], modifiedItems: [], cancelledItems: [] }, catOf, cfg).length === 1);
check("stations off → exactly one group", groupByStation({ newItems: [{ itemId: 20 }, { itemId: 10 }], modifiedItems: [], cancelledItems: [] }, catOf, { ...cfg, enabled: false }).length === 1);

// ── Delta with skipped items on both sides (the Mineral Water case) ──
const snap = (itemId: number, quantity = 1) => ({ itemId, name: String(itemId), quantity, size: null, serviceMode: "dinein" });
const last = [snap(10), snap(40)];               // an old order whose water WAS printed
const current = [snap(10), snap(40, 2)];          // water bumped at the end of the meal
const d1 = computeDelta(filterKotSkipped(current, catOf, skip), filterKotSkipped(last, catOf, skip));
check("water bump alone → no new / modified / cancelled lines", d1.newItems.length + d1.modifiedItems.length + d1.cancelledItems.length === 0);
const d2 = computeDelta(filterKotSkipped([snap(10)], catOf, skip), filterKotSkipped(last, catOf, skip));
check("removing printed water → no VOID Water", d2.cancelledItems.length === 0);
const d3 = computeDelta(filterKotSkipped([snap(10), snap(40), snap(20)], catOf, skip), filterKotSkipped(last, catOf, skip));
check("a real dish next to water still prints", d3.newItems.length === 1 && d3.newItems[0].itemId === 20);

// ── One job per printer ──
const P1 = { id: "p1" }; const P2 = { id: "p2" };
const T = (s: string) => Buffer.from(s);
const jobs = assemblePrinterJobs([
  { printer: P1, buffer: T("A") }, { printer: P2, buffer: T("B") }, { printer: P1, buffer: T("C") },
]);
check("one job per printer", jobs.length === 2);
check("a printer's tickets are joined in order", jobs[0].printer.id === "p1" && jobs[0].buffer.toString() === "AC");
check("each job keeps its separate tickets (browser fallback)", jobs[0].tickets.length === 2 && jobs[1].tickets.length === 1);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
