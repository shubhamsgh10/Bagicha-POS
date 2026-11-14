/**
 * Additive migration for local-first sync: change_log + sync_devices tables, the
 * change_log_capture() trigger function, and an AFTER INSERT/UPDATE/DELETE row trigger on the
 * nine synced tables (users, staff_members, categories, menu_items, tables, restaurant_settings,
 * orders, order_items, kot_tickets). No existing column or row is touched.
 *
 * The SQL is imported from server/sync/changeLogSql.ts (the same text scripts/verify-change-log.ts
 * proves on PGlite), so this runner needs tsx:
 *
 *   npx tsx scripts/migrate-change-log.mjs --dry-run    # print the SQL, touch nothing, no DB connection
 *   npx tsx scripts/migrate-change-log.mjs              # apply (ONE transaction, lock_timeout 3s)
 *   npx tsx scripts/migrate-change-log.mjs --rollback   # drop the triggers, function and both tables
 *
 * Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS). Take a backups/ snapshot
 * first (node scripts/backup-full-db-local.mjs). Every trigger adds one small insert per row write,
 * and the tables get a brief lock while the trigger is created.
 */
import 'dotenv/config';
import pkg from 'pg';
import { migrationStatements, ROLLBACK_SQL } from '../server/sync/changeLogSql.ts';

const args = new Set(process.argv.slice(2));
const statements = args.has('--rollback') ? ROLLBACK_SQL : migrationStatements();

if (args.has('--dry-run')) {
  console.log(`-- ${args.has('--rollback') ? 'ROLLBACK' : 'MIGRATE'} (dry run, nothing executed)\nBEGIN;\nSET LOCAL lock_timeout = '3s';`);
  for (const s of statements) console.log(s.trim() + ';\n');
  console.log('COMMIT;');
  process.exit(0);
}

const { Pool } = pkg;
// rejectUnauthorized:false matches the app and every other scripts/migrate-*.mjs (Supabase pooler CA).
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000, max: 1 });
const client = await pool.connect();
try {
  // One explicit transaction on one client: SET LOCAL is scoped to it, nothing leaks into the pooler session.
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '3s'");
  for (const s of statements) await client.query(s);
  await client.query('COMMIT');
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname = 'change_log_capture' AND NOT tgisinternal) AS triggers,
            to_regclass('change_log') IS NOT NULL AS has_change_log,
            to_regclass('sync_devices') IS NOT NULL AS has_sync_devices`);
  console.log(args.has('--rollback') ? 'ROLLED BACK' : 'DONE', rows[0]);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('FAILED (rolled back):', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
