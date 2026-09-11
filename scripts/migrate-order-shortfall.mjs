/**
 * Additive migration: adds orders.shortfall_amount, defaulted to '0' so existing rows are
 * untouched and every "revenue = totalAmount - shortfallAmount" reader nets out to exactly
 * what it reported before (db:push is unsafe — see CLAUDE.md).
 *
 * MUST be run before deploying the settlement-box change: schema.ts references the column,
 * and Drizzle selects every schema-defined column by default, so without it every
 * `db.select().from(orders)` read path 500s with `column "shortfall_amount" does not exist`
 * — the exact failure subtotal_amount caused. Idempotent, safe to re-run anywhere.
 *
 * Run: npx tsx scripts/migrate-order-shortfall.mjs   (or `node` — plain ESM, no TS syntax)
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shortfall_amount decimal(10,2) DEFAULT '0'`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const cols = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'shortfall_amount'`);
  console.log('Resulting columns:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
