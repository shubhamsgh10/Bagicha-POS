# KOT Kitchen Stations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One KOT tap prints one ticket per kitchen station (a chef = a set of categories) with a big black-bar station header, cut apart on the single printer, plus a "Don't print on KOT" list that removes chosen categories/items from every KOT and from the Kitchen screen.

**Architecture:** Settings live in `printSettings.kot` (`kitchenStations`, `skipKot`) — no DB migration. A pure module `shared/kotStations.ts` decides skipping, station membership, grouping and per-printer job assembly. `runKotPrint` filters skipped items on both sides of the delta, groups by station then printer, renders one ticket per (station, printer) and joins each printer's tickets into one print job. Save routes filter skipped items from the Kitchen-screen ticket. Admin edits it in a new component file.

**Tech Stack:** TypeScript, Express, Drizzle, React + TanStack Query, ESC/POS (raw + `GS v 0` raster), `tsx` verify scripts (`npm run test:pure`).

Spec: `docs/superpowers/specs/2026-11-11-kot-kitchen-stations-design.md`. Branch: `kot-kitchen-stations`.

**Repo rules that bite here (from CLAUDE.md):**
- `tsconfig` has no `target`: never `for…of`/spread a `Map`/`Set` — use `Array.from(...)`.
- `scripts/` is not type-checked by `npm run check`; validate scripts by running them with `tsx`.
- The server doesn't hot-reload; `DATABASE_URL` is the shared production DB — no live DB testing in this plan.
- Never commit `.js` twins inside `shared/`.

---

## File map

| File | Change |
|---|---|
| `shared/print/types.ts` | + `KitchenStation`, `KitchenStationsSettings`, `SkipKotSettings`; two optional fields on `KOTPrintSettings` |
| `server/settingsStore.ts` | defaults for the two fields |
| `shared/kotStations.ts` | **new** — pure rules |
| `scripts/verify-kot-stations.ts` | **new** — tests; added to `test:pure` |
| `shared/print/escpos.ts` | + `REVERSE_ON/OFF`, `charSize()` |
| `shared/print/generators.ts` | `stationName` param + text-style header |
| `shared/print/kotImage.ts` | `stationName` param + image-style header, `KOT_IMAGE_STYLE.station` |
| `server/services/printDispatch.ts` | `runKotPrint`: skip filter, station grouping, one job per printer |
| `shared/orderItemsSave.ts` | (unchanged API) — callers filter |
| `server/storage.ts` | `createOrderWithItems` kot param optional |
| `server/routes.ts` | POST `/api/orders` + PUT `/api/orders/:id/items` drop skipped items from the Kitchen ticket |
| `server/printRoutes.ts` | `/api/print/preview` KOT: skip + per-station sections |
| `client/src/components/print-settings/KitchenStationsSection.tsx` | **new** — Stations + Don't-print cards |
| `client/src/components/PrintSettingsPanel.tsx` | types/defaults + mount the new cards |
| `CLAUDE.md` | one paragraph under Printing |

---

### Task 1: Settings types and defaults

**Files:**
- Modify: `shared/print/types.ts:34-36`
- Modify: `server/settingsStore.ts:146`

- [ ] **Step 1: Add the types**

In `shared/print/types.ts`, inside `KOTPrintSettings` after `categoryPrinterOverrides`, add:

```ts
  /** One KOT ticket per kitchen station (a chef = a set of categories). Off = one ticket per printer, as before. */
  kitchenStations?: KitchenStationsSettings;
  /** Categories / menu items that never go on any KOT nor on the Kitchen screen (still billed). */
  skipKot?: SkipKotSettings;
```

and below the interface:

```ts
export interface KitchenStation {
  id: string;
  name: string;
  categoryIds: number[];
}

export interface KitchenStationsSettings {
  enabled: boolean;
  /** Print order = list order; the General ticket prints last. A category in two stations belongs to the first. */
  stations: KitchenStation[];
  /** Header of the ticket for items whose category is in no station. */
  generalName: string;
}

export interface SkipKotSettings {
  categoryIds: number[];
  itemIds: number[];
}
```

- [ ] **Step 2: Defaults**

In `server/settingsStore.ts` `DEFAULT_PRINT_SETTINGS.kot`, after `categoryPrinterOverrides: {},` add:

```ts
    kitchenStations: { enabled: false, stations: [], generalName: 'General' },
    skipKot: { categoryIds: [], itemIds: [] },
```

(The existing `kot: { ...DEFAULT_PRINT_SETTINGS.kot, ...saved }` merge supplies these for already-saved settings.)

- [ ] **Step 3: Type-check**

Run: `npm run check` — Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add shared/print/types.ts server/settingsStore.ts
git commit -m "KOT stations: settings types + defaults"
```

---

### Task 2: Pure rules — `shared/kotStations.ts`

**Files:**
- Create: `shared/kotStations.ts`
- Create: `scripts/verify-kot-stations.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-kot-stations.ts`:

```ts
/**
 * Verifies KOT kitchen stations (shared/kotStations.ts): skip rules, station membership, grouping order,
 * per-printer job assembly, and the station header on both KOT styles. Pure — no printer, no DB.
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-kot-stations.ts`
Expected: FAIL — cannot resolve `../shared/kotStations`.

- [ ] **Step 3: Implement**

Create `shared/kotStations.ts`:

```ts
/**
 * Kitchen stations for the KOT: one ticket per chef. A station is a named set of categories (a chef who
 * cooks Main Course + Combos + Indian Bread is ONE station → ONE ticket). Items whose category is in no
 * station print on the General ticket. Separately, a skip list (categories and/or single menu items, e.g.
 * Mineral Water) keeps items off every KOT and off the Kitchen screen — they stay on the bill.
 * Pure: used by server/services/printDispatch.ts (printed KOT), server/routes.ts (Kitchen-screen ticket)
 * and server/printRoutes.ts (preview). Locked by scripts/verify-kot-stations.ts.
 */
