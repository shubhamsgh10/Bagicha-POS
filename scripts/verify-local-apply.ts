// PGlite in-memory proof of the shop PC's local schema + snapshot/changes apply (phase 3, Task B).
// A second in-memory PGlite plays the cloud: the real cloud snapshot SQL produces the JSON rows
// (secrets stripped), which are then applied to the "local" PGlite. Never loads dotenv.
import { PGlite } from "@electric-sql/pglite";
import { schemaStatements } from "./lib/pgliteSchema";
import { renderLocalSchemaFile, LOCAL_SCHEMA_FILE } from "./gen-local-schema";
import fs from "node:fs";
import { migrationStatements, snapshotSelectSql, fetchRowsSql } from "../server/sync/changeLogSql";
import { SYNC_TABLES } from "../shared/syncTables";
import { LOCAL_SCHEMA_STATEMENTS } from "../server/local/schema.generated";
import { ensureLocalSchema, localSchemaHash, getMeta, setMeta } from "../server/local/localSchema";
import { applySnapshot, applyChanges, getCursor, clearCursor } from "../server/local/applyChanges";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  // ── drift check: committed generated schema == fresh generation ──
  const fresh = await renderLocalSchemaFile();
  const committed = fs.readFileSync(LOCAL_SCHEMA_FILE, "utf8").split("\r\n").join("\n");
  check("schema.generated.ts matches a fresh generation (run scripts/gen-local-schema.ts if not)", fresh === committed);
  check("generated statements equal schemaStatements()", JSON.stringify(LOCAL_SCHEMA_STATEMENTS) === JSON.stringify(await schemaStatements()));

  // ── the fake cloud ──
  const cloud = new PGlite();
  await cloud.waitReady;
  for (const s of await schemaStatements()) await cloud.exec(s);
  for (const s of migrationStatements()) await cloud.exec(s);
  const cq = async (sql: string, params: any[] = []) => (await cloud.query<any>(sql, params)).rows;

  await cq(`INSERT INTO users (username, password, role, pin, totp_secret, totp_enabled) VALUES ('boss','scrypt-hash','admin','1234','TOTPSECRET',true)`);
  await cq(`INSERT INTO staff_members (name, pin, designation) VALUES ('Ravi','4321','Cook')`);
  await cq(`INSERT INTO categories (name) VALUES ('Pizza')`);
  await cq(`INSERT INTO menu_items (name, price, category_id, sizes, ingredients, inventory_links) VALUES ('Margherita','199.50',1,'[{"size":"Regular","price":199.5},{"size":"Large","price":299}]'::json, ARRAY['dough','cheese'], '[{"inventoryId":1,"quantity":2.5}]'::json)`);
  await cq(`INSERT INTO tables (name, section) VALUES ('T1','inner')`);
  await cq(`INSERT INTO restaurant_settings (id, settings) VALUES (1, '{"taxRate":5,"billCounter":7}'::json)`);
  const [{ id: oid }] = await cq(`INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status, table_id, notes) VALUES ('ORD0001','dinein','209.48','9.98','pending','pending',1,'extra spicy') RETURNING id`);
  await cq(`INSERT INTO order_items (order_id, menu_item_id, name, quantity, price, size) VALUES ($1,1,'Margherita',1.5,'199.50','Regular')`, [oid]);
  await cq(`INSERT INTO kot_tickets (order_id, kot_number, items) VALUES ($1,'KOT0001','[{"name":"Margherita","quantity":1.5}]'::json)`, [oid]);
  // an old, settled order (outside the snapshot window)
  await cq(`INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status, created_at) VALUES ('ORD-OLD','takeaway','10','0','served','paid', now() - interval '30 days')`);

  async function cloudSnapshot() {
    const tables: Record<string, unknown[]> = {};
    for (const t of SYNC_TABLES) tables[t] = (await cq(snapshotSelectSql(t))).map((r) => r.j);
    return { cursor: "100:100:", tables };
  }
  async function cloudRows(table: string, ids: number[]) {
    const m = new Map<number, unknown>();
    for (const r of await cq(fetchRowsSql(table), [ids])) m.set(r.id, r.j);
    return m;
  }

  // ── local schema ──
  const local = new PGlite();
  await local.waitReady;
  const lq = async (sql: string, params: any[] = []) => (await local.query<any>(sql, params)).rows;
  check("fresh DB: schema is built", (await ensureLocalSchema(local)).recreated === true);
  check("second call is a no-op (hash matches)", (await ensureLocalSchema(local)).recreated === false);
  check("local_meta + local_sessions exist", (await lq(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('local_meta','local_sessions')`)).length === 2);
  check("schema_hash stored", (await getMeta(local, "schema_hash")) === localSchemaHash());

  // ── snapshot apply ──
  const snap = await cloudSnapshot();
  check("cloud snapshot excludes the 30-day-old paid order", snap.tables.orders.length === 1);
  await applySnapshot(local, snap);
  check("cursor stored", (await getCursor(local)) === "100:100:");
  check("orders applied", (await lq(`SELECT order_number, notes, table_id FROM orders`)).map((r) => r.order_number + "/" + r.notes + "/" + r.table_id).join() === "ORD0001/extra spicy/1");
  check("order_items applied with fractional qty", (await lq(`SELECT quantity FROM order_items`))[0].quantity === 1.5);
  const mi = (await lq(`SELECT price, sizes, ingredients, inventory_links FROM menu_items`))[0];
  check("json + array + numeric columns round-trip", mi.price === "199.50" && mi.sizes[1].price === 299 && mi.ingredients.join() === "dough,cheese" && mi.inventory_links[0].quantity === 2.5, JSON.stringify(mi));
  const u = (await lq(`SELECT * FROM users`))[0];
  check("users row with password '' applies; pin/totp_secret are NULL", u.username === "boss" && u.password === "" && u.pin === null && u.totp_secret === null && u.totp_enabled === true);
  check("staff_members applies without pin", (await lq(`SELECT pin, designation FROM staff_members`))[0].pin === null);
  const o = (await lq(`SELECT created_at FROM orders`))[0].created_at;
  const cloudCreated = (await cq(`SELECT created_at FROM orders WHERE id = $1`, [oid]))[0].created_at;
  check("timestamp round-trips to the same instant", new Date(o).getTime() === new Date(cloudCreated).getTime(), `${o} vs ${cloudCreated}`);
  check("restaurant_settings json applies", (await lq(`SELECT settings FROM restaurant_settings`))[0].settings.billCounter === 7);
  const seqNext = (await lq(`INSERT INTO categories (name) VALUES ('Next') RETURNING id`))[0].id;
  check("serial sequence reset to max(id)+1", seqNext === 2, String(seqNext));
  await lq(`DELETE FROM categories WHERE id = 2`);
  check("only the 9 synced tables were touched (change_log/sync_devices empty locally)",
    (await lq(`SELECT count(*)::int AS n FROM change_log`))[0].n === 0 && (await lq(`SELECT count(*)::int AS n FROM sync_devices`))[0].n === 0);

  // re-snapshot replaces, not appends
  await applySnapshot(local, snap);
  check("re-applying a snapshot replaces (no duplicates)", (await lq(`SELECT count(*)::int AS n FROM orders`))[0].n === 1);

  // ── changes apply ──
  await cq(`UPDATE orders SET notes = 'less spicy', status = 'preparing' WHERE id = $1`, [oid]);
  const [{ id: o2 }] = await cq(`INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status) VALUES ('ORD0002','takeaway','50','0','pending','pending') RETURNING id`);
  const rows = await cloudRows("orders", [oid, o2]);
  const touched = await applyChanges(local, {
    cursor: "200:200:",
    changes: [
      { table: "orders", id: oid, row: rows.get(oid)! },
      { table: "orders", id: o2, row: rows.get(o2)! },
    ],
  });
  check("upsert of an existing row changes it", (await lq(`SELECT notes, status FROM orders WHERE id=$1`, [oid]))[0].notes === "less spicy");
  check("upsert inserts a new row", (await lq(`SELECT count(*)::int AS n FROM orders`))[0].n === 2);
  check("cursor advanced and touched tables reported", (await getCursor(local)) === "200:200:" && touched.join() === "orders");

  await applyChanges(local, { cursor: "300:300:", changes: [{ table: "orders", id: o2, row: null }, { table: "order_items", id: 99999, row: null }] });
  check("tombstone deletes (and a tombstone for a missing row is harmless)", (await lq(`SELECT count(*)::int AS n FROM orders WHERE id=$1`, [o2]))[0].n === 0);

  // a failing change rolls the whole apply back, cursor included
  let threw = false;
  try {
    await applyChanges(local, { cursor: "400:400:", changes: [{ table: "orders", id: oid, row: { ...(rows.get(oid) as any), notes: "SHOULD ROLL BACK" } }, { table: "orders", id: 5, row: { id: 5 } }] });
  } catch { threw = true; }
  check("a bad row rolls back the whole batch", threw && (await getCursor(local)) === "300:300:" && (await lq(`SELECT notes FROM orders WHERE id=$1`, [oid]))[0].notes === "less spicy");

  let refused = false;
  try { await applyChanges(local, { cursor: "x", changes: [{ table: "audit_logs", id: 1, row: null }] }); } catch { refused = true; }
  check("a non-synced table is refused", refused);

  // ── schema change handling ──
  await lq(`INSERT INTO local_sessions (sid, sess, expire) VALUES ('s1','{}'::jsonb, now())`);
  const changed = [...LOCAL_SCHEMA_STATEMENTS, `CREATE TABLE zz_probe (id serial primary key)`];
  const res = await ensureLocalSchema(local, changed);
  check("hash change drops and re-creates the public schema", res.recreated === true && (await lq(`SELECT count(*)::int AS n FROM orders`))[0].n === 0);
  check("cursor is gone after a rebuild, so a fresh snapshot runs", (await getCursor(local)) === null);
  check("local_meta and local_sessions are re-created", (await lq(`SELECT count(*)::int AS n FROM local_sessions`))[0].n === 0 && (await getMeta(local, "schema_hash")) === localSchemaHash(changed));
  await setMeta(local, "x", "1");
  await clearCursor(local);

  console.log(failures === 0 ? "\nAll local-apply checks passed" : `\n${failures} local-apply check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
