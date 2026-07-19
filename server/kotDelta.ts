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


  return { newItems, modifiedItems, cancelledItems };
}
