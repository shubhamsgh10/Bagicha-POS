/**
 * Full local DB backup — dumps every table's rows to one timestamped JSON file on disk.
 * Safety net for destructive one-off maintenance (e.g. scripts/cleanup-pretest-data.mjs)
 * on environments where server/services/backupService.ts's R2/S3 cloud backup isn't
 * configured (no R2_BUCKET_NAME/AWS_BUCKET_NAME set) — this repo's shared DB currently
 * has neither set, so that service can't be used as-is.
 *
 * Not a restore tool by itself — it's a raw row snapshot per table. Restoring means
 * re-inserting the relevant table's array back via a one-off script reading this file,
 * same spirit as backupService.ts's own dump shape (same table list).
 *
 * Run: npx tsx scripts/backup-full-db-local.mjs   (or `node`, plain ESM)
 * Output: backups/db-backup-<ISO-timestamp>.json in the repo root (gitignored — verify
 * backups/ is in .gitignore before running somewhere this matters, so a snapshot
 * containing customer phone numbers/PINs never accidentally gets committed).
 */
import 'dotenv/config';
import pkg from 'pg';
import { writeFileSync, mkdirSync } from 'fs';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

// Every table in shared/schema.ts, in no particular order (a full dump, not restore-ordered).
const TABLES = [
  'users', 'categories', 'menu_items', 'inventory_categories', 'inventory', 'stock_movements',
  'orders', 'order_items', 'kot_tickets', 'delivery_integrations', 'sales', 'tables',
  'customers_master', 'customer_profiles', 'customer_events', 'customer_segments',
  'automation_rules', 'automation_jobs', 'print_jobs', 'customer_messages',
  'conversations', 'conversation_messages',
  'staff_profiles', 'attendance', 'leaves', 'shifts', 'shift_assignments',
  'coupons', 'coupon_redemptions', 'loyalty_points', 'feedback', 'payment_transactions',
  'daily_digests', 'attendance_records', 'attendance_sync_log', 'staff_members',
  'audit_logs', 'restaurant_settings',
];

async function main() {
  const snapshot = { takenAt: new Date().toISOString(), tables: {} };
  let totalRows = 0;

  for (const table of TABLES) {
    try {
      const res = await pool.query(`SELECT * FROM ${table}`);
      snapshot.tables[table] = res.rows;
      totalRows += res.rowCount;
      console.log(`  ${table.padEnd(24)} ${res.rowCount} rows`);
    } catch (e) {
      console.error(`  ${table.padEnd(24)} ERROR: ${e.message}`);
      snapshot.tables[table] = { error: e.message };
    }
  }

  mkdirSync('backups', { recursive: true });
  const filename = `backups/db-backup-${snapshot.takenAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(filename, JSON.stringify(snapshot, null, 2));
  console.log(`\nDONE — ${totalRows} total rows across ${TABLES.length} tables`);
  console.log(`Saved to: ${filename}`);
}

main()
  .catch((e) => { console.error('BACKUP ERROR:', e); process.exitCode = 1; })
  .finally(() => pool.end());
