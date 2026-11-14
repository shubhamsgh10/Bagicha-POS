// SQL text shared by scripts/migrate-change-log.mjs, scripts/verify-change-log.ts (PGlite) and
// the sync routes, so the three can't drift. Pure strings — no imports from db.
import {
  SYNC_TABLES, PHASE4_NEW_TABLES, UUID_ID_TABLES, SECRET_COLUMNS, SECRET_FILLS, NESTED_SECRETS, SNAPSHOT_ORDER_DAYS,
} from "../../shared/syncTables";

export const CHANGE_LOG_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS change_log (
     seq bigserial PRIMARY KEY,
     txid xid8 NOT NULL DEFAULT pg_current_xact_id(),
     table_name text NOT NULL,
     row_id text NOT NULL,
     op char(1) NOT NULL,
     changed_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_change_log_txid ON change_log (txid)`,
  `CREATE INDEX IF NOT EXISTS idx_change_log_changed_at ON change_log (changed_at)`,
  `ALTER TABLE change_log ENABLE ROW LEVEL SECURITY`,
  `CREATE TABLE IF NOT EXISTS sync_devices (
     id serial PRIMARY KEY,
     name text NOT NULL,
     token_hash text NOT NULL UNIQUE,
     created_at timestamptz DEFAULT now(),
     last_seen_at timestamptz,
     revoked_at timestamptz
   )`,
  `ALTER TABLE sync_devices ENABLE ROW LEVEL SECURITY`,
];

export const CHANGE_LOG_FUNCTION = `CREATE OR REPLACE FUNCTION change_log_capture() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO change_log (table_name, row_id, op) VALUES (TG_TABLE_NAME, OLD.id::text, 'D');
  ELSE
    INSERT INTO change_log (table_name, row_id, op) VALUES (TG_TABLE_NAME, NEW.id::text, left(TG_OP, 1));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql`;

export function triggerDdl(table: string): string[] {
  return [
    `DROP TRIGGER IF EXISTS change_log_capture ON ${table}`,
    `CREATE TRIGGER change_log_capture AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION change_log_capture()`,
  ];
}

/** Everything the migration runs, in order (function after tables, triggers last). */
export function migrationStatements(): string[] {
  const out = [...CHANGE_LOG_DDL, CHANGE_LOG_FUNCTION];
  for (const t of SYNC_TABLES) out.push(...triggerDdl(t));
  return out;
}

export const ROLLBACK_SQL: string[] = [
  ...SYNC_TABLES.map((t) => `DROP TRIGGER IF EXISTS change_log_capture ON ${t}`),
  `DROP FUNCTION IF EXISTS change_log_capture()`,
  `DROP TABLE IF EXISTS change_log`,
  `DROP TABLE IF EXISTS sync_devices`,
];

/** Row JSON expression for `alias` (table `table`) with secrets removed / blanked. Table names are our own constants. */
export function rowJsonSql(table: string, alias = "t"): string {
  let expr = `to_jsonb(${alias})`;
  for (const c of SECRET_COLUMNS[table] ?? []) expr += ` - '${c}'`;
  const fills = SECRET_FILLS[table];
  if (fills) expr += ` || '${JSON.stringify(fills)}'::jsonb`;
  // jsonb_set only replaces a path whose parent exists, so rows without attendanceDevice are unchanged.
  for (const s of NESTED_SECRETS[table] ?? []) {
    expr = `jsonb_set(${expr}, '{${s.path.join(",")}}', '${s.value}'::jsonb, false)`;
  }
  return expr;
}

/** The pull query. Params: $1 prev snapshot text, $2 current snapshot text. */
export const PULL_SQL = `SELECT seq, table_name, row_id, op
FROM change_log
WHERE txid >= pg_snapshot_xmin($1::pg_snapshot)
  AND NOT pg_visible_in_snapshot(txid, $1::pg_snapshot)
  AND pg_visible_in_snapshot(txid, $2::pg_snapshot)
ORDER BY seq`;

export const CURRENT_SNAPSHOT_SQL = `SELECT pg_current_snapshot()::text AS snap`;

export const OPEN_ORDER_PREDICATE =
  `(status <> 'cancelled' AND (payment_status = 'pending' OR status IN ('pending','preparing','ready','hold')))`;

/** Snapshot row selectors per table (SELECT of jsonb rows). */
export function snapshotSelectSql(table: string): string {
  const t = table;
  const rows = (where: string) => `SELECT ${rowJsonSql(t)} AS j FROM ${t} t ${where}`;
  const selectedOrders = `SELECT id FROM orders WHERE ${OPEN_ORDER_PREDICATE} OR created_at >= now() - interval '${SNAPSHOT_ORDER_DAYS} days'`;
  if (t === "orders") return rows(`WHERE ${OPEN_ORDER_PREDICATE} OR created_at >= now() - interval '${SNAPSHOT_ORDER_DAYS} days'`);
  if (t === "order_items" || t === "kot_tickets") return rows(`WHERE order_id IN (${selectedOrders}) ORDER BY id`);
  return rows(`ORDER BY id`);
}

const UUID_TABLES = new Set<string>(UUID_ID_TABLES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** SQL array type of a table's id column. */
export function idArrayType(table: string): string {
  return UUID_TABLES.has(table) ? "uuid[]" : "int[]";
}

/** Fetch current rows by id (integer serial, or uuid for customers_master). Param $1: id array. */
export function fetchRowsSql(table: string): string {
  return `SELECT t.id AS id, ${rowJsonSql(table)} AS j FROM ${table} t WHERE t.id = ANY($1::${idArrayType(table)})`;
}

export interface ChangeRow { seq: string | number; table_name: string; row_id: string; op: string }

/** Keep the last op per (table,row), in seq order. uuid tables keep their id as a string. */
export function collapseChanges(rows: ChangeRow[]): Array<{ table: string; id: number | string; op: string }> {
  const last = new Map<string, { table: string; id: number | string; op: string }>();
  for (const r of rows) {
    let id: number | string;
    if (UUID_TABLES.has(r.table_name)) {
      if (!UUID_RE.test(r.row_id)) continue;
      id = r.row_id.toLowerCase();
    } else {
      id = Number(r.row_id);
      if (!Number.isInteger(id)) continue;
    }
    const k = `${r.table_name}:${id}`;
    last.delete(k); // re-insert so ordering follows the latest change
    last.set(k, { table: r.table_name, id, op: r.op });
  }
  return Array.from(last.values());
}

/** One page of a v2 snapshot: rows after id $1 (NULL = from the start), at most $2, ordered by id. */
export function snapshotPageSql(table: string): string {
  return `SELECT t.id AS id, ${rowJsonSql(table)} AS j FROM ${table} t
          WHERE ($1::text IS NULL OR t.id > $1::${UUID_TABLES.has(table) ? "uuid" : "int"})
          ORDER BY t.id LIMIT $2::int`;
}

// ───────────────────────── Phase 4 ─────────────────────────
/** Number blocks handed to a shop PC so its offline orders carry final ids / bill numbers / KOT numbers. */
export const DEVICE_LEASES_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS device_leases (
     id serial PRIMARY KEY,
     device_id integer NOT NULL,
     kind text NOT NULL,
     start_value bigint NOT NULL,
     end_value bigint NOT NULL,
     next_value bigint NOT NULL,
     issued_at timestamptz NOT NULL DEFAULT now(),
     exhausted_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS idx_device_leases_device_kind ON device_leases (device_id, kind, start_value)`,
  `ALTER TABLE device_leases ENABLE ROW LEVEL SECURITY`,
];

