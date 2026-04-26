export interface SnapshotItem {
  itemId: number;
  name: string;
  quantity: number;
  size: string | null;
}

export interface KotSnapshot {
  items: SnapshotItem[];
  printedAt: string;
}

export interface KotDelta {
  newItems: SnapshotItem[];
  modifiedItems: Array<SnapshotItem & { previousQty: number }>;
  cancelledItems: SnapshotItem[];
}

export function computeDelta(current: SnapshotItem[], last: SnapshotItem[]): KotDelta {
  const lastMap = new Map<string, SnapshotItem>();
  for (const item of last) {
    lastMap.set(`${item.itemId}:${item.size ?? ''}`, item);
  }
  const currentMap = new Map<string, SnapshotItem>();
  for (const item of current) {
    currentMap.set(`${item.itemId}:${item.size ?? ''}`, item);
  }

  const newItems: SnapshotItem[] = [];
  const modifiedItems: Array<SnapshotItem & { previousQty: number }> = [];
  const cancelledItems: SnapshotItem[] = [];

  for (const [key, item] of Array.from(currentMap.entries())) {
    const prev = lastMap.get(key);
    if (!prev) {
      newItems.push(item);
    } else if (item.quantity > prev.quantity) {
      newItems.push({ ...item, quantity: item.quantity - prev.quantity });
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
