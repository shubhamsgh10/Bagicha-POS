/**
 * Additive migration: adds orders.delivery_charge (the POS cart's manual Delivery Charge),
 * defaulted to 0 so existing rows and the currently deployed code are untouched (db:push is
 * unsafe — see CLAUDE.md). MUST run before any server build whose schema has the column:
 * Drizzle selects every schema column, so new code against an un-migrated DB fails every
 * GET /api/orders with "column delivery_charge does not exist" (the subtotal_amount incident).
 * Idempotent. Rollback: ALTER TABLE orders DROP COLUMN IF EXISTS delivery_charge
 * Run: node scripts/migrate-order-delivery-charge.mjs
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statement = `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charge decimal(10,2) DEFAULT '0'`;
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ADD COLUMN takes a brief ACCESS EXCLUSIVE lock on orders. Never queue behind a long-running
  // query (which would block the live POS behind us) — give up after 5s; just re-run later.
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  await client.query(statement);
  await client.query('COMMIT');
  console.log('  OK:', statement);
  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'delivery_charge'`);
  console.log('Resulting column:', cols.rows);
  console.log('DONE');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('MIGRATION ERROR:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
