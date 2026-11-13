// Applies the cloud's snapshot / pull responses to the local PGlite copy. Typing is left to
// Postgres itself: each JSON row goes through jsonb_populate_record(NULL::<table>, ...) so
// timestamps, json columns, numerics and arrays convert exactly as the column declares.
// Only the 9 SYNC_TABLES are ever touched (the generated schema also contains empty change_log /
// sync_devices tables and many others — they are left alone).
import type { PGlite } from "@electric-sql/pglite";
import { SYNC_TABLES } from "../../shared/syncTables";
import { setMeta, getMeta } from "./localSchema";

const SYNC_SET = new Set<string>(SYNC_TABLES);
const CURSOR_KEY = "sync_cursor";
const SNAPSHOT_CHUNK = 500;

export interface SnapshotResponse { cursor: string; tables: Record<string, unknown[]> }
export interface PullChange { table: string; id: number | string; row: unknown | null }
export interface PullResponse { cursor: string; changes: PullChange[] }

interface TableInfo { columns: string[]; idType: string; sequence: string | null }
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
    idType: idCol.data_type === "integer" ? "integer" : idCol.data_type === "bigint" ? "bigint" : "text",
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
  if (max === null || max === undefined) await tx.query(`SELECT setval($1, 1, false)`, [info.sequence]);
  else await tx.query(`SELECT setval($1, $2::bigint, true)`, [info.sequence, max]);
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
  for (const t of SYNC_TABLES) infos.set(t, await tableInfo(client, t));
  await client.transaction(async (tx) => {
    await tx.exec(`TRUNCATE ${SYNC_TABLES.map(quoteIdent).join(", ")} CASCADE`);
    for (const t of SYNC_TABLES) {
      const rows = snap.tables[t] ?? [];
      const q = quoteIdent(t);
      for (let i = 0; i < rows.length; i += SNAPSHOT_CHUNK) {
        await tx.query(
          `INSERT INTO ${q} SELECT * FROM jsonb_populate_recordset(NULL::${q}, $1::jsonb)`,
          [JSON.stringify(rows.slice(i, i + SNAPSHOT_CHUNK))],
        );
      }
      await resetSequence(tx, t, infos.get(t)!);
    }
    await tx.query(
      `INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CURSOR_KEY, snap.cursor],
    );
  });
}

/** Applies a pull response in order, in ONE transaction, and stores the new cursor. Returns the tables it touched. */
export async function applyChanges(client: PGlite, pull: PullResponse): Promise<string[]> {
  if (!pull || typeof pull.cursor !== "string" || !Array.isArray(pull.changes)) throw new Error("malformed pull response");
  const infos = new Map<string, TableInfo>();
  for (const c of pull.changes) if (!infos.has(c.table)) infos.set(c.table, await tableInfo(client, c.table));
  const touched = new Set<string>();
  await client.transaction(async (tx) => {
    for (const c of pull.changes) {
      const info = infos.get(c.table)!;
      if (c.row === null || c.row === undefined) await deleteRow(tx, c.table, info, c.id);
      else await upsertRow(tx, c.table, info, c.row);
      touched.add(c.table);
    }
    await tx.query(
      `INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CURSOR_KEY, pull.cursor],
    );
  });
  return Array.from(touched);
}
