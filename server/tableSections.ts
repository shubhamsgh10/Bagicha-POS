import { db } from "./db";
import { tables } from "@shared/schema";
import { createTableSectionCache } from "./tableSectionCache";

/**
 * The process-wide table-section cache (the pure logic and its rules live in tableSectionCache.ts).
 * `tableSectionFor` never throws; call `forgetTableSections()` after any write to the `tables` table.
 */
const cache = createTableSectionCache({
  load: () => db.select({ id: tables.id, section: tables.section }).from(tables),
});

export const tableSectionFor = (tableId: number | null | undefined): Promise<string | null> => cache.get(tableId);
export const forgetTableSections = (): void => cache.forget();
