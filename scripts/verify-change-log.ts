// PGlite in-memory proof of the change_log SQL (trigger capture, snapshot-cursor pull, secret strip,
// rollback). Never loads dotenv: the production DATABASE_URL must not be reachable from here.
import { PGlite } from "@electric-sql/pglite";
import { schemaStatements } from "./lib/pgliteSchema";
import {
  migrationStatements, ROLLBACK_SQL, PULL_SQL, CURRENT_SNAPSHOT_SQL, snapshotSelectSql,
  fetchRowsSql, rowJsonSql, collapseChanges,
} from "../server/sync/changeLogSql";
import { SYNC_TABLES } from "../shared/syncTables";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const db = new PGlite();
  await db.waitReady;
  for (const s of await schemaStatements()) await db.exec(s);
  for (const s of migrationStatements()) await db.exec(s);
  let again = true;
  try { for (const s of migrationStatements()) await db.exec(s); } catch (e: any) { again = false; console.log(e.message); }
  check("migration statements are idempotent", again);

  const q = async (sql: string, params: any[] = []) => (await db.query<any>(sql, params)).rows;
  const log = async () => q(`SELECT table_name, row_id, op FROM change_log ORDER BY seq`);
  const mkOrder = (n: string) => q(
    `INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status) VALUES ($1,'takeaway','100','0','pending','pending') RETURNING id`, [n]);

  // trigger capture
  const [{ id: aId }] = await mkOrder("ZZ-A");
  await q(`UPDATE orders SET notes = 'x' WHERE id = $1`, [aId]);
  await q(`DELETE FROM orders WHERE id = $1`, [aId]);
  const l1 = await log();
  check("insert/update/delete on orders add I/U/D rows",
    l1.length === 3 && l1.map((r) => r.op).join("") === "IUD" && l1.every((r) => r.table_name === "orders" && r.row_id === String(aId)), JSON.stringify(l1));

  await q(`DELETE FROM change_log`);
  await q(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type) VALUES ('1','a','admin','x','y')`);
  check("write to a non-synced table adds nothing", (await log()).length === 0);

  let trigOk = true;
  for (const t of SYNC_TABLES) {
    const tr = await q(`SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid WHERE c.relname = $1 AND tg.tgname = 'change_log_capture'`, [t]);
    if (tr.length !== 1) { trigOk = false; console.log("missing trigger on", t); }
  }
  check("all 9 synced tables have the trigger", trigOk);

  // snapshot-cursor pull
  await q(`DELETE FROM change_log`);
  const pull = async (prev: string, cur: string) => collapseChanges(await q(PULL_SQL, [prev, cur]));
  const s0 = (await q(CURRENT_SNAPSHOT_SQL))[0].snap;
  const [{ id: bId }] = await mkOrder("ZZ-B");
  const s1 = (await q(CURRENT_SNAPSHOT_SQL))[0].snap;
  const p1 = await pull(s0, s1);
  check("pull(s0,s1) returns the new order", p1.length === 1 && p1[0].table === "orders" && p1[0].id === bId && p1[0].op === "I", JSON.stringify(p1));
  check("pull(s1,s1) returns nothing", (await pull(s1, s1)).length === 0);

  // Out-of-order commit: txid 11 got the lower seq but was still in progress at the previous
  // snapshot; txid 10 committed earlier. A bare seq cursor would have skipped 11's row.
  await q(`DELETE FROM change_log`);
  await q(`INSERT INTO change_log (txid, table_name, row_id, op) VALUES ('11','menu_items','5','U')`);
  await q(`INSERT INTO change_log (txid, table_name, row_id, op) VALUES ('10','menu_items','6','U')`);
  const prev = "10:12:11"; // 10 visible, 11 in progress
  const cur = "10:12:";    // 11 has now committed
  const early = await pull(prev, prev);
  check("nothing returned while the same snapshot repeats", early.length === 0, JSON.stringify(early));
  const late = await pull(prev, cur);
  check("tx that committed after a later seq is returned next pull", late.length === 1 && late[0].id === 5, JSON.stringify(late));
  check("and not returned again", (await pull(cur, cur)).length === 0);

  const col = collapseChanges([
    { seq: 1, table_name: "orders", row_id: "1", op: "I" }, { seq: 2, table_name: "orders", row_id: "1", op: "U" },
    { seq: 3, table_name: "orders", row_id: "2", op: "D" },
  ]);
  check("collapse keeps last op per row", col.length === 2 && col[0].op === "U" && col[1].op === "D");

  // secret strip
  await q(`INSERT INTO users (username, password, role, pin, totp_secret) VALUES ('zz','hunter2','staff','1234','TOTPSECRET')`);
  await q(`INSERT INTO staff_members (name, pin) VALUES ('Sam','9876')`);
  const u = (await q(`SELECT ${rowJsonSql("users")} AS j FROM users t WHERE username='zz'`))[0].j;
  check("users row has no pin / totp_secret keys", !("pin" in u) && !("totp_secret" in u));
  check("users password is blanked, not leaked", u.password === "" && !JSON.stringify(u).includes("hunter2"));
  const smId = (await q(`SELECT id FROM staff_members WHERE name='Sam'`))[0].id;
  const sm = (await q(fetchRowsSql("staff_members"), [[smId]]))[0].j;
  check("staff_members row has no pin key", !("pin" in sm) && sm.name === "Sam");
  const uid = (await q(`SELECT id FROM users WHERE username='zz'`))[0].id;
  const uRows = await q(fetchRowsSql("users"), [[uid]]);
  check("fetchRowsSql(users) strips secrets", uRows.length === 1 && !("totp_secret" in uRows[0].j) && uRows[0].j.password === "");

  // attendance device token / comm key inside restaurant_settings never leave the server
  await q(`DELETE FROM restaurant_settings`);
  await q(`INSERT INTO restaurant_settings (id, settings) VALUES (1, $1::json)`,
    [JSON.stringify({ taxRate: 5, attendanceDevice: { enabled: true, ip: "10.0.0.5", token: "DEVTOKENSECRET", commKey: 4321 } })]);
  const rsRow = (await q(fetchRowsSql("restaurant_settings"), [[1]]))[0].j;
  check("settings attendance token blanked", rsRow.settings.attendanceDevice.token === "" && !JSON.stringify(rsRow).includes("DEVTOKENSECRET"));
  check("settings comm key blanked", rsRow.settings.attendanceDevice.commKey === 0 && !JSON.stringify(rsRow).includes("4321"));
  check("other settings untouched", rsRow.settings.taxRate === 5 && rsRow.settings.attendanceDevice.ip === "10.0.0.5");
  await q(`UPDATE restaurant_settings SET settings = $1::json WHERE id = 1`, [JSON.stringify({ taxRate: 5 })]);
  const rsNoDevice = (await q(fetchRowsSql("restaurant_settings"), [[1]]))[0].j;
  check("settings without attendanceDevice unchanged", rsNoDevice.settings.taxRate === 5 && !("attendanceDevice" in rsNoDevice.settings));

  // snapshot selectors
  await q(`DELETE FROM orders`); await q(`DELETE FROM order_items`); await q(`DELETE FROM kot_tickets`);
  const old = `now() - interval '10 days'`;
  const ins = async (n: string, status: string, pay: string, created: string) => (await q(
    `INSERT INTO orders (order_number, order_type, total_amount, tax_amount, status, payment_status, created_at) VALUES ($1,'takeaway','1','0',$2,$3,${created}) RETURNING id`, [n, status, pay]))[0].id;
  const recentPaid = await ins("S1", "served", "paid", "now()");
  const oldPaid = await ins("S2", "served", "paid", old);
  const oldOpen = await ins("S3", "preparing", "pending", old);
  const oldCancelled = await ins("S4", "cancelled", "pending", old);
  for (const oid of [recentPaid, oldPaid, oldOpen, oldCancelled]) {
    await q(`INSERT INTO order_items (order_id, menu_item_id, quantity, price) VALUES ($1, 1, 1, '1')`, [oid]);
    await q(`INSERT INTO kot_tickets (order_id, kot_number, items) VALUES ($1, $2, '[]')`, [oid, `K${oid}`]);
  }
  const want = JSON.stringify([recentPaid, oldOpen].sort((a, b) => a - b));
  const snapIds = (await q(snapshotSelectSql("orders"))).map((r) => r.j.id).sort((a: number, b: number) => a - b);
  check("snapshot orders = recent + old-but-open (not old paid / old cancelled)", JSON.stringify(snapIds) === want, JSON.stringify(snapIds));
  const itemOrders = (await q(snapshotSelectSql("order_items"))).map((r) => r.j.order_id).sort((a: number, b: number) => a - b);
  check("snapshot order_items only for selected orders", JSON.stringify(itemOrders) === want);
  const kotOrders = (await q(snapshotSelectSql("kot_tickets"))).map((r) => r.j.order_id).sort((a: number, b: number) => a - b);
  check("snapshot kot_tickets only for selected orders", JSON.stringify(kotOrders) === want);
  let allOk = true;
  for (const t of SYNC_TABLES) { try { await q(snapshotSelectSql(t)); } catch (e: any) { allOk = false; console.log(t, e.message); } }
  check("snapshot SQL runs for all 9 tables", allOk);

  let txOk = true;
  try {
    await db.exec("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await q(CURRENT_SNAPSHOT_SQL); await q(snapshotSelectSql("orders"));
    await db.exec("COMMIT");
  } catch (e: any) { txOk = false; console.log(e.message); await db.exec("ROLLBACK").catch(() => {}); }
  check("snapshot transaction runs read-only", txOk);

  // rollback
  for (const s of ROLLBACK_SQL) await db.exec(s);
  const left = await q(`SELECT (SELECT count(*) FROM pg_trigger WHERE tgname='change_log_capture') AS trg, to_regclass('change_log') AS cl, to_regclass('sync_devices') AS sd, (SELECT count(*) FROM pg_proc WHERE proname='change_log_capture') AS fn`);
  check("rollback leaves no triggers, function or tables",
    Number(left[0].trg) === 0 && left[0].cl === null && left[0].sd === null && Number(left[0].fn) === 0, JSON.stringify(left[0]));

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
