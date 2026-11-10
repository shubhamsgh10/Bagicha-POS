# KOT Kitchen Stations — design

Date: 2026-11-11 · Status: approved by owner in brainstorming

## Problem

The restaurant has **4 chefs, each cooking in a different space** (South Indian, Main Course,
Pizza, Chinese) but **one KOT printer** on the main POS PC. Today one KOT tap prints one combined
ticket, so staff can't hand each chef only their part. The existing Category Routing
(`kotSettings.categoryPrinterOverrides`) splits tickets **per printer**, so with one printer it
never splits.

Second problem: Mineral Water is usually added at the end of a meal, so pressing Bill
triggers the silent catch-up KOT and prints a pointless water-only ticket.

## Goals

1. One KOT tap prints **one ticket per kitchen station** that has something new, each cut
   apart by the printer's cutter, on the single printer.
2. Each ticket carries a **very large station header** (white text on a full-width black bar)
   so a chef spots their ticket instantly.
3. Items in no station print on a **General** ticket (name editable) — nothing silently skips the kitchen.
4. A **"Don't print on KOT"** list (categories and/or single items) removes items from every
   KOT (manual, Auto-KOT, Bill catch-up, reprint) **and from the Kitchen KOT screen**. They stay
   on the bill and are still charged.
5. Fully configurable by the owner in Admin → Print Settings → KOT Print. Off by default —
   nothing changes until turned on (except the skip list, which is empty by default).

Non-goals: splitting the Kitchen KOT screen into per-station tickets; per-station KOT numbers;
per-menu-item station assignment.

## Settings (no DB migration)

Stored in `restaurant_settings` print settings alongside the existing KOT settings
(`shared/print/types.ts` `KOTPrintSettings`, defaults in `server/settingsStore.ts`; the
settings merge supplies defaults for already-saved settings):

```ts
kitchenStations?: {
  enabled: boolean;                 // default false
  stations: { id: string; name: string; categoryIds: number[] }[]; // print order = list order
  generalName: string;              // default "General"
};
skipKot?: { categoryIds: number[]; itemIds: number[] };   // default empty; applies even when stations are off
```

Rules:
- A category belongs to at most one station (UI enforces; if saved data has duplicates, the
  first station in list order wins).
- An item is skipped if its menu item id is in `itemIds` or its category id is in `categoryIds`.
  Open items (negative ids, no category) are never skipped and go to General.
- Deleted categories referenced by settings are ignored.

## Shared pure helper — `shared/kotStations.ts`

DB-free, unit-tested:
- `isKotSkipped(item: {itemId, categoryId}, skip)` → boolean.
- `stationFor(categoryId, stationsCfg)` → `{ key, name }` (General when unassigned or stations off).
- `groupByStation(newItems, modifiedItems, cancelledItems, catByItemId, cfg)` → ordered list of
  `{ key, name, newItems, modifiedItems, cancelledItems }`, stations in list order then General,
  empty groups dropped. When stations are disabled → a single group with no header (today's behaviour).
- `filterSkipped(snapshotItems, catByItemId, skip)` for use on both snapshot sides.

## Print pipeline — `server/services/printDispatch.ts` `runKotPrint`

1. **Skip filter on both sides of the delta.** Remove skipped items from `currentSnapshot`/raw
   items *and* from `lastSnapshot.items` before `computeDelta`. So an older order whose water was
   already printed never produces a "VOID Water" line, and a water-only addition is no delta.
   The claimed `lastKotSnapshot` stays the **unfiltered** current snapshot (so later settings
   changes compare consistently).
2. **Nothing left → no print.** If after filtering there are no new/modified/cancelled lines
   (or, for a first KOT / reprint, no lines at all), return `printed:false, reason:"no_delta"`
   without claiming — same as today's no-delta path, so Bill's silent catch-up stays silent.
3. **Group by printer + station.** The printer is still resolved per item via
   `categoryPrinterOverrides` → main KOT printer; groups key on `printerId|stationKey`.
4. **One job per printer.** All station tickets for one printer are concatenated into **one**
   buffer (each ticket ends with its own `GS V` cut) → one `print_jobs` row / one direct send.
   This keeps the order fixed and avoids the desktop `printQueue` order+type+printer dedup
   (fallback when no `jobId`) dropping tickets 2–4. Same KOT number on every ticket.
5. **Browser fallback** (no printer / non-ESC/POS): one `browserPayloads` entry **per station
   ticket** (existing multi-ticket support prints one page each).
6. **Reprint** splits the full order by station the same way.
7. Partial-failure behaviour, claim/rollback, and the `kotCatchUp` path are unchanged.

`/api/print/preview`'s `kotTextLines` follows the same skip + grouping so the preview matches.

## Kitchen KOT screen

`shared/orderItemsSave.ts` `kitchenTicketLines` (PUT `/api/orders/:id/items`) and the ticket
built in `POST /api/orders` drop skipped items. If nothing remains, no `kot_tickets` row is
created for that save (the KOT number is not issued). Screen stays one ticket per save.

## Ticket header

`generateKOTBuffer` gains an optional `stationName`:
- **Image style** (`shared/print/kotImage.ts`, default): a full-width black bar at the very top
  with the name in white bold at a size well above the item size (new `KOT_IMAGE_STYLE.station*`
  constants), uppercase, shrunk only if it would not fit on one line. If a glyph is missing the
  existing text fallback applies.
- **Text style** (`generators.ts`): `GS B 1` (reverse) + double width & height, centred, uppercase,
  then reverse off.
- No header when stations are disabled.

## Admin UI — `client/src/components/PrintSettingsPanel.tsx`

New **Kitchen Stations** card in the KOT Print tab:
- Switch "Split KOT by kitchen station".
- Station list: name input, category checkboxes (a category already used by another station is
  shown disabled with that station's name), up/down to reorder, delete, "+ Add station".
- "General ticket name" input.
- **Don't print on KOT** card: category checkboxes + item search/multi-select (chips).
- Saved through the existing print-settings save (only changed fields sent).

## Testing

New `scripts/verify-kot-stations.ts` (added to `test:pure`): skip rules (item, category, open
item), station assignment + duplicate-category rule, grouping order and empty-group drop,
VOID-water case (old snapshot contains water), water-only delta = nothing, reprint split,
concatenated buffer = N cuts in station order, header bytes present in text style, image style
renders a header (non-null, taller than without) and the virtual-printer round trip yields one
raster block per ticket. Existing `verify-kot-image`, `verify-kot-style`, `verify-kot-delta`,
`verify-order-items-save`, `verify-print-request` must stay green; `npm run check` clean.
Browser-fallback render checked visually. **Not verifiable here:** the real thermal printer —
owner to confirm cut + header darkness on the device.
