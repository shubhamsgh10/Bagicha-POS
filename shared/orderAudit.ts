/**
 * Bill-edit audit diffing — the "before vs. after" half of the audit trail described in
 * CLAUDE.md's Security & data-integrity invariants section. Used by PUT /api/orders/:id/items
 * to describe exactly what changed on a running order before writing an order.items_edit
 * audit row (server/services/auditService.ts's logAudit).
 *
 * Deliberately NOT a reuse of shared/kotDelta.ts's computeDelta, even though both diff a
 * before/after item list keyed the same way. They answer different questions:
 *   - kotDelta is kitchen-shaped: it nets out a pure dine-in<->parcel serviceMode flip (the
 *     kitchen doesn't care which box the food leaves in) and reports a quantity increase as
 *     just the increment ("+0.5"), because that's what the cook needs to make.
 *   - This module is audit-shaped: a serviceMode flip changes what the customer is billed
 *     (container charge, KOT routing) and MUST be a visible, traceable change, not netted
 *     away. A quantity change must read as a transition (2 -> 3), not an increment, because
 *     an auditor reviewing "who changed what" needs the actual before/after values.
 * If a future change makes these look duplicative, that similarity is coincidental — keep
 * them separate.
 *
 * Contrast with shared/kotItemCancel.ts, which DOES reuse computeDelta directly (not a
 * parallel diff) — it needs the kitchen-shaped "was this exact item on the last sent KOT"
 * answer, flip-netting included, not this module's audit-shaped one.
 */

export interface AuditLine {
  menuItemId: number;
  name: string;
  size: string | null;
  serviceMode: string | null;
  quantity: number;
  price: number; // per-unit
}

export interface ChangedLine {
  name: string;
  size: string | null;
  qtyBefore: number;
  qtyAfter: number;
  priceBefore: number;
  priceAfter: number;
  modeBefore: string | null;
  modeAfter: string | null;
}

export interface OrderLineDiff {
  added: AuditLine[];
  removed: AuditLine[];
  changed: ChangedLine[];
  isEmpty: boolean;
}

// Keyed on identity alone (item + size), NOT serviceMode — unlike kotDelta's key, on purpose:
// a serviceMode-only flip must land in `changed` (modeBefore !== modeAfter), not show up as
// one removed line + one added line under a different key.
//
// Known limitation: because serviceMode isn't part of the key, TWO concurrent lines of the
// same dish+size in different modes (Section POS's per-item "Eating Here"/"Parcel" toggle —
// see CLAUDE.md) collapse onto the same map slot here, unlike kotDelta's key which keeps
// them distinct. If only one of the two lines is edited in a save this still reads
// correctly (the other line's before/after values are identical, so its silent loss from
// the map is inconsequential), but if BOTH lines change in the same save, this diff can
// under-report — it only ever sees whichever line happened to be last in each array. This
// is an audit-trail fidelity gap, not a money/order-correctness one: replaceOrderItems
// persists the real per-line data regardless of what this diff manages to describe.
const lineKey = (l: AuditLine) => `${l.menuItemId}:${l.size ?? ""}`;

// Lines sharing a key are SUMMED (same as kotDelta): keyed last-wins, adding a second Butter Naan
// line (or removing one of two) showed no change at all in the audit.
// Keyed by dish + size + service mode, so two lines of one dish in different modes stay separate;
// a pure mode flip is paired back into one "changed" entry after the diff (below).
const aggKey = (l: AuditLine) => `${lineKey(l)}:${l.serviceMode ?? ""}`;
function aggregateLines(lines: AuditLine[]): Map<string, AuditLine> {
  const m = new Map<string, AuditLine>();
  for (const l of lines) {
    const k = aggKey(l);
    const prev = m.get(k);
    m.set(k, prev ? { ...l, quantity: Math.round((Number(prev.quantity) + Number(l.quantity)) * 1e6) / 1e6 } : { ...l });
  }
  return m;
}

