/** Additive migration for the mobile-card toggle. Direct ALTER (db:push is unsafe — DB ahead via whatsapp). */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_on_mobile boolean NOT NULL DEFAULT false`,
  `ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS show_on_mobile boolean NOT NULL DEFAULT true`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const cols = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE column_name = 'show_on_mobile' AND table_name IN ('users','staff_members') ORDER BY table_name`);
  console.log('Resulting columns:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
