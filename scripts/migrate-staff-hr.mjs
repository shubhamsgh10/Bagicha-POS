/**
 * One-off additive migration for the "unified staff → biometric + payroll" feature.
 *
 * Applied directly (not via `drizzle-kit push`) because the shared DB is ahead of this
 * worktree's schema (it carries the whatsapp-automation tables), so a full push would
 * try to DROP those. These statements are additive/idempotent and touch only
 * `staff_members` + `attendance`.
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

const statements = [
  `ALTER TABLE attendance ALTER COLUMN user_id DROP NOT NULL`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS staff_member_id integer`,
  `ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS designation text`,
  `ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS biometric_id text`,
  `ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS monthly_salary numeric(10,2) NOT NULL DEFAULT '0'`,
  `ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS exclude_from_payroll boolean NOT NULL DEFAULT false`,
];

try {
  const chk = await pool.query(
    `SELECT to_regclass('public.conversations') AS conversations,
            to_regclass('public.conversation_messages') AS conversation_messages,
            to_regclass('public.sessions') AS sessions`,
  );
  console.log('Safety check — these whatsapp tables must still exist (non-null):', chk.rows[0]);

  for (const s of statements) {
    await pool.query(s);
    console.log('  OK:', s);
  }

  const cols = await pool.query(
    `SELECT table_name, column_name, is_nullable, data_type
       FROM information_schema.columns
      WHERE (table_name = 'staff_members' AND column_name IN ('designation','biometric_id','monthly_salary','exclude_from_payroll'))
         OR (table_name = 'attendance'     AND column_name IN ('staff_member_id','user_id'))
      ORDER BY table_name, column_name`,
  );
  console.log('Resulting columns:');
  for (const r of cols.rows) console.log(`  ${r.table_name}.${r.column_name}  ${r.data_type}  nullable=${r.is_nullable}`);
  console.log('DONE');
} catch (e) {
  console.error('MIGRATION ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
