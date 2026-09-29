/**
 * One-off cleanup: removes test/demo data created before the restaurant's real
 * go-live date (2026-09-07, IST business day) — the admin started entering real
 * orders from that date on; everything before it was setup/testing.
 *
 * SAFETY: dry-run by default — prints exactly what WOULD be deleted (row counts) and
 * makes zero changes. Pass --confirm to actually execute the deletes, which then run
 * inside one transaction (all-or-nothing — a failure partway through rolls back
 * everything, never a half-applied cleanup).
 *
 * ⚠️ RUN scripts/backup-full-db-local.mjs FIRST. This script does not create its own
 * backup — it assumes one already exists to restore from if something goes wrong.
 *
 * Scope (confirmed with the restaurant owner):
 *   DELETE — orders created before the cutoff, and every row that exists only because
 *   of one of those orders: order_items, kot_tickets, print_jobs, coupon_redemptions,
 *   loyalty_points, feedback, payment_transactions, stock_movements (order-linked
 *   rows only — a stock movement from a manual inventory edit, not tied to any order,
 *   is left alone). Also pure activity-log tables scoped by their own timestamp
 *   (not order-linked): audit_logs, customer_events, automation_jobs (WhatsApp send
 *   queue), customer_messages, conversation_messages, daily_digests.
 *
 *   NEVER TOUCHED — customers_master / customer_profiles / customer_segments (every
 *   existing customer record was created during the test period, per a one-time
 *   count — deleting "customers created before the cutoff" would delete every real,
 *   currently-active customer too, since they all first appeared then and many kept
 *   ordering after go-live); conversations (WhatsApp thread objects, only their old
 *   messages are pruned); users, staffMembers, staffProfiles, attendance, leaves, shifts
 *   (employee records — an entirely different concern from order data); menu/category/
 *   inventory catalog rows (configuration, not "data"); tables (only current_order_id
 *   is nulled if it happens to point at a deleted order — defensive, not expected to
 *   fire); coupons/automation_rules/delivery_integrations/restaurant_settings
 *   (configuration). The bill/KOT sequential counters are NOT reset — real orders
 *   placed since go-live already carry real, higher sequence numbers; resetting would
 *   make new orders restart at #1 and collide/interleave with those, not give a clean
 *   restart.
 *
 * Run (preview):  npx tsx scripts/cleanup-pretest-data.mjs
 * Run (execute):  npx tsx scripts/cleanup-pretest-data.mjs --confirm
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const CONFIRM = process.argv.includes('--confirm');

// businessDayRange('2026-09-07').start per shared/businessDay.ts (5am IST cutoff) —
// 2026-09-07T05:00:00+05:30 = 2026-09-06T23:30:00.000Z. Orders/logs at or after this
// instant are kept; anything strictly before is the test period being removed.
const CUTOFF = '2026-09-06T23:30:00.000Z';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

async function main() {
  console.log(`Mode: ${CONFIRM ? 'EXECUTE (--confirm passed)' : 'DRY RUN (pass --confirm to execute)'}`);
  console.log(`Cutoff: ${CUTOFF} (= 2026-09-07 05:00 IST business day start)\n`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      `SELECT id FROM orders WHERE created_at < $1`,
      [CUTOFF],
    );
    const orderIds = orderRows.map((r) => r.id);
    console.log(`orders to delete: ${orderIds.length}`);

    // Order-linked children — deleted first, by order id, so nothing is ever briefly
    // orphaned even within the transaction.
    const orderLinkedTables = [
      'order_items', 'kot_tickets', 'print_jobs', 'coupon_redemptions',
      'loyalty_points', 'feedback', 'payment_transactions', 'stock_movements',
    ];
    const orderLinkedCounts = {};
    for (const table of orderLinkedTables) {
      if (orderIds.length === 0) { orderLinkedCounts[table] = 0; continue; }
      const res = CONFIRM
        ? await client.query(`DELETE FROM ${table} WHERE order_id = ANY($1::int[])`, [orderIds])
        : await client.query(`SELECT count(*) FROM ${table} WHERE order_id = ANY($1::int[])`, [orderIds]);
      orderLinkedCounts[table] = CONFIRM ? res.rowCount : Number(res.rows[0].count);
      console.log(`  ${table.padEnd(22)} ${orderLinkedCounts[table]}`);
    }

    // Defensive: free any table still pointing at an order about to be deleted.
    // A prior read-only check found zero such rows, but this closes the gap between
    // that check and now, and is correct behavior regardless.
    const tablesRes = orderIds.length === 0
      ? { rowCount: 0 }
      : CONFIRM
        ? await client.query(
            `UPDATE tables SET current_order_id = NULL, status = 'free' WHERE current_order_id = ANY($1::int[])`,
            [orderIds],
          )
        : await client.query(
            `SELECT count(*) FROM tables WHERE current_order_id = ANY($1::int[])`,
            [orderIds],
          );
    const tablesFreed = CONFIRM ? tablesRes.rowCount : Number(tablesRes.rows?.[0]?.count ?? 0);
    console.log(`tables freed (were pointing at a deleted order): ${tablesFreed}`);

    // The orders themselves.
    const ordersRes = CONFIRM
      ? await client.query(`DELETE FROM orders WHERE created_at < $1`, [CUTOFF])
      : { rowCount: orderIds.length };
    console.log(`orders deleted: ${CONFIRM ? ordersRes.rowCount : `(would be) ${orderIds.length}`}`);

    // Pure activity-log tables, scoped by their own timestamp (not order-linked).
    const dateScoped = [
      { table: 'sales', column: 'date' },
      { table: 'audit_logs', column: 'created_at' },
      { table: 'customer_events', column: 'created_at' },
      { table: 'automation_jobs', column: 'scheduled_at' },
      { table: 'customer_messages', column: 'created_at' },
      { table: 'conversation_messages', column: 'created_at' },
      { table: 'daily_digests', column: 'created_at' },
    ];
    const dateScopedCounts = {};
    for (const { table, column } of dateScoped) {
      const res = CONFIRM
        ? await client.query(`DELETE FROM ${table} WHERE ${column} < $1`, [CUTOFF])
        : await client.query(`SELECT count(*) FROM ${table} WHERE ${column} < $1`, [CUTOFF]);
      dateScopedCounts[table] = CONFIRM ? res.rowCount : Number(res.rows[0].count);
      console.log(`  ${table.padEnd(22)} ${dateScopedCounts[table]}`);
    }

    if (CONFIRM) {
      await client.query('COMMIT');
      console.log('\nCOMMITTED — cleanup applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — nothing was changed. Re-run with --confirm to execute.');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nERROR — rolled back, nothing was changed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(() => pool.end());
