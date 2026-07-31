/** Additive migration: add inventory_categories table + category_id/cost_per_unit on inventory (db:push is unsafe — see CLAUDE.md). */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `CREATE TABLE IF NOT EXISTS inventory_categories (
     id serial PRIMARY KEY,
     name text NOT NULL,
     description text,
     is_active boolean NOT NULL DEFAULT true,
     display_order integer NOT NULL DEFAULT 0
   )`,
  `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS category_id integer`,
  `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS cost_per_unit numeric(10,2)`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s.split('\n')[0].trim()); }
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'inventory_categories'`);
  console.log('Resulting table:', tables.rows);
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'inventory' AND column_name IN ('category_id', 'cost_per_unit')`);
  console.log('Resulting columns:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
