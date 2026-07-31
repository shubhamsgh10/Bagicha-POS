/** Additive migration: append-only inventory ledger + per-order-item cost snapshot (db:push is unsafe — see CLAUDE.md). */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
const statements = [
  `CREATE TABLE IF NOT EXISTS stock_movements (
     id serial PRIMARY KEY,
     inventory_id integer NOT NULL,
     order_id integer,
     menu_item_id integer,
     type text NOT NULL,
     quantity_delta numeric(10,2) NOT NULL,
     stock_after numeric(10,2) NOT NULL,
     note text,
     actor_user_id integer,
     actor_staff_member_id integer,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS stock_movements_inventory_id_idx ON stock_movements (inventory_id)`,
  `CREATE INDEX IF NOT EXISTS stock_movements_order_id_idx ON stock_movements (order_id)`,
  `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost numeric(10,2)`,
];
try {
  for (const s of statements) { await pool.query(s); console.log('  OK:', s.split('\n')[0].trim()); }
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'stock_movements'`);
  console.log('Resulting table:', tables.rows);
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'unit_cost'`);
  console.log('Resulting column:', cols.rows);
  console.log('DONE');
} catch (e) { console.error('MIGRATION ERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
