# Mobile Compact Tables + POS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the phone (<768px) layout of the Tables page and the POS page to the owner's "Compact POS" design, without touching desktop/tablet or any business logic.

**Architecture:** A synchronous `useIsMobile()` decides, per page, whether to render the compact mobile markup. Tables gets a separate presentational component (`TablesMobileView`) fed by the page's existing state, mutations and handlers. POS keeps its single component but branches at five spots (header, menu tile, cart row, totals handle, action dock) when `compact = isMobile && !isSectionMode`; every branch calls the same handlers and `go()/isOff()` gates as today. The pure bits (table filter, floor chips, settle label) live in small lib files covered by a DB-free verify script.

**Tech Stack:** React 18 + TypeScript, Tailwind, wouter, TanStack Query, lucide-react. Tests are hand-rolled `tsx scripts/verify-*.ts` programs chained in `npm run test:pure`. Type-check: `npm run check`.

**Spec:** `docs/superpowers/specs/2026-11-11-mobile-compact-tables-pos-design.md`

**Ground rules for every task**
- `tsconfig` has no `target` (ES5): never `for…of`/spread a `Map`/`Set` — use `Array.from(map.entries())`.
- Never edit `client/src/components/ui/*` (shadcn).
- Colours: design-system CSS vars from `client/src/index.css` (`--green-800` #1B4D33, `--green-700`, `--green-600` #2E8B57, `--green-50` #F1F7EE, `--success-bg` #E7F2EA, `--ink-700` #243B5E, `--info-bg` #E8EDF5, `--clay-600` #B85C38, `--clay-700`, `--warning-bg` #FAF1DD, `--paper-0/50/100`, `--line` #E7DFCE, `--line-strong` #D8CFB9, `--text-strong/1/2/3`, `--danger` #BE4630, `--danger-bg`).
- Commit after each task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `mobile-compact-ui` (already checked out).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `client/src/hooks/use-mobile.tsx` | modify | read the breakpoint synchronously on first render (no desktop flash) |
| `client/src/lib/tablesMobile.ts` | create | pure: `filterTablesByStatus`, `floorStaffChips` |
| `client/src/lib/posMobile.ts` | create | pure: `settleButtonLabel`, `cartTotalsHint` |
| `scripts/verify-mobile-compact.ts` | create | DB-free assertions for both lib files |
| `package.json` | modify | add the verify script to `test:pure` |
| `client/src/components/tables/tableShared.tsx` | create | `Table` type, `SECTION_OPTIONS`, `statusConfig`, `fmt`, `RunningTimer`, `TableTimer`, `sectionLabel` (moved out of Tables.tsx) |
| `client/src/components/tables/TablesMobileView.tsx` | create | the compact Tables screen (presentational) |
| `client/src/pages/Tables.tsx` | modify | import shared bits, render `TablesMobileView` when mobile |
| `client/src/components/TopNav.tsx` | modify | mobile header: bordered ☰, logo + navy wordmark |
| `client/src/components/pos-mobile/PosMobileHeader.tsx` | create | two-row compact POS header + Guest fields with autocomplete |
| `client/src/components/pos-mobile/PosMobileActionDock.tsx` | create | KOT/Bill/E-Bill/Save/Hold + Settle dock |
| `client/src/pages/POS.tsx` | modify | `compact` flag + five branches + bottom tab restyle |

---

### Task 1: Synchronous `useIsMobile`

**Files:**
- Modify: `client/src/hooks/use-mobile.tsx`

- [ ] **Step 1: Replace the initial state**

In `client/src/hooks/use-mobile.tsx` change

```tsx
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)
```

to

```tsx
  // Read the width on the first render so a phone never paints the desktop layout first.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : undefined,
  )
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/use-mobile.tsx
git commit -m "useIsMobile: read breakpoint on first render

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers + verify script (TDD)

**Files:**
- Create: `client/src/lib/tablesMobile.ts`
- Create: `client/src/lib/posMobile.ts`
- Create: `scripts/verify-mobile-compact.ts`
- Modify: `package.json` (`test:pure`)

- [ ] **Step 1: Write the failing verify script**

Create `scripts/verify-mobile-compact.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-mobile-compact.ts`
Expected: FAIL — cannot resolve `../client/src/lib/tablesMobile`.

- [ ] **Step 3: Implement `client/src/lib/tablesMobile.ts`**

```ts
/** Pure helpers for the compact mobile Tables screen (TablesMobileView). */

export type TableStatusFilter = "running" | "free" | null;

/** Running = every occupied table (running or billed); Free = free only; null = all. */
export function filterTablesByStatus<T extends { status: string }>(tables: T[], filter: TableStatusFilter): T[] {
  if (filter === "free") return tables.filter(t => t.status === "free");
  if (filter === "running") return tables.filter(t => t.status !== "free");
  return tables;
}

export interface FloorChip { name: string; tables: string[] }

/** Running tables grouped by who serves them ("Raj → 2, G2"); a blank server is "—". */
export function floorStaffChips(tables: Array<{ name: string; status: string; servedByName?: string | null }>): FloorChip[] {
  const byName = new Map<string, string[]>();
  tables.forEach(t => {
    if (t.status !== "running") return;
    const key = (t.servedByName ?? "").trim() || "—";
    const list = byName.get(key) ?? [];
    list.push(t.name);
    byName.set(key, list);
  });
  return Array.from(byName.entries()).map(([name, names]) => ({ name, tables: names }));
}
```

- [ ] **Step 4: Implement `client/src/lib/posMobile.ts`**

```ts
/** Pure helpers for the compact mobile POS (cart totals handle + Settle button). */

export function settleButtonLabel(a: {
  phase: string; busy: boolean; total: number; lines: number; fmt: (n: number) => string;
}): string {
  if (a.phase === "printing") return "Printing…";
  if (a.busy || a.phase === "processing") return "…";
  if (a.lines <= 0) return "Settle";
  return `Settle ${a.fmt(a.total)} · ${a.lines} ${a.lines === 1 ? "item" : "items"}`;
}

export function cartTotalsHint(a: { open: boolean; subtotal: number; tax: number; fmt: (n: number) => string }): string {
  return a.open ? "Bill details" : `Subtotal ${a.fmt(a.subtotal)} · tax ${a.fmt(a.tax)} · discount & charges`;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx tsx scripts/verify-mobile-compact.ts`
Expected: every line `PASS`, `14/14 passed`, exit 0.

- [ ] **Step 6: Add to `test:pure`**

In `package.json`, append ` && tsx scripts/verify-mobile-compact.ts` to the end of the `"test:pure"` command string (inside the closing quote).

Run: `npm run test:pure`
Expected: exits 0, last block ends `14/14 passed`.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/tablesMobile.ts client/src/lib/posMobile.ts scripts/verify-mobile-compact.ts package.json
git commit -m "Pure helpers for compact mobile Tables/POS + verify script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move shared Tables pieces into `tableShared.tsx`

**Files:**
- Create: `client/src/components/tables/tableShared.tsx`
- Modify: `client/src/pages/Tables.tsx` (lines 26–120: `interface Table` … `function sectionLabel`)

- [ ] **Step 1: Create `client/src/components/tables/tableShared.tsx`**

Cut these blocks **verbatim** from `client/src/pages/Tables.tsx` and paste them into the new file, adding `export` to each: `interface Table`, `const SECTION_OPTIONS`, `const statusConfig`, `const fmt`, `function RunningTimer`, `function TableTimer`, `function sectionLabel`. Leave `groupBySection` in Tables.tsx. Top of the new file:

```tsx
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

/** Shared between the desktop Tables page and the compact mobile view (TablesMobileView). */
```

After the paste the file's exports are: `Table`, `SECTION_OPTIONS`, `statusConfig`, `fmt`, `RunningTimer`, `TableTimer`, `sectionLabel`. Also export the status key type so callers can index `statusConfig` safely:

```tsx
export type TableStatus = keyof typeof statusConfig;
```

- [ ] **Step 2: Import them in Tables.tsx**

Add below the other imports in `client/src/pages/Tables.tsx`:

```tsx
import {
  type Table, SECTION_OPTIONS, statusConfig, fmt, RunningTimer, TableTimer, sectionLabel,
} from "@/components/tables/tableShared";
```

Remove `useEffect` from Tables.tsx's react import only if `npm run check` reports it unused (it is still used by the `isWide` effect, so it most likely stays).

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/tables/tableShared.tsx client/src/pages/Tables.tsx
git commit -m "Tables: move shared types/timers to tableShared.tsx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `TablesMobileView` component

**Files:**
- Create: `client/src/components/tables/TablesMobileView.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Fragment, useState } from "react";
import { Users, Printer, ArrowRightLeft, Edit2, Trash2, Plus, Pencil, UtensilsCrossed, Bike, ShoppingBag } from "lucide-react";
import { LiveOrdersStrip } from "@/components/live-tables/LiveOrdersPanel";
import { SectionOrdersFlyout } from "@/components/live-tables/SectionOrdersFlyout";
import type { LiveOrder } from "@/hooks/useLiveOrders";
import { filterTablesByStatus, floorStaffChips, type TableStatusFilter } from "@/lib/tablesMobile";
import {
  type Table, type TableStatus, statusConfig, fmt, RunningTimer, TableTimer, sectionLabel,
} from "./tableShared";

export interface LiveStatusSummary {
  runningTables: number; freeTables: number; activeOrders: number;
  todaySales: number; cashSales: number; upiSales: number; dueAmount?: number;
}

interface Props {
  tables: Table[];
  isLoading: boolean;
  grouped: Record<string, Table[]>;
  sectionOrder: string[];
  liveStatus?: LiveStatusSummary;
  showSalesSplit: boolean;
  onToggleSalesSplit: () => void;
  salesRef: React.RefObject<HTMLButtonElement>;
  shiftFrom: Table | null;
  deliveryOrders: LiveOrder[];
  pickupOrders: LiveOrder[];
  posSections: Array<{ id: string; name: string }>;
  sectionOrders: Record<string, LiveOrder[]>;
  onTableClick: (t: Table) => void;
  onPrint: (orderId: number) => void;
  onMove: (t: Table) => void;
  onEdit: (e: React.MouseEvent, t: Table) => void;
  onDelete: (e: React.MouseEvent, t: Table) => void;
  onAddTable: () => void;
  onDelivery: () => void;
  onPickup: () => void;
  onSectionNewOrder: (s: { id: string; name: string }) => void;
}

/** Compact phone layout of the Tables page (Compact POS design). Presentational only:
 *  every action is a callback into Tables.tsx, which keeps the mutations, PIN gates and dialogs. */
export function TablesMobileView(p: Props) {
  const [filter, setFilter] = useState<TableStatusFilter>(null);
  const [editMode, setEditMode] = useState(false);

  const running = p.liveStatus?.runningTables ?? p.tables.filter(t => t.status === "running").length;
  const free = p.liveStatus?.freeTables ?? p.tables.filter(t => t.status === "free").length;
  const chips = floorStaffChips(p.tables);
  const activeCount = p.tables.filter(t => t.status === "running").length;

  const stats: Array<{ key: string; label: string; value: string | number; dot: string; filter?: TableStatusFilter }> = [
    { key: "running", label: "Running", value: running, dot: "var(--green-500)", filter: "running" },
    { key: "free", label: "Free", value: free, dot: "var(--text-3)", filter: "free" },
    { key: "orders", label: "Orders", value: p.liveStatus?.activeOrders ?? 0, dot: "var(--ink-700)" },
    { key: "sales", label: "Sales", value: fmt(p.liveStatus?.todaySales ?? 0), dot: "#D89A3E" },
  ];

  const dueAmount = p.liveStatus?.dueAmount ?? 0;
  const salesSegments = [
    { key: "cash", label: "Cash", amount: p.liveStatus?.cashSales ?? 0, dot: "bg-emerald-500", text: "text-emerald-800" },
    { key: "upi", label: "UPI", amount: p.liveStatus?.upiSales ?? 0, dot: "bg-indigo-500", text: "text-indigo-800" },
    ...(Math.round(dueAmount) > 0
      ? [{ key: "due", label: "Due", amount: dueAmount, dot: "bg-amber-500", text: "text-amber-800" }]
      : []),
  ];

  const renderTable = (table: Table) => {
    const status = (table.status in statusConfig ? table.status : "free") as TableStatus;
    const cfg = statusConfig[status];
    const occupied = status !== "free";
    const isShiftSource = p.shiftFrom?.id === table.id;
    const isShiftTarget = !!p.shiftFrom && p.shiftFrom.id !== table.id && status === "free";
    const showRunActions = status === "running" && !!table.currentOrderId && !editMode;
    return (
      <div
        key={table.id}
        className={`relative h-[60px] rounded-xl flex items-stretch overflow-hidden ${occupied ? "col-span-2" : ""} ${isShiftTarget ? "ring-2 ring-amber-400 ring-offset-1" : ""} ${isShiftSource ? "ring-2 ring-primary ring-offset-1" : ""}`}
        style={cfg.style}
      >
        <button
          type="button"
          onClick={e => (editMode ? p.onEdit(e, table) : p.onTableClick(table))}
          className="flex-1 min-w-0 flex flex-col justify-center gap-[3px] px-[9px] py-[7px] text-left"
        >
          <span className="flex items-baseline gap-1.5 min-w-0">
            <b className={`text-base font-extrabold leading-none truncate ${cfg.nameText}`}>{table.name}</b>
            {status === "running" && (
              <span className="font-mono text-[10px] font-bold shrink-0" style={{ color: "var(--green-700)" }}>
                {table.orderCreatedAt
                  ? <RunningTimer startedAt={table.orderCreatedAt} />
                  : table.currentOrderId ? <TableTimer orderId={table.currentOrderId} /> : "Active"}
              </span>
            )}
          </span>
          {status === "free" && (
            <span className={`flex items-center gap-[3px] font-mono text-[10px] ${cfg.subText}`}>
              <Users className="w-2.5 h-2.5" />{table.capacity}
            </span>
          )}
          {status === "running" && (
            <span className="text-xs font-extrabold tabular-nums whitespace-nowrap truncate" style={{ color: "var(--green-800)" }}>
              {table.runningTotal != null ? fmt(table.runningTotal) : ""}
              {table.servedByName && (
                <span className="ml-1 font-mono text-[10px] font-bold" style={{ color: "var(--ink-700)" }}>{table.servedByName}</span>
              )}
            </span>
          )}
          {status === "billed" && (
            <span className={`text-[11px] font-semibold truncate ${cfg.subText}`}>
              Bill printed{table.runningTotal != null ? ` · ${fmt(table.runningTotal)}` : ""}
            </span>
          )}
        </button>

        {showRunActions && (
          <div className="flex items-center gap-1 pr-[7px]">
            <button
              type="button"
              aria-label={`Print bill for ${table.name}`}
              onClick={e => { e.stopPropagation(); p.onPrint(table.currentOrderId!); }}
              className="w-[38px] h-11 rounded-[10px] flex items-center justify-center text-white"
              style={{ background: "var(--green-800)" }}
            >
              <Printer className="w-[15px] h-[15px]" />
            </button>
            <button
              type="button"
              aria-label={`Move ${table.name}`}
              onClick={e => { e.stopPropagation(); p.onMove(table); }}
              className="w-[38px] h-11 rounded-[10px] flex items-center justify-center bg-white"
              style={{ border: "1px solid var(--green-200)", color: "var(--green-700)" }}
            >
              <ArrowRightLeft className="w-[15px] h-[15px]" />
            </button>
          </div>
        )}

        {editMode && (
          <>
            <button
              type="button"
              aria-label={`Delete ${table.name}`}
              onClick={e => p.onDelete(e, table)}
              className="absolute top-0 right-0 w-[30px] h-[30px] rounded-bl-[10px] flex items-center justify-center"
              style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
            >
              <Trash2 className="w-[13px] h-[13px]" />
            </button>
            <button
              type="button"
              aria-label={`Edit ${table.name}`}
              onClick={e => p.onEdit(e, table)}
              className="absolute bottom-0 right-0 w-[30px] h-[30px] rounded-tl-[10px] flex items-center justify-center"
              style={{ background: "var(--info-bg)", color: "var(--ink-700)" }}
            >
              <Edit2 className="w-[13px] h-[13px]" />
            </button>
          </>
        )}
      </div>
    );
  };

  const zoneHeader = (name: string, meta: string) => (
    <div className="flex items-center gap-2.5 pt-3 pb-[7px]">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em]" style={{ color: "var(--text-1)" }}>{name}</span>
      <span className="flex-1 h-px" style={{ background: "var(--line)" }} />
      <span className="text-[10.5px]" style={{ color: "var(--text-2)" }}>{meta}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--paper-50)" }}>
      {/* Stats strip */}
      <div className="shrink-0 pt-2 px-3">
        <div className="grid grid-cols-4 rounded-[14px] overflow-hidden bg-white" style={{ border: "1px solid var(--line)" }}>
          {stats.map((s, i) => {
            const active = !!s.filter && filter === s.filter;
            const body = (
              <>
                <span className="flex items-center gap-[5px] text-[10px] font-extrabold uppercase tracking-[0.06em]" style={{ color: "var(--text-2)" }}>
                  <i className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />{s.label}
                </span>
                <span className="text-[15px] font-extrabold tabular-nums truncate max-w-full" style={{ color: "var(--text-strong)" }}>{s.value}</span>
              </>
            );
            const cls = `flex flex-col items-start gap-0.5 px-2.5 py-2 min-w-0 text-left ${i < 3 ? "border-r" : ""}`;
            const style = { borderColor: "#F0EADC", background: active || (s.key === "sales" && p.showSalesSplit) ? "var(--success-bg)" : "#fff" };
            if (s.key === "sales") {
              return (
                <button key={s.key} ref={p.salesRef} type="button" aria-expanded={p.showSalesSplit}
                  onClick={p.onToggleSalesSplit} className={cls} style={style}>{body}</button>
              );
            }
            if (s.filter) {
              return (
                <button key={s.key} type="button" aria-pressed={active}
                  onClick={() => setFilter(active ? null : s.filter!)} className={cls} style={style}>{body}</button>
              );
            }
            return <div key={s.key} className={cls} style={style}>{body}</div>;
          })}
        </div>

        {p.showSalesSplit && (
          <div className="grid grid-flow-col auto-cols-fr mt-1.5 rounded-xl overflow-hidden bg-white" style={{ border: "1px solid var(--line)" }}>
            {salesSegments.map((seg, i) => (
              <span key={seg.key} className={`flex items-center justify-center gap-1.5 py-2 min-w-0 ${i > 0 ? "border-l" : ""}`} style={{ borderColor: "#F0EADC" }}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${seg.dot}`} />
                <span className="text-[11px] font-semibold" style={{ color: "var(--text-2)" }}>{seg.label}</span>
                <span className={`text-xs font-bold tabular-nums ${seg.text}`}>{fmt(seg.amount)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="shrink-0 flex gap-1.5 px-3 pt-2">
        <button type="button" onClick={p.onDelivery}
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[12.5px] font-bold"
          style={{ background: "var(--ink-700)", color: "#EAF0F8" }}>
          <Bike className="w-[15px] h-[15px]" />Delivery
        </button>
        <button type="button" onClick={p.onPickup}
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[12.5px] font-bold text-white"
          style={{ background: "var(--clay-600)" }}>
          <ShoppingBag className="w-[15px] h-[15px]" />Pickup
        </button>
        <button type="button" onClick={p.onAddTable}
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-1 text-[12.5px] font-bold bg-white"
          style={{ border: "1px dashed var(--line-strong)", color: "var(--text-1)" }}>
          <Plus className="w-[15px] h-[15px]" />Table
        </button>
        <button type="button" aria-label={editMode ? "Done editing tables" : "Edit tables"} aria-pressed={editMode}
          onClick={() => setEditMode(v => !v)}
          className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
          style={editMode
            ? { background: "var(--green-800)", color: "#F4F8F0", border: "1px solid var(--green-800)" }
            : { background: "#fff", color: "var(--text-1)", border: "1px solid var(--line)" }}>
          <Pencil className="w-4 h-4" />
        </button>
      </div>

      {/* On floor */}
      {chips.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-3 pt-2 pb-0.5 overflow-x-auto scrollbar-hide">
          <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.1em]" style={{ color: "var(--text-2)" }}>On floor</span>
          {chips.map(c => (
            <span key={c.name} className="shrink-0 inline-flex items-center h-6 px-[9px] rounded-full font-mono text-[10.5px] font-bold"
              style={{ background: "var(--info-bg)", color: "var(--ink-700)" }}>
              {c.name} → {c.tables.join(", ")}
            </span>
          ))}
          <span className="shrink-0 text-[11px]" style={{ color: "var(--text-2)" }}>
            {activeCount} {activeCount === 1 ? "table" : "tables"} active
          </span>
        </div>
      )}

      {/* Grid */}
      <main className="flex-1 min-h-0 overflow-y-auto px-3 pb-3.5">
        <div className="pt-2"><LiveOrdersStrip deliveryOrders={p.deliveryOrders} pickupOrders={p.pickupOrders} /></div>

        {p.isLoading ? (
          <div className="grid grid-cols-4 gap-1.5 pt-3">
            {Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-[60px] skeleton-glass" />)}
          </div>
        ) : p.tables.length === 0 ? (
          <div className="flex flex-col items-center text-center py-16">
            <Users className="w-8 h-8 mb-3" style={{ color: "var(--text-3)" }} />
            <p className="text-base font-semibold mb-1">No tables yet</p>
            <button type="button" onClick={p.onAddTable} className="mt-2 h-11 px-4 rounded-xl text-sm font-bold text-white" style={{ background: "var(--green-800)" }}>
              Add first table
            </button>
          </div>
        ) : (
          p.sectionOrder.map(section => {
            const all = p.grouped[section];
            const visible = filterTablesByStatus(all, filter);
            if (visible.length === 0) return null;
            return (
              <Fragment key={section}>
                {zoneHeader(sectionLabel(section), `${all.filter(t => t.status === "running").length} running · ${all.length} tables`)}
                <div className="grid grid-cols-4 gap-1.5">{visible.map(renderTable)}</div>
              </Fragment>
            );
          })
        )}

        {p.posSections.map(section => {
          const open = p.sectionOrders[section.id] ?? [];
          return (
            <Fragment key={section.id}>
              {zoneHeader(section.name, `${open.length} open`)}
              <div className="grid grid-cols-4 gap-1.5">
                <div className="col-span-2">
                  <SectionOrdersFlyout sectionId={section.id} sectionName={section.name} orders={open}
                    onNewOrder={() => p.onSectionNewOrder(section)}>
                    <div className="h-[60px] rounded-xl flex items-center gap-2 px-3 border-2 border-amber-400 bg-amber-50">
                      <UtensilsCrossed className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-amber-700 truncate">{section.name}</span>
                        <span className="block text-[10px] font-medium text-amber-500">Tap to order</span>
                      </span>
                    </div>
                  </SectionOrdersFlyout>
                </div>
              </div>
            </Fragment>
          );
        })}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: exits 0. If `Bike`/`ShoppingBag` are missing from the installed lucide-react, use `Truck` / `Package`.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/tables/TablesMobileView.tsx
git commit -m "TablesMobileView: compact phone layout for Tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Render `TablesMobileView` on phones

**Files:**
- Modify: `client/src/pages/Tables.tsx`

- [ ] **Step 1: Imports and flag**

Add imports:

```tsx
import { useIsMobile } from "@/hooks/use-mobile";
import { TablesMobileView } from "@/components/tables/TablesMobileView";
```

Inside `Tables()`, right after `const { deliveryOrders, pickupOrders, sectionOrders } = useLiveOrders();` add:

```tsx
  const isMobile = useIsMobile();
```

- [ ] **Step 2: Branch the page body**

In the JSX, wrap everything from the `{/* ── Live Status Bar ── */}` `<div className="shrink-0 px-3 sm:px-4 py-2" …>` through the closing `</main>` of the table grid in a desktop-only fragment, and render the mobile view otherwise. The `PinGuard` above, and the Add/Edit `Dialog` + `LiveOrdersPanel` below, stay outside the branch:

```tsx
      {isMobile ? (
        <TablesMobileView
          tables={tables}
          isLoading={isLoading}
          grouped={grouped}
          sectionOrder={sectionOrder}
          liveStatus={liveStatus}
          showSalesSplit={showSalesSplit}
          onToggleSalesSplit={() => setShowSalesSplit(v => !v)}
          salesRef={salesRef}
          shiftFrom={shiftFrom}
          deliveryOrders={deliveryOrders}
          pickupOrders={pickupOrders}
          posSections={posSections}
          sectionOrders={sectionOrders}
          onTableClick={handleTableClick}
          onPrint={printTableBill}
          onMove={t => go("moveTable", "Shift Table", () => setShiftFrom(t))}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAddTable={() => { setEditTable(null); setForm({ name: "", capacity: "4", section: "inner" }); setShowAdd(true); }}
          onDelivery={() => navigate("/pos?mode=delivery")}
          onPickup={() => navigate("/pos?mode=pickup")}
          onSectionNewOrder={s => navigate(`/pos?section=${encodeURIComponent(s.id)}&sectionName=${encodeURIComponent(s.name)}`)}
        />
      ) : (
        <>
          {/* … the existing Live Status Bar div … */}
          {/* … the existing <main> table grid … */}
        </>
      )}
```

(The two comment lines stand for the existing, unchanged JSX that you are wrapping — do not retype it.)

- [ ] **Step 3: Type-check and test**

Run: `npm run check` → exits 0.
Run: `npm run test:pure` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Tables.tsx
git commit -m "Tables: compact mobile view below 768px

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: TopNav mobile header

**Files:**
- Modify: `client/src/components/TopNav.tsx` (hamburger button ~line 102, logo ~line 111)

- [ ] **Step 1: Bordered hamburger**

Replace the hamburger button's `className` with:

```tsx
          className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center bg-white border border-[var(--line)] text-[var(--text-1)] hover:bg-[var(--paper-100)] transition-colors shrink-0"
```

- [ ] **Step 2: Mobile wordmark**

Replace

```tsx
        <div className="flex items-center gap-2 shrink-0">
          <BagichaLogo size="sm" />
        </div>
```

with

```tsx
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <BagichaLogo size="sm" />
        </div>
        {/* Phone: logo + single-colour wordmark (Compact POS design) */}
        <div className="md:hidden flex items-center gap-2 min-w-0">
          <img src={bagichaLogoImg} alt="Bagicha" width={32} height={32} className="shrink-0" style={{ objectFit: "contain", mixBlendMode: "multiply" }} />
          <span className="bg-wordmark text-[21px] leading-none tracking-[0.18em] truncate">Bagicha</span>
        </div>
```

and add the import at the top of TopNav.tsx:

```tsx
import bagichaLogoImg from "@assets/Bagicha Logo.png";
```

(`.bg-wordmark` in `index.css` already sets Cormorant, uppercase, navy `--ink-700`.)

- [ ] **Step 3: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/TopNav.tsx
git commit -m "TopNav: compact phone header (bordered menu button, navy wordmark)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `PosMobileHeader` component

**Files:**
- Create: `client/src/components/pos-mobile/PosMobileHeader.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { ChevronLeft, Search, User, X } from "lucide-react";

interface Customer { name: string; phone: string }

interface Props {
  onBack: () => void;
  title: string;                 // "Table 3" / "Delivery" / "Pickup"
  timer?: React.ReactNode;       // running timer for a saved table order
  orderTypeLabel: string;        // "Dine-in" / "Delivery" / "Pickup"
  orderNumber?: string;          // serialNum(activeOrderId)
  roleSwitcher: React.ReactNode;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  guestName: string;
  guestPhone: string;
  onGuestNameChange: (v: string) => void;
  onGuestPhoneChange: (v: string) => void;
  onPickCustomer: (c: Customer) => void;
  customers: Customer[];
  dropdownLimit: number;
}

/** Two-row compact POS header for phones (Compact POS design). */
export function PosMobileHeader(p: Props) {
  const [guestOpen, setGuestOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const guestLabel = p.guestName || p.guestPhone || "Guest";
  const hasGuest = !!(p.guestName || p.guestPhone);
  const filtered = p.guestName.trim()
    ? p.customers.filter(c => c.name.toLowerCase().includes(p.guestName.toLowerCase()))
    : p.customers.slice(0, p.dropdownLimit);

  return (
    <div className="shrink-0 relative z-40 flex flex-col gap-[7px] px-3 pt-2 pb-2"
      style={{ background: "var(--paper-50)", borderBottom: "1px solid var(--line)" }}>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Back to tables" onClick={p.onBack}
          className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-white"
          style={{ border: "1px solid var(--line)" }}>
          <ChevronLeft className="w-[18px] h-[18px]" style={{ color: "var(--text-1)" }} />
        </button>
        <span className="shrink min-w-0 inline-flex items-center gap-[7px] h-10 px-[11px] rounded-xl text-sm font-extrabold"
          style={{ background: "var(--green-800)", color: "#F4F8F0" }}>
          <span className="truncate">{p.title}</span>
          {p.timer && <span className="font-mono text-[10.5px] font-bold shrink-0" style={{ color: "var(--green-300)" }}>{p.timer}</span>}
        </span>
        <span className="shrink-0 inline-flex items-center h-[26px] px-[9px] rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em]"
          style={{ background: "var(--success-bg)", color: "var(--green-700)" }}>
          {p.orderTypeLabel}
        </span>
        <span className="flex-1 min-w-0 text-right font-mono text-[10.5px] font-bold truncate" style={{ color: "var(--text-2)" }}>
          {p.orderNumber ?? ""}
        </span>
        <div className="shrink-0">{p.roleSwitcher}</div>
      </div>

      <div className="flex gap-1.5">
        <div className="flex-1 min-w-0 flex items-center gap-[7px] h-10 px-2.5 bg-white rounded-xl" style={{ border: "1px solid var(--line-strong)" }}>
          <Search className="w-[15px] h-[15px] shrink-0" style={{ color: "var(--text-2)" }} />
          <input value={p.searchQuery} onChange={e => p.onSearchChange(e.target.value)} placeholder="Search item"
            className="flex-1 min-w-0 bg-transparent outline-none text-base placeholder:text-[var(--text-3)]" style={{ color: "var(--text-strong)" }} />
          {p.searchQuery && (
            <button type="button" aria-label="Clear search" onClick={() => p.onSearchChange("")} className="shrink-0 w-8 h-8 flex items-center justify-center">
              <X className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
            </button>
          )}
        </div>
        <button type="button" aria-expanded={guestOpen} onClick={() => setGuestOpen(v => !v)}
          className="shrink-0 max-w-[150px] h-10 px-[11px] rounded-xl flex items-center gap-1.5 text-[12.5px] font-bold overflow-hidden whitespace-nowrap"
          style={{
            border: `1px solid ${guestOpen ? "var(--green-600)" : "var(--line-strong)"}`,
            background: guestOpen ? "var(--success-bg)" : "#fff",
            color: hasGuest ? "var(--green-800)" : "var(--text-1)",
          }}>
          <User className="w-[15px] h-[15px] shrink-0" />
          <span className="truncate">{guestLabel}</span>
        </button>
      </div>

      {guestOpen && (
        <div className="flex gap-1.5">
          <div className="relative flex-[1.3] min-w-0">
            <input
              name="customerName" autoComplete="off" placeholder="Customer name" value={p.guestName}
              onChange={e => { p.onGuestNameChange(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              className="w-full h-10 px-[11px] rounded-xl bg-white outline-none text-base"
              style={{ border: "1px solid var(--line-strong)", color: "var(--text-strong)" }}
            />
            {showDropdown && filtered.length > 0 && (
              // onMouseDown preventDefault: dragging the scrollbar must not blur the input
              // (the 150 ms onBlur timer would close the list mid-scroll).
              <div onMouseDown={e => e.preventDefault()}
                className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto overscroll-contain custom-scrollbar">
                {filtered.map((c, i) => (
                  <button key={i} type="button" onMouseDown={e => e.preventDefault()}
                    onClick={() => { p.onPickCustomer(c); setShowDropdown(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 border-b border-gray-50 last:border-0">
                    <div className="text-sm font-semibold text-gray-800">{c.name}</div>
                    {c.phone && <div className="text-xs text-gray-400 mt-0.5">{c.phone}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input type="tel" inputMode="tel" placeholder="Phone number" value={p.guestPhone}
            onChange={e => p.onGuestPhoneChange(e.target.value)}
            className="flex-1 min-w-0 h-10 px-[11px] rounded-xl bg-white outline-none font-mono text-base"
            style={{ border: "1px solid var(--line-strong)", color: "var(--text-strong)" }} />
        </div>
      )}
    </div>
  );
}
```

(Inputs use `text-base` = 16px so iOS Safari doesn't zoom on focus.)

- [ ] **Step 2: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pos-mobile/PosMobileHeader.tsx
git commit -m "PosMobileHeader: compact two-row POS header with Guest fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `PosMobileActionDock` component

**Files:**
- Create: `client/src/components/pos-mobile/PosMobileActionDock.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Lock } from "lucide-react";

export type DockTone = "ink" | "clay" | "green" | "plain" | "amber";

export interface DockAction {
  key: string;
  label: string;
  tone: DockTone;
  disabled: boolean;
  locked: boolean;
  onClick: () => void;
}

const TONES: Record<DockTone, { bg: string; fg: string; bd: string }> = {
  ink:   { bg: "var(--info-bg)",    fg: "var(--ink-700)",   bd: "#C9D4E5" },
  clay:  { bg: "var(--warning-bg)", fg: "var(--clay-700)",  bd: "#EBD9B4" },
  green: { bg: "var(--green-50)",   fg: "var(--green-800)", bd: "var(--green-200)" },
  plain: { bg: "#fff",              fg: "var(--text-1)",    bd: "var(--line-strong)" },
  amber: { bg: "var(--warning-bg)", fg: "var(--amber-600)", bd: "#EBD9B4" },
};

/** Compact POS action dock (Cart tab, phones): 5 equal buttons + a full-width Settle button. */
export function PosMobileActionDock(p: {
  actions: DockAction[];
  settleLabel: string;
  settleDisabled: boolean;
  settleLocked: boolean;
  onSettle: () => void;
}) {
  return (
    <div className="shrink-0 bg-white flex flex-col gap-[7px] px-3 pt-2 pb-2" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="grid grid-cols-5 gap-[5px]">
        {p.actions.map(a => {
          const t = TONES[a.tone];
          return (
            <button key={a.key} type="button" disabled={a.disabled} onClick={a.onClick}
              className="h-11 rounded-[10px] text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.96] transition-transform"
              style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}>
              {a.label}
              {a.locked && <Lock className="w-2.5 h-2.5 opacity-50" />}
            </button>
          );
        })}
      </div>
      <button type="button" disabled={p.settleDisabled} onClick={p.onSettle}
        className="w-full h-[46px] rounded-xl text-[14.5px] font-extrabold text-white flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
        style={{ background: "linear-gradient(180deg, var(--green-700), var(--green-800))", boxShadow: "var(--shadow-green)" }}>
        {p.settleLabel}
        {p.settleLocked && <Lock className="w-3 h-3 opacity-60" />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check` → exits 0 (`--amber-600` already exists; it is used by POS.tsx's Hold button).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/pos-mobile/PosMobileActionDock.tsx
git commit -m "PosMobileActionDock: compact POS action dock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: POS — `compact` flag + header

**Files:**
- Modify: `client/src/pages/POS.tsx`

- [ ] **Step 1: Imports**

Add:

```tsx
import { useIsMobile } from "@/hooks/use-mobile";
import { PosMobileHeader } from "@/components/pos-mobile/PosMobileHeader";
import { PosMobileActionDock, type DockAction } from "@/components/pos-mobile/PosMobileActionDock";
import { settleButtonLabel, cartTotalsHint } from "@/lib/posMobile";
```

- [ ] **Step 2: Flag + summary default**

Immediately above `const [summaryOpen, setSummaryOpen] = useState(true);` (≈ line 263) insert:

```tsx
  // Compact phone layout (Compact POS design). Section POS keeps its own counter layout.
  const isMobile = useIsMobile();
  const compact = isMobile && !isSectionMode;
```

and change the summary state + auto-open effect to:

```tsx
  // Mobile: collapse the cart totals. In compact mode the action dock lives OUTSIDE this
  // collapsible, so it starts (and stays) collapsed; Section POS keeps its actions inside
  // and still auto-opens.
  const [summaryOpen, setSummaryOpen] = useState(!compact);
  const prevHasItemsRef = useRef(false);
  useEffect(() => {
    if (cartItems.length > 0 && !prevHasItemsRef.current && !compact) setSummaryOpen(true);
    prevHasItemsRef.current = cartItems.length > 0;
  }, [cartItems.length, compact]);
```

- [ ] **Step 3: Render the compact header**

Find the top bar: `<div className="shrink-0 relative z-40"` directly under the `TOP BAR — Petpooja style` comment. Wrap that whole `<div>…</div>` (it ends right before the `{isSectionMode && (<SectionParcelToggle` block) as `{!compact && ( … )}` and add just above it:

```tsx
      {compact && (
        <PosMobileHeader
          onBack={handleBackToTables}
          title={posMode === "delivery" ? "Delivery" : posMode === "pickup" ? "Pickup" : (tableLabel ?? "Dine In")}
          timer={isEditMode && existingOrder?.createdAt ? <POSTimer startedAt={existingOrder.createdAt} /> : undefined}
          orderTypeLabel={(() => {
            const ot = form.watch("orderType");
            return ot === "delivery" ? "Delivery" : ot === "takeaway" ? "Pickup" : "Dine-in";
          })()}
          orderNumber={activeOrderId ? serialNum(activeOrderId) : undefined}
          roleSwitcher={
            <RoleSwitcher
              activeRole={activeRole}
              loginRole={loginRole}
              secondsLeft={secondsLeft}
              isElevated={isElevated}
              onElevate={elevateRole}
              onRevert={revertRole}
            />
          }
          searchQuery={searchQuery}
          onSearchChange={v => { setSearchQuery(v); setMobileTab("menu"); }}
          guestName={form.watch("customerName") || ""}
          guestPhone={form.watch("customerPhone") || ""}
          onGuestNameChange={v => form.setValue("customerName", v)}
          onGuestPhoneChange={v => form.setValue("customerPhone", v)}
          onPickCustomer={c => { form.setValue("customerName", c.name); form.setValue("customerPhone", c.phone); }}
          customers={uniqueCustomers}
          dropdownLimit={CUSTOMER_DROPDOWN_LIMIT}
        />
      )}
```

- [ ] **Step 4: Hide the old mobile customer strip in compact mode**

Change `{!isSectionMode && <div className="md:hidden shrink-0 relative z-30 flex gap-2 px-3 py-2 border-b border-gray-100/60"` (the "Mobile customer fill-up" block) to start with `{!isSectionMode && !compact && <div …`.

- [ ] **Step 5: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/POS.tsx
git commit -m "POS: compact phone header (table pill, search, Guest)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: POS — compact menu (chips, headings, tiles)

**Files:**
- Modify: `client/src/pages/POS.tsx` (items-grid block ≈ lines 2620–2775)

- [ ] **Step 1: Category chips**

The mobile chips row (`<div className="md:hidden flex gap-1.5 overflow-x-auto px-3 py-2 scrollbar-hide shrink-0"`) is already phone-only (Section POS on phones shares it; the restyle is intended there too). Replace the "All" chip's `className` with:

```tsx
              className={`shrink-0 h-[34px] px-3 rounded-full text-xs font-bold border transition-colors ${
                selectedCategory === "all"
                  ? "bg-[var(--green-800)] text-[#F4F8F0] border-[var(--green-800)]"
                  : "bg-white text-[var(--text-1)] border-[var(--line-strong)]"
              }`}
```

and for the per-category button the same string with `selectedCategory === cat.id`. Change the row's `style` to `{{ background: "var(--paper-50)" }}` (no bottom border).

- [ ] **Step 2: Grid class + padding**

Change

```tsx
                const gridCls = isSectionMode
                  ? "grid grid-cols-2 md:grid-cols-3 gap-3"
                  : "grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2";
```

to

```tsx
                const gridCls = isSectionMode
                  ? "grid grid-cols-2 md:grid-cols-3 gap-3"
                  : compact
                    ? "grid grid-cols-2 gap-1.5"
                    : "grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2";
```

and the `<div className="p-3">` directly inside `<ScrollArea className="flex-1">` to `<div className={compact ? "px-3 pb-3" : "p-3"}>`.

- [ ] **Step 3: Compact tile**

Inside `renderTile`, right after `const showPill = pillQty > 0 && pillCartKey !== null;`, insert:

```tsx
                  if (compact) {
                    const qtyText = pillQty % 1 === 0 ? pillQty : pillQty.toFixed(1);
                    const priceText = hasSizes
                      ? `${fmt(Math.min.apply(null, item.sizes.map((s: SizeOption) => Number(s.price))))}+`
                      : fmt(parseFloat(item.price || "0"));
                    return (
                      <div key={item.id}
                        className={`flex items-center gap-1.5 min-h-[52px] pl-2.5 pr-1 py-1 rounded-xl border ${isAvailable ? "" : "opacity-40"}`}
                        style={{ background: showPill ? "var(--green-50)" : "var(--paper-0)", borderColor: showPill ? "var(--green-600)" : "var(--line)" }}>
                        <button type="button" disabled={!isAvailable} onClick={activate}
                          className="flex-1 min-w-0 text-left py-0.5 flex flex-col gap-0.5 disabled:cursor-not-allowed">
                          <span className="text-[12.5px] font-semibold leading-tight line-clamp-2" style={{ color: "var(--text-strong)" }}>{item.name}</span>
                          <span className="text-[12.5px] font-extrabold tabular-nums" style={{ color: "var(--text-strong)" }}>{priceText}</span>
                          {!isAvailable && <span className="text-[10px] font-medium" style={{ color: "var(--danger)" }}>Unavailable</span>}
                        </button>
                        {showPill ? (
                          <div className="shrink-0 flex items-center rounded-[10px] overflow-hidden text-[#F4F8F0]" style={{ background: "var(--green-800)" }}>
                            <button type="button" aria-label={`One less ${item.name}`}
                              disabled={pillQty <= 1 ? isOff("removeItem") : isOff("editItem")}
                              onClick={() => bumpCartQty(pillCartKey!, -1)}
                              className="w-9 h-11 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed">
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-mono text-[11.5px] font-bold min-w-[14px] text-center tabular-nums">{qtyText}</span>
                            <button type="button" aria-label={`One more ${item.name}`}
                              disabled={needsPicker ? isOff("editItem") : false}
                              onClick={() => needsPicker ? bumpCartQty(pillCartKey!, 1) : (isAvailable && directAddItem(item))}
                              className="w-9 h-11 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button type="button" aria-label={`Add ${item.name}`} disabled={!isAvailable} onClick={activate}
                            className="shrink-0 w-10 h-11 rounded-[10px] flex items-center justify-center text-[#F4F8F0] disabled:opacity-40 active:scale-[0.94] transition-transform"
                            style={{ background: "var(--green-800)" }}>
                            <Plus className="w-[17px] h-[17px]" />
                          </button>
                        )}
                      </div>
                    );
                  }
```

(Same handlers and gates as the desktop pill: `bumpCartQty`, `directAddItem`, `isOff("removeItem"|"editItem")`, `activate`.)

- [ ] **Step 4: Compact category heading**

Replace the group heading

```tsx
                    <div className="flex items-baseline gap-2.5 mb-2.5">
                      <h2 className="font-display font-semibold text-[1.375rem] leading-none" style={{ color: "var(--text-strong)" }}>{cat.name}</h2>
                      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
                    </div>
```

with

```tsx
                    <div className={compact ? "flex items-center gap-2.5 pt-2 pb-1.5" : "flex items-baseline gap-2.5 mb-2.5"}>
                      <h2 className={`font-display font-semibold leading-none ${compact ? "text-lg" : "text-[1.375rem]"}`} style={{ color: "var(--text-strong)" }}>{cat.name}</h2>
                      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
                      {compact && <span className="font-mono text-[10px]" style={{ color: "var(--text-2)" }}>{items.length}</span>}
                    </div>
```

and the group wrapper `<div key={cat.id} className="mb-4 last:mb-0">` to `<div key={cat.id} className={compact ? "" : "mb-4 last:mb-0"}>`.

- [ ] **Step 5: Empty-search message**

Replace `<div className="text-center py-16 text-sm" style={{ color: "var(--text-3)" }}>No items found</div>` with:

```tsx
                <div className="text-center py-16 px-6 text-sm" style={{ color: "var(--text-3)" }}>
                  {compact && searchQuery
                    ? `Nothing on the menu matches “${searchQuery}”. Use Open item in the cart for one-offs.`
                    : "No items found"}
                </div>
```

- [ ] **Step 6: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/POS.tsx
git commit -m "POS: compact phone menu tiles, chips and headings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: POS — compact cart (bar + rows)

**Files:**
- Modify: `client/src/pages/POS.tsx` (billing panel ≈ lines 2780–3000)

- [ ] **Step 1: Extract the Clear-all handler**

The "Clear all" button's `onClick` holds an inline function. Move its body into a named function declared next to the other handlers (e.g. just above `const hasItems = cartItems.length > 0;` ≈ line 1659) and call it from the existing button so both layouts share it:

```tsx
  // Clear all: on a saved order only lines not yet saved can go — removing a line the kitchen
  // already has needs its own cancel reason (× on the row); clearing everything used to make every
  // later save fail with a 400.
  const handleClearAll = () => {
    if (activeOrderId) {
      const kept = cartItems.filter(wasItemKotd);
      setCartItems(kept);
      if (kept.length > 0) toast({ title: "Saved items kept", description: "Remove a saved item with × on its row — it needs a cancel reason." });
      return;
    }
    setCartItems([]); setDiscountPercent(0); setContainerCharge(0); setDeliveryCharge(0); pendingKotCancellationsRef.current = {};
  };
```

and change the existing button to `onClick={() => go("clearCart", "Clear All Items", handleClearAll)}`. If `wasItemKotd` is declared after line 1659, place `handleClearAll` after `wasItemKotd` instead (it must be declared before use at render time only, so any position inside the component body before `return` works).

- [ ] **Step 2: Compact cart bar**

The panel header is `<div className="px-3 py-2 shrink-0 flex items-center justify-between"` (first child of the billing panel). Wrap it as `{!compact && ( … )}` and add above it:

```tsx
          {compact && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ background: "var(--paper-50)" }}>
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em]" style={{ color: "var(--text-1)" }}>Order</span>
              {activeOrderId && (
                <button
                  type="button"
                  {...longPressHandlers(() => hasItems && setShowSettleDialog(true))}
                  onClick={() => hasItems && setShowSettleDialog(true)}
                  title="Tap or long-press for full details, settle, or Pay Later"
                  className="font-mono text-[11px] font-bold rounded-md px-1.5 py-[3px] select-none"
                  style={{ color: "var(--green-700)", background: "var(--success-bg)" }}
                >
                  {serialNum(activeOrderId)}
                </button>
              )}
              <span className="flex-1" />
              <button type="button" disabled={isOff("openItem")}
                onClick={() => go("openItem", "Add Open Item", () => setShowOpenItemDialog(true))}
                className="h-[34px] px-2.5 rounded-full flex items-center gap-1 text-[11.5px] font-bold bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ border: "1px dashed var(--green-600)", color: "var(--green-700)" }}>
                <Plus className="w-[13px] h-[13px]" />Open item
              </button>
              {hasItems && (
                <button type="button" disabled={isOff("clearCart")}
                  onClick={() => go("clearCart", "Clear All Items", handleClearAll)}
                  className="h-[34px] px-2 flex items-center gap-1 text-[11.5px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ color: "var(--danger)" }}>
                  <Trash2 className="w-[13px] h-[13px]" />Clear
                  {activeRole === "staff" && <Lock className="w-2.5 h-2.5" />}
                </button>
              )}
            </div>
          )}
```

- [ ] **Step 3: Hide the column headers in compact mode**

Change `{hasItems && !isSectionMode && (` (the Qty/Item/Amount header row) to `{hasItems && !isSectionMode && !compact && (`.

- [ ] **Step 4: Compact row renderer**

Inside the IIFE that defines `const renderCartRow = (item: CartItem) => (…);`, directly after that definition add:

```tsx
              const renderCompactCartRow = (item: CartItem) => {
                const kotd = wasItemKotd(item);
                const qtyText = item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(1);
                const meta = [
                  item.addons.map(a => `+ ${a.name}`).join(", "),
                  Object.entries(item.variants || {}).map(([g, v]) => `${g}: ${v}`).join(", "),
                  item.extras || "",
                  item.notes ? `📝 ${item.notes}` : "",
                ].filter(Boolean).join(" · ") || `${fmt(item.totalPrice)} each · tap to edit`;
                const openEdit = () => go("editItem", "Edit Item", () => (item.id > 0 ? openEditPicker(item) : openOpenItemEditor(item)));
                return (
                  <div key={item.cartKey} className="flex items-center gap-2 pl-2.5 pr-1 py-[5px] min-h-[52px] border-b" style={{ borderColor: "#F0EADC" }}>
                    <div className="shrink-0 flex items-center rounded-[10px]" style={{ border: "1px solid var(--line)", background: "var(--paper-50)" }}>
                      <button type="button" aria-label={`One less ${item.name}`}
                        disabled={item.quantity <= 1 ? isOff(kotd ? "cancelKotItem" : "removeItem") : isOff("editItem")}
                        onClick={() => bumpCartQty(item.cartKey, item.quantity <= 1 ? -item.quantity : -1)}
                        className="w-10 h-11 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: "var(--text-2)" }}>
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="min-w-[16px] text-center font-mono text-[13px] font-bold tabular-nums" style={{ color: "var(--text-strong)" }}>{qtyText}</span>
                      <button type="button" aria-label={`One more ${item.name}`} disabled={isOff("editItem")}
                        onClick={() => bumpCartQty(item.cartKey, 1)}
                        className="w-10 h-11 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: "var(--green-700)" }}>
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button type="button" disabled={isOff("editItem")} onClick={openEdit}
                      className="flex-1 min-w-0 text-left py-0.5 flex flex-col gap-0.5 disabled:cursor-not-allowed">
                      <span className="text-[13px] font-bold leading-tight truncate" style={{ color: "var(--text-strong)" }}>
                        {item.name}{item.size ? ` (${item.size})` : ""}
                        {item.id < 0 && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide rounded px-1 py-px align-middle" style={{ color: "var(--green-700)", background: "var(--green-50)", border: "1px solid var(--green-200)" }}>Open</span>
                        )}
                      </span>
                      <span className="flex items-center gap-[5px] text-[10.5px] min-w-0" style={{ color: "var(--text-2)" }}>
                        <Edit2 className="w-2.5 h-2.5 shrink-0" style={{ color: "var(--green-700)" }} />
                        <span className="truncate">{meta}</span>
                      </span>
                    </button>
                    <span className="shrink-0 text-[13.5px] font-extrabold tabular-nums" style={{ color: "var(--text-strong)" }}>{fmt(item.totalPrice * item.quantity)}</span>
                    <button type="button" aria-label={`Remove ${item.name}`} disabled={isOff(kotd ? "cancelKotItem" : "removeItem")}
                      onClick={() => requestRemoveFromCart(item)}
                      className="shrink-0 w-10 h-11 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed" style={{ color: "var(--text-2)" }}>
                      <X className="w-[15px] h-[15px]" />
                    </button>
                  </div>
                );
              };
              const rowRenderer = compact ? renderCompactCartRow : renderCartRow;
```

- [ ] **Step 5: Use it in both list sites**

- `<div className="space-y-2">{modeItems.map(renderCartRow)}</div>` → `<div className={compact ? "" : "space-y-2"}>{modeItems.map(rowRenderer)}</div>`
- `return <div className="p-3 space-y-2">{cartItems.map(renderCartRow)}</div>;` → `return <div className={compact ? "bg-white" : "p-3 space-y-2"}>{cartItems.map(rowRenderer)}</div>;`
- In the table-session grouping, the wrapper `<div className="p-3 space-y-3">` → `<div className={compact ? "bg-white" : "p-3 space-y-3"}>`, and the mode header `<div className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm mb-1.5 border ${cfg.headerCls}`}>` → add a compact variant: ``className={compact ? `text-[10px] font-extrabold uppercase tracking-[0.1em] px-3 py-1 border-b ${cfg.headerCls}` : `text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm mb-1.5 border ${cfg.headerCls}`}``.

- [ ] **Step 6: Type-check**

Run: `npm run check` → exits 0.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/POS.tsx
git commit -m "POS: compact phone cart bar and rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: POS — totals handle, action dock, bottom tabs

**Files:**
- Modify: `client/src/pages/POS.tsx` (≈ lines 3003–3300)

- [ ] **Step 1: Totals handle text**

In the collapsible handle button (`aria-controls="cart-summary-body"`), replace its two children (`<span className="w-9 h-1.5 …" />` and the `<span className="flex items-center gap-1.5">…Total…</span>`) with:

```tsx
              {compact ? (
                <>
                  <span className="text-[11.5px] truncate" style={{ color: "var(--text-2)" }}>
                    {cartTotalsHint({ open: summaryOpen, subtotal, tax, fmt })}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 ${summaryOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-2)" }} />
                </>
              ) : (
                <>
                  <span className="w-9 h-1.5 rounded-full bg-gray-300" aria-hidden />
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500">Total</span>
                    <span className="text-sm font-bold text-green-600">{fmt(grandTotal)}</span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${summaryOpen ? "" : "rotate-180"}`} />
                  </span>
                </>
              )}
```

and give the handle a compact height: change its `className` to `` `md:hidden shrink-0 flex items-center justify-between gap-3 px-3 ${compact ? "h-10" : "h-11"} border-t active:bg-black/[0.03] transition-colors` ``.

- [ ] **Step 2: Remove the in-collapsible buttons in compact mode**

The `{/* Action buttons */}` block `<div className="px-2 pb-2 shrink-0 space-y-1 border-t pt-1.5">` → wrap as `{!compact && ( … )}`. (Section POS is never compact, so `SectionActionBar` is unaffected.)

- [ ] **Step 3: Render the dock after the collapsible**

Directly after the closing `</div>` of `<div id="cart-summary-body" …>` (the grid wrapper) — still inside the billing panel — add:

```tsx
          {compact && (
            <PosMobileActionDock
              actions={[
                { key: "kot", label: "KOT", tone: "ink", disabled: !hasItems || isPending || isOff("printKot"), locked: isOff("printKot"), onClick: () => go("printKot", "Print KOT", handleKOT) },
                { key: "bill", label: "Bill", tone: "clay", disabled: !hasItems || isPending || isOff("printBill"), locked: isOff("printBill"), onClick: () => go("printBill", "Print Bill", handleBillPrint) },
                { key: "ebill", label: "E-Bill", tone: "green", disabled: !hasItems || isPending || isOff("printBill"), locked: isOff("printBill"), onClick: () => go("printBill", "Send E-Bill", handleEBill) },
                {
                  key: "save",
                  label: (createOrderMutation.isPending || updateOrderMutation.isPending) && submitModeRef.current === "save" ? "Saving…" : "Save",
                  tone: "plain", disabled: !hasItems || isPending || isOff("saveOrder"), locked: isOff("saveOrder"),
                  onClick: () => go("saveOrder", "Save Order", handleSave),
                },
                { key: "hold", label: "Hold", tone: "amber", disabled: !activeOrderId || isPending || isOff("holdOrder"), locked: isOff("holdOrder"), onClick: () => go("holdOrder", "Hold Order", () => setShowHoldConfirm(true)) },
              ] satisfies DockAction[]}
              settleLabel={settleButtonLabel({ phase: settlePhase, busy: settleMutation.isPending, total: grandTotal, lines: cartItems.length, fmt })}
              settleDisabled={!hasItems || isPending || isOff("settleOrder")}
              settleLocked={isOff("settleOrder")}
              onSettle={() => go("settleOrder", "Settle Order", handleSettle)}
            />
          )}
```

The dock must only appear on the Cart tab: it is inside the billing panel, which is already `hidden` on phones while `mobileTab === "menu"`, so no extra condition is needed. If `satisfies` fails type-check (TS < 4.9), drop it and annotate the array as `const dockActions: DockAction[] = [...]` declared just above the JSX return.

- [ ] **Step 4: Bottom tab bar**

Restyle the `{/* ── Mobile: Menu / Cart tab switcher ── */}` bar (already `md:hidden`). Replace the whole block with:

```tsx
      <div className="md:hidden shrink-0 bg-white grid grid-cols-2 px-1.5 pt-1.5 pb-1.5" style={{ borderTop: "1px solid var(--line)" }}>
        <button
          type="button"
          onClick={() => setMobileTab("menu")}
          className="h-11 flex items-center justify-center gap-[7px] text-[12.5px] font-bold"
          style={{ color: mobileTab === "menu" ? "var(--green-800)" : "var(--text-2)" }}
        >
          <LayoutGrid className="w-[18px] h-[18px]" />Menu
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("cart")}
          className="h-11 flex items-center justify-center gap-[7px] text-[12.5px] font-bold"
          style={{ color: mobileTab === "cart" ? "var(--green-800)" : "var(--text-2)" }}
        >
          <ShoppingCart className="w-[18px] h-[18px]" />Cart
          {cartItems.length > 0 && (
            <span className="min-w-[18px] h-[18px] px-[5px] rounded-full font-mono text-[10.5px] font-bold inline-flex items-center justify-center text-[#F4F8F0]"
              style={{ background: "var(--green-800)" }}>
              {cartItems.length}
            </span>
          )}
        </button>
      </div>
```

(This bar is also used by Section POS on phones — the restyle is intentionally shared; behaviour is unchanged.)

- [ ] **Step 5: Type-check + tests**

Run: `npm run check` → exits 0.
Run: `npm run test:pure` → exits 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/POS.tsx
git commit -m "POS: compact phone totals handle, action dock, bottom tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Verify in a real browser and clean up

**Files:** none changed unless a bug is found (fix it in the file that owns it, re-run `npm run check`, commit).

The DB is the shared production DB. Read CLAUDE.md "Verifying a UI change in a real browser" and "Manual KOT/Bill taps in the app during development" before starting.

- [ ] **Step 1: Start the dev server on a private Pusher channel (PowerShell)**

```powershell
$env:PUSHER_CHANNEL="private-bagicha-dev-$(Get-Random)"; npm run dev
```

Run it in the background; wait for the "serving" log line. (Background jobs stay off — `BACKGROUND_JOBS` is not set.)

- [ ] **Step 2: Read-only checks at 390×844 and 360×780**

Log in with the dev login from `.claude.local.md`. With the Playwright MCP (fallback: chrome-devtools MCP), resize to 390×844 and check, waiting ~0.5 s after each tap before a screenshot:
- Tables: TopNav shows bordered ☰ + logo + BAGICHA; 4-column stats strip; tapping Running filters to occupied tables and tapping again clears; tapping Sales opens the Cash/UPI(/Due) row; action row has Delivery / Pickup / + Table / pencil; pencil shows delete + edit corners and tapping a card opens the Edit dialog with Section; running cards span two columns with Print + Move; no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`).
- POS on a free table (`/pos?tableId=…&tableName=…` via tapping a free table): header row 1 (back, green table pill, Dine-in chip, role switcher), row 2 (search + Guest); Guest opens name/phone with the autocomplete; Menu tab shows chips, serif headings, 2-col tiles; adding an item flips its tile to the − qty + pill; Cart tab shows the Order bar, stepper rows, the collapsed totals line, the 5-button dock and "Settle ₹… · n items"; opening the totals shows Discount/Container/Tax inputs.
- Every tap target on these screens measures ≥ 44 px tall where the spec says so (check the dock, steppers, tile buttons via `getBoundingClientRect`).
- Resize to 1280×800: Tables and POS look exactly as on `main` (compare against a screenshot from `git stash`-free main build if in doubt — at minimum: Live Status pills, desktop table grid, POS three-column layout, desktop action buttons).
- `document.querySelector(".app-page-content").children.length === 1` after navigating Tables → POS → back.

- [ ] **Step 3: One end-to-end order (writes to the DB)**

On a free table, with **no customer name/phone**: add 2 items → KOT → Bill → after each tap run `npx tsx scripts/dev-quiet-print-jobs.ts <orderId>` so no ticket reaches the shop printer. Then open the Actions path that exists on phones — Settle → "✕ Cancel Order instead" — and cancel the order with reason "ZZTEST mobile compact UI". Do **not** settle with money.

- [ ] **Step 4: Remove the test order**

Snapshot then delete (one transaction) the order's `order_items`, `kot_tickets`, `print_jobs`, `audit_logs` (`entity_type='order'`, `entity_id` = the id as text) and the `orders` row; set its table back to `free` if still `running`; restore the sequence:

```sql
BEGIN; SET LOCAL lock_timeout='3s'; LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE;
SELECT setval(pg_get_serial_sequence('orders','id'), (SELECT max(id) FROM orders)); COMMIT;
```

Use a `tsx -r dotenv/config` script in the scratchpad (never a session-level `SET`).

- [ ] **Step 5: Final checks**

Run: `npm run check` → exits 0. Run: `npm run test:pure` → exits 0. Delete any screenshot PNGs written to the repo root (`git status --short` shows none). Stop the dev server.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A -- client scripts package.json
git commit -m "Mobile compact UI: fixes from browser verification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Skip if nothing changed.)
