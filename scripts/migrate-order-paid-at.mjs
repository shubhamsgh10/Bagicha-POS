/**
 * Additive migration: adds orders.paid_at (nullable timestamp, no default, NO backfill).
 *
 * paid_at is "when the money was received". It is NULL for every existing row, and every reader goes
 * through shared/paymentSplit.ts's collectedAt(), which falls back to created_at when it is NULL —
 * so for all existing orders the Tables card, Reports, and the "correct a payment" window behave
 * exactly as they did before this column existed. Only orders settled AFTER the new code is live get
 * a paid_at (the payment route, the Orders-page "settle due", and Reports' bulk "Mark all paid").
 *
 * MUST be run before deploying the code that references it: schema.ts selects every column by
 * default, so without it every `db.select().from(orders)` read path fails with
 * `column "paid_at" does not exist` (the same failure subtotal_amount and shortfall_amount
 * caused — db:push is unsafe here, see CLAUDE.md). Running it EARLY is harmless: the old code never
 * names the column, so an extra nullable column changes nothing for it.
 *
 * Idempotent (ADD COLUMN IF NOT EXISTS), safe to re-run anywhere.
 * Rollback if ever needed:  ALTER TABLE orders DROP COLUMN IF EXISTS paid_at;
 *
 * Run: node scripts/migrate-order-paid-at.mjs   (plain ESM, no TS syntax)
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
// TLS note: the host is Supabase's connection pooler, which signs with Supabase's own private CA —
// not in Node's trust store, so a verified connection fails (SELF_SIGNED_CERT_IN_CHAIN; checked).
// `rejectUnauthorized:false` matches every other scripts/migrate-*.mjs and the app itself. The proper
// fix is pinning Supabase's CA via `ssl: { ca }` — a repo-wide follow-up, not something to fix in one script.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamp`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s); }
  const cols = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'paid_at'`);
  console.log('Resulting column:', cols.rows);
  const n = await pool.query(`SELECT count(*)::int AS total, count(paid_at)::int AS with_paid_at FROM orders`);
  console.log('Rows:', n.rows[0], '(with_paid_at should be 0 right after the migration)');
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
