# Menu Price Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the owner's Nov 2026 price list (192 PDF rows) to the live `menu_items` table in one safe transaction.

**Architecture:** A pure planner (`scripts/lib/menuPricePlan.ts`) turns live rows + a hand-checked target table (`scripts/data/menu-prices-2026-11.ts`) into updates/inserts or errors; a one-off runner (`scripts/apply-menu-prices-2026-11.ts`) dry-runs by default and writes only with `--confirm`. Spec: `docs/superpowers/specs/2026-11-07-menu-price-revision-design.md`.

**Tech Stack:** TypeScript via `tsx`, `pg` (one connection, `BEGIN`/`COMMIT`), `shared/menuValidation.ts`, `server/realtime/publisher.ts`.

---

### Task 1: Planner tests (fail first)

**Files:** Create `scripts/verify-menu-price-plan.ts`

- [ ] Write PASS/FAIL assertions (repo's hand-rolled style, nonzero exit on failure) against a fixture menu:
  price change → one `update`; equal price → `unchanged`; name mismatch / deleted / missing id → error;
  pizza sizes → new prices with `stockMultiplier` kept and base = Small; size set mismatch → error;
  new dish → `insert`; new dish already present at the same price+category → `alreadyPresent`, at another
  price → error; rename: before → update carrying `newName`, after → `unchanged`; unknown category → error;
  invalid price → error; the same id targeted twice → error. Coverage: a missing PDF row or a price
  disagreement → error. Real data: `PDF_ROWS` is rows 1..192 and `checkCoverage(PDF_ROWS, TARGETS)` is empty.
- [ ] Run `npx tsx scripts/verify-menu-price-plan.ts` → fails (module not found).

### Task 2: Planner

**Files:** Create `scripts/lib/menuPricePlan.ts`

- [ ] Export `MenuRow`, `CategoryRow`, `PdfRow`, `Target` (`update` | `sizes` | `new`), `Change`, `Plan`,
  `planMenuPrices(menu, categories, targets)`, `checkCoverage(pdfRows, targets)`, `formatChange(change)`.
- [ ] Run the verify script → the fixture checks pass (the real-data check still fails: no data yet).

### Task 3: Target table

**Files:** Create `scripts/data/menu-prices-2026-11.ts`

- [ ] `PDF_ROWS` = the 192 PDF rows verbatim; `TARGETS` = the mapping to menu ids (per the spec's decisions).
- [ ] Run the verify script → all PASS. Commit tasks 1–3.

### Task 4: Runner

**Files:** Create `scripts/apply-menu-prices-2026-11.ts`

- [ ] Dry run: read categories, menu, open-order count in one `BEGIN TRANSACTION READ ONLY`; print the plan; exit 1 on errors.
- [ ] `--confirm`: open-order guard (`--allow-open` overrides), snapshot to `backups/menu-before-prices-<ts>.json`,
  transaction with `SELECT … FOR UPDATE`, re-plan, guarded `UPDATE … WHERE id=$1 AND name=$2` (rowCount 1) and
  `INSERT … RETURNING id`, `COMMIT`, then `publishRealtime({ type: "MENU_UPDATE" })`.
- [ ] `npm run check` (unchanged), dry run against the live DB → review the diff with the user. Commit.

### Task 5: Apply and verify

- [ ] `npx tsx scripts/apply-menu-prices-2026-11.ts --confirm`.
- [ ] Dry run again → "0 changes"; independent read-back compares every PDF row with the live menu.