export function diffOrderLines(before: AuditLine[], after: AuditLine[]): OrderLineDiff {
  const beforeMap = aggregateLines(before);
  const afterMap = aggregateLines(after);

  const added: AuditLine[] = [];
  const changed: ChangedLine[] = [];
  for (const [key, line] of Array.from(afterMap.entries())) {
    const prev = beforeMap.get(key);
    if (!prev) {
      added.push(line);
      continue;
    }
    const qtyChanged = prev.quantity !== line.quantity;
    const priceChanged = prev.price !== line.price;
    const modeChanged = (prev.serviceMode ?? null) !== (line.serviceMode ?? null);
    if (qtyChanged || priceChanged || modeChanged) {
      changed.push({
        name: line.name,
        size: line.size,
        qtyBefore: prev.quantity,
        qtyAfter: line.quantity,
        priceBefore: prev.price,
        priceAfter: line.price,
        modeBefore: prev.serviceMode ?? null,
        modeAfter: line.serviceMode ?? null,
      });
    }
  }

  const removed: AuditLine[] = [];
  for (const [key, line] of Array.from(beforeMap.entries())) {
    if (!afterMap.has(key)) removed.push(line);
  }

  // A line that only changed service mode (same dish, size, quantity, price) is one edit — a mode
  // change — not a removal plus an addition.
  for (let i = removed.length - 1; i >= 0; i--) {
    const r = removed[i];
    const j = added.findIndex((a) => lineKey(a) === lineKey(r) && a.quantity === r.quantity && a.price === r.price);
    if (j === -1) continue;
    const a = added[j];
    changed.push({
      name: a.name, size: a.size,
      qtyBefore: r.quantity, qtyAfter: a.quantity,
      priceBefore: r.price, priceAfter: a.price,
      modeBefore: r.serviceMode ?? null, modeAfter: a.serviceMode ?? null,
    });
    removed.splice(i, 1);
    added.splice(j, 1);
  }

  return {
    added,
    removed,
    changed,
    isEmpty: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

/**
 * Shape of the metadata object routes.ts's PUT /api/orders/:id/items attaches to an
 * order.items_edit audit row (see the logAudit call there) — a subset of the diffOrderLines
 * output plus the before/after money totals it's saved alongside.
 */
export interface ItemsEditMetadata {
  added?: unknown[];
  removed?: unknown[];
  changed?: unknown[];
  totalBefore?: number;
  totalAfter?: number;
  discountBefore?: number;
  discountAfter?: number;
  containerBefore?: number;
  containerAfter?: number;
  deliveryBefore?: number;
  deliveryAfter?: number;
}

/**
 * Classifies one order.items_edit audit row for Reports.tsx's "KOT & Bill Activity" tab
 * (server/services/auditService.ts's getKotBillActivitySummary). Non-exclusive by design —
 * a single edit routinely changes BOTH the kitchen ticket and the bill (adding an item is
 * both), and forcing mutual exclusivity would starve "KOT Modified" of its single most
 * common real case. This is the pure-function twin of a SECOND, independent expression of
 * the identical rule as raw SQL inside getKotBillActivitySummary — keep both in sync if
 * this rule ever changes.
 */
export function classifyItemsEditRow(meta: ItemsEditMetadata | null | undefined): {
  kotModified: boolean;
  billModified: boolean;
} {
  if (!meta) return { kotModified: false, billModified: false };
  const kotModified =
    (meta.added?.length ?? 0) > 0 ||
    (meta.removed?.length ?? 0) > 0 ||
    (meta.changed?.length ?? 0) > 0;
  const billModified =
    meta.totalBefore !== meta.totalAfter ||
    meta.discountBefore !== meta.discountAfter ||
    meta.containerBefore !== meta.containerAfter ||
    meta.deliveryBefore !== meta.deliveryAfter;
  return { kotModified, billModified };
}
