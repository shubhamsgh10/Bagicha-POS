/**
 * Additive migration: disambiguate orders.created_by (users.id vs staffMembers.id — they
 * share an integer id space). Adds created_by_staff_member_id, then backfills orders that
 * are currently unresolvable to any users row (today's "Unassigned" bucket in the Staff
 * page Sales tab) by matching their stored created_by_name against staff_members.name.
 * db:push is unsafe — see CLAUDE.md.
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
try {
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by_staff_member_id integer`);
  console.log('  OK: added created_by_staff_member_id');

  const backfill = await pool.query(`
    UPDATE orders o
    SET created_by_staff_member_id = sm.id,
        created_by = NULL
    FROM staff_members sm
    WHERE o.created_by IS NOT NULL
      AND o.created_by_staff_member_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.created_by)
      AND o.created_by_name IS NOT NULL
      AND lower(trim(o.created_by_name)) = lower(trim(sm.name))
    RETURNING o.id
  `);
  console.log(`  OK: backfilled ${backfill.rowCount} order(s) to created_by_staff_member_id`);

  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
