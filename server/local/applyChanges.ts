// Applies the cloud's snapshot / pull responses to the local PGlite copy. Typing is left to
// Postgres itself: each JSON row goes through jsonb_populate_record(NULL::<table>, ...) so
// timestamps, json columns, numerics and arrays convert exactly as the column declares.
// Only the SYNC_TABLES_V2 tables are ever touched (the generated schema also contains empty change_log /
// sync_devices tables and many others — they are left alone).
import type { PGlite } from "@electric-sql/pglite";
import { SYNC_TABLES_V2 } from "../../shared/syncTables";
import { setMeta, getMeta } from "./localSchema";

const SYNC_SET = new Set<string>(SYNC_TABLES_V2);
/** First id of the rows this PC creates itself (order_items / kot_tickets) until the cloud replaces them. */
export const LOCAL_TEMP_ID_FLOOR = 1_000_000_000;
const TEMP_ID_TABLES = new Set<string>(["order_items", "kot_tickets"]);
const CURSOR_KEY = "sync_cursor";
const SNAPSHOT_CHUNK = 500;

export interface SnapshotResponse { cursor: string; tables: Record<string, unknown[]> }
export interface PullChange { table: string; id: number | string; row: unknown | null }
export interface PullResponse { cursor: string; changes: PullChange[] }

interface TableInfo { columns: string[]; idType: string; sequence: string | null }
export interface PendingSkip { orderIds: Set<number>; tableIds: Set<number> }
const infoCache = new WeakMap<PGlite, Map<string, TableInfo>>();

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function assertSyncTable(table: string): void {
  if (!SYNC_SET.has(table)) throw new Error(`refusing to touch non-synced table "${table}"`);
}

async function tableInfo(client: PGlite, table: string): Promise<TableInfo> {
  assertSyncTable(table);
  let perClient = infoCache.get(client);
  if (!perClient) { perClient = new Map(); infoCache.set(client, perClient); }
  const hit = perClient.get(table);
  if (hit) return hit;
  const cols = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  if (cols.rows.length === 0) throw new Error(`local table "${table}" does not exist`);
  const idCol = cols.rows.find((c) => c.column_name === "id");
  if (!idCol) throw new Error(`local table "${table}" has no id column`);
  const seq = await client.query<{ s: string | null }>(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [`public.${quoteIdent(table)}`]);
  const info: TableInfo = {
    columns: cols.rows.map((c) => c.column_name),
    idType: idCol.data_type === "integer" ? "integer" : idCol.data_type === "bigint" ? "bigint" : idCol.data_type === "uuid" ? "uuid" : "text",
    sequence: seq.rows[0]?.s ?? null,
  };
  perClient.set(table, info);
  return info;
}

type Q = Pick<PGlite, "query" | "exec">;

