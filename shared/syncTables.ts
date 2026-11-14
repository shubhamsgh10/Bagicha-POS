// Tables mirrored to the shop PC's local database (local-first phase 3).
export const SYNC_TABLES = [
  "users", "staff_members", "categories", "menu_items", "tables",
  "restaurant_settings", "orders", "order_items", "kot_tickets",
] as const;
export type SyncTable = typeof SYNC_TABLES[number];

/** Never leave the server. NOT NULL ones are filled with '' (see SECRET_FILLS). */
export const SECRET_COLUMNS: Record<string, string[]> = {
  users: ["password", "pin", "totp_secret"],
  staff_members: ["pin"],
};
/** Stripped columns that are NOT NULL in the schema: the PC stores an empty string. */
export const SECRET_FILLS: Record<string, Record<string, string>> = {
  users: { password: "" },
};

/** Secrets nested inside a json column, blanked in place (path → replacement json). The attendance
 *  device token/comm key live inside restaurant_settings.settings; GET /api/settings hides them from
 *  non-owners and they must never reach a synced PC (its agent caches its own token). */
export const NESTED_SECRETS: Record<string, Array<{ path: string[]; value: string }>> = {
  restaurant_settings: [
    { path: ["settings", "attendanceDevice", "token"], value: '""' },
    { path: ["settings", "attendanceDevice", "commKey"], value: "0" },
  ],
};

/** Orders created within this many days are in the first (legacy, protocol v1) snapshot, plus every open one. */
export const SNAPSHOT_ORDER_DAYS = 3;
/** A pull with more changes than this tells the device to re-snapshot instead. */
export const PULL_RESET_THRESHOLD = 5000;
/** change_log rows older than this are pruned. */
export const CHANGE_LOG_RETENTION_DAYS = 7;

// ───────────────────────── Phase 4 (offline writes) ─────────────────────────
/** Tables added by phase 4 (triggers via scripts/migrate-sync-phase4.mjs). */
export const PHASE4_NEW_TABLES = [
  "inventory", "inventory_categories", "customers_master", "customer_profiles", "coupons",
  "loyalty_points", "staff_profiles", "attendance", "leaves", "shifts", "shift_assignments", "audit_logs",
] as const;
/**
 * The phase-4 sync set (protocol v2): every business table the GET routes read, full history.
 * `SYNC_TABLES` above stays the 9-table phase-3 set so installed phase-3 PCs (whose bundled copy
 * knows nothing else and which refuse unknown tables) keep working: a request without `v=2` is
 * answered with the legacy set and the legacy 3-day order window (see server/sync/syncRoutes.ts).
 */
export const SYNC_TABLES_V2 = [...SYNC_TABLES, ...PHASE4_NEW_TABLES] as const;
export type SyncTableV2 = typeof SYNC_TABLES_V2[number];
/** Tables whose `id` is a uuid (everything else is an integer serial). Pull sends their ids as strings. */
export const UUID_ID_TABLES: readonly string[] = ["customers_master"];
/**
 * A full-history snapshot can exceed Vercel's 4.5 MB response cap, so v2 snapshots are paged by id:
 * GET /api/sync/snapshot?v=2&begin=1 (cursor + table list), then ?v=2&table=T&after=ID&limit=N pages.
 * The device pulls from the begin-cursor afterwards, which heals anything that moved while paging.
 */
export const SNAPSHOT_PAGE_SIZE = 1000;
export const SNAPSHOT_PAGE_MAX = 2000;

/** Kinds of numbers/ids a device is leased (device_leases.kind). */
export const LEASE_KINDS = ["order_id", "bill_counter", "kot_counter"] as const;
export type LeaseKind = typeof LEASE_KINDS[number];
export const LEASE_DEFAULT_SIZE = 200;
export const LEASE_MAX_SIZE = 1000;
/** A device may be issued at most this many leases of one kind per hour (guards runaway burning of bill numbers). */
export const LEASE_MAX_PER_HOUR = 20;
