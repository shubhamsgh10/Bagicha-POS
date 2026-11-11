# Mobile UI — Orders, Billing, Reports, Menu, Login + shared shell (sub-project 2)

Date: 2026-11-11 · Branch: `mobile-compact-ui` · Follows `2026-11-11-mobile-compact-tables-pos-design.md`

## Goal

Restyle the **phone** layout (< 768px, the app's `md` breakpoint) of Orders, Billing, Reports,
Menu and Login to the owner's `MobilePOS` design, plus the shared pieces those pages sit in
(page header, chips, bottom bar, ☰ drawer). Desktop and tablet stay exactly as they are.

Sub-project 3 (Staff, Admin, Settings, Customers, Inventory, KOT, Live View, Attendance, …)
is out of scope here; it will reuse the shared pieces built in this one.

## Decisions (from the owner)

- **Restyle, keep every feature.** Same data, filters, tabs, actions, dialogs as today; only the
  phone layout and look change. Nothing is removed or moved behind another screen.
- **Bottom bar keeps today's four tabs** (Tables, Orders, Billing, Live Tables), restyled. No new
  Search page, no standalone New-order screen.
- **Login:** the logo and the picture must be the same. The only logo on the login screens is the
  one drawn into the picture's bottom-right corner; the separate square logo above the card goes.

## Rules

- Responsive classes (`md:` variants) on the existing JSX; no forked page components except
  the small shared pieces below. No change to queries, mutations, permission gates, print or
  payment code. Dialogs (payment, due-settle, change-payment, edit-menu-item, …) are untouched.
- Tokens only (`--green-800`, `--paper-*`, `--line`, `--ink-700`, `--clay-600`, …); serif
  headings use `font-display` (Cormorant), numbers `font-mono`/`tabular-nums`.
- Tap targets ≥ 44px tall for primary controls; chips ≥ 36px.
- tsconfig is ES5: no `for…of` / spread over `Map`/`Set` (use `Array.from`).
- Never edit `client/src/components/ui/*`.

## Shared pieces

**Page header (`components/Header.tsx`, phones).** Eyebrow (existing `eyebrow` prop, green
uppercase 10.5px) above a 28px Cormorant title, `paper-50` background, no description and no
clock, tighter padding; the New-Order/`action` slot stays on the right. Desktop markup unchanged.
Pages without an eyebrow keep working. TopNav (☰ + logo + wordmark) stays above it.

**Chip row (`components/mobile/ChipRow.tsx`, new).** `ChipRow` + `Chip` — horizontally scrolling
pills, active = filled `--green-800`, inactive = white with `--line-strong` border, optional count
and status dot. Used by Orders (status + payment), Billing (day), Reports (tabs), Menu
(Items/Categories, category filter). Presentational only.

**Bottom bar (`components/BottomNav.tsx`).** Same four items and filtering; 21px icons, 10.5px
labels, green when active, 6px/26px padding, top shadow as in the design.

**Drawer (`components/TopNav.tsx`).** Same items, role filtering and logout. Header becomes the
design's green panel (wordmark + the signed-in staff initials/name/role); rows get the status dot
and 44px height; the footer shows initials + name and a logout button.

## Orders (`pages/Orders.tsx`)

- Header eyebrow `Today · N orders` (or the picked day / "All dates"), title "Orders".
- Toolbar on phones: search full width; one row with the existing `DayPicker` and compact
  New Order / Refresh buttons; status tabs (`all … cancelled`) as a `ChipRow` (the existing
  `Tabs` state is kept; only the trigger styling changes); Cash / UPI / Due as a second chip row
  with the existing counts and filter state.
- Order row: the collapsed summary becomes the design's card (order number mono, "table · type ·
  server" line, status pill, item summary, total, elapsed minutes). Tapping still expands the full
  detail (payment, change-payment link, settle-due, status select, print). `OrderDetailRow` stays
  `React.memo`; the 30-rows-at-a-time windowing and the "no `useToast()` inside a row component"
  rule from CLAUDE.md are kept.

## Billing (`pages/Billing.tsx`)

- Header eyebrow `N pending payment` (+ "all dates"), title "Billing".
- Day picker + backlog banner restyled (banner keeps its "Show all" action).
- Order cards: single column, design card — order number, customer, time, status + payment
  badges, compact totals (subtotal, discount, container, delivery, tax, total), 44px
  "Collect Payment" (primary green) and "Print". Paid cards keep the "Paid via …" / write-off text.
- Payment and due-settle dialogs, Razorpay, `deriveBillTotals` usage: unchanged.

## Reports (`pages/Reports.tsx`)

- Header eyebrow = the range label, title "Reports". Date picker and Export on one row.
- Stat cards on phones: the first (Total Sales) is the dark-green hero card; the rest form a
  compact 2-column grid. Same values and sub-labels.
- The eight tabs become a scrolling `ChipRow` (existing `activeTab` state, same visibility rule
  for KOT & Bill Activity).
- Tab bodies keep their data, charts, drill-downs and CSV export. Their section containers take
  the design's white rounded card look; wide tables scroll sideways inside their card. The
  `DateRangePicker` keeps its no-exit-animation rule (CLAUDE.md).

## Menu (`pages/Menu.tsx`)

- Header eyebrow `N items · M categories`, title "Menu".
- Items/Categories switch as chips; toolbar = Add Item (green, 44px) + Bulk Edit + Filters
  buttons (Bulk/Filters as icon buttons with labels on ≥ `sm`).
- New phone-only category chip row above the list, wired to the existing `filterCategory` state.
- Item cards become design list rows in one white card: name, mono line (price or sizes · prep ·
  ingredients · margin where visible today), availability pill (display only, as today),
  edit/delete buttons (44px). Bulk-select, filters panel, bulk actions panel and margins keep
  working. The availability pill is **not** made a quick toggle (new behaviour, out of scope).
- Categories tab: rows restyled the same way.

## Login (`pages/Login.tsx`, phones + the shared card)

- **Phone (`StaffSelector`, device flagged mobile):** splash unchanged. The staff grid, PIN entry
  and manager/admin screens show the **same chef picture** (`Wood-Fire-Pizza.png`) as a
  full-screen backdrop — `contain`, bottom-anchored, white letterbox (the asset is near-white,
  as the splash relies on) — with the card on top as a white (≈ 0.92) rounded card. The
  separate square logo above the card (`compactWrap`'s 56px `bagichaLogoImg`) is removed; the
  picture's own corner lockup is the logo and must stay visible and uncovered (picture is fixed;
  the card scrolls above it).
- PIN screen and staff cards take the design's look: 6 PIN dots, 52px rounded keypad keys on
  `--paper-50`, avatar + name header. PIN still auto-submits at 6 digits (no extra button); the
  physical-keyboard support, shake, toasts and TOTP flow are unchanged. Manager/admin form
  inputs/buttons use the same tokens.
- **Desktop / tablet / narrow non-mobile-UA (`Login` root card):** keeps the landscape
  oven-and-patio picture on wide screens (a wide screen cannot use the tall one); below 640px it
  uses the same chef backdrop as above. The card's own square logo (`login-logo-img`) is removed
  there too, so the picture's corner lockup is the only logo. The backdrop positioning must keep
  that lockup visible at common sizes (390×844, 768×1024, 1280×800, 1920×1080).
- No change to auth requests, rate limits or the splash gesture code.

## Out of scope

Staff, Admin, Settings, Customers, Inventory, KOT, Live View, Attendance, Print Station and the
public feedback page (sub-project 3); POS/Tables (done); any desktop change.

## Testing

- `npm run check`, `npm run test:pure` (no new pure logic expected; if a helper appears it gets a
  `verify-*.ts` in `test:pure`).
- Real browser, 390×844 and 360×780, signed in with the owner's login: Orders (chips, search, day
  picker, expand a row), Billing (cards, banner, dialog *opens* but nothing is paid), Reports (all
  tabs, date picker, hero card), Menu (chips, filters, bulk mode on/off, edit dialog *opens*, no
  save/delete), drawer, bottom bar, Login (log out → splash → staff grid → PIN → admin form). No
  horizontal page scroll; primary tap targets ≥ 44px; then 768 and 1280 to confirm nothing
  changed; login logo visible at the four sizes above. The DB is the shared production DB: no
  orders, payments, deletes or menu edits during testing.
