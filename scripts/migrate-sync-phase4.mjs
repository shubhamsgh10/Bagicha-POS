/**
 * Additive migration for local-first phase 4 (offline writes): the device_leases table (RLS on) and the
 * change_log_capture() row trigger on the 12 newly synced tables (inventory, inventory_categories,
 * customers_master, customer_profiles, coupons, loyalty_points, staff_profiles, attendance, leaves,
 * shifts, shift_assignments, audit_logs). Needs scripts/migrate-change-log.mjs to have run (change_log).
 * No existing column or row is touched. SQL comes from server/sync/changeLogSql.ts, the same text
 * scripts/verify-replay.ts proves on PGlite, so this runner needs tsx:
 *
 *   npx tsx scripts/migrate-sync-phase4.mjs --dry-run    # print the SQL, no DB connection
 *   npx tsx scripts/migrate-sync-phase4.mjs              # apply (ONE transaction, lock_timeout 3s)
 *   npx tsx scripts/migrate-sync-phase4.mjs --rollback   # drop the 12 triggers and device_leases (phase 3 stays)
 *
 * Idempotent. Take a backups/ snapshot first (node scripts/backup-full-db-local.mjs). Each trigger adds
 * one small insert per row write; the tables get a brief lock while the trigger is created.
 */
import 'dotenv/config';
import pkg from 'pg';
import { phase4MigrationStatements, PHASE4_ROLLBACK_SQL } from '../server/sync/changeLogSql.ts';

const args = new Set(process.argv.slice(2));
const rollback = args.has('--rollback');
const statements = rollback ? PHASE4_ROLLBACK_SQL : phase4MigrationStatements();

if (args.has('--dry-run')) {
  console.log(`-- ${rollback ? 'ROLLBACK' : 'MIGRATE'} phase 4 (dry run, nothing executed)\nBEGIN;\nSET LOCAL lock_timeout = '3s';`);
  for (const s of statements) console.log(s.trim() + ';\n');
  console.log('COMMIT;');
  process.exit(0);
}

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '3s'");
  for (const s of statements) await client.query(s);
  await client.query('COMMIT');
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname = 'change_log_capture' AND NOT tgisinternal) AS triggers,
            to_regclass('device_leases') IS NOT NULL AS has_device_leases`);
  console.log(rollback ? 'ROLLED BACK' : 'DONE', rows[0], rollback ? '(expect 9 triggers left)' : '(expect 21 triggers)');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('FAILED (rolled back):', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