import type { KitchenStationsSettings, SkipKotSettings } from "./print/types";

export const GENERAL_STATION_KEY = "general";

export type CategoryOf = (itemId: number) => number | null | undefined;

export function hasSkipRules(skip?: SkipKotSettings | null): boolean {
  return !!skip && ((skip.itemIds?.length ?? 0) > 0 || (skip.categoryIds?.length ?? 0) > 0);
}

/** Open items (negative synthetic ids) always reach the kitchen — they have no category and no menu row. */
export function isKotSkipped(itemId: number, categoryId: number | null | undefined, skip?: SkipKotSettings | null): boolean {
  if (!skip || itemId < 0) return false;
  if ((skip.itemIds ?? []).indexOf(itemId) >= 0) return true;
  return categoryId != null && (skip.categoryIds ?? []).indexOf(categoryId) >= 0;
}

export function filterKotSkipped<T extends { itemId: number }>(items: T[], catOf: CategoryOf, skip?: SkipKotSettings | null): T[] {
  if (!hasSkipRules(skip)) return items;
  return items.filter((i) => !isKotSkipped(i.itemId, catOf(i.itemId), skip));
}

export function stationsActive(cfg?: KitchenStationsSettings | null): boolean {
  return !!cfg?.enabled && (cfg.stations?.length ?? 0) > 0;
}

/** `name` null = stations off: the single ticket carries no station header (today's ticket). */
export interface StationRef {
  key: string;
  name: string | null;
}

export function stationFor(categoryId: number | null | undefined, cfg?: KitchenStationsSettings | null): StationRef {
  if (!stationsActive(cfg)) return { key: GENERAL_STATION_KEY, name: null };
  if (categoryId != null) {
    for (const s of cfg!.stations) {
      if ((s.categoryIds ?? []).indexOf(categoryId) >= 0) return { key: `s:${s.id}`, name: s.name.trim() || "Station" };
    }
  }
  return { key: GENERAL_STATION_KEY, name: cfg!.generalName?.trim() || "General" };
}

function stationRank(key: string, cfg?: KitchenStationsSettings | null): number {
  const list = cfg?.stations ?? [];
  const idx = list.findIndex((s) => `s:${s.id}` === key);
  return idx < 0 ? list.length : idx;
}

export interface StationGroup<N, M, C> {
  key: string;
  name: string | null;
  newItems: N[];
  modifiedItems: M[];
  cancelledItems: C[];
}

/** Splits a KOT's lines into station tickets: station-list order, General last, empty stations dropped. */
export function groupByStation<N extends { itemId: number }, M extends { itemId: number }, C extends { itemId: number }>(
  items: { newItems: N[]; modifiedItems: M[]; cancelledItems: C[] },
  catOf: CategoryOf,
  cfg?: KitchenStationsSettings | null,
): StationGroup<N, M, C>[] {
  const map = new Map<string, StationGroup<N, M, C>>();
  const groupOf = (itemId: number) => {
    const ref = stationFor(catOf(itemId) ?? null, cfg);
    let g = map.get(ref.key);
    if (!g) {
      g = { key: ref.key, name: ref.name, newItems: [], modifiedItems: [], cancelledItems: [] };
      map.set(ref.key, g);
    }
    return g;
  };
  for (const i of items.newItems) groupOf(i.itemId).newItems.push(i);
  for (const i of items.modifiedItems) groupOf(i.itemId).modifiedItems.push(i);
  for (const i of items.cancelledItems) groupOf(i.itemId).cancelledItems.push(i);
  return Array.from(map.values()).sort((a, b) => stationRank(a.key, cfg) - stationRank(b.key, cfg));
}

/**
 * One print job per printer: that printer's station tickets joined in print order (each ticket ends with its
 * own cut). One job keeps the tickets in order, and the print_jobs ids / desktop queue dedup are keyed per
 * printer — four separate jobs for one printer would collide there. `tickets` stays split for the browser
 * fallback, which prints one page per ticket.
 */