/** Everything scripts/migrate-sync-phase4.mjs runs: device_leases, then triggers on the new synced tables. */
export function phase4MigrationStatements(): string[] {
  const out = [...DEVICE_LEASES_DDL, CHANGE_LOG_FUNCTION];
  for (const t of PHASE4_NEW_TABLES) out.push(...triggerDdl(t));
  return out;
}

/** Undoes phase 4 only (the phase-3 change_log / sync_devices / 9 triggers stay). */
export const PHASE4_ROLLBACK_SQL: string[] = [
  ...PHASE4_NEW_TABLES.map((t) => `DROP TRIGGER IF EXISTS change_log_capture ON ${t}`),
  `DROP TABLE IF EXISTS device_leases`,
];

// Lease issuance. Each runs INSIDE a transaction the caller opened (see server/sync/leases.ts).
/** Serialises every writer of orders for the length of the transaction (see leases.ts for why). */
export const LOCK_ORDERS_SQL = `LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE`;
/** Issued-lease cap check. $1 device, $2 kind. */
export const LEASE_RATE_SQL = `SELECT count(*)::int AS n FROM device_leases WHERE device_id = $1 AND kind = $2 AND issued_at > now() - interval '1 hour'`;
/** Reserves ids [start, start+size-1]: takes the next id, then moves the sequence to the block's end. $1 size. */
export const ORDER_ID_BLOCK_SQL = `WITH first AS (SELECT nextval(pg_get_serial_sequence('orders','id')) AS s)
  SELECT s::bigint AS start_value, setval(pg_get_serial_sequence('orders','id'), s + $1::bigint - 1)::bigint AS end_value FROM first`;
/** Advances a settings counter by $2 and returns the NEW value (the block is (value-size, value]). $1 field. */
export const COUNTER_BLOCK_SQL = `UPDATE restaurant_settings
  SET settings = jsonb_set(settings::jsonb, ARRAY[$1::text], to_jsonb(COALESCE((settings ->> $1::text)::int, 0) + $2::int))::json, updated_at = NOW()
  WHERE id = 1 RETURNING (settings ->> $1::text)::int AS value`;
export const INSERT_LEASE_SQL = `INSERT INTO device_leases (device_id, kind, start_value, end_value, next_value)
  VALUES ($1, $2, $3, $4, $3) RETURNING id, kind, start_value, end_value`;
/** Does one of the device's leases of this kind contain $3? $1 device, $2 kind. */
export const IN_LEASE_SQL = `SELECT 1 FROM device_leases WHERE device_id = $1 AND kind = $2 AND start_value <= $3::bigint AND end_value >= $3::bigint LIMIT 1`;
/** The order's updated_at at microsecond precision, as text. $1 id. */
export const ORDER_UPDATED_AT_SQL = `SELECT to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS u FROM orders WHERE id = $1`;
