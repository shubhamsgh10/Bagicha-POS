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

/** Orders created within this many days are in the first snapshot (plus every open one). */
export const SNAPSHOT_ORDER_DAYS = 3;
/** A pull with more changes than this tells the device to re-snapshot instead. */
export const PULL_RESET_THRESHOLD = 5000;
/** change_log rows older than this are pruned. */
export const CHANGE_LOG_RETENTION_DAYS = 7;
