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
import { generateKOTBuffer } from "../shared/print/generators";
import { renderKotBitmap, KOT_IMAGE_STYLE } from "../shared/print/kotImage";
import { interpretEscPos } from "../shared/print/escposInterpret";
import { browserPayloadsOf, withBrowserPayloads, splitEscPosAtCuts } from "../shared/print/browserPayload";

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

// ── Station header ──
const kotSettings = {
  enabled: true, printModifiedKOT: true, printModifiedItemsOnly: true, printCancelledKOT: true, printAddons: true,
  showDuplicateWatermark: true, kotNumbering: true,
} as any;
const ticketBase = {
  orderNumber: "1", tableNumber: "5", kotNumber: 42, isReprint: false, isDelta: false,
  newItems: [{ name: "Masala Dosa", quantity: 1, serviceMode: "dinein" }],
  modifiedItems: [], cancelledItems: [], width: 48, now: new Date("2026-11-11T07:30:00Z"),
};
const text = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" }, stationName: "South Indian" });
check("text style: station name uppercased on the ticket", text.includes("SOUTH INDIAN"));
check("text style: reverse (white-on-black) on", text.indexOf(Buffer.from([0x1d, 0x42, 0x01])) >= 0);
check("text style: triple size for a short name", text.indexOf(Buffer.from([0x1d, 0x21, 0x22])) >= 0);
check("text style: size + reverse reset after the header", text.indexOf(Buffer.from([0x1d, 0x21, 0x00])) > text.indexOf(Buffer.from([0x1d, 0x21, 0x22])) && text.indexOf(Buffer.from([0x1d, 0x42, 0x00])) >= 0);
check("text style: header comes before the table line", text.indexOf("SOUTH INDIAN") < text.indexOf("TABLE - 5"));
// 48 cols: triple fits 16 chars (incl. the 2 padding spaces), double 24. "Tandoor and Breads" = 20 → double.
const longName = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" }, stationName: "Tandoor and Breads" });
check("text style: a long name drops to double size", longName.indexOf(Buffer.from([0x1d, 0x21, 0x11])) >= 0 && longName.indexOf(Buffer.from([0x1d, 0x21, 0x22])) < 0);
const hugeName = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" }, stationName: "Tandoor and Indian Breads" });
check("text style: a very long name drops to normal size", hugeName.indexOf(Buffer.from([0x1d, 0x21, 0x11])) < 0 && hugeName.indexOf(Buffer.from([0x1d, 0x21, 0x22])) < 0 && hugeName.includes("TANDOOR AND INDIAN BREADS"));
const plain = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" } });
check("text style: no station → no reverse header", plain.indexOf(Buffer.from([0x1d, 0x42, 0x01])) < 0);

const imgPlain = renderKotBitmap({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "image" } })!;
const imgStation = renderKotBitmap({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "image" }, stationName: "South Indian" })!;
check("image style: renders with a station", !!imgStation);
check("image style: header adds at least the bar's height", imgStation.heightDots >= imgPlain.heightDots + Math.round(KOT_IMAGE_STYLE.station * 1.2));
const wbS = Math.ceil(imgStation.widthDots / 8);
const inkRow = (y: number) => { let n = 0; for (let x = 0; x < imgStation.widthDots; x++) if (imgStation.bits[y * wbS + (x >> 3)] & (0x80 >> (x & 7))) n++; return n; };
const barRowY = KOT_IMAGE_STYLE.padTop + 2;
check("image style: the very top is a black bar across the paper", inkRow(barRowY) > imgStation.widthDots * 0.85);
check("image style: the bar has white letters in it", (() => { for (let y = barRowY; y < barRowY + KOT_IMAGE_STYLE.station; y++) if (inkRow(y) < imgStation.widthDots * 0.8) return true; return false; })());
check("image style: margins stay white", (() => { for (let y = 0; y < imgStation.heightDots; y++) { for (let x = 0; x < KOT_IMAGE_STYLE.marginX - 2; x++) if (imgStation.bits[y * wbS + (x >> 3)] & (0x80 >> (x & 7))) return false; } return true; })());

// Two image tickets for one printer → the virtual printer sees two cuts.
const two = Buffer.concat([
  generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "image" }, stationName: "Main Course" }),
  generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "image" }, stationName: "Pizza" }),
]);
const cutCount = (b: Buffer) => { let n = 0, i = -1; const c = Buffer.from([0x1d, 0x56, 0x41, 0x00]); while ((i = b.indexOf(c, i + 1)) >= 0) n++; return n; };
check("a joined printer job has one cut per station ticket", cutCount(two) === 2);
check("the joined job still interprets (rasters present)", interpretEscPos(new Uint8Array(two), 48).items.some((i: any) => i.type === "raster"));

