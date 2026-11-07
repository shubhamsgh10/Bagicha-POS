/**
 * One-off: apply the owner's Nov 2026 price list to menu_items (the shared production DB).
 * Spec: docs/superpowers/specs/2026-11-07-menu-price-revision-design.md
 *
 *   npx tsx scripts/apply-menu-prices-2026-11.ts             # dry run: prints the diff, writes nothing
 *   npx tsx scripts/apply-menu-prices-2026-11.ts --confirm   # backup → one transaction → MENU_UPDATE
 *   ... --confirm --allow-open                               # even while orders are open (see below)
 *
 * Refuses while any order is open (unpaid pending/preparing/ready/hold): priceOrder pulls a line
 * below the menu floor up to it, so a running table re-saved after the change would be re-billed
 * at the new price mid-meal, and a price cut would not reach lines already on an open order.
 *
 * Re-running after a successful run is a no-op (renames and new dishes are recognised).
 * One connection, BEGIN/COMMIT only — never a session SET (DATABASE_URL is the transaction pooler).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";
import { dbSslConfig, stripSslParams } from "../server/dbSsl";
import { createRealtimePublisher } from "../server/realtime/publisher";
import { planMenuPrices, formatChange, type Change, type MenuRow, type CategoryRow, type Plan } from "./lib/menuPricePlan";
import { TARGETS } from "./data/menu-prices-2026-11";

const args = new Set(process.argv.slice(2));
const CONFIRM = args.has("--confirm");
const ALLOW_OPEN = args.has("--allow-open");

const OPEN_ORDERS_SQL = `SELECT count(*)::int AS n FROM orders
  WHERE payment_status = 'pending' AND status IN ('pending','preparing','ready','hold')`;

function makePool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Verify the server certificate: DATABASE_CA_CERT if set, else the Supabase root CA in certs/.
  const caFile = path.resolve("certs", "supabase-prod-ca-2021.crt");
  const env = process.env.DATABASE_CA_CERT ? process.env : { DATABASE_CA_CERT: fs.readFileSync(caFile, "utf8") };
  const ssl = dbSslConfig(env);
  if (ssl.mode !== "verified") throw new Error(`DB TLS not verified (${ssl.mode})`);
  return new pg.Pool({ connectionString: stripSslParams(url), ssl: ssl.ssl, max: 1, connectionTimeoutMillis: 15_000 });
}

async function readState(c: pg.PoolClient, forUpdate: boolean) {
  const cats = (await c.query<CategoryRow>("SELECT id, name FROM categories ORDER BY id")).rows;
  const menu = (await c.query<MenuRow>(
    `SELECT id, name, price, category_id, is_deleted, sizes FROM menu_items ORDER BY id${forUpdate ? " FOR UPDATE" : ""}`,
  )).rows;
  const open = (await c.query<{ n: number }>(OPEN_ORDERS_SQL)).rows[0].n;
  return { cats, menu, open };
}

function printPlan(plan: Plan, open: number) {
  const updates = plan.changes.filter((c): c is Extract<Change, { op: "update" }> => c.op === "update");
  const inserts = plan.changes.filter((c) => c.op === "insert");
  const up = updates.filter((c) => !c.toSizes && c.toPrice > c.fromPrice);
  const down = updates.filter((c) => !c.toSizes && c.toPrice < c.fromPrice);
  const renameOnly = updates.filter((c) => !c.toSizes && c.toPrice === c.fromPrice);
  const sized = updates.filter((c) => c.toSizes);
  const section = (title: string, list: Change[]) => {
    if (!list.length) return;
    console.log(`\n${title} (${list.length})`);
    for (const c of list) console.log("  " + formatChange(c));
  };
  section("PRICE UP", up);
  section("PRICE DOWN", down);
  section("PIZZA SIZES", sized);
  section("RENAME ONLY", renameOnly);
  section("NEW DISHES", inserts);
  if (plan.alreadyPresent.length) console.log(`\nNew dishes already on the menu (skipped): ${plan.alreadyPresent.join(", ")}`);
  console.log(`\nSummary: ${updates.length} updates (${up.length} up, ${down.length} down, ${sized.length} pizzas, ${renameOnly.length} rename-only), ` +
    `${inserts.length} new, ${plan.unchanged.length} already at the PDF price, ${plan.errors.length} errors. Open orders now: ${open}.`);
  if (plan.errors.length) {
    console.log("\nERRORS — nothing will be written:");
    for (const e of plan.errors) console.log("  " + e);
  }
}

async function main() {
  const pool = makePool();
  const c = await pool.connect();
  try {
    // 1. Dry plan (read-only).
    await c.query("BEGIN TRANSACTION READ ONLY");
    const before = await readState(c, false);
    await c.query("COMMIT");
    const plan = planMenuPrices(before.menu, before.cats, TARGETS);
    printPlan(plan, before.open);
    if (plan.errors.length) { process.exitCode = 1; return; }
    if (!CONFIRM) { console.log("\nDry run — nothing written. Re-run with --confirm to apply."); return; }
    if (plan.changes.length === 0) { console.log("\nNothing to change."); return; }
    if (before.open > 0 && !ALLOW_OPEN) {
      console.log(`\nREFUSED: ${before.open} order(s) open. Settle/close them first (or pass --allow-open).`);
      process.exitCode = 2; return;
    }

    // 2. Snapshot what we are about to change.
    const snapshot = {
      takenAt: new Date().toISOString(),
      categories: (await c.query("SELECT * FROM categories ORDER BY id")).rows,
      menu_items: (await c.query("SELECT * FROM menu_items ORDER BY id")).rows,
    };
    fs.mkdirSync("backups", { recursive: true });
    const backupFile = path.join("backups", `menu-before-prices-${snapshot.takenAt.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(snapshot, null, 2));
    console.log(`\nBackup: ${backupFile} (${snapshot.menu_items.length} menu rows)`);

    // 3. One transaction: lock, re-plan (must equal the dry plan), write with guarded statements.
    await c.query("BEGIN");
    const inserted: Array<{ id: number; name: string }> = [];
    try {
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SET LOCAL statement_timeout = '30s'");
      const locked = await readState(c, true);
      if (locked.open > 0 && !ALLOW_OPEN) throw new Error(`${locked.open} order(s) opened meanwhile — aborted`);
      const plan2 = planMenuPrices(locked.menu, locked.cats, TARGETS);
      if (plan2.errors.length || JSON.stringify(plan2.changes) !== JSON.stringify(plan.changes)) {
        throw new Error("menu changed since the dry run — aborted, re-run to see the new diff");
      }
      for (const ch of plan2.changes) {
        if (ch.op === "update") {
          const r = await c.query(
            `UPDATE menu_items
                SET price = $3,
                    name  = COALESCE($4, name),
                    sizes = COALESCE($5::json, sizes)
              WHERE id = $1 AND name = $2 AND is_deleted = false`,
            [ch.id, ch.name, ch.toPrice.toFixed(2), ch.newName ?? null, ch.toSizes ? JSON.stringify(ch.toSizes) : null],
          );
          if (r.rowCount !== 1) throw new Error(`update of #${ch.id} "${ch.name}" touched ${r.rowCount} rows`);
        } else {
          const r = await c.query<{ id: number }>(
            "INSERT INTO menu_items (name, price, category_id) VALUES ($1, $2, $3) RETURNING id",
            [ch.name, ch.price.toFixed(2), ch.categoryId],
          );
          inserted.push({ id: r.rows[0].id, name: ch.name });
        }
      }
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    }
    console.log(`\nCOMMITTED: ${plan.changes.length - inserted.length} updates, ${inserted.length} new dishes.`);
    for (const i of inserted) console.log(`  new #${i.id} ${i.name}`);

    // 4. Read back: the same plan must now be a no-op.
    await c.query("BEGIN TRANSACTION READ ONLY");
    const after = await readState(c, false);
    await c.query("COMMIT");
    const check = planMenuPrices(after.menu, after.cats, TARGETS);
    const ok = check.errors.length === 0 && check.changes.length === 0 && check.alreadyPresent.length === inserted.length;
    console.log(`Read-back: ${check.changes.length} changes left, ${check.errors.length} errors, ${check.alreadyPresent.length} new dishes present → ${ok ? "OK" : "MISMATCH"}`);
    if (!ok) process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }

  // 5. Tell open POS screens to refetch the menu (same event Admin → Menu sends). Non-fatal.
  if (CONFIRM && process.exitCode == null) {
    try {
      const pub = await createRealtimePublisher();
      await pub.publish({ type: "MENU_UPDATE" });
      console.log("Sent MENU_UPDATE to open screens.");
    } catch (err) {
      console.warn("MENU_UPDATE not sent (screens pick the new menu up on reload):", err);
    }
  }
}

main().catch((err) => { console.error("FAILED:", err instanceof Error ? err.message : err); process.exitCode = 1; });
