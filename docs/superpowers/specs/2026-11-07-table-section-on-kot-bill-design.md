# Table section (Inner / Outer / …) on the KOT and the bill

Date: 2026-11-07 · Status: design approved by the owner, pending spec review

## Problem

Staff can't tell an Inner order from an Outer one on paper. Today:

- The KOT prints the table name only (`TABLE - 3` in text style, `Table No: 3` in image style).
- The bill prints **no table at all** — only the order type (`Dine In`).
- Each table already has a `section` (`inner | outer | vip | terrace | hall`, `tables.section`), but nothing on
  the print path reads it. `orders` stores `tableId` and a name snapshot `tableNumber`, not the section.

## Goal

Every dine-in KOT and bill shows the table's section next to its number. Takeaway / pickup / delivery tickets
are unchanged.

## Decisions (owner-approved)

1. **Format: a separate section line.** KOT puts the section on its own big line above the table line; the bill
   gets a new `Table: <Section> - <name>` line.
2. **Source of the section: a live lookup by `order.tableId`, through a small in-process cache** — not a new
   `orders` column, not an uncached read per print. Rationale:
   - No schema change and no migration against the shared DB (a server deployed ahead of a migration 500s every
     order read — it has happened before with `subtotal_amount`).
   - Follows Move Table / table shifts for free (they already rewrite `orders.tableId`).
   - Orders already open at deploy time get the section immediately.
   - Adds no DB read to a KOT/bill tap in steady state (print latency was tuned hard; an uncached read would add
     a round trip to every tap).
3. No admin toggle for the bill line (YAGNI; the owner asked for it unconditionally).

## Design

### 1. Label helper — `shared/tableSection.ts` (new, pure)

- `tableSectionLabel(section)` → `inner`→`Inner`, `outer`→`Outer`, `vip`→`VIP`, `terrace`→`Terrace`,
  `hall`→`Hall`; any other value is capitalised (`rooftop`→`Rooftop`); empty/null → `null`.
- The KOT prints it uppercased (`INNER`); the bill prints it as-is (`Inner`).
- `Tables.tsx` and `OrderCard.tsx` each keep their own copy of this mapping; not touched here (unrelated
  refactor).

### 2. Section lookup — `server/tableSectionCache.ts` (new)

- Pure core `createTableSectionCache({ load, ttlMs, now })` (testable without a DB), plus a module-level
  instance wired to `db.select({ id, section }).from(tables)`.
- Loads the **whole** `tables` list once (~15 rows) and serves `get(tableId)` from memory for 60 s. A miss on an
  id (new table) or an expired entry triggers one reload. A failed reload keeps serving the last good map; with
  no map at all it returns `null` — **a lookup failure must never fail or delay a print**, the ticket just
  prints without the section.
- `forgetTableSections()` is called from `POST /api/tables`, `PUT /api/tables/:id` and
  `DELETE /api/tables/:id` (`routes.ts`), so the instance that handled the edit is correct immediately; other
  Vercel instances are stale for ≤ 60 s (a section is edited about never).
- Exported helper `tableSectionFor(tableId: number | null)`.

### 3. Print inputs

Add an optional `tableSection?: string | null` to:

- `generateKOTBuffer` params and `generateKOTImageBuffer`'s params (`shared/print/generators.ts`,
  `shared/print/kotImage.ts`);
- `generateBillBuffer`'s `order` (`shared/print/generators.ts`);
- the plain-text twins `kotTextLines` / `billTextLines` (`server/printRoutes.ts`).

### 4. KOT layout

- **Text style** (`generateKOTBuffer`): with a table and a section, a double-size centered `INNER` line sits
  directly above the double-size `TABLE - 3` line. No section → exactly today's output.
- **Image style** (`kotImage.ts`): a bold big centered `INNER` line between `Dine In` and `Table No: 3`. The
  existing `kotImage` row-count cap and glyph-coverage fallback (to the text ticket) are unaffected — section
  text is ASCII.
- **Takeaway / no table:** unchanged (`TAKEAWAY` / `Take Away`).

### 5. Bill layout

After the time line and before `Cashier: … Bill No.: …`, when the order has a `tableNumber`:

```
Table: Inner - 3
```

No section known (legacy row, deleted table, lookup failure) → `Table: 3`. No table → no line (today's
behaviour for pickup/delivery). Same line in `billTextLines`.

### 6. Wiring (server)

- `runKotPrint` (`server/services/printDispatch.ts`): `await tableSectionFor(order.tableId)` once, before the
  first `generateKOTBuffer`; pass it to all three call sites (browser-fallback ticket, per-routed-printer direct
  tickets, remote-dispatched tickets). A cache hit costs no I/O, so it doesn't change the snapshot path's
  "reads nothing" property in steady state.
- `runBillAfterCatchUp`: same, into `generateBillBuffer`'s `order`.
- Move-table KOT already goes through `runKotPrint` (covered). `/api/print/preview` (`printRoutes.ts`) gets it
  for both previews.
- The browser-print fallback renders the server's own ESC/POS bytes, so it needs no client change.

### Out of scope

- The WhatsApp e-bill (`shared/ebillText.ts`) already prints `Table: X`; left alone.
- The POS / Kitchen in-page text previews (`receiptText.ts`, last-resort only).
- Any admin setting, any schema change.

## Testing

New `scripts/verify-table-section.ts`, added to the `test:pure` chain in `package.json`:

- label helper: known values, VIP, unknown value, empty/null;
- cache: serves from memory within TTL, reloads after TTL, reloads on unknown id, `forget` forces a reload,
  a failing `load` keeps the last good map and never throws;
- KOT text: section line precedes the table line; no section / takeaway identical to current output;
- KOT image: taller by one line with a section, identical without, takeaway unchanged;
- bill: `Table: Inner - 3`; `Table: 3` without a section; no line without a table; the plain-text twins agree
  with the buffers.

Existing `verify-kot-style.ts`, `verify-kot-image.ts` and `verify-escpos-interpret.ts` must still pass unchanged.
Run `npm run check` and `npm run test:pure`. The new layouts are **not** verified on the real thermal printer
from this repo (same caveat as the image KOT) — check them through the browser-fallback render.

## Docs

Add a short paragraph to CLAUDE.md's "Printing (KOT/Bill)" section: where the section comes from, the 60 s
cache, and that the bill now prints the table.
