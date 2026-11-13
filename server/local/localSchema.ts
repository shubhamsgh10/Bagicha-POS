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
 * Drops ONLY tables in `public` (never another schema), then re-creates every table including
 * local_meta and local_sessions, and stores the new hash. The sync cursor lives in local_meta, so
 * a rebuild forgets it and the worker takes a fresh snapshot.
 */
export async function ensureLocalSchema(
  client: PGlite,
  statements: string[] = LOCAL_SCHEMA_STATEMENTS,
): Promise<{ recreated: boolean }> {
  const hash = localSchemaHash(statements);
  const metaExists = (await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'local_meta'`,
  )).rows[0].n > 0;
  if (metaExists && (await getMeta(client, "schema_hash")) === hash) return { recreated: false };

  await client.transaction(async (tx) => {
    const existing = await tx.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    for (const row of existing.rows) {
      await tx.exec(`DROP TABLE IF EXISTS public."${row.tablename.replace(/"/g, '""')}" CASCADE`);
    }
    for (const s of statements) await tx.exec(s);
    for (const s of LOCAL_AUX_STATEMENTS) await tx.exec(s);
    await tx.query(`INSERT INTO local_meta (key, value) VALUES ('schema_hash', $1)`, [hash]);
  });
  return { recreated: true };
}
