/** Additive migration for the print_jobs table (direct CREATE — db:push prompts interactively for new tables). */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `CREATE TABLE IF NOT EXISTS print_jobs (
    id serial PRIMARY KEY,
    order_id integer NOT NULL,
    job_type text NOT NULL,
    printer_id text NOT NULL,
    payload text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamp NOT NULL DEFAULT now(),
    printed_at timestamp
  )`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'print_jobs' ORDER BY ordinal_position`);
  console.log('Resulting columns:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
