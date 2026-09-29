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

const snapKey = (i: SnapshotItem) => `${i.itemId}:${i.size ?? ''}:${i.serviceMode ?? ''}`;

export function computeDelta(current: SnapshotItem[], last: SnapshotItem[]): KotDelta {
  const lastMap = new Map<string, SnapshotItem>();
  for (const item of last) {
    lastMap.set(snapKey(item), item);
  }
  const currentMap = new Map<string, SnapshotItem>();
  for (const item of current) {
    currentMap.set(snapKey(item), item);
  }

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
