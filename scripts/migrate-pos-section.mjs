/** Additive migration: tag orders with the quick-POS section that created them (db:push is unsafe — see CLAUDE.md). */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_section_id text`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'pos_section_id'`);
  console.log('Resulting column:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
