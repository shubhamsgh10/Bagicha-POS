/**
 * Additive migration: the request_keys table for one-time request keys (server/requestKeys.ts).
 * Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 *
 * ROW LEVEL SECURITY is enabled on purpose: every table in `public` has RLS on, and this database's
 * default privileges grant anon/authenticated full rights on NEW tables — without RLS the stored order
 * answers would be readable/writable through Supabase's REST API with the public anon key. No policies:
 * the app connects as the table owner (postgres), which RLS does not restrict (not FORCEd).
 *
 * Idempotent (IF NOT EXISTS) and safe to re-run. Rollback: DROP TABLE IF EXISTS request_keys;
 * TLS: verifies the server certificate with the committed Supabase CA (certs/supabase-prod-ca-2021.crt).
 *
 * Run: node scripts/migrate-request-keys.mjs
 */
import 'dotenv/config';
import fs from 'fs';
import pkg from 'pg';
const { Pool } = pkg;

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const url = new URL(process.env.DATABASE_URL);
// pg lets a URL sslmode replace the ssl object below — strip it (same as server/dbSsl.ts).
for (const k of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(k);
const ca = fs.readFileSync(new URL('../certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
const pool = new Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15_000 });

const statements = [
  `CREATE TABLE IF NOT EXISTS request_keys (
     key text PRIMARY KEY,
     actor_id text NOT NULL,
     method text NOT NULL,
     path text NOT NULL,
     body_hash text NOT NULL,
     state text NOT NULL,
     response_status integer,
     response_body json,
     created_at timestamp NOT NULL DEFAULT now(),
     completed_at timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS idx_request_keys_created ON request_keys (created_at)`,
  `ALTER TABLE request_keys ENABLE ROW LEVEL SECURITY`,
];

try {
  for (const stmt of statements) {
    await pool.query(`BEGIN; SET LOCAL lock_timeout = '3s'; ${stmt}; COMMIT;`);
    console.log('  OK:', stmt.split('\n')[0]);
  }
  const { rows } = await pool.query(
    `SELECT c.relname, c.relrowsecurity AS rls,
            (SELECT count(*) FROM pg_indexes WHERE tablename = 'request_keys' AND indexname = 'idx_request_keys_created') AS idx
       FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'request_keys'`);
  console.log('Present:', rows);
  const ok = rows.length === 1 && rows[0].rls === true && Number(rows[0].idx) === 1;
  console.log(ok ? 'DONE' : 'INCOMPLETE — re-run');
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
