/**
 * Additive migration: replaces the plain btree index on conversation_messages.wa_message_id
 * with a UNIQUE index of the same name, so a duplicate waMessageId insert (two concurrent
 * webhook/reconnect deliveries of the same message racing conversationStore.recordMessage's
 * SELECT-then-INSERT dedup check) hits a 23505 constraint violation instead of silently
 * creating a second row. Postgres treats NULLs as distinct under UNIQUE, so pending outbound
 * rows (waMessageId still null at insert time) are unaffected. db:push is unsafe — see
 * CLAUDE.md's Database section — hence a targeted raw ALTER, matching this repo's other
 * scripts/migrate-*.mjs.
 * Run: npx tsx scripts/migrate-conv-msg-wa-unique.mjs   (or `node` — plain ESM, no TS syntax)
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `DROP INDEX IF EXISTS idx_conv_msgs_wa_id`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_msgs_wa_id ON conversation_messages (wa_message_id)`,
];
try {
  const dupes = await pool.query(
    `SELECT wa_message_id, count(*) FROM conversation_messages
      WHERE wa_message_id IS NOT NULL GROUP BY wa_message_id HAVING count(*) > 1`);
  if (dupes.rows.length) {
    console.error('ABORTING: existing duplicate wa_message_id rows would violate the new unique index:', dupes.rows);
    console.error('Resolve/delete duplicates manually before re-running this migration.');
    process.exitCode = 1;
  } else {
    for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
    const idx = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'conversation_messages' AND indexname = 'idx_conv_msgs_wa_id'`);
    console.log('Resulting index:', idx.rows);
    console.log('DONE');
  }
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
