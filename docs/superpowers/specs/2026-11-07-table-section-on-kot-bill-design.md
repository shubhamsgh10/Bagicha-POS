# Table section (Inner / Outer / …) on the KOT and bill, plus a POS-cart WhatsApp e-bill

Date: 2026-11-07 · Status: Part A approved by the owner; Part B (e-bill) added the same day, pending spec review

Two parts, one plan: **Part A** shows the table's section on the KOT, the thermal bill and the e-bill text;
**Part B** puts a WhatsApp e-bill button back in the POS cart.

# Part A — Table section on KOT and bill

## Problem

Staff can't tell an Inner order from an Outer one on paper. Today:

- The KOT prints the table name only (`TABLE - 3` in text style, `Table No: 3` in image style).
- The bill prints **no table at all** — only the order type (`Dine In`).
- Each table already has a `section` (`inner | outer | vip | terrace | hall`, `tables.section`), but nothing on
  the print path reads it. `orders` stores `tableId` and a name snapshot `tableNumber`, not the section.

## Goal

Every dine-in KOT, bill and e-bill shows the table's section next to its number. Takeaway / pickup / delivery
tickets are unchanged.

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
3. **The bill's table line is compulsory** (owner's instruction): it prints on every bill for an order that has a
   table, with no admin setting to hide it. The same line is used on the e-bill.

## Design

### 1. Label helper — `shared/tableSection.ts` (new, pure)

- `tableSectionLabel(section)` → `inner`→`Inner`, `outer`→`Outer`, `vip`→`VIP`, `terrace`→`Terrace`,
  `hall`→`Hall`; any other value is capitalised (`rooftop`→`Rooftop`); empty/null → `null`.
- `formatTableLabel(name, section)` → `"Inner - 3"`; `"3"` when the section is unknown; `null` when there is no
  table name. The thermal bill, its plain-text twin and the e-bill all print `Table: ${formatTableLabel(...)}`,
  so the three can't drift.
- The KOT prints the section uppercased (`INNER`); the bill and e-bill print it as-is (`Inner`).
- `Tables.tsx` and `OrderCard.tsx` each keep their own copy of this mapping; not touched here (unrelated
  refactor).

### 2. Section lookup — `server/tableSectionCache.ts` (new)

- Pure core `createTableSectionCache({ load, ttlMs, now })` (testable without a DB), plus a module-level
  instance wired to `db.select({ id, section }).from(tables)`.
- Loads the **whole** `tables` list once (~15 rows). The first lookup on an instance waits for that load; after
  that `get(tableId)` is answered from memory and, once the map is older than 60 s, answers with the old value
  immediately while one background reload runs (stale-while-revalidate — a print never waits on a refresh).
  An unknown id returns `null` without reloading (a table created on another instance shows up within 60 s).
  A failed load keeps the last good map and is not retried for 10 s; with no map at all `get` returns `null` —
  **a lookup failure must never fail or delay a print**, the ticket just prints without the section. A load
  still unfinished after 15 s is treated as lost (a frozen serverless instance) and replaced.
- `forgetTableSections()` is called from `POST /api/tables`, `PUT /api/tables/:id` and
  `DELETE /api/tables/:id` (`routes.ts`). It drops the map (a load already running is discarded), so the next
  lookup on the instance that handled the edit reloads and is correct immediately; other Vercel instances are
  stale for ≤ 60 s (a section is edited about never).
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
  first `generateKOTBuffer`; pass it to both call sites (the browser-fallback ticket, and the per-routed-printer
  tickets, which cover direct and remote-dispatched printers alike). A cache hit costs no I/O, so it doesn't
  change the snapshot path's "reads nothing" property in steady state.
- `runBillAfterCatchUp`: same, into `generateBillBuffer`'s `order`.
- Move-table KOT already goes through `runKotPrint` (covered). `/api/print/preview` (`printRoutes.ts`) gets it
  for both previews.
- The browser-print fallback renders the server's own ESC/POS bytes, so it needs no client change.

- `shared/ebillText.ts`'s `buildEbillText` takes `order.tableSection` and prints the same
  `Table: Inner - 3` line (Part B supplies it).

### Out of scope (Part A)

- The POS / Kitchen in-page text previews (`receiptText.ts`, last-resort only).
- Any admin setting, any schema change.

### Testing (Part A)

New `scripts/verify-table-section.ts`, added to the `test:pure` chain in `package.json`:

- label helper: known values, VIP, unknown value, empty/null;
- cache: serves from memory within TTL, reloads after TTL, reloads on unknown id, `forget` forces a reload,
  a failing `load` keeps the last good map and never throws;
- KOT text: section line precedes the table line; no section / takeaway identical to current output;
- KOT image: taller by one line with a section, identical without, takeaway unchanged;
- bill: `Table: Inner - 3`; `Table: 3` without a section; no line without a table; the line prints with every
  optional bill flag switched off (compulsory). The plain-text twins in `printRoutes.ts` import the DB pool, so
  they are covered by `npm run check` and the manual preview check instead of the pure script.

Existing `verify-kot-style.ts`, `verify-kot-image.ts` and `verify-escpos-interpret.ts` must still pass unchanged.
Run `npm run check` and `npm run test:pure`. The new layouts are **not** verified on the real thermal printer
from this repo (same caveat as the image KOT) — check them through the browser-fallback render.

### Docs (Part A)

Add a short paragraph to CLAUDE.md's "Printing (KOT/Bill)" section: where the section comes from, the 60 s
cache, and that the bill now prints the table (compulsory, no setting).

