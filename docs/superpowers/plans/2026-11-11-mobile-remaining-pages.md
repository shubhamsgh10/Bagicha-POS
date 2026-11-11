# Mobile Orders / Billing / Reports / Menu / Login + Shared Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the phone (<768px) layout of Orders, Billing, Reports, Menu and Login — plus the shared page header, chip rows, bottom bar and ☰ drawer — to the owner's MobilePOS design, keeping every feature, with desktop/tablet unchanged.

**Architecture:** Responsive Tailwind classes (`max-sm:` / `sm:` / `md:` variants) on the existing JSX, so desktop markup and behaviour cannot change. Three small new presentational pieces: `ChipRow`/`Chip` (scrolling pill filters), `MenuItemRow` (phone list row for the Menu page) and `LoginBackdrop` (the chef picture behind the phone login screens). Only pages that need dynamic header text call `useIsMobile()` (already synchronous) to pass an eyebrow on phones only.

**Tech Stack:** React 18 + TypeScript, Tailwind 3.4 (`max-sm:` supported), wouter, TanStack Query, lucide-react, framer-motion. Type-check: `npm run check`. Tests: `npm run test:pure` (no new pure logic in this plan).

**Spec:** `docs/superpowers/specs/2026-11-11-mobile-remaining-pages-design.md`

**Ground rules for every task**
- Branch `mobile-compact-ui`. Commit trailer (use exactly): `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `git add` explicit paths only. Never push.
- Desktop/tablet (≥ `md`, and ≥ `sm` where a page already split at `sm`) must render exactly as before. Every change is either a `max-sm:`/`md:hidden`/`sm:hidden` class, an element that only renders on phones, or a prop passed only when `isMobile`.
- Do not edit `client/src/components/ui/*`. Do not touch dialogs, queries, mutations, permission gates. tsconfig is ES5: no `for…of`/spread over `Map`/`Set`.
- Many files use CRLF line endings. Use the Edit tool (it matches exact text) or a script that preserves line endings; check `git diff --stat` shows only the intended lines changed.
- Tokens: `--green-800`, `--green-700`, `--green-300`, `--paper-50/100`, `--line`, `--line-strong`, `--text-strong/1/2/3`, `--success-bg`, `--ink-700`, `--clay-600`, `--danger`. Phone tap targets ≥ 44px for primary controls, chips ≥ 36px.
- Existing utility: `.scrollbar-hide`, `.bg-eyebrow`, `font-display` (Cormorant).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `client/src/components/mobile/ChipRow.tsx` | create | `ChipRow` + `Chip` pill filters |
| `client/src/components/mobile/MenuItemRow.tsx` | create | phone list row for a menu item |
| `client/src/components/LoginBackdrop.tsx` | create | chef picture backdrop for phone login |
| `client/src/components/Header.tsx` | modify | phone header look |
| `client/src/components/BottomNav.tsx` | modify | phone bottom bar look |
| `client/src/components/TopNav.tsx` | modify | ☰ drawer look |
| `client/src/components/DayPicker.tsx` | modify | bigger phone tap targets |
| `client/src/pages/Orders.tsx` | modify | phone toolbar, chips, card |
| `client/src/pages/Billing.tsx` | modify | phone header/cards |
| `client/src/pages/Reports.tsx` | modify | hero stat, chip tabs, toolbar |
| `client/src/pages/Menu.tsx` | modify | chips, toolbar, list rows |
| `client/src/pages/Login.tsx` | modify | backdrop, no card logo, paper PIN pad |

---

### Task 1: `ChipRow` / `Chip`

**Files:**
- Create: `client/src/components/mobile/ChipRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from "react";

/** Horizontally scrolling row of pill filters (MobilePOS design). Presentational only. */
export function ChipRow({
  children, className = "", ariaLabel,
}: { children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className={`flex gap-1.5 overflow-x-auto scrollbar-hide ${className}`}>
      {children}
    </div>
  );
}

