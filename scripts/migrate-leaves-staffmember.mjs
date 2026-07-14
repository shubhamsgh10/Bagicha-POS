/**
 * Additive migration: leaves gains staffMemberId (userId made nullable) so PIN/biometric-only
 * staff members can apply for + appear in leave requests, mirroring the attendance/shift_assignments
 * dual-key pattern. db:push is unsafe on the drifted shared Neon DB — see CLAUDE.md.
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });

const statements = [
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS staff_member_id integer`,
  `ALTER TABLE leaves ALTER COLUMN user_id DROP NOT NULL`,
];

try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const { rows } = await pool.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'leaves' AND column_name IN ('user_id','staff_member_id')`);
  console.log('Columns:', rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
