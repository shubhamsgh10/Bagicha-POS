/**
 * Additive migration for biometric shift auto-detection.
 *  - shift_assignments gains staffMemberId/source/clockIn/clockOut/workingHours; userId made nullable.
 *  - Recomputes shifts.duration_hours with midnight-wrap (fixes Evening 16:00–00:00 stored as 0.00h).
 * db:push is unsafe on the drifted shared Neon DB — see CLAUDE.md.
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });

const statements = [
  `ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS staff_member_id integer`,
  `ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS clock_in text`,
  `ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS clock_out text`,
  `ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS working_hours numeric(4,2)`,
  `ALTER TABLE shift_assignments ALTER COLUMN user_id DROP NOT NULL`,
  `ALTER TABLE shift_assignments ALTER COLUMN created_by DROP NOT NULL`,
];

const minutesOf = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }

  // Recompute duration_hours for every shift with midnight-wrap.
  const { rows: shifts } = await pool.query(`SELECT id, start_time, end_time FROM shifts`);
  for (const sh of shifts) {
    const start = minutesOf(sh.start_time);
    let end = minutesOf(sh.end_time);
    if (end <= start) end += 1440;
    const hours = Math.round(((end - start) / 60) * 100) / 100;
    await pool.query(`UPDATE shifts SET duration_hours = $1 WHERE id = $2`, [hours.toFixed(2), sh.id]);
    console.log(`  shift ${sh.id} ${sh.start_time}-${sh.end_time} -> ${hours.toFixed(2)}h`);
  }

  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shift_assignments'
        AND column_name IN ('staff_member_id','source','clock_in','clock_out','working_hours')`);
  console.log('New columns:', cols.map((c) => c.column_name));
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
