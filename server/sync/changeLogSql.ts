// SQL text shared by scripts/migrate-change-log.mjs, scripts/verify-change-log.ts (PGlite) and
// the sync routes, so the three can't drift. Pure strings — no imports from db.
import { SYNC_TABLES, SECRET_COLUMNS, SECRET_FILLS, SNAPSHOT_ORDER_DAYS } from "../../shared/syncTables";

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

/** Fetch current rows by id (all synced tables have an integer id). Param $1: int[]. */
export function fetchRowsSql(table: string): string {
  return `SELECT t.id AS id, ${rowJsonSql(table)} AS j FROM ${table} t WHERE t.id = ANY($1::int[])`;
}

export interface ChangeRow { seq: string | number; table_name: string; row_id: string; op: string }

/** Keep the last op per (table,row), in seq order. */
export function collapseChanges(rows: ChangeRow[]): Array<{ table: string; id: number; op: string }> {
  const last = new Map<string, { table: string; id: number; op: string }>();
  for (const r of rows) {
    const id = Number(r.row_id);
    if (!Number.isInteger(id)) continue;
    const k = `${r.table_name}:${id}`;
    last.delete(k); // re-insert so ordering follows the latest change
    last.set(k, { table: r.table_name, id, op: r.op });
  }
  return Array.from(last.values());
}
