# Mobile compact UI — Tables + POS (sub-project 1)

Date: 2026-11-11 · Branch: `mobile-compact-ui` (from `main`)

## Goal

Restyle the **phone** layout of the Tables page and the POS page to follow the owner's
"Compact POS" design (`Compact POS.dc.html`, two 390×844 screens). Desktop and tablet stay
exactly as they are.

This is sub-project 1 of 3:
1. **Tables + POS** — Compact POS design (this spec).
2. Shared mobile shell (header ☰ + eyebrow + serif title, drawer, chips, cards) from
   `MobilePOS.dc.html` applied to Orders, Billing, Reports, Menu, Login.
3. Remaining pages (Staff, Admin, Settings, Customers, Inventory, KOT, …).

## Rules

- **Mobile only:** every change applies below the existing `md` breakpoint (768px). Use
  `md:hidden` / `hidden md:flex` pairs or `max-md:` variants; no desktop class changes.
- **Reskin only.** No server, schema, pricing, cart, print, settlement or permission change.
  Every action keeps its existing handler and its `go(action, label, fn)` / `isOff()` gate.
- Colours come from the design-system tokens already in `client/src/index.css`
  (`--green-800` #1B4D33, `--paper-*`, `--line` #E7DFCE, `--text-*`); the design's navy
  #243B5E and clay #B85C38 are used for Delivery / Pickup.
- Touch targets ≥ 44px tall for every tap control on these two screens.

## Tables page (mobile)

**Header (TopNav, mobile part).** ☰ · Bagicha logo + "BAGICHA" wordmark (Cormorant, letter-spaced,
navy) · spacer · RoleSwitcher (the design's shield button). TopNav is shared, so every page's
mobile header gets this; that is intended and is the first piece of sub-project 2.

**Stats strip.** One white rounded card split into 4 equal columns: Running · Free · Orders ·
Sales (uppercase 10px label with a status dot, 15px bold value).
- Running / Free toggle a client-side filter of the table grid (tap again to clear); the
  active column gets the light-green background. Running shows every occupied table
  (running + billed); Free shows free tables.
- Sales toggles the existing Cash / UPI / Due split (`showSalesSplit`), shown as a row of equal
  columns directly under the strip. Data stays `/api/live-status`.

**Action row.** Four 44px buttons: Delivery (navy, → `/pos?mode=delivery`), Pickup (clay,
→ `/pos?mode=pickup`), "+ Table" (dashed outline, opens the existing Add dialog) and a square
pencil that toggles **edit mode** (filled green while on).

**On floor.** One horizontally scrolling line: "ON FLOOR" label + one navy chip per staff
member ("Raj → 3, 5"), from the same `runningTables` grouping, + "n tables active". Hidden
when nothing is running. Replaces the Staff-on-floor card on mobile only.

**Zones.** Per section: uppercase header, divider line, "x running · y tables". Grid of
4 columns, 6px gap.
- Free card: 60px tall, dashed border, name (16px bold) + seat icon & capacity.
- Running card: spans 2 columns, light-green fill, name + timer (mono), amount + server name;
  right side has two 38×44 buttons: Print (dark green, existing `printTableBill`) and Move
  (existing `go("moveTable", …, setShiftFrom)`).
- Billed card: existing billed styling + "Bill printed", spans 2 columns like running.
- Tapping the card body keeps `handleTableClick` (open POS, or pick shift target).
- Shift source / target rings stay.
- **Edit mode:** cards show a delete corner (top-right, red) and an edit corner
  (bottom-right, navy); Print/Move are hidden. Edit opens the existing Add/Edit dialog (with
  Section). Delete uses existing `handleDelete`. Tapping a card body in edit mode opens Edit
  instead of the POS. Outside edit mode, no edit/delete controls are shown on mobile.

**Kept, restyled to match:** `LiveOrdersStrip` (delivery/pickup open orders), quick-POS
section cards with `SectionOrdersFlyout`, loading skeleton, empty state, `LiveOrdersPanel`.

## POS page (mobile, non-section mode)

**Header row 1.** Back (40px square) · dark-green pill with the table name + mono timer
(for pickup/delivery: the mode name, no timer) · small uppercase order-type chip · order
number (mono, right-aligned, plain text — the tap/long-press → settle handler stays on the
cart bar's order chip) · RoleSwitcher.

**Header row 2.** Search box (existing search state) · "Guest" button showing the entered
name/phone or "Guest". Tapping it expands a row with the existing customer name and phone
inputs **including** the existing autocomplete dropdown. Replaces today's mobile customer
strip.

**Menu tab.** Horizontal category chips (All + categories; active = filled green). Items
grouped under serif category headings with item counts, 2-column grid. Tile: name + price on
the left; right side 40×44 "+" or, when exactly one cart line matches, the green − qty + pill
(existing `bumpCartQty` / add logic and the existing "0 or 2+ lines → +" rule). In-cart tiles
get the green border/fill. Empty search shows "Nothing matches … use Open item".

**Cart tab.**
- Bar: "ORDER" + order-number chip · "+ Open item" (dashed, existing gate + dialog) · "Clear"
  (existing `clearCart` gate).
- Rows (white list, divider lines): − qty + stepper (40×44 buttons, existing handlers incl.
  `requestRemoveFromCart` when going to zero) · name + meta line (addons / notes / unit price,
  pencil icon) — tapping opens the **existing Edit Item modal** · amount · × (existing
  `requestRemoveFromCart`).
- Existing grouping by service mode stays (headers restyled).
- Totals: a 40px collapsed line "Subtotal ₹x · tax ₹y · discount & charges" + chevron
  (existing `summaryOpen`); open shows Subtotal, Discount % input, Container ₹ input,
  Delivery ₹ input (per `chargeBoxVisibility`), Tax (rate) — existing inputs and gates.
- Action dock (white, only on the Cart tab): 5 equal 44px buttons KOT (navy tint) · Bill
  (clay tint) · E-Bill (green tint) · Save (plain) · Hold (clay tint), then a full-width
  primary "Settle ₹total · n items". Same handlers, disabled states and `isOff` locks as today.

**Bottom bar.** Menu | Cart (44px, icon + label, active = green) with a count badge on Cart.

**Unchanged:** Section POS (`isSectionMode`) mobile layout — except the two bars it shares with
the normal phone POS (category chips, Menu | Cart bottom bar), which take the new look — every dialog (settlement, cancel,
item cancel, PIN, hold, move/merge, edit item, open item), desktop layout.

## Testing

- `npm run check` and `npm run test:pure` pass.
- Real browser at 390×844 (and 360 wide): Tables filter/edit mode/print/move; POS open table
  → add items (tile pill, stepper) → Guest → KOT → Bill → Settle; pickup order. Then check
  ≥768px width is unchanged. The DB is the shared production DB: use no customer name/phone,
  remove test orders afterwards (Cancel Order, then the scripted delete + `orders.id` sequence
  restore from CLAUDE.md "Verifying a UI change"); no screenshots left in the repo root.
