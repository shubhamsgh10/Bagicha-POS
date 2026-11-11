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