// ── Browser-print fallback (Electron host, client-side): one payload per ticket of a joined job ──
{
  const CUT = Buffer.from([0x1d, 0x56, 0x41, 0x00]);
  const b64 = (b: Buffer) => b.toString("base64");
  const lift = (buf: Buffer, width = 48) =>
    browserPayloadsOf(withBrowserPayloads({ printJob: { printerId: "p1", data: b64(buf) } } as any, () => width));
  const bytesOf = (p: { data: string }) => Buffer.from(p.data, "base64");

  const imgA = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "image" }, stationName: "Main Course" });
  const imgB = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "image" }, stationName: "Pizza" });
  const imgPayloads = lift(Buffer.concat([imgA, imgB]));
  check("fallback: two joined image tickets → 2 payloads", imgPayloads.length === 2);
  check("fallback: each payload is exactly its ticket's bytes (cut stays with the ticket before it)",
    imgPayloads.length === 2 && bytesOf(imgPayloads[0]).equals(imgA) && bytesOf(imgPayloads[1]).equals(imgB));
  check("fallback: every payload ends with its cut and has just that one", imgPayloads.every((p) => {
    const b = bytesOf(p); return b.subarray(b.length - 4).equals(CUT) && cutCount(b) === 1;
  }));
  check("fallback: the payloads keep the printer width", imgPayloads.every((p) => p.width === 48));
  check("fallback: each split payload still interprets with its raster", imgPayloads.every((p) =>
    interpretEscPos(new Uint8Array(bytesOf(p)), 48).items.some((i: any) => i.type === "raster")));

  const txtA = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" }, stationName: "Main Course" });
  const txtB = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" }, stationName: "Pizza" });
  const txtC = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" } });
  const txtPayloads = lift(Buffer.concat([txtA, txtB, txtC]), 32);
  check("fallback: three joined text tickets → 3 payloads in print order", txtPayloads.length === 3
    && bytesOf(txtPayloads[0]).includes("MAIN COURSE") && bytesOf(txtPayloads[1]).includes("PIZZA") && !bytesOf(txtPayloads[2]).includes("PIZZA"));
  check("fallback: width comes from the printer for every split payload", txtPayloads.every((p) => p.width === 32));

  // Single-ticket job: untouched — same base64 string, one payload.
  const one = lift(imgA);
  check("fallback: a single ticket stays ONE payload with the original data string", one.length === 1 && one[0].data === b64(imgA));
  check("fallback: single text ticket unchanged too", lift(txtA).length === 1 && lift(txtA)[0].data === b64(txtA));

  // No trailing cut (e.g. a bill): the tail is kept as the last piece; a stream that ENDS on a cut has no empty piece.
  const noCut = Buffer.concat([txtA.subarray(0, txtA.length - 4), Buffer.from("tail")]);
  check("fallback: bytes after the last cut form a final payload", lift(Buffer.concat([txtA, noCut])).length === 2);
  check("fallback: nothing after the last cut → no empty payload", lift(Buffer.concat([txtA, txtB])).length === 2);

  // A look-alike cut inside raster data must NOT split the ticket: GS v 0 m xL=2 xH=0 yL=4 yH=0 → 8 data bytes
  // (01 02, a cut-like 1d 56 41 00, 03 04).
  const lookalike = Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x04, 0x00, 0x01, 0x02]), CUT, Buffer.from([0x03, 0x04]),
    Buffer.from("after raster\n"), CUT,
  ]);
  check("fallback: a cut-like byte run inside raster data is not a ticket boundary", splitEscPosAtCuts(new Uint8Array(lookalike)).length === 1);
  check("fallback: the cut after the raster still splits", splitEscPosAtCuts(new Uint8Array(Buffer.concat([lookalike, lookalike]))).length === 2);

  // Several jobs (two printers): each job split on its own, order preserved, each with its own width.
  const multi = browserPayloadsOf(withBrowserPayloads(
    { printJobs: [{ printerId: "p1", data: b64(Buffer.concat([txtA, txtB])) }, { printerId: "p2", data: b64(txtC) }] } as any,
    (id) => (id === "p2" ? 32 : 48),
  ));
  check("fallback: multi-printer response → tickets flattened in order with per-printer widths",
    multi.length === 3 && multi[0].width === 48 && multi[1].width === 48 && multi[2].width === 32);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
