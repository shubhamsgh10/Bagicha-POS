/**
 * Additive migration: adds orders.subtotal_amount + orders.container_charge, both
 * nullable/defaulted so existing rows are untouched (db:push is unsafe — see CLAUDE.md).
 * Run: npx tsx scripts/migrate-order-subtotal.mjs   (or `node` — plain ESM, no TS syntax)
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_amount decimal(10,2)`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS container_charge decimal(10,2) DEFAULT '0'`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const cols = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name IN ('subtotal_amount', 'container_charge')`);
  console.log('Resulting columns:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
