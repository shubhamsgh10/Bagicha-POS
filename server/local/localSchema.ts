// The shop PC's local database schema: the committed statements generated from shared/schema.ts
// (schema.generated.ts) plus two local-only tables. The local DB is a pure cache in phase 3 (no
// local writes), so when the schema changes the whole `public` schema is dropped and rebuilt and
// a fresh snapshot is taken.
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { LOCAL_SCHEMA_STATEMENTS } from "./schema.generated";

/** Local-only tables (not in shared/schema.ts). */
export const LOCAL_AUX_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS local_meta (key text PRIMARY KEY, value text)`,
  `CREATE TABLE IF NOT EXISTS local_sessions (sid text PRIMARY KEY, sess jsonb NOT NULL, expire timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_local_sessions_expire ON local_sessions (expire)`,
  // Phase 4 (offline writes). local_outbox = the actions waiting to be replayed to the cloud;
  // local_leases = the order id / bill / KOT number blocks the cloud leased to this PC (never lost
  // on a rebuild); local_order_meta = the cloud updated_at each order was last synced at (the replay
  // base); local_auth = offline login verifiers copied from the users / staff rows' _auth blobs.
  `CREATE TABLE IF NOT EXISTS local_outbox (
     seq bigserial PRIMARY KEY, order_id integer, method text NOT NULL, path text NOT NULL, body jsonb,
     idem_key text NOT NULL, actor text NOT NULL, approver text, base text, numbers jsonb,
     status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, last_error text, last_code text,
     created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_local_outbox_status ON local_outbox (status, seq)`,
  `CREATE TABLE IF NOT EXISTS local_leases (
     id serial PRIMARY KEY, kind text NOT NULL, start_value bigint NOT NULL, end_value bigint NOT NULL,
     next_value bigint NOT NULL, issued_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS local_order_meta (order_id integer PRIMARY KEY, cloud_updated_at text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS local_auth (kind text NOT NULL, id integer NOT NULL, pw text, pin text, PRIMARY KEY (kind, id))`,
];

export function localSchemaHash(statements: string[] = LOCAL_SCHEMA_STATEMENTS): string {
  return crypto.createHash("sha256").update(statements.join("\n--\n")).update("\n##\n").update(LOCAL_AUX_STATEMENTS.join("\n--\n")).digest("hex");
}

export async function getMeta(client: PGlite, key: string): Promise<string | null> {
  const r = await client.query<{ value: string }>(`SELECT value FROM local_meta WHERE key = $1`, [key]);
  return r.rows.length ? r.rows[0].value : null;
}

export async function setMeta(client: PGlite, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await client.query(`DELETE FROM local_meta WHERE key = $1`, [key]);
    return;
  }
  await client.query(
    `INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

/**
 * Makes the local DB match the generated schema. Returns whether it was (re)built.
 * Drops ONLY tables in `public` (never another schema), then re-creates every table including the
 * local_* ones, and stores the new hash. The sync cursor lives in local_meta, so a rebuild forgets
 * it and the worker takes a fresh snapshot.
 *
 * Phase 4: local_outbox holds actions the cloud has not seen yet, and local_leases the numbers it
 * promised this PC. A rebuild NEVER drops them: with pending/problem outbox entries it is refused
 * (`blocked`: the old schema keeps serving, the caller logs loudly and surfaces schemaBlocked);
 * otherwise the leases are carried across the rebuild.
 */
export async function ensureLocalSchema(
  client: PGlite,
  statements: string[] = LOCAL_SCHEMA_STATEMENTS,
): Promise<{ recreated: boolean; blocked?: boolean }> {
  const hash = localSchemaHash(statements);
  const has = async (name: string) => (await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`, [name])).rows[0].n > 0;
  const metaExists = await has("local_meta");
  if (metaExists && (await getMeta(client, "schema_hash")) === hash) return { recreated: false };

  let keptLeases: Array<Record<string, unknown>> = [];
  if (await has("local_outbox")) {
    const open = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM local_outbox WHERE status IN ('pending','problem')`)).rows[0].n;
    if (open > 0) {
      console.error(`[local] SCHEMA CHANGED but ${open} unsynced action(s) are waiting in the outbox: NOT rebuilding the local database. ` +
        `Reconnect to the internet so they replay (or discard them on the Sync screen), then restart.`);
      return { recreated: false, blocked: true };
    }
  }
  if (await has("local_leases")) keptLeases = (await client.query(`SELECT kind, start_value, end_value, next_value, issued_at FROM local_leases`)).rows as any[];

  await client.transaction(async (tx) => {
    const existing = await tx.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    for (const row of existing.rows) {
      await tx.exec(`DROP TABLE IF EXISTS public."${row.tablename.replace(/"/g, '""')}" CASCADE`);
    }
    for (const s of statements) await tx.exec(s);
    for (const s of LOCAL_AUX_STATEMENTS) await tx.exec(s);
    await tx.query(`INSERT INTO local_meta (key, value) VALUES ('schema_hash', $1)`, [hash]);
    for (const l of keptLeases) {
      await tx.query(`INSERT INTO local_leases (kind, start_value, end_value, next_value, issued_at) VALUES ($1,$2,$3,$4,$5)`,
        [l.kind, l.start_value, l.end_value, l.next_value, l.issued_at]);
    }
  });
  return { recreated: true };
}