async function upsertRow(tx: Q, table: string, info: TableInfo, row: unknown): Promise<void> {
  const setCols = info.columns.filter((c) => c !== "id").map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`);
  const t = quoteIdent(table);
  const conflict = setCols.length ? `DO UPDATE SET ${setCols.join(", ")}` : "DO NOTHING";
  await tx.query(
    `INSERT INTO ${t} SELECT * FROM jsonb_populate_record(NULL::${t}, $1::jsonb) ON CONFLICT (id) ${conflict}`,
    [JSON.stringify(row)],
  );
}

async function deleteRow(tx: Q, table: string, info: TableInfo, id: number | string): Promise<void> {
  await tx.query(`DELETE FROM ${quoteIdent(table)} WHERE id = $1::${info.idType}`, [String(id)]);
}

async function resetSequence(tx: Q, table: string, info: TableInfo): Promise<void> {
  if (!info.sequence) return;
  const m = await tx.query<{ m: string | null }>(`SELECT max(id)::text AS m FROM ${quoteIdent(table)}`);
  const max = m.rows[0]?.m;
  // Rows this PC creates offline take ids from 1,000,000,000 up (never colliding with a cloud id).
  const floor = TEMP_ID_TABLES.has(table) ? LOCAL_TEMP_ID_FLOOR - 1 : 0;
  if (floor === 0 && (max === null || max === undefined)) await tx.query(`SELECT setval($1, 1, false)`, [info.sequence]);
  else await tx.query(`SELECT setval($1, GREATEST($2::bigint, $3::bigint), true)`, [info.sequence, max ?? "0", floor]);
}

export async function getCursor(client: PGlite): Promise<string | null> {
  return getMeta(client, CURSOR_KEY);
}

export async function clearCursor(client: PGlite): Promise<void> {
  await setMeta(client, CURSOR_KEY, null);
}

/** Replaces every synced table with the snapshot, in ONE transaction, and stores its cursor. */
export async function applySnapshot(client: PGlite, snap: SnapshotResponse): Promise<void> {
  if (!snap || typeof snap.cursor !== "string" || !snap.tables) throw new Error("malformed snapshot");
  const infos = new Map<string, TableInfo>();
  for (const t of SYNC_TABLES_V2) infos.set(t, await tableInfo(client, t));
  await client.transaction(async (tx) => {
    await tx.exec(`TRUNCATE ${SYNC_TABLES_V2.map(quoteIdent).join(", ")} CASCADE`);
    await tx.exec(`DELETE FROM local_auth; DELETE FROM local_order_meta`);
    for (const t of SYNC_TABLES_V2) {
      const rows = snap.tables[t] ?? [];
      const q = quoteIdent(t);
      for (let i = 0; i < rows.length; i += SNAPSHOT_CHUNK) {
        await tx.query(
          `INSERT INTO ${q} SELECT * FROM jsonb_populate_recordset(NULL::${q}, $1::jsonb)`,
          [JSON.stringify(rows.slice(i, i + SNAPSHOT_CHUNK))],
        );
      }
      await resetSequence(tx, t, infos.get(t)!);
      for (const r of rows) await storeAuth(tx, t, r);
    }
    await tx.query(
      `INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CURSOR_KEY, snap.cursor],
    );
  });
}

/** users / staff_members rows carry `_auth` (scrypt verifiers): kept in local_auth, never in the synced tables. */
async function storeAuth(tx: Q, table: string, row: any): Promise<void> {
  if (table !== "users" && table !== "staff_members") return;
  const id = Number(row?.id);
  if (!Number.isInteger(id)) return;
  const kind = table === "users" ? "user" : "staff";
  const a = row?._auth ?? {};
  await tx.query(
    `INSERT INTO local_auth (kind, id, pw, pin) VALUES ($1,$2,$3,$4) ON CONFLICT (kind, id) DO UPDATE SET pw = EXCLUDED.pw, pin = EXCLUDED.pin`,
    [kind, id, typeof a.pw === "string" ? a.pw : null, typeof a.pin === "string" ? a.pin : null],
  );
}

async function setBase(tx: Q, orderId: number, updatedAt: unknown): Promise<void> {
  if (typeof updatedAt !== "string") return;
  await tx.query(
    `INSERT INTO local_order_meta (order_id, cloud_updated_at) VALUES ($1,$2) ON CONFLICT (order_id) DO UPDATE SET cloud_updated_at = EXCLUDED.cloud_updated_at`,
    [orderId, updatedAt]);
}

export interface ApplyResult { touched: string[]; skipped: number; skippedTables: boolean }

/**
 * Applies a pull response in order, in ONE transaction, and stores the new cursor.
 * `skip` (orders with unreplayed local edits, and their tables) leaves those rows alone so older cloud
 * state cannot overwrite newer local state; they heal when the order's entries are acknowledged
 * (order refresh) and, for tables, when the outbox drains.
 */
