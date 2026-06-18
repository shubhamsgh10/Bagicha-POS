/**
 * apply-wa-schema.ts — one-off additive DDL for the WhatsApp automation feature.
 *
 * drizzle-kit push prompts interactively ("create or rename?") for the new
 * tables, which can't be answered in CI/agent shells. Everything here is
 * idempotent (IF NOT EXISTS) and matches shared/schema.ts exactly, so a later
 * interactive `npm run db:push` will report no changes.
 *
 * Run: npx tsx -r dotenv/config scripts/apply-wa-schema.ts
 */

import { pool } from "../server/db";

const DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id                    serial PRIMARY KEY,
  phone                 text NOT NULL UNIQUE,
  customer_id           uuid,
  display_name          text,
  bot_active            boolean NOT NULL DEFAULT true,
  human_takeover_at     timestamp,
  last_agent_reply_at   timestamp,
  assigned_agent        text,
  unread_count          integer NOT NULL DEFAULT 0,
  last_message_at       timestamp,
  last_message_preview  text,
  opted_out             boolean NOT NULL DEFAULT false,
  created_at            timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  direction       text NOT NULL,
  sender          text NOT NULL,
  sender_name     text,
  body            text NOT NULL,
  wa_message_id   text,
  status          text NOT NULL DEFAULT 'pending',
  error           text,
  trigger         text,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_conversation ON conversation_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_msgs_wa_id        ON conversation_messages (wa_message_id);

ALTER TABLE customer_messages ADD COLUMN IF NOT EXISTS wa_message_id text;
ALTER TABLE customer_messages ADD COLUMN IF NOT EXISTS delivered_at  timestamp;
ALTER TABLE customer_messages ADD COLUMN IF NOT EXISTS read_at       timestamp;

ALTER TABLE automation_jobs ADD COLUMN IF NOT EXISTS phone           text;
ALTER TABLE automation_jobs ADD COLUMN IF NOT EXISTS attempts        integer NOT NULL DEFAULT 0;
ALTER TABLE automation_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamp;
`;

async function main() {
  console.log("[wa-schema] Applying additive DDL…");
  await pool.query(DDL);
  const check = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name IN ('conversations','conversation_messages') ORDER BY table_name`,
  );
  console.log("[wa-schema] Tables present:", check.rows.map(r => r.table_name).join(", "));
  await pool.end();
  console.log("[wa-schema] Done.");
}

main().catch(err => {
  console.error("[wa-schema] FAILED:", err);
  process.exit(1);
});