---

# Part B — E-Bill button in the POS cart

## Current state

- The cart's action area has a KOT | Bill row and a Save | Hold | Settle row. **There is no e-bill button.**
- Dead code is left in `POS.tsx`: `handleSaveEBill` and `sendWhatsAppBill` are never called. The old handler
  built the message from the *cart* with its own inline layout (the drift `shared/ebillText.ts` was written to
  end) and the `save-ebill` branches of both save mutations then clear the cart and navigate to `/tables`.
- `shared/ebillText.ts`'s `buildEbillText` is the single, pure e-bill text builder (persisted numbers via
  `deriveBillTotals`).
- Server: `normalizeWaPhone` / `isValidWaPhone` (`server/services/whatsapp/types.ts`) and the private
  `markTableBilled` (`printDispatch.ts`, the table → `billed` flip the Bill button uses) already exist.

## Decision (owner-approved)

Delivery is a **`wa.me` link: the bill text opens pre-filled in WhatsApp and staff taps Send.** Not the
Baileys/Meta driver — it works from any device (phones on Vercel included), carries no ban risk, isn't subject
to the outbound queue's pacing or same-day duplicate guard (staff can re-send after adding an item), and the
system sends nothing by itself.

## Behaviour

1. **Button.** `E-Bill` (message icon) joins the KOT | Bill row, making it three columns. It is gated by the
   **existing `printBill` CartAction** — no new permission (route new quick-actions through existing gates) —
   and disabled exactly like Bill (`!hasItems || isPending || isOff("printBill")`, lock icon when gated).
2. **Tap.** The cart's customer phone is required: empty or under 10 digits → toast "Enter the customer's
   WhatsApp number first" and nothing is saved. Otherwise it saves the cart the way Bill does
   (`cancelPendingAutoKot()`, `submitModeRef = "save-ebill"`, `triggerSubmit()` → create or `PUT /items`, no
   print), so an item added a second ago is always on the e-bill.
3. **After the save succeeds** (the `save-ebill` branch of both mutations) it **stays on screen, like Bill**
   (`setActiveOrderId`, reload the cart on create) instead of the dead code's "clear cart + go to /tables" —
   Settle usually follows. It then calls `POST /api/orders/:id/ebill` and points a window at the returned
   `waUrl`. That window is opened **during the tap** (blank), the pattern Reports' dues e-bill already uses, so
   popup blockers allow it (Electron allows `about:blank`); on failure it is closed again. If no window could be
   opened (a PIN-gated tap loses the click's activation), a toast with an **Open WhatsApp** action opens it from
   a fresh click. Success toast: "E-bill ready — tap Send in WhatsApp".
4. **Section POS is excluded:** it hides the customer phone box entirely, so there is no number to send to.

## Server — `POST /api/orders/:id/ebill` (`requireAuth`)

- Reads the order and its items from the DB — **persisted numbers only**, item names `order_items.name` first
  then the menu (left join, ordered by `order_items.id`), never anything the client computed.
- `404` missing order; `409` cancelled. The phone is the order's persisted `customerPhone`; not valid per
  `isValidWaPhone` → `400 { code: "bad_phone" }`.
- Table label via `tableSectionFor(order.tableId)` (Part A); restaurant name / address / footer note from
  `getLiveSettings()` (a bill is a money document: same "never defaults" rule as printing → 503 when settings
  aren't live).
- Text is `buildEbillText({ ...order, tableSection }, items, settings)` — the shared builder, now printing
  `Table: Inner - 3`.
- Flips the table to `billed` with the same non-fatal helper the Bill button uses (`markTableBilled`, exported
  from `printDispatch.ts`; only for a running order still holding its table), so a table whose bill went out on
  WhatsApp reads as billed on the Tables page.
- **Deliberately does not** bump `billPrintCount` (not a print; that drives the paper "DUPLICATE" watermark),
  touch loyalty, enqueue an `automation_jobs` row or write an audit row (it is not a deviation).
- Returns `{ text, waUrl, phone }`, `waUrl = https://wa.me/<normalizeWaPhone(phone)>?text=<encoded text>`.

## Client clean-up

- Delete the dead `handleSaveEBill` and `sendWhatsAppBill`, and POS.tsx's now-unused `buildEbillText` import.
- The two mutations' `save-ebill` branches change as described in Behaviour 3.
- Mobile uses the same panel, so the same button; no separate layout.

## Failure handling

Save fails → the existing "Failed to place order / update" toast, nothing opens. Endpoint fails → destructive
toast through `describeApiError`; the order stays saved. Popup blocked → the Open WhatsApp action toast.

## Testing (Part B)

- Extend `scripts/verify-ebill-text.ts`: `Table: Inner - 3`, `Table: 3` without a section, no line without a
  table, and the existing container/delivery/discount cases unchanged.
- The route's DB glue can't run in `test:pure`. Verify in a real browser per CLAUDE.md: a throwaway order with
  an explicit `ZZTEST-` marker and a dummy phone, the server restarted first (no hot reload), cleaned up through
  Cancel Order and the `orders.id` sequence restore. Check: button gating and lock, no-phone toast, e-bill text
  matches the saved order (incl. container / discount / section), cart stays open, table shows billed.

### Docs (Part B)

CLAUDE.md: a short paragraph under "Printing (KOT/Bill)" — the E-Bill button flow, `POST /api/orders/:id/ebill`,
that it reuses the `printBill` gate and `markTableBilled`, and that it is a manual `wa.me` send outside the
outbound queue.
