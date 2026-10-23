/**
 * Additive migration: read-path indexes on the order tables (no column or data changes).
 *
 * pg_stat_statements / pg_stat_user_tables (Oct 2026) showed every item read scanning all of
 * order_items (31M rows read through 95k sequential scans — it had no index on order_id), and the
 * orders table scanned 284k times for date/status filters. These indexes make those lookups
 * direct. They are declared in shared/schema.ts under the same names so `db:push` sees them as
 * existing rather than proposing a DROP.
 *
 * The tables are small (hundreds to a few thousand rows), so a plain CREATE INDEX holds its write
 * lock for milliseconds; lock_timeout makes it give up rather than queue behind a long transaction
 * (re-run it if that happens). Idempotent (IF NOT EXISTS) and safe to re-run anywhere.
 *
 * Rollback if ever needed:
 *   DROP INDEX IF EXISTS idx_orders_created_at, idx_orders_status_payment, idx_order_items_order_id,
 *                        idx_kot_tickets_order_id, idx_print_jobs_status_created;
 *
 * Run: node scripts/migrate-perf-indexes.mjs   (plain ESM, no TS syntax)
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
// rejectUnauthorized:false matches the app and every other scripts/migrate-*.mjs (Supabase pooler CA).
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });

const indexes = [
  `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status_payment ON orders (status, payment_status)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kot_tickets_order_id ON kot_tickets (order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_status_created ON print_jobs (status, created_at)`,
];

try {
  for (const stmt of indexes) {
    // One transaction per index so SET LOCAL applies to it (the pooler may hand each statement a
    // different backend otherwise).
    await pool.query(`BEGIN; SET LOCAL lock_timeout = '3s'; ${stmt}; COMMIT;`);
    console.log('  OK:', stmt);
  }
  const { rows } = await pool.query(
    `SELECT indexname, tablename FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN
        ('idx_orders_created_at','idx_orders_status_payment','idx_order_items_order_id','idx_kot_tickets_order_id','idx_print_jobs_status_created')
      ORDER BY tablename, indexname`);
  console.log('Present:', rows);
  console.log(rows.length === indexes.length ? 'DONE' : 'INCOMPLETE — re-run');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
