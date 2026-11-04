export interface SnapshotItem {
  itemId: number;
  name: string;
  quantity: number;
  size: string | null;
  serviceMode?: string | null;
}

export interface KotSnapshot {
  items: SnapshotItem[];
  printedAt: string;
}

export interface KotDelta {
  // previousQty is present when this "new" entry is actually the incremental
  // amount added to an existing line (quantity increase) — see computeDelta.
  newItems: Array<SnapshotItem & { previousQty?: number }>;
  modifiedItems: Array<SnapshotItem & { previousQty: number }>;
  cancelledItems: SnapshotItem[];
}

/** A dish's identity for the KOT delta: same dish, same size, same service mode. */
export const snapKey = (i: { itemId: number; size: string | null; serviceMode?: string | null }) =>
  `${i.itemId}:${i.size ?? ''}:${i.serviceMode ?? ''}`;

/**
 * One entry per snapKey with the quantities SUMMED. An order can hold several lines with the same
 * key — the same dish with different add-ons/notes, or the same dish added again after the order
 * was reopened (the cart then holds the saved line and a new one). Keyed last-wins, as this used to
 * be, only ONE of those lines counted: a second Butter Naan added as its own line never reached the
 * kitchen (1 vs 1 → "no change"), and removing one of two such lines went unnoticed.
 */
function aggregate(items: SnapshotItem[]): Map<string, SnapshotItem> {
  const map = new Map<string, SnapshotItem>();
  // Rounded so float noise (0.1 + 0.2) can never read as a tiny phantom increment.
  const q = (n: number) => Math.round(n * 1e6) / 1e6;
  for (const item of items) {
    const k = snapKey(item);
    const prev = map.get(k);
    map.set(k, prev ? { ...prev, quantity: q(prev.quantity + Number(item.quantity)) } : { ...item, quantity: q(Number(item.quantity)) });
  }
  return map;
}

/**
 * The instruction text a KOT line shows for one dish key. When every line of that dish carries the
 * same instructions, that text; when they differ (one plain, one "+ Extra Cheese"), each variant
 * with its quantity — "1x regular; 1x + Extra Cheese" — so the kitchen sees exactly what each one
 * gets, instead of one line's notes stamped on all of them. ASCII only: it also prints in the
 * printer's ROM font.
 */
export function mergedInstructions(lines: Array<{ quantity: number; instructions?: string | null }>): string | null {
  const groups = new Map<string, number>();
  for (const l of lines) {
    const text = (l.instructions ?? "").trim();
    groups.set(text, (groups.get(text) ?? 0) + Number(l.quantity));
  }
  if (groups.size === 0) return null;
  if (groups.size === 1) return Array.from(groups.keys())[0] || null;
  return Array.from(groups.entries())
    .map(([text, qty]) => `${Math.round(qty * 100) / 100}x ${text || "regular"}`)
    .join("; ");
}

/** snapKey → mergedInstructions of every line with that key. */
export function instructionsByKey(
  lines: Array<{ itemId: number; size: string | null; serviceMode?: string | null; quantity: number; instructions?: string | null }>,
): Map<string, string | null> {
  const byKey = new Map<string, Array<{ quantity: number; instructions?: string | null }>>();
  for (const l of lines) {
    const k = snapKey(l);
    const list = byKey.get(k) ?? [];
    list.push(l);
    byKey.set(k, list);
  }
  const out = new Map<string, string | null>();
  for (const [k, list] of Array.from(byKey.entries())) out.set(k, mergedInstructions(list));
  return out;
}

export function computeDelta(current: SnapshotItem[], last: SnapshotItem[]): KotDelta {
  const lastMap = aggregate(last);
  const currentMap = aggregate(current);

  const newItems: Array<SnapshotItem & { previousQty?: number }> = [];
  const modifiedItems: Array<SnapshotItem & { previousQty: number }> = [];
  const cancelledItems: SnapshotItem[] = [];

  for (const [key, item] of Array.from(currentMap.entries())) {
    const prev = lastMap.get(key);
    if (!prev) {
      newItems.push(item);
    } else if (item.quantity > prev.quantity) {
      // Kitchen only needs to cook the increment, not redo the whole line — but tag
      // it with previousQty so the ticket can show "+0.5 (now 1, was 0.5)" instead of
      // a bare quantity indistinguishable from a genuinely fresh order of that size.
      newItems.push({ ...item, quantity: item.quantity - prev.quantity, previousQty: prev.quantity });
    } else if (item.quantity < prev.quantity) {
      modifiedItems.push({ ...item, previousQty: prev.quantity });
    }
  }

  for (const [key, item] of Array.from(lastMap.entries())) {
    if (!currentMap.has(key)) {
      cancelledItems.push(item);
    }
  }

  // snapKey includes serviceMode so two concurrent lines of the same dish in
  // different modes (e.g. Section POS's per-item "eat here" vs "parcel" — see
  // CLAUDE.md) track their quantities independently. But that means a pure
  // serviceMode flip on an otherwise-unchanged line (same dish, same size, same
  // quantity, just re-tagged dine-in<->parcel/pickup/delivery) changes its key and
  // fell straight into the cancel/new logic above as a spurious full VOID + full
  // NEW — telling the kitchen to stop cooking something they're already cooking
  // and start a fresh order of the exact same thing, for what's really just a
  // packaging/billing change. Net out any such pair: same itemId+size+quantity,
  // one cancelled and one genuinely-new (not a quantity-increase entry, which
  // always carries previousQty and is never a flip). This can only match a true
  // flip — a cancel+new pair with equal itemId+size can only exist in the first
  // place because their serviceMode differed.
  for (let i = cancelledItems.length - 1; i >= 0; i--) {
    const c = cancelledItems[i];
    const j = newItems.findIndex(
      (n) => n.previousQty === undefined && n.itemId === c.itemId && n.size === c.size && n.quantity === c.quantity,
    );
    if (j !== -1) {
      cancelledItems.splice(i, 1);
      newItems.splice(j, 1);
    }
  }

  return { newItems, modifiedItems, cancelledItems };
}