export async function applyChangesDetailed(client: PGlite, pull: PullResponse, skip?: PendingSkip): Promise<ApplyResult> {
  if (!pull || typeof pull.cursor !== "string" || !Array.isArray(pull.changes)) throw new Error("malformed pull response");
  const infos = new Map<string, TableInfo>();
  for (const c of pull.changes) if (!infos.has(c.table)) infos.set(c.table, await tableInfo(client, c.table));
  const touched = new Set<string>();
  let skipped = 0;
  let skippedTables = false;
  await client.transaction(async (tx) => {
    for (const c of pull.changes) {
      const info = infos.get(c.table)!;
      const isDelete = c.row === null || c.row === undefined;
      if (skip) {
        let orderId: number | null = null;
        if (c.table === "orders") orderId = Number(c.id);
        else if (c.table === "order_items" || c.table === "kot_tickets") {
          orderId = isDelete
            ? ((await tx.query<{ o: number }>(`SELECT order_id AS o FROM ${quoteIdent(c.table)} WHERE id = $1`, [Number(c.id)])).rows[0]?.o ?? null)
            : Number((c.row as any)?.order_id);
        }
        if (orderId !== null && skip.orderIds.has(orderId)) { skipped++; continue; }
        if (c.table === "tables" && skip.tableIds.has(Number(c.id))) { skipped++; skippedTables = true; continue; }
      }
      if (isDelete) {
        await deleteRow(tx, c.table, info, c.id);
        if (c.table === "users" || c.table === "staff_members") {
          await tx.query(`DELETE FROM local_auth WHERE kind = $1 AND id = $2`, [c.table === "users" ? "user" : "staff", Number(c.id)]);
        }
      } else {
        await upsertRow(tx, c.table, info, c.row);
        await storeAuth(tx, c.table, c.row);
        if (c.table === "orders") await setBase(tx, Number(c.id), (c.row as any)?.updated_at);
      }
      touched.add(c.table);
    }
    await tx.query(
      `INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CURSOR_KEY, pull.cursor],
    );
  });
  return { touched: Array.from(touched), skipped, skippedTables };
}

/** Returns just the touched tables. */
export async function applyChanges(client: PGlite, pull: PullResponse, skip?: PendingSkip): Promise<string[]> {
  return (await applyChangesDetailed(client, pull, skip)).touched;
}

export interface OrderRefresh {
  order: Record<string, any>;
  items: Array<Record<string, any>>;
  kotTickets: Array<Record<string, any>>;
}

/**
 * Replaces ONE order's local rows (order + items + kot tickets) with the cloud's, in one transaction:
 * the acknowledgement refresh, which removes the temporary item / ticket ids this PC invented.
 * `null` (the cloud says it is gone) deletes them.
 */
export async function replaceOrderRows(client: PGlite, orderId: number, data: OrderRefresh | null): Promise<void> {
  const oi = await tableInfo(client, "order_items");
  const ki = await tableInfo(client, "kot_tickets");
  const oo = await tableInfo(client, "orders");
  await client.transaction(async (tx) => {
    await tx.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
    await tx.query(`DELETE FROM kot_tickets WHERE order_id = $1`, [orderId]);
    if (!data) {
      await tx.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
      await tx.query(`DELETE FROM local_order_meta WHERE order_id = $1`, [orderId]);
      return;
    }
    await upsertRow(tx, "orders", oo, data.order);
    for (const it of data.items) await upsertRow(tx, "order_items", oi, it);
    for (const k of data.kotTickets) await upsertRow(tx, "kot_tickets", ki, k);
    await setBase(tx, orderId, data.order.updated_at);
  });
}

/** Records only the cloud updated_at of an order (the replay base), leaving its rows alone. */
export async function recordOrderBase(client: PGlite, orderId: number, updatedAt: unknown): Promise<void> {
  await setBase(client, orderId, updatedAt);
}

/** Upserts rows of one table without touching the cursor (re-syncs `tables` once the outbox is empty). */
export async function upsertRows(client: PGlite, table: string, rows: unknown[]): Promise<void> {
  const info = await tableInfo(client, table);
  await client.transaction(async (tx) => { for (const r of rows) await upsertRow(tx, table, info, r); });
}
