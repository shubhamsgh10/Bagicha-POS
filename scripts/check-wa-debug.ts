/** Temporary debug: dump WhatsApp conversation state. */
import { pool } from "../server/db";

async function main() {
  const c = await pool.query(
    "SELECT id, phone, display_name, bot_active, last_message_preview, last_message_at FROM conversations ORDER BY id DESC LIMIT 5",
  );
  console.log("conversations rows:", c.rowCount);
  console.log(JSON.stringify(c.rows, null, 1));

  const m = await pool.query(
    "SELECT id, conversation_id, direction, sender, left(body,40) AS body, status, created_at FROM conversation_messages ORDER BY id DESC LIMIT 10",
  );
  console.log("conversation_messages rows:", m.rowCount);
  console.log(JSON.stringify(m.rows, null, 1));

  const j = await pool.query(
    "SELECT id, trigger_type, status, phone, attempts, error, scheduled_at FROM automation_jobs ORDER BY id DESC LIMIT 5",
  );
  console.log("automation_jobs rows:", j.rowCount);
  console.log(JSON.stringify(j.rows, null, 1));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
