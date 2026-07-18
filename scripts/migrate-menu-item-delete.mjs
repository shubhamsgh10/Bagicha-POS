/** Additive migration: real soft-delete flag on menu_items, separate from is_available (Out-of-Stock toggle). db:push is unsafe — see CLAUDE.md. */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'menu_items' AND column_name = 'is_deleted'`);
  console.log('Resulting column:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