export function Chip({
  active, onClick, children, count, dot, title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Optional count shown after the label. */
  count?: number;
  /** Optional Tailwind background class for a small status dot, e.g. "bg-emerald-500". */
  dot?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className="shrink-0 min-h-[36px] px-3.5 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
      style={
        active
          ? { background: "var(--green-800)", color: "#F4F8F0", borderColor: "var(--green-800)" }
          : { background: "#fff", color: "var(--text-1)", borderColor: "var(--line-strong)" }
      }
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {children}
      {count != null && <span className="tabular-nums text-[10px] opacity-70">{count}</span>}
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/mobile/ChipRow.tsx
git commit -m "ChipRow/Chip: scrolling pill filters for phone layouts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Phone page header

**Files:**
- Modify: `client/src/components/Header.tsx`

- [ ] **Step 1: Header classes**

Replace

```tsx
    <header className="bg-card shadow-sm border-b border-border px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
```

with

```tsx
    <header className="bg-card max-sm:bg-[var(--paper-50)] shadow-sm max-sm:shadow-none border-b border-border px-4 sm:px-6 py-3 max-sm:py-2.5 sm:py-4 sticky top-0 z-10">
```

and replace the title

```tsx
          <h1 className="font-display font-semibold text-2xl sm:text-3xl leading-none text-foreground truncate">{title}</h1>
```

with

```tsx
          <h1 className="font-display font-semibold text-[28px] sm:text-3xl leading-none text-foreground truncate">{title}</h1>
```

(Description and clock are already `hidden sm:*`; the eyebrow already renders when passed.)

- [ ] **Step 2: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Header.tsx
git commit -m "Header: phone look (paper background, 28px serif title)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bottom bar

**Files:**
- Modify: `client/src/components/BottomNav.tsx`

- [ ] **Step 1: Restyle**

Replace the `<nav …>` opening tag block

```tsx
    <nav className="md:hidden shrink-0 safe-bottom"
      style={{
        background: "var(--paper-0)",
        borderTop: "1px solid var(--line)",
        boxShadow: "0 -6px 20px rgba(20,34,27,0.07)",
      }}
    >
      <div className="flex items-center h-[56px]">
```

with

```tsx
    <nav className="md:hidden shrink-0 safe-bottom"
      style={{
        background: "var(--paper-0)",
        borderTop: "1px solid var(--line)",
        boxShadow: "0 -6px 20px rgba(20,34,27,0.05)",
      }}
    >
      <div className="flex items-stretch min-h-[60px] px-1.5 pt-1.5 pb-1">
```

Replace the button's className and children

```tsx
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 touch-manipulation"
              style={{ color: isActive ? "var(--green-800)" : "var(--text-3)" }}
            >
              <Icon className="w-5 h-5 transition-colors" />
              <span className="text-[9px] font-semibold leading-none">
                {item.label}
              </span>
```

with

```tsx
              className="flex-1 flex flex-col items-center justify-center gap-[5px] py-1.5 touch-manipulation"
              style={{ color: isActive ? "var(--green-800)" : "var(--text-3)" }}
            >
              <Icon className="w-[21px] h-[21px] transition-colors" />
              <span className="text-[10.5px] font-bold leading-none">
                {item.label}
              </span>
```

- [ ] **Step 2: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/BottomNav.tsx
git commit -m "BottomNav: MobilePOS look (21px icons, 10.5px labels)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ☰ drawer

**Files:**
- Modify: `client/src/components/TopNav.tsx` (the `Mobile sidebar drawer` block only)

- [ ] **Step 1: Drawer header**

Replace the whole `{/* Drawer header */}` block

```tsx
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--line)]">
              <div>
                <p className="text-sm font-bold text-[var(--text-strong)]">{user?.username}</p>
                <p className="text-xs text-[var(--text-3)] capitalize">{activeRole}</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-[var(--paper-100)] text-[var(--text-3)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
```

with

```tsx
            {/* Drawer header — green panel with the wordmark (MobilePOS design) */}
            <div className="flex items-start justify-between gap-3 px-4 pt-6 pb-4" style={{ background: "var(--green-800)", color: "#F4F8F0" }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0">
                  <img src={bagichaLogoImg} alt="" width={30} height={30} style={{ objectFit: "contain", mixBlendMode: "multiply" }} />
                </span>
                <div className="min-w-0">
                  <div className="font-display text-[19px] font-semibold uppercase tracking-[0.18em] leading-none">Bagicha</div>
                  <div className="font-mono text-[10px] mt-1.5 capitalize truncate" style={{ color: "var(--green-300)" }}>
                    {user?.username} · {activeRole}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Close menu"
                className="w-10 h-10 -mr-2 -mt-1 rounded-lg flex items-center justify-center hover:bg-white/10 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
```

- [ ] **Step 2: Nav row height**

In the nav item `<div onClick={() => setSidebarOpen(false)} className={`flex items-center gap-3 px-3 py-3 rounded-xl …`}>` change `px-3 py-3` to `px-3 min-h-[48px]` and the active class `bg-[var(--green-50)] text-[var(--green-800)]` to `bg-[var(--success-bg)] text-[var(--green-800)]`.

- [ ] **Step 3: Footer**

Replace the whole `{/* Logout */}` block

```tsx
            {/* Logout */}
            <div className="shrink-0 px-3 py-4 border-t border-[var(--line)]">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--danger)] hover:bg-[var(--danger-bg)] transition-colors"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-sm font-semibold">Logout</span>
              </button>
            </div>
```

with

```tsx
            {/* Footer: who is signed in + logout */}
            <div className="shrink-0 px-4 py-3 border-t border-[var(--line)] flex items-center gap-3">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0" style={{ background: "var(--info-bg)", color: "var(--ink-700)" }}>
                {(user?.username ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-bold text-[var(--text-strong)] truncate">{user?.username}</span>
                <span className="block text-[11px] text-[var(--text-3)] capitalize">{activeRole} · on shift</span>
              </span>
              <button
                onClick={handleLogout}
                aria-label="Logout"
                className="w-11 h-11 rounded-xl border border-[var(--line)] bg-white flex items-center justify-center shrink-0 hover:bg-[var(--danger-bg)]"
                style={{ color: "var(--clay-600)" }}
              >
                <LogOut className="w-[18px] h-[18px]" />
              </button>
            </div>
```

- [ ] **Step 4: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TopNav.tsx
git commit -m "TopNav drawer: MobilePOS look (green header, 48px rows, user footer)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: DayPicker phone tap targets

**Files:**
- Modify: `client/src/components/DayPicker.tsx`

- [ ] **Step 1: Bigger controls on phones**

Both arrow buttons currently use `className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"`. Change `w-7 h-7` to `w-10 h-10 sm:w-7 sm:h-7` on **both** (Previous day and Next day). Change the label button's `px-2 py-1` to `px-2.5 py-2.5 sm:px-2 sm:py-1`.

- [ ] **Step 2: Type-check and commit**

Run: `npm run check` → exits 0.

```bash
git add client/src/components/DayPicker.tsx
git commit -m "DayPicker: 40px tap targets on phones

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Orders

**Files:**
- Modify: `client/src/pages/Orders.tsx`

- [ ] **Step 1: Imports and phone flag**

Add imports:

```tsx
import { useIsMobile } from "@/hooks/use-mobile";
import { ChipRow, Chip } from "@/components/mobile/ChipRow";
```

In `export default function Orders()` add as the first line of the body (before any early return):

```tsx
  const isMobile = useIsMobile();
```

- [ ] **Step 2: Header**

Replace the main-return header

```tsx
      <Header title="Order History" description="View and manage all restaurant orders" />

      {/* ── Toolbar ── */}
```

with

```tsx
      <Header
        title={isMobile ? "Orders" : "Order History"}
        eyebrow={isMobile
          ? `${showAll ? "All dates" : businessDate === todayBusinessDate() ? "Today" : businessDate} · ${((orders as any[]) ?? []).length} orders`
          : undefined}
        description="View and manage all restaurant orders"
      />

      {/* ── Toolbar ── */}
```

(`todayBusinessDate` is already imported in this file — it is used for `businessDate`'s initial state.)

- [ ] **Step 3: Toolbar order and tap sizes (phones)**

The toolbar container is `<div className="px-3 sm:px-6 pt-3 sm:pt-4 flex items-center gap-2 flex-wrap">`. Inside it:

1. New Order button: change `className` `"flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold bg-gradient-to-r …"` by appending ` max-sm:order-3 max-sm:min-h-[44px] max-sm:px-3.5` and change its text to an icon-only label on phones:

```tsx
          <Plus className="w-4 h-4" /> <span className="max-sm:hidden">New Order</span>
```
   plus add `aria-label="New order"` to the `motion.button`.
2. Refresh button: append `max-sm:order-4 max-sm:min-h-[44px] max-sm:px-3.5` to its className, change its content to `<RefreshCw className="w-3.5 h-3.5" /> <span className="max-sm:hidden">Refresh</span>` and add `aria-label="Refresh"`.
3. Wrap the `<DayPicker … />` element in `<div className="max-sm:order-2">…</div>`.
4. Search box div (`flex items-center gap-2 bg-[var(--paper-0)] border … flex-1 max-w-sm ml-1 …`): append ` max-sm:order-1 max-sm:basis-full max-sm:max-w-none max-sm:ml-0 max-sm:min-h-[44px]` and make its input 16px so iOS doesn't zoom: change the input's `text-sm` to `text-base sm:text-sm`.
5. Payment segmented group (`role="group" aria-label="Filter by payment"`): change its `className` from `"flex items-center gap-0.5 rounded-xl p-1"` to `"hidden sm:flex items-center gap-0.5 rounded-xl p-1"`, and immediately after that `</div>` add the phone chips (same state and counts):

```tsx
        <ChipRow className="sm:hidden max-sm:order-5 basis-full" ariaLabel="Filter by payment">
          {PAYMENT_FILTERS.map(({ key, label, dot, hint }) => (
            <Chip key={key} title={hint} active={payFilter === key} dot={dot} count={payCounts[key]} onClick={() => setPayFilter(key)}>
              {label}
            </Chip>
          ))}
        </ChipRow>
```

- [ ] **Step 4: Status tabs as chips on phones**

Change the `TabsList` from

```tsx
          <TabsList className="flex w-full justify-start overflow-x-auto rounded-xl p-1 mb-4 gap-0.5"
            style={{
              background: "var(--paper-100)",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow-xs)",
            }}>
```

to

```tsx
          <TabsList className="flex w-full justify-start overflow-x-auto scrollbar-hide rounded-xl p-1 mb-4 gap-0.5 sm:bg-[var(--paper-100)] sm:border sm:border-[var(--line)] sm:shadow-[var(--shadow-xs)] max-sm:bg-transparent max-sm:p-0 max-sm:gap-1.5 max-sm:h-auto">
```

and append to each `TabsTrigger` className (after `transition-all`):

```
 max-sm:rounded-full max-sm:border max-sm:border-[var(--line-strong)] max-sm:bg-white max-sm:font-bold max-sm:data-[state=active]:!bg-[var(--green-800)] max-sm:data-[state=active]:!text-[#F4F8F0] max-sm:data-[state=active]:!border-[var(--green-800)] max-sm:data-[state=active]:!shadow-none
```

- [ ] **Step 5: Order card on phones**

In `OrderDetailRow`:

1. Summary row: replace

```tsx
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
```

with

```tsx
        className="flex flex-wrap items-center justify-between gap-y-2 px-3 sm:px-4 py-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0 max-sm:basis-full">
```

2. Right cluster: replace `<div className="flex items-center gap-2 shrink-0 ml-3">` with `<div className="flex items-center gap-2 shrink-0 sm:ml-3 max-sm:w-full">`.
3. Amount: replace `<div className="text-right hidden sm:block mr-1">` with `<div className="text-right mr-1 max-sm:mr-auto max-sm:text-left">` (the total is now visible on phones; the status dot under it stays).
4. Status select trigger: replace `className="h-7 text-xs w-28 rounded-xl bg-[var(--paper-0)] border-[var(--line)]"` with `className="h-9 sm:h-7 text-xs w-28 rounded-xl bg-[var(--paper-0)] border-[var(--line)]"`.

- [ ] **Step 6: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Orders.tsx
git commit -m "Orders: phone toolbar, chip filters, two-line order card

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Billing

**Files:**
- Modify: `client/src/pages/Billing.tsx`

- [ ] **Step 1: Phone flag + header**

Add `import { useIsMobile } from "@/hooks/use-mobile";` and, as the first line of `Billing()`'s body, `const isMobile = useIsMobile();`.

Replace the main-return header

```tsx
      <Header
        title="Billing"
        description={showAllPending ? `${orders?.length || 0} orders pending payment (all dates)` : `${orders?.length || 0} orders pending payment`}
      />
```

with

```tsx
      <Header
        title="Billing"
        eyebrow={isMobile ? `${orders?.length || 0} pending payment${showAllPending ? " · all dates" : ""}` : undefined}
        description={showAllPending ? `${orders?.length || 0} orders pending payment (all dates)` : `${orders?.length || 0} orders pending payment`}
      />
```

- [ ] **Step 2: Backlog banner tap target**

On the banner's "Show all" `<button … className="text-sm font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800 transition-colors shrink-0">` append ` max-sm:min-h-[44px] max-sm:px-2`.

- [ ] **Step 3: Cards**

- Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` → `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4`.
- `<Card key={order.id} className="bg-card shadow-sm hover:shadow-md transition-shadow">` → `className="bg-card shadow-sm hover:shadow-md transition-shadow max-sm:rounded-2xl max-sm:border-[var(--line)]"`.
- Collect Payment button: `className="flex-1 text-xs"` → `className="flex-1 text-xs max-sm:h-11 max-sm:text-sm"`.
- Print button: `className="text-xs"` → `className="text-xs max-sm:h-11 max-sm:px-4 max-sm:text-sm"`.

- [ ] **Step 4: Type-check and commit**

Run: `npm run check` → exits 0.

```bash
git add client/src/pages/Billing.tsx
git commit -m "Billing: phone header eyebrow, 44px card buttons

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Reports

**Files:**
- Modify: `client/src/pages/Reports.tsx`

- [ ] **Step 1: Phone flag + header**

Add `import { useIsMobile } from "@/hooks/use-mobile";`. Directly under `const [activeTab, setActiveTab] = useState("sales");` add `const isMobile = useIsMobile();`.

Replace

```tsx
      <Header title="Reports" description="Analytics and insights for your restaurant performance" />
```

with

```tsx
      <Header
        title="Reports"
        eyebrow={isMobile ? formatRangeLabel(dateRange.start, dateRange.end) : undefined}
        description="Analytics and insights for your restaurant performance"
      />
```

- [ ] **Step 2: Toolbar**

Replace the toolbar heading block

```tsx
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Sales Analytics</h2>
            <p className="text-sm text-gray-500">{formatRangeLabel(dateRange.start, dateRange.end)}</p>
          </div>
          <div className="flex gap-2 items-center">
```

with

```tsx
          <div className="max-sm:hidden">
            <h2 className="text-xl font-semibold text-gray-800">Sales Analytics</h2>
            <p className="text-sm text-gray-500">{formatRangeLabel(dateRange.start, dateRange.end)}</p>
          </div>
          <div className="flex gap-2 items-center max-sm:w-full max-sm:justify-between">
```

and on the Export `motion.button` append ` max-sm:min-h-[44px]` to its className. Change the toolbar container `className="mb-6 flex justify-between items-center flex-wrap gap-3"` to `"mb-6 max-sm:mb-4 flex justify-between items-center flex-wrap gap-3"`.

- [ ] **Step 3: Stat cards — hero + compact grid**

Change the grid `className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6"` to `"grid max-sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 grid-cols-1 gap-5 max-sm:gap-2.5 mb-6 max-sm:mb-4"`.

Replace the card element's className and content (inside `statCards.map`)

```tsx
              className="rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5
                         hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 hover:bg-[var(--paper-0)]
                         transition-all duration-200"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-800 mt-0.5">{card.value}</p>
                  <p className={`text-xs mt-1 ${card.subColor}`}>{card.sub}</p>
                </div>
                {card.icon}
              </div>
```

with

```tsx
              className={`rounded-2xl bg-[var(--paper-100)] border border-[var(--line)] shadow-md p-5 max-sm:p-3.5
                         hover:scale-[1.01] hover:shadow-xl hover:shadow-emerald-500/10 hover:bg-[var(--paper-0)]
                         transition-all duration-200 ${i === 0 ? "max-sm:col-span-2 max-sm:!bg-[var(--green-800)] max-sm:!border-[var(--green-800)]" : ""}`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className={`text-sm text-gray-500 ${i === 0 ? "max-sm:!text-[var(--green-300)] max-sm:uppercase max-sm:text-[10px] max-sm:font-extrabold max-sm:tracking-widest" : "max-sm:text-[10px] max-sm:uppercase max-sm:font-extrabold max-sm:tracking-widest"}`}>{card.label}</p>
                  <p className={`text-2xl font-bold text-gray-800 mt-0.5 ${i === 0 ? "max-sm:!text-[#F4F8F0] max-sm:text-[32px] max-sm:font-display max-sm:font-semibold" : "max-sm:text-xl"}`}>{card.value}</p>
                  <p className={`text-xs mt-1 ${card.subColor} ${i === 0 ? "max-sm:!text-[rgba(244,248,240,0.72)]" : "max-sm:truncate"}`}>{card.sub}</p>
                </div>
                <span className="max-sm:hidden">{card.icon}</span>
              </div>
```

- [ ] **Step 4: Tabs as chips on phones**

Replace the tab container and button classes

```tsx
        <div className="rounded-xl bg-[var(--paper-100)] border border-[var(--line)] p-1 flex gap-1 mb-5 w-fit max-w-full overflow-x-auto">
```

with

```tsx
        <div className="rounded-xl bg-[var(--paper-100)] border border-[var(--line)] p-1 flex gap-1 mb-5 w-fit max-w-full overflow-x-auto scrollbar-hide max-sm:w-full max-sm:bg-transparent max-sm:border-0 max-sm:p-0 max-sm:gap-1.5 max-sm:mb-4">
```

and the button className (the template string)

```tsx
              className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm"
                  : "text-gray-600 hover:bg-[var(--paper-0)]"
              }`}
```

with

```tsx
              className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all max-sm:rounded-full max-sm:min-h-[36px] max-sm:px-3.5 max-sm:text-xs max-sm:font-bold max-sm:border ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-[#226B43] to-[#1B4D33] text-white shadow-sm max-sm:border-[var(--green-800)]"
                  : "text-gray-600 hover:bg-[var(--paper-0)] max-sm:bg-white max-sm:border-[var(--line-strong)] max-sm:text-[var(--text-1)]"
              }`}
```

- [ ] **Step 5: Type-check and commit**

Run: `npm run check` → exits 0.

```bash
git add client/src/pages/Reports.tsx
git commit -m "Reports: phone hero stat, chip tabs, compact toolbar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Tab bodies are intentionally untouched here; any sideways overflow they cause on a phone is fixed in Task 11.)

---

### Task 9: Menu

**Files:**
- Create: `client/src/components/mobile/MenuItemRow.tsx`
- Modify: `client/src/pages/Menu.tsx`

- [ ] **Step 1: `MenuItemRow`**

```tsx
import { Edit, Trash2, CheckSquare, Square } from "lucide-react";

/** Phone list row for a menu item (MobilePOS "Menu manage" style). Presentational only. */
export function MenuItemRow({
  name, meta, available, bulkMode, selected, deleting, onToggleSelect, onEdit, onDelete,
}: {
  name: string;
  /** Mono line under the name: "Category · ₹199 · Prep 15min · Margin 42%". */
  meta: string;
  available: boolean;
  bulkMode: boolean;
  selected: boolean;
  deleting: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={bulkMode ? onToggleSelect : undefined}
      className={`flex items-center gap-2.5 pl-3 pr-1 py-2 min-h-[60px] border-b ${selected ? "bg-emerald-50" : "bg-white"} ${bulkMode ? "cursor-pointer" : ""}`}
      style={{ borderColor: "#F0EADC" }}
    >
      {bulkMode && (selected
        ? <CheckSquare className="w-5 h-5 text-emerald-600 shrink-0" />
        : <Square className="w-5 h-5 text-gray-300 shrink-0" />)}
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-bold leading-tight" style={{ color: available ? "var(--text-strong)" : "var(--text-3)" }}>{name}</div>
        <div className="font-mono text-[11px] mt-1 leading-snug" style={{ color: "var(--text-3)" }}>{meta}</div>
      </div>
      <span
        className="shrink-0 h-[26px] px-2.5 rounded-full inline-flex items-center text-[10.5px] font-extrabold uppercase tracking-wide"
        style={available
          ? { background: "var(--success-bg)", color: "var(--green-700)" }
          : { background: "var(--danger-bg)", color: "var(--danger)" }}
      >
        {available ? "In stock" : "Out"}
      </span>
      {!bulkMode && (
        <>
          <button type="button" aria-label={`Edit ${name}`} onClick={onEdit}
            className="shrink-0 w-11 h-11 flex items-center justify-center" style={{ color: "var(--text-2)" }}>
            <Edit className="w-4 h-4" />
          </button>
          <button type="button" aria-label={`Delete ${name}`} disabled={deleting} onClick={onDelete}
            className="shrink-0 w-11 h-11 flex items-center justify-center disabled:opacity-40" style={{ color: "var(--danger)" }}>
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Imports, phone flag, helpers in `Menu.tsx`**

Add imports:

```tsx
import { useIsMobile } from "@/hooks/use-mobile";
import { ChipRow, Chip } from "@/components/mobile/ChipRow";
import { MenuItemRow } from "@/components/mobile/MenuItemRow";
```

At the top of `Menu()` body (after `const { toast } = useToast();`) add `const isMobile = useIsMobile();`. Directly below the existing `const handleDeleteItem = …` definition add:

```tsx
  // Phone list row: one mono line with the same facts the desktop card shows.
  const marginText = (item: MenuItem): string | null => {
    if (!canSeeCost || !item.inventoryLinks || item.inventoryLinks.length === 0) return null;
    const result = computeMenuItemCost(item.inventoryLinks, costByInventoryId, 1);
    if (result.hasIncompleteCost) return "Margin —";
    const margin = computeMarginPercent(parseFloat(item.price), result.cost);
    return margin == null ? null : `Margin ${margin.toFixed(0)}%`;
  };
  const rowMeta = (item: MenuItem): string => {
    const price = item.sizes && item.sizes.length > 0
      ? item.sizes.map((s) => `${s.size} ${formatCurrency(s.price)}`).join(" / ")
      : formatCurrency(parseFloat(item.price));
    return [
      getCategoryName(item.categoryId),
      price,
      `Prep ${item.preparationTime}min`,
      item.inventoryLinks && item.inventoryLinks.length > 0 ? `${item.inventoryLinks.length} ingr.` : null,
      marginText(item),
      `Sold ${soldToday[item.id] ?? 0}`,
    ].filter(Boolean).join(" · ");
  };
```

(If `soldToday`, `costByInventoryId`, `canSeeCost`, `computeMenuItemCost` or `computeMarginPercent` are declared after this spot in the file, move the helper block below their declarations — they only need to exist before render.)

- [ ] **Step 3: Header, tabs, toolbar, category chips**

Header:

```tsx
      <Header
        title="Menu"
        eyebrow={isMobile ? `${rawItems.length} items · ${categories.length} categories` : undefined}
        description="Manage your restaurant menu items and categories"
      />
```

Tab bar: add `max-sm:hidden` to the existing tab-bar container className (`mb-6 flex items-center gap-1 p-1 …`) and insert directly above it:

```tsx
        <ChipRow className="sm:hidden mb-3" ariaLabel="Menu sections">
          <Chip active={activeTab === "items"} onClick={() => switchTab("items")}>Menu items</Chip>
          <Chip active={activeTab === "categories"} onClick={() => switchTab("categories")}>Categories</Chip>
        </ChipRow>
```

Toolbar: hide the big heading on phones — change `<h2 className="text-xl font-semibold text-gray-800">Menu Items</h2>` to `<h2 className="text-xl font-semibold text-gray-800 max-sm:hidden">Menu Items</h2>`. On the button group `<div className="flex gap-2 flex-wrap">` append ` max-sm:w-full`. On the **Add Item** `motion.button` append ` max-sm:order-first max-sm:w-full max-sm:justify-center max-sm:min-h-[44px]`; on the Bulk Edit and Filters `motion.button`s append ` max-sm:flex-1 max-sm:justify-center max-sm:min-h-[44px]`.

Category chips: directly after the toolbar's closing `</div>` (before the `{/* ── Search + Filters Panel ── */}` comment) insert:

```tsx
                <ChipRow className="sm:hidden mb-3" ariaLabel="Filter by category">
                  <Chip active={filterCategory === "all"} onClick={() => setFilterCategory("all")}>All</Chip>
                  {categories.map((c) => (
                    <Chip key={c.id} active={filterCategory === c.id.toString()} onClick={() => setFilterCategory(c.id.toString())}>
                      {c.name}
                    </Chip>
                  ))}
                </ChipRow>
```

- [ ] **Step 4: Phone list vs desktop grid**

Change the grid wrapper `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">` to `<div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-5">` (the existing `menuItems.map(...)` inside is untouched). Immediately **before** it insert the phone list:

```tsx
                <div className="md:hidden rounded-2xl overflow-hidden border" style={{ borderColor: "var(--line)" }}>
                  {menuItems.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      name={item.name}
                      meta={rowMeta(item)}
                      available={!!item.isAvailable}
                      bulkMode={bulkMode}
                      selected={selectedIds.has(item.id)}
                      deleting={deleteMenuItemMutation.isPending}
                      onToggleSelect={() => toggleSelect(item.id)}
                      onEdit={() => handleEditItem(item)}
                      onDelete={() => handleDeleteItem(item)}
                    />
                  ))}
                </div>
```

- [ ] **Step 5: Type-check**

Run: `npm run check` → exits 0. If `item.sizes` entries aren't `{size, price}` typed as the desktop card uses them, mirror the desktop card's usage (`s.size`, `s.price`).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/mobile/MenuItemRow.tsx client/src/pages/Menu.tsx
git commit -m "Menu: phone chips, toolbar and list rows

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Login — one picture, one logo

**Files:**
- Create: `client/src/components/LoginBackdrop.tsx`
- Modify: `client/src/pages/Login.tsx`

- [ ] **Step 1: `LoginBackdrop`**

```tsx
import pizzaBgImage from "@assets/Wood-Fire-Pizza.png";

/**
 * The chef-at-the-oven picture behind the phone login screens. `contain` + bottom-right so the
 * picture's own BAGICHA lockup (drawn into its bottom-right corner) stays fully visible — it is
 * the only logo on the login screens. The asset is near-white, so the letterbox is invisible.
 */
export function LoginBackdrop({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-0 bg-white pointer-events-none ${className}`}
      style={{
        backgroundImage: `url(${pizzaBgImage})`,
        backgroundSize: "contain",
        backgroundPosition: "right bottom",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
```

- [ ] **Step 2: Imports**

In `Login.tsx` add `import { LoginBackdrop } from "@/components/LoginBackdrop";`. After the edits below, `bagichaLogoImg` is unused in this file — remove its import (`import bagichaLogoImg from "@assets/Bagicha Logo.png";`). `pizzaBgImage` is still used by the splash.

- [ ] **Step 3: Phone sign-in screens (`compactWrap`)**

Replace the whole `compactWrap`

```tsx
  const compactWrap = (children: React.ReactNode, viewKey: string) => (
    <div key={viewKey} className="fixed inset-0 overflow-y-auto bg-white">
      <div className="min-h-full flex flex-col items-center px-5 py-8">
        <div className="m-auto w-full max-w-[22rem] flex flex-col items-center">
          <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img mb-4" style={{ width: 56, height: 56 }} />
          <div className="w-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
```

with

```tsx
  const compactWrap = (children: React.ReactNode, viewKey: string) => (
    <div key={viewKey} className="fixed inset-0 overflow-y-auto bg-white">
      {/* Same chef picture as the splash; its own corner lockup is the logo (no second logo). */}
      <LoginBackdrop />
      {/* pb-36 keeps the card above the picture's bottom-right lockup on a normal phone. */}
      <div className="relative z-10 min-h-full flex flex-col items-center px-5 pt-8 pb-36">
        <div className="m-auto w-full max-w-[22rem]">
          <div
            className="w-full rounded-[22px] p-5"
            style={{
              background: "rgba(255,255,255,0.92)",
              border: "1px solid var(--line)",
              boxShadow: "0 2px 8px rgba(20,34,27,0.06)",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 4: Paper keypad on phones**

Add an optional `compact` prop to `PinPad`:

```tsx
function PinPad({
  onDigit, onDelete, disabled, compact,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
```

Replace `const keyStyle: React.CSSProperties = { … };` with:

```tsx
  const keyStyle: React.CSSProperties = compact
    ? {
        background:   "var(--paper-50)",
        border:       "1px solid var(--line)",
        boxShadow:    "none",
        borderRadius: "14px",
      }
    : {
        background:     "rgba(255,255,255,0.68)",
        backdropFilter: "blur(10px)",
        border:         "1px solid rgba(255,255,255,0.75)",
        boxShadow:      "0 2px 8px rgba(0,0,0,0.07), 0 1px 0 rgba(255,255,255,0.95) inset",
        borderRadius:   "16px",
      };
```

and change the two key buttons' height class `h-14` to `${compact ? "h-[52px]" : "h-14"}` (both the ⌫ button and the digit button — convert their `className` strings to template literals). In `StaffSelector`'s PIN screen pass `compact` to `<PinPad … compact />`. The desktop card's `PinPad` call stays without it.

- [ ] **Step 5: Root `Login` (desktop / tablet / non-mobile-UA)**

Replace the phone layer

```tsx
      <div className="absolute inset-0 sm:hidden" style={{ backgroundImage: `url(${pizzaBgImage})`, backgroundSize: "cover", backgroundPosition: "center center", backgroundRepeat: "no-repeat" }} />
```

with

```tsx
      <LoginBackdrop className="sm:hidden" />
```

and replace the card logo block

```tsx
        <div className="flex flex-col items-center mb-6">
          <img src={bagichaLogoImg} alt="Bagicha" className="login-logo-img mb-2" />
          <p className="text-[11px] text-gray-400 uppercase tracking-[0.12em] font-medium">
            Restaurant POS
          </p>
        </div>
```

with

```tsx
        {/* No separate logo: the picture behind the card already carries the BAGICHA lockup. */}
        <div className="flex flex-col items-center mb-6">
          <p className="text-[11px] text-gray-500 uppercase tracking-[0.12em] font-medium">
            Restaurant POS
          </p>
        </div>
```

- [ ] **Step 6: Type-check and commit**

Run: `npm run check` → exits 0; `grep -n "bagichaLogoImg" client/src/pages/Login.tsx` → no matches.

```bash
git add client/src/components/LoginBackdrop.tsx client/src/pages/Login.tsx
git commit -m "Login: same picture on every screen, picture's own logo only

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verify in a real browser (read-only on the live DB)

The DB is the shared production DB. **Do not** pay, settle, delete, edit a menu item, change a status or create an order. Only look. The owner's admin login is not stored in the repo — ask the owner for it if it is not already in your session.

**Files:** none unless a defect is found (fix in the owning file, `npm run check`, commit).

- [ ] **Step 1: Start the dev server on a private Pusher channel (PowerShell, background)**

```powershell
$env:PUSHER_CHANNEL="private-bagicha-dev-$(Get-Random)"; npm run dev
```

Wait for `serving on port 5000` (poll `http://localhost:5000/api/health` until 200).

- [ ] **Step 2: Phone checks at 390×844 then 360×780 (Playwright MCP; wait ~0.5 s after taps before screenshots)**

- Orders: eyebrow `Today · N orders`, serif "Orders"; search full width; day-picker row with two icon buttons; status chips scroll and the active one is green; Cash/UPI/Due chips with counts; each card is two lines with a visible total, and tapping expands the usual detail; no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`).
- Billing: eyebrow, cards, 44px Collect Payment / Print (do not click Collect Payment).
- Reports: eyebrow = range; green hero Total Sales card; 2-column small cards; tab chips scroll; open **every** tab and record any that overflows horizontally (fix with `overflow-x-auto` on the offending container, phone only); date picker + Export fit one row.
- Menu: eyebrow, chips, Add/Bulk/Filters row, category chips filter the list, rows show name + mono line + In stock/Out pill + edit/delete (do not click delete; click Edit once to see the modal open, then close it without saving); Bulk Edit shows checkboxes.
- ☰ drawer: green header, 48px rows, footer with initials + logout icon (do not log out yet). Bottom bar: 4 tabs, active green.
- Primary tap targets ≥ 44px: run a `getBoundingClientRect` check on buttons visible on each page; list any `< 40px` and decide per spec (chips ≥ 36px are fine).

- [ ] **Step 3: Login (phones)**

Mock the device flag so the phone flow renders in the desktop browser: in `browser_run_code_unsafe`, `await page.route('**/api/auth/context', r => r.fulfill({ json: { isLocalNetwork: false, isMobile: true } }));` then log out via the ☰ drawer and reload. Check: splash (unchanged) → swipe/`setRevealed` → staff grid → PIN → manager form. On each: the chef picture is behind the card, **no** square logo above the card, and the picture's bottom-right BAGICHA lockup is fully visible (screenshot at 390×844 and 360×640; the card may scroll on the short one — note it). Remove the route mock afterwards.

- [ ] **Step 4: Login (desktop sizes)**

Without the mock, at 1280×800, 1920×1080 and 768×1024 (and 390×844 non-mobile-UA path): landscape picture on ≥ 640px, chef backdrop below 640px, no separate logo, the picture's corner lockup visible and not overlapped by the card.

- [ ] **Step 5: Desktop regression at 1280×800**

Orders, Billing, Reports, Menu, Tables look exactly as on `main` (no eyebrow in headers, original tabs/segmented controls, original grid on Menu, original TopNav). `document.querySelector(".app-page-content").children.length === 1` after navigating between pages.

- [ ] **Step 6: Final checks and cleanup**

Run `npm run check` and `npm run test:pure` → both exit 0. `git status --short` shows no stray PNGs in the repo root (delete any; `.playwright-mcp/` is ignored). Stop the dev server (TaskStop the background job).

- [ ] **Step 7: Commit fixes (if any)**

```bash
git add -A -- client
git commit -m "Mobile pages: fixes from browser verification

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Skip if nothing changed.)