export function assemblePrinterJobs<P extends { id: string }>(
  tickets: Array<{ printer: P; buffer: Buffer }>,
): Array<{ printer: P; buffer: Buffer; tickets: Buffer[] }> {
  const by = new Map<string, { printer: P; tickets: Buffer[] }>();
  for (const t of tickets) {
    let e = by.get(t.printer.id);
    if (!e) {
      e = { printer: t.printer, tickets: [] };
      by.set(t.printer.id, e);
    }
    e.tickets.push(t.buffer);
  }
  return Array.from(by.values()).map((e) => ({ printer: e.printer, tickets: e.tickets, buffer: Buffer.concat(e.tickets) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-kot-stations.ts`
Expected: all PASS, exit 0. (If the delta checks fail, read `shared/kotDelta.ts`'s `SnapshotItem` shape and adjust the `snap()` helper fields — do not change `computeDelta`.)

- [ ] **Step 5: Add to `test:pure` and commit**

In `package.json`, append ` && tsx scripts/verify-kot-stations.ts` to the end of the `test:pure` script.

```bash
npm run check
git add shared/kotStations.ts scripts/verify-kot-stations.ts package.json
git commit -m "KOT stations: pure skip/station/grouping rules + tests"
```

---

### Task 3: Station header on the ticket (text + image)

**Files:**
- Modify: `shared/print/escpos.ts` (after line 23)
- Modify: `shared/print/generators.ts:32-75`
- Modify: `shared/print/kotImage.ts` (`KOT_IMAGE_STYLE`, `KotImageParams`, `allStrings`, header block)
- Test: `scripts/verify-kot-stations.ts`

- [ ] **Step 1: Write the failing tests**

In `scripts/verify-kot-stations.ts`, add imports at the top:

```ts
import { generateKOTBuffer } from "../shared/print/generators";
import { renderKotBitmap, KOT_IMAGE_STYLE } from "../shared/print/kotImage";
import { interpretEscPos } from "../shared/print/escposInterpret";
```

and before the `let failed = 0;` block:

```ts
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
const longName = generateKOTBuffer({ ...ticketBase, kotSettings: { ...kotSettings, kotStyle: "text" }, stationName: "Tandoor and Indian Breads" });
check("text style: a long name drops to double size", longName.indexOf(Buffer.from([0x1d, 0x21, 0x11])) >= 0 && longName.indexOf(Buffer.from([0x1d, 0x21, 0x22])) < 0);
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx scripts/verify-kot-stations.ts`
Expected: FAIL — type error / `stationName` ignored / `KOT_IMAGE_STYLE.station` undefined (tsx doesn't type-check, so the text-header checks print FAIL).

- [ ] **Step 3: ESC/POS helpers**

In `shared/print/escpos.ts` after the `CUT` line:

```ts
/** GS B n — white-on-black (reverse) printing on/off. */
export const REVERSE_ON = Buffer.from([GS, 0x42, 0x01]);
export const REVERSE_OFF = Buffer.from([GS, 0x42, 0x00]);

/** GS ! n — character size multipliers (1–8 each). charSize(1, 1) = normal. */
export function charSize(width: number, height: number): Buffer {
  const w = Math.max(1, Math.min(8, Math.round(width))) - 1;
  const h = Math.max(1, Math.min(8, Math.round(height))) - 1;
  return Buffer.from([GS, 0x21, (w << 4) | h]);
}
```

- [ ] **Step 4: Text-style header in `generators.ts`**

Add to the `generateKOTBuffer` params type (after `tableSection`):

```ts
  /** Kitchen station ticket header ("South Indian"), printed first as a huge white-on-black line. Absent = none. */
  stationName?: string | null;
```

Add above `export function generateKOTBuffer`:

```ts
/** The station banner: reverse + the largest size that keeps the name (plus a space each side) on one line. */
function stationHeaderText(name: string, W: number): Buffer[] {
  const label = ` ${name.trim().toUpperCase()} `;
  const mult = label.length <= Math.floor(W / 3) ? 3 : label.length <= Math.floor(W / 2) ? 2 : 1;
  return [
    E.ALIGN_CENTER, E.BOLD_ON, E.REVERSE_ON, E.charSize(mult, mult),
    E.line(label),
    E.charSize(1, 1), E.REVERSE_OFF, E.BOLD_OFF, E.LF,
  ];
}
```

In the body, right after `parts.push(E.INIT);`:

```ts
  if (params.stationName?.trim()) parts.push(...stationHeaderText(params.stationName, W));
```

- [ ] **Step 5: Image-style header in `kotImage.ts`**

In `KOT_IMAGE_STYLE`, after `banner: 26,`:

```ts
  /** Em size of the kitchen-station header bar (white on black, very top). Shrinks only if the name won't fit. */
  station: 60,
```

In `KotImageParams`, after `tableSection`:

```ts
  /** Kitchen station name — drawn as a big white-on-black bar at the very top. */
  stationName?: string | null;
```

In `allStrings`, change the first line to include it:

```ts
  const s: string[] = [String(p.tableNumber ?? ""), String(p.kotNumber ?? ""), sectionLineOf(p) ?? "", p.stationName?.trim().toUpperCase() ?? ""];
```

In `renderKotBitmap`, directly after the `// ── Header ──` comment and before the DUPLICATE block:

```ts
  if (p.stationName?.trim()) {
    const label = p.stationName.trim().toUpperCase();
    let size: number = S.station;
    while (size > S.big && measure(label, "bold", size) > rightEdge - mx - 24) size -= 2;
    bar(label, size);
    y += 4;
  }
```

(`bar` draws the rect from `y` = `padTop`, so the bar starts at the top of the ticket.)

- [ ] **Step 6: Run the tests**

Run: `npx tsx scripts/verify-kot-stations.ts && npx tsx scripts/verify-kot-image.ts && npx tsx scripts/verify-kot-style.ts && npx tsx scripts/verify-escpos-interpret.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
npm run check
git add shared/print/escpos.ts shared/print/generators.ts shared/print/kotImage.ts scripts/verify-kot-stations.ts
git commit -m "KOT stations: big white-on-black station header (text + image)"
```

---

### Task 4: `runKotPrint` — skip filter, station tickets, one job per printer

**Files:**
- Modify: `server/services/printDispatch.ts:229-450`

No pure test covers the DB-bound function itself; the logic it composes is tested in Task 2/3. Verify by `npm run check` + the existing `verify-print-request.ts`/`verify-print-perf.ts` + Task 8's render check.

- [ ] **Step 1: Import**

At the top of `printDispatch.ts` add:

```ts
import { filterKotSkipped, groupByStation, assemblePrinterJobs, hasSkipRules, stationsActive } from "@shared/kotStations";
```

- [ ] **Step 2: Resolve categories before the delta**

Directly after `const tableSection = await tableSectionFor(order.tableId);`, add (the block moved up from the routing section):

```ts
  const kotSkip = kotSettings.skipKot;
  const stationsCfg = kotSettings.kitchenStations;
  const overrides = kotSettings.categoryPrinterOverrides ?? {};
  // Category of every item this KOT may touch: the current lines, plus items that were printed before and
  // are gone now (cancelled — needed to route their VOID and to apply the skip list to the old snapshot).
  const catByItemId = new Map<number, number | null>(
    rawItems.map((i) => [i.menuItemId, i.categoryId ?? null]),
  );
  const needCategories = hasSkipRules(kotSkip) || stationsActive(stationsCfg) || Object.keys(overrides).length > 0;
  const priorItems = ((order.lastKotSnapshot as KotSnapshot | null)?.items ?? []);
  const missingCatIds = needCategories
    ? Array.from(new Set(priorItems.map((i) => i.itemId).filter((id) => id >= 0 && !catByItemId.has(id))))
    : [];
  if (missingCatIds.length > 0) {
    const rows = await timer.time("db_cat", () =>
      db
        .select({ id: menuItems.id, categoryId: menuItems.categoryId })
        .from(menuItems)
        .where(inArray(menuItems.id, missingCatIds)),
    );
    for (const r of rows) catByItemId.set(r.id, r.categoryId ?? null);
  }
  const catOf = (id: number) => catByItemId.get(id);
```

- [ ] **Step 3: Filter skipped items on both sides**

Replace the `let newItems … = currentSnapshot.map(...)` statement with the same expression wrapped in the filter:

```ts
  let newItems: Array<SnapshotItem & { instructions?: string | null; previousQty?: number }> = filterKotSkipped(
    currentSnapshot.map((i, idx) => ({ ...i, instructions: rawItems[idx].specialInstructions ?? null })),
    catOf,
    kotSkip,
  );
```

Replace `const delta = computeDelta(currentSnapshot, lastSnapshot.items);` with:

```ts
    // Skipped items (e.g. Mineral Water) are removed from BOTH sides, so adding/removing them is never a
    // delta and an old order whose water was printed doesn't print "VOID Water". The claimed snapshot below
    // stays unfiltered, so a later change to the skip list still compares consistently.
    const delta = computeDelta(
      filterKotSkipped(currentSnapshot, catOf, kotSkip),
      filterKotSkipped(lastSnapshot.items, catOf, kotSkip),
    );
```

Right after the closing `}` of the `if (!reprint && lastSnapshot?.items?.length) { … }` block, add:

```ts
  // Everything on the order is on the skip list → no ticket at all (Bill's silent catch-up stays silent).
  if (!isDelta && newItems.length === 0 && currentSnapshot.length > 0) {
    return { ok: true, body: { printed: false, reason: "no_delta" } };
  }
```

- [ ] **Step 4: Split the no-printer browser fallback by station**

In the `if (!printer) { … }` branch, replace the single `const fallbackTicket = generateKOTBuffer({...})` and its `browserPayloads: [toBrowserPayload(fallbackTicket, 48)]` with:

```ts
    const fallbackTickets = groupByStation({ newItems, modifiedItems, cancelledItems }, catOf, stationsCfg);
    if (fallbackTickets.length === 0) fallbackTickets.push({ key: "general", name: null, newItems, modifiedItems, cancelledItems });
    const fallbackPayloads = fallbackTickets.map((g) =>
      toBrowserPayload(
        generateKOTBuffer({
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          tableSection,
          stationName: g.name,
          kotNumber: browserKotNum ?? String((order.kotPrintCount ?? 0) + 1),
          isReprint: reprint,
          isDelta,
          newItems: g.newItems,
          modifiedItems: g.modifiedItems,
          cancelledItems: g.cancelledItems,
          kotSettings,
          width: 48,
        }),
        48,
      ),
    );
```

and in its returned body use `browserPayloads: fallbackPayloads,`.

- [ ] **Step 5: Replace printer routing with station → printer tickets**

Delete the old block from `// ── Category → printer routing` through `if (groups.size === 0) groupFor(printer);` (the `overrides`, `catByItemId`, `routedItemIds`, `missingCatIds`/`db_cat`, `RoutedGroup`, `groups`, `groupFor` and the three `for` loops). Keep `resolveKotPrinter`, now using the hoisted `catByItemId`/`overrides`:

```ts
  // ── Station tickets, each routed to its printer (category overrides → KOT printer) ──
  const resolveKotPrinter = (itemId: number): PrinterConfig => {
    const catId = catByItemId.get(itemId);
    const overrideId = catId != null ? overrides[String(catId)] : null;
    return (overrideId ? printers.find((pr) => pr.id === overrideId) : undefined) ?? printer;
  };

  type TicketGroup = {
    printer: PrinterConfig;
    stationName: string | null;
    newItems: typeof newItems;
    modifiedItems: typeof modifiedItems;
    cancelledItems: typeof cancelledItems;
  };
  const ticketGroups: TicketGroup[] = [];
  for (const sg of groupByStation({ newItems, modifiedItems, cancelledItems }, catOf, stationsCfg)) {
    const byPrinter = new Map<string, TicketGroup>();
    const into = (pr: PrinterConfig) => {
      let g = byPrinter.get(pr.id);
      if (!g) {
        g = { printer: pr, stationName: sg.name, newItems: [], modifiedItems: [], cancelledItems: [] };
        byPrinter.set(pr.id, g);
      }
      return g;
    };
    for (const it of sg.newItems) into(resolveKotPrinter(it.itemId)).newItems.push(it);
    for (const it of sg.modifiedItems) into(resolveKotPrinter(it.itemId)).modifiedItems.push(it);
    for (const it of sg.cancelledItems) into(resolveKotPrinter(it.itemId)).cancelledItems.push(it);
    ticketGroups.push(...Array.from(byPrinter.values()));
  }
  if (ticketGroups.length === 0) {
    ticketGroups.push({ printer, stationName: null, newItems: [], modifiedItems: [], cancelledItems: [] });
  }
```

Replace `buildKotJobs` with:

```ts
  // One ticket per (station, printer); each printer's tickets joined into ONE job, cut between tickets.
  // Same KOT number on every ticket.
  let kotJobs: Awaited<ReturnType<typeof buildKotJobs>>;
  const buildKotJobs = () => timer.time("build", async () =>
    assemblePrinterJobs(
      ticketGroups.map((g) => ({
        printer: g.printer,
        buffer: generateKOTBuffer({
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          tableSection,
          stationName: g.stationName,
          kotNumber: kotNumStr,
          isReprint: reprint,
          isDelta,
          newItems: g.newItems,
          modifiedItems: g.modifiedItems,
          cancelledItems: g.cancelledItems,
          kotSettings,
          width: g.printer.width ?? 48,
        }),
      })),
    ).map((j) => ({ ...j, escPosOk: supportsRawEscPos(j.printer) })),
  );
```

In the final return body, replace the `browserPayloads` expression with one page per ticket:

```ts
      browserPayloads: nonEscPosJobs.length > 0
        ? nonEscPosJobs.flatMap((j) => j.tickets.map((t) => toBrowserPayload(t, j.printer.width ?? 48)))
        : undefined,
```

Everything else (`directJobs`/`remoteJobs`/`nonEscPosJobs` filters, `dispatchRemotePrintJobs` keyed by `printer.id`, failure handling, claim/rollback) is unchanged — it already works per printer job.

- [ ] **Step 6: Verify**

Run: `npm run check` — Expected: exit 0 (fix any leftover references to the deleted `groups`/`routedItemIds`).
Run: `npx tsx scripts/verify-print-request.ts && npx tsx scripts/verify-print-perf.ts && npx tsx scripts/verify-kot-delta.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/services/printDispatch.ts
git commit -m "KOT stations: one ticket per station, skip list, one job per printer"
```

---

### Task 5: Kitchen KOT screen drops skipped items

**Files:**
- Modify: `server/storage.ts:180-184` (interface) and `:1032-1053` (impl)
- Modify: `server/routes.ts` — POST `/api/orders` (~2143-2205, 2285) and PUT `/api/orders/:id/items` (~2507)

- [ ] **Step 1: Make the ticket optional in `createOrderWithItems`**

Interface (`storage.ts` ~180):

```ts
  createOrderWithItems(
    order: InsertOrder,
    items: Array<Omit<InsertOrderItem, "orderId">>,
    kot?: Omit<InsertKotTicket, "orderId">,
  ): Promise<{ order: Order; items: OrderItem[]; kotTicket: KotTicket | null }>;
```

Implementation: same signature change, and replace the two kot lines with:

```ts
      // No ticket when every line is on the "Don't print on KOT" list (nothing for the kitchen).
      let kotTicket: KotTicket | null = null;
      if (kot) {
        const kotItems = Array.isArray(kot.items) ? kot.items : undefined;
        [kotTicket] = await tx.insert(kotTickets).values({ ...(kot as any), items: kotItems, orderId: newOrder.id }).returning();
      }
      return { order: newOrder, items: insertedItems, kotTicket };
```

- [ ] **Step 2: POST `/api/orders`**

Add the import at the top of `routes.ts`:

```ts
import { isKotSkipped } from "@shared/kotStations";
```

Replace `const [billNo, kotNo] = await Promise.all([incrementBillCounter(), incrementKotCounter()]);` with:

```ts
      // Kitchen-screen lines: everything except the "Don't print on KOT" list (getSettings — not money).
      const kotSkip = getSettings().printSettings.kot.skipKot;
      const kitchenLines = lineItems.filter(
        (item: any) => !isKotSkipped(Number(item.menuItemId), menuById.get(Number(item.menuItemId))?.categoryId, kotSkip),
      );
      const [billNo, kotNo] = await Promise.all([
        incrementBillCounter(),
        kitchenLines.length > 0 ? incrementKotCounter() : Promise.resolve(null),
      ]);
```

Replace the `kotNumber`/`kotItems` block with:

```ts
      const kotTicketRow = kotNo != null
        ? {
            kotNumber: String(kotNo).padStart(3, "0"),
            items: kitchenLines.map((item: any) => ({
              name: item.name,
              quantity: item.quantity,
              instructions: buildSpecialInstructions(item.specialInstructions, item.addons) || undefined,
              serviceMode: item.serviceMode || undefined,
            })) as any,
          }
        : undefined;
```

Pass `kotTicketRow` as the third argument to `createOrderWithItems` (instead of `{ kotNumber, items: kotItems as any }`). At the snapshot call (~2285) change `[created.kotTicket]` to `created.kotTicket ? [created.kotTicket] : []`. Search the handler for any other `kotNumber`/`created.kotTicket` use and guard it the same way.

(`menuById` is already defined above the cost computation in this handler — line ~2136. If it is declared after this point, move the `kitchenLines` block below it.)

- [ ] **Step 3: PUT `/api/orders/:id/items`**

Replace `const ticketLines = kitchenTicketLines(lineItems, existingItems);` with:

```ts
      // "Don't print on KOT" items never reach the Kitchen screen either — filtered on both sides, like the print.
      const kotSkip = getSettings().printSettings.kot.skipKot;
      const menuCatById = new Map(menuRows.map((m) => [m.id, m.categoryId]));
      const keepForKitchen = (menuItemId: number) => !isKotSkipped(menuItemId, menuCatById.get(menuItemId), kotSkip);
      const ticketLines = kitchenTicketLines(
        lineItems.filter((i: any) => keepForKitchen(Number(i.menuItemId))),
        existingItems.filter((i) => keepForKitchen(i.menuItemId)),
      );
```

(Existing items no longer on the order may be missing from `menuRows`; their item-level skip still applies, and they can only appear as removals, which the Kitchen ticket ignores.)

- [ ] **Step 4: Verify**

Run: `npm run check && npx tsx scripts/verify-order-items-save.ts && npx tsx scripts/verify-kot-stations.ts`
Expected: exit 0, all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts server/routes.ts
git commit -m "KOT stations: skipped items never reach the Kitchen screen"
```

---

### Task 6: `/api/print/preview` follows the same rules

**Files:**
- Modify: `server/printRoutes.ts` (KOT preview branch, ~470-545)

- [ ] **Step 1: Select the category and filter**

Import at the top: `import { filterKotSkipped, groupByStation } from "@shared/kotStations";`

In the preview's `rawItems` select add `menuItemId: orderItems.menuItemId,` if absent and `categoryId: menuItems.categoryId,`. After `rawItems`:

```ts
        const catByItemId = new Map(rawItems.map((i) => [i.menuItemId, i.categoryId ?? null]));
        const catOf = (id: number) => catByItemId.get(id);
        const kotSkip = kotSettings.skipKot;
```

Wrap `newItems = currentSnapshot.map(...)` in `filterKotSkipped(…, catOf, kotSkip)` and change the delta call to
`computeDelta(filterKotSkipped(currentSnapshot, catOf, kotSkip), filterKotSkipped(lastSnapshot.items, catOf, kotSkip))`.

- [ ] **Step 2: One section per station**

Replace the single `const lines = kotTextLines({...})` with:

```ts
        const stationGroups = groupByStation({ newItems, modifiedItems, cancelledItems }, catOf, kotSettings.kitchenStations);
        const sections = stationGroups.length > 0 ? stationGroups : [{ name: null, newItems, modifiedItems, cancelledItems }];
        const tableSection = await tableSectionFor(order.tableId);
        const lines: string[] = [];
        sections.forEach((g, idx) => {
          if (idx > 0) lines.push("", "- - - - - - - - (cut) - - - - - - - -", "");
          if (g.name) lines.push(`*** ${g.name.toUpperCase()} ***`);
          lines.push(...kotTextLines({
            orderNumber: order.orderNumber,
            tableNumber: order.tableNumber,
            tableSection,
            kotNumber: kotNumStr,
            isReprint: reprint,
            isDelta,
            newItems: g.newItems,
            modifiedItems: g.modifiedItems,
            cancelledItems: g.cancelledItems,
            kotSettings,
            width: W,
          }));
        });
```

(If `kotTextLines` returns something other than `string[]`, match its return type — read its signature at line 38 first.)

- [ ] **Step 3: Verify and commit**

Run: `npm run check` — Expected: exit 0.

```bash
git add server/printRoutes.ts
git commit -m "KOT stations: preview follows skip list + station split"
```

---

### Task 7: Admin UI — Kitchen Stations + Don't print on KOT

**Files:**
- Create: `client/src/components/print-settings/KitchenStationsSection.tsx`
- Modify: `client/src/components/PrintSettingsPanel.tsx` (local `KOTPrintSettings` ~line 42, `DEFAULT_KOT` ~line 90, KOT tab ~line 1063)

- [ ] **Step 1: Create the component file**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { KitchenStationsSettings, SkipKotSettings } from "@shared/print/types";

interface CategoryLite { id: number; name: string; isActive?: boolean }
interface MenuItemLite { id: number; name: string; categoryId: number | null }

const inputCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 w-full bg-gray-50 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors";

export const DEFAULT_STATIONS: KitchenStationsSettings = { enabled: false, stations: [], generalName: "General" };
export const DEFAULT_SKIP: SkipKotSettings = { categoryIds: [], itemIds: [] };

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-600 font-medium bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span>{title}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-3 py-3 space-y-3">{children}</div>}
    </div>
  );
}

/** One KOT ticket per chef: each station = the categories that chef cooks. */
export function KitchenStationsSection({ value, onChange }: {
  value: KitchenStationsSettings | undefined;
  onChange: (next: KitchenStationsSettings) => void;
}) {
  const cfg = value ?? DEFAULT_STATIONS;
  const { data: categories = [] } = useQuery<CategoryLite[]>({ queryKey: ["/api/categories"] });
  const active = categories.filter(c => c.isActive !== false);
  const set = (patch: Partial<KitchenStationsSettings>) => onChange({ ...cfg, ...patch });
  const setStation = (id: string, patch: Partial<KitchenStationsSettings["stations"][number]>) =>
    set({ stations: cfg.stations.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (idx: number, dir: -1 | 1) => {
    const next = cfg.stations.slice();
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    set({ stations: next });
  };
  const ownerOf = (catId: number) => cfg.stations.find(s => s.categoryIds.indexOf(catId) >= 0);
  const summary = cfg.enabled ? ` · ${cfg.stations.length} station${cfg.stations.length === 1 ? "" : "s"}` : " · off";

  return (
    <Collapsible title={`Kitchen Stations${summary}`}>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        One KOT per chef. Tick the categories each chef cooks — they all print on that chef's ticket, with the
        chef's station name in big letters on top. The printer cuts between tickets. Categories not ticked print
        on the General ticket.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-800">Split KOT by kitchen station</span>
        <Switch checked={cfg.enabled} onCheckedChange={v => set({ enabled: v })} />
      </div>

      {cfg.stations.map((s, idx) => (
        <div key={s.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              value={s.name}
              maxLength={20}
              placeholder="Station name (e.g. South Indian)"
              onChange={e => setStation(s.id, { name: e.target.value })}
            />
            <button type="button" aria-label="Move up" onClick={() => move(idx, -1)} className="p-2 rounded hover:bg-gray-100 text-gray-500"><ArrowUp className="w-4 h-4" /></button>
            <button type="button" aria-label="Move down" onClick={() => move(idx, 1)} className="p-2 rounded hover:bg-gray-100 text-gray-500"><ArrowDown className="w-4 h-4" /></button>
            <button type="button" aria-label="Delete station" onClick={() => set({ stations: cfg.stations.filter(x => x.id !== s.id) })} className="p-2 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {active.map(c => {
              const owner = ownerOf(c.id);
              const mine = s.categoryIds.indexOf(c.id) >= 0;
              const taken = !!owner && owner.id !== s.id;
              return (
                <label key={c.id} className={`flex items-center gap-2 text-xs py-1 ${taken ? "text-gray-300" : "text-gray-700"}`}>
                  <input
                    type="checkbox"
                    checked={mine}
                    disabled={taken}
                    onChange={e => setStation(s.id, {
                      categoryIds: e.target.checked ? [...s.categoryIds, c.id] : s.categoryIds.filter(id => id !== c.id),
                    })}
                  />
                  <span className="truncate">{c.name}{taken ? ` (${owner!.name || "other"})` : ""}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => set({ stations: [...cfg.stations, { id: `st_${Date.now().toString(36)}`, name: "", categoryIds: [] }] })}
        className="flex items-center gap-1 text-sm text-emerald-600 font-medium"
      >
        <Plus className="w-4 h-4" /> Add station
      </button>

      <div>
        <label className="text-xs text-gray-500">General ticket name (categories in no station)</label>
        <input className={inputCls} maxLength={20} value={cfg.generalName} onChange={e => set({ generalName: e.target.value })} />
      </div>
    </Collapsible>
  );
}

/** Categories / single items that never print on a KOT nor show on the Kitchen screen (still billed). */
export function SkipKotSection({ value, onChange }: {
  value: SkipKotSettings | undefined;
  onChange: (next: SkipKotSettings) => void;
}) {
  const skip = value ?? DEFAULT_SKIP;
  const [q, setQ] = useState("");
  const { data: categories = [] } = useQuery<CategoryLite[]>({ queryKey: ["/api/categories"] });
  const { data: menu = [] } = useQuery<MenuItemLite[]>({ queryKey: ["/api/menu"] });
  const nameOf = (id: number) => menu.find(m => m.id === id)?.name ?? `Item #${id}`;
  const matches = q.trim()
    ? menu.filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase()) && skip.itemIds.indexOf(m.id) < 0).slice(0, 8)
    : [];
  const count = skip.categoryIds.length + skip.itemIds.length;

  return (
    <Collapsible title={`Don't print on KOT${count ? ` · ${count}` : ""}`}>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        These never go to the kitchen — no KOT (not even when Bill is pressed) and not on the Kitchen screen.
        They still appear on the bill. Example: Mineral Water.
      </p>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Whole categories</p>
        <div className="grid grid-cols-2 gap-1">
          {categories.filter(c => c.isActive !== false).map(c => (
            <label key={c.id} className="flex items-center gap-2 text-xs py-1 text-gray-700">
              <input
                type="checkbox"
                checked={skip.categoryIds.indexOf(c.id) >= 0}
                onChange={e => onChange({
                  ...skip,
                  categoryIds: e.target.checked ? [...skip.categoryIds, c.id] : skip.categoryIds.filter(id => id !== c.id),
                })}
              />
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Single items</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {skip.itemIds.map(id => (
            <span key={id} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-full px-2 py-1">
              {nameOf(id)}
              <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange({ ...skip, itemIds: skip.itemIds.filter(x => x !== id) })}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <input className={inputCls} placeholder="Search an item (e.g. water)" value={q} onChange={e => setQ(e.target.value)} />
        {matches.length > 0 && (
          <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100">
            {matches.map(m => (
              <button
                key={m.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => { onChange({ ...skip, itemIds: [...skip.itemIds, m.id] }); setQ(""); }}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </Collapsible>
  );
}
```

- [ ] **Step 2: Wire into `PrintSettingsPanel.tsx`**

Import:

```ts
import { KitchenStationsSection, SkipKotSection, DEFAULT_STATIONS, DEFAULT_SKIP } from "@/components/print-settings/KitchenStationsSection";
import type { KitchenStationsSettings, SkipKotSettings } from "@shared/print/types";
```

In the local `KOTPrintSettings` interface, after `categoryPrinterOverrides?`, add:

```ts
  kitchenStations?: KitchenStationsSettings;
  skipKot?: SkipKotSettings;
```

In `DEFAULT_KOT`, after `categoryPrinterOverrides: {},` add `kitchenStations: DEFAULT_STATIONS, skipKot: DEFAULT_SKIP,`.

In the KOT tab, directly after the `<CategoryRoutingSection … />` element:

```tsx
              <KitchenStationsSection
                value={ps.kot.kitchenStations}
                onChange={v => setKot('kitchenStations', v)}
              />
              <SkipKotSection
                value={ps.kot.skipKot}
                onChange={v => setKot('skipKot', v)}
              />
```

In `saveMutation`'s `cleanPs.kot`, clean the stations before saving (drop blank names' empty stations and dedupe nothing else):

```ts
        kot: {
          ...ps.kot,
          kotPrinterId: live(ps.kot.kotPrinterId),
          categoryPrinterOverrides: overrides,
          kitchenStations: ps.kot.kitchenStations
            ? { ...ps.kot.kitchenStations, stations: ps.kot.kitchenStations.stations.filter(s => s.name.trim() || s.categoryIds.length > 0) }
            : undefined,
        },
```

- [ ] **Step 3: Verify**

Run: `npm run check` — Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/print-settings/KitchenStationsSection.tsx client/src/components/PrintSettingsPanel.tsx
git commit -m "KOT stations: Admin cards for stations + don't-print-on-KOT"
```

---

### Task 8: End-to-end render check, docs, full suite

**Files:**
- Create: `scripts/render-kot-stations-sample.ts` (manual, not in `test:pure`)
- Modify: `CLAUDE.md` (Printing section, after the "KOT image style" paragraph)

- [ ] **Step 1: Sample render script**

```ts
/**
 * Renders a 4-station sample KOT (+ General) the way runKotPrint builds it, to PNG-less text on stdout:
 * one line per ticket with its raster height and cut count. Manual: npx tsx scripts/render-kot-stations-sample.ts
 */
import { groupByStation, assemblePrinterJobs, filterKotSkipped } from "../shared/kotStations";
import { generateKOTBuffer } from "../shared/print/generators";

const cat: Record<number, number> = { 1: 11, 2: 12, 3: 13, 4: 14, 5: 15, 6: 16, 7: 17 };
const kotSettings = { enabled: true, printModifiedKOT: true, printModifiedItemsOnly: true, printCancelledKOT: true, printAddons: true, showDuplicateWatermark: true, kotNumbering: true, kotStyle: "image" } as any;
const stations = { enabled: true, generalName: "General", stations: [
  { id: "si", name: "South Indian", categoryIds: [11] },
  { id: "mc", name: "Main Course", categoryIds: [12, 13] },
  { id: "pz", name: "Pizza", categoryIds: [14] },
  { id: "ch", name: "Chinese", categoryIds: [15] },
] };
const skip = { categoryIds: [], itemIds: [7] };
const items = [
  { itemId: 1, name: "Masala Dosa", quantity: 2, serviceMode: "dinein" },
  { itemId: 2, name: "Paneer Butter Masala", quantity: 1, serviceMode: "dinein" },
  { itemId: 3, name: "Butter Naan", quantity: 4, serviceMode: "dinein" },
  { itemId: 4, name: "Margherita Pizza", size: "Medium", quantity: 1, serviceMode: "dinein" },
  { itemId: 5, name: "Veg Hakka Noodles", quantity: 1, serviceMode: "dinein" },
  { itemId: 6, name: "Gulab Jamun", quantity: 2, serviceMode: "dinein" },
  { itemId: 7, name: "Mineral Water", quantity: 1, serviceMode: "dinein" },
];
const kept = filterKotSkipped(items, (id) => cat[id], skip);
const groups = groupByStation({ newItems: kept, modifiedItems: [], cancelledItems: [] }, (id) => cat[id], stations);
const printer = { id: "main", width: 48 };
const jobs = assemblePrinterJobs(groups.map((g) => ({
  printer,
  buffer: generateKOTBuffer({ orderNumber: "ORD0001", tableNumber: "5", tableSection: "inner", stationName: g.name, kotNumber: "042", isReprint: false, isDelta: false, newItems: g.newItems, modifiedItems: [], cancelledItems: [], kotSettings, width: 48 }),
})));
console.log(`tickets: ${groups.map((g) => `${g.name}(${g.newItems.map((i) => i.name).join(", ")})`).join(" | ")}`);
console.log(`print jobs: ${jobs.length}, tickets in job: ${jobs[0].tickets.length}, bytes: ${jobs[0].buffer.length}`);
console.log(`Mineral Water printed: ${groups.some((g) => g.newItems.some((i) => i.name === "Mineral Water"))}`);
```

Run: `npx tsx scripts/render-kot-stations-sample.ts`
Expected output:
```
tickets: South Indian(Masala Dosa) | Main Course(Paneer Butter Masala, Butter Naan) | Pizza(Margherita Pizza) | Chinese(Veg Hakka Noodles) | General(Gulab Jamun)
print jobs: 1, tickets in job: 5, bytes: <~300000>
Mineral Water printed: false
```

- [ ] **Step 2: Visual check of the header (browser fallback renderer)**

Start nothing on the server. In a scratch script, write the first ticket's bitmap to a PNG using `renderKotBitmap` + `zlib` (no image library in this repo), or open Admin → Print Settings preview if available, and look at it: black bar, white "SOUTH INDIAN", readable. Save the PNG to the session scratchpad, not the repo root. Report what was seen; if the bar looks too big/small, tune only `KOT_IMAGE_STYLE.station`.

- [ ] **Step 3: CLAUDE.md**

Add under Printing, after the "KOT image style" paragraph:

```markdown
**Kitchen stations + "Don't print on KOT" (`kotSettings.kitchenStations`, `kotSettings.skipKot`, `shared/kotStations.ts`).** One KOT tap prints one ticket per *station* — a station is a chef, i.e. a named set of categories (Main Course + Combos + Indian Bread + Rice = one ticket) — in list order, General (categories in no station, name editable) last, each with a big white-on-black station bar on top (image: `KOT_IMAGE_STYLE.station`; text: `GS B` reverse + `GS !` 3×/2×). All tickets for one printer are joined into **one** print job (`assemblePrinterJobs`), each ending in its own cut — `print_jobs` ids (`dispatchRemotePrintJobs` returns ids keyed by printer) and the desktop queue's fallback dedup are per printer, so separate jobs for one printer would collide. Category Routing to other printers still applies inside each station. The skip list (categories and/or menu item ids; open items never skipped) is filtered from **both** sides of `computeDelta`, so adding/removing Mineral Water is never a delta, an old order whose water was printed never prints "VOID Water", and a water-only order prints nothing on Bill's catch-up; the claimed `lastKotSnapshot` stays unfiltered. The Kitchen screen ticket filters the same list (POST `/api/orders` creates no `kot_tickets` row — and burns no KOT number — when every line is skipped; `createOrderWithItems`' kot is optional). Both off by default. Locked by `scripts/verify-kot-stations.ts`. **Not verified on the real printer** — confirm the cuts and the bar's darkness on the device.
```

- [ ] **Step 4: Full suite**

Run: `npm run check && npm run test:pure`
Expected: exit 0, every script PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-kot-stations-sample.ts CLAUDE.md
git commit -m "KOT stations: sample render script + CLAUDE.md"
```

---

## Self-review notes

- Spec coverage: settings (T1), pure rules + VOID-water/water-only (T2), header both styles + bigger (T3), print pipeline + one job per printer + browser per-ticket + reprint (reprint uses the same grouping path in T4), Kitchen screen (T5), preview (T6), Admin UI incl. "many categories per station" and General name (T7), tests/docs (T8).
- Deliberately unchanged: the Electron host's own browser-fallback (`printGateway.ts` `withBrowserPayloads`) lifts a joined job as one page containing all station tickets — acceptable; the server-side fallback already sends one page per ticket.
- Deploy: server and client ship together; the settings are additive, so an old client simply doesn't show the new cards.
