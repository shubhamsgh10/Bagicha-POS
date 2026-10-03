/**
 * Stage probe — times the building blocks of the print call in isolation so each stage's SHARE
 * of the total is known. Read-only except one INSERT per iteration inside a transaction that is
 * ROLLED BACK; Pusher events go to a throwaway channel nobody subscribes to.
 * NOTE: run from a dev machine this measures THAT machine's RTT to Neon/Pusher, not Vercel bom1's —
 * use it for ratios; absolute production numbers come from the Server-Timing header (Task 2).
 * Manual-only (not in test:pure).
 * Run: npx tsx scripts/probe-print-stages.ts [--iterations 20]
 */
import "dotenv/config";
import PusherServer from "pusher";
import { pool } from "../server/db";

const argv = process.argv.slice(2);
const iterations = (() => {
  const i = argv.indexOf("--iterations");
  return i >= 0 && argv[i + 1] ? parseInt(argv[i + 1], 10) : 20;
})();

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

async function sample(name: string, fn: () => Promise<unknown>) {
  await fn(); // warm-up, discarded
  const vals: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    vals.push(performance.now() - t0);
  }
  vals.sort((a, b) => a - b);
  return { stage: name, n: vals.length, p50: +pct(vals, 50).toFixed(1), p95: +pct(vals, 95).toFixed(1), max: +vals[vals.length - 1].toFixed(1) };
}

async function main() {
  const rows: Array<Record<string, unknown>> = [];

  const latest = await pool.query("SELECT id FROM orders ORDER BY id DESC LIMIT 1");
  const orderId: number | undefined = latest.rows[0]?.id;
  if (!orderId) throw new Error("no orders in the DB to probe against");

  rows.push(await sample("neon: SELECT 1 (RTT floor)", () => pool.query("SELECT 1")));
  rows.push(await sample("db_order: orders by id", () => pool.query("SELECT * FROM orders WHERE id = $1", [orderId])));
  rows.push(
    await sample("db_items: order_items ⟕ menu_items", () =>
      pool.query(
        `SELECT oi.menu_item_id, mi.category_id, coalesce(oi.name, mi.name, 'Item') AS name, oi.quantity, oi.size,
                oi.special_instructions, oi.service_mode
           FROM order_items oi LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
          WHERE oi.order_id = $1`,
        [orderId],
      ),
    ),
  );
  rows.push(
    await sample("db_tickets: kot_tickets by order", () =>
      pool.query("SELECT * FROM kot_tickets WHERE order_id = $1 ORDER BY id ASC", [orderId]),
    ),
  );

  // print_jobs INSERT, always rolled back — one row (≈3 KB base64 payload) and a 2-row variant.
  // There is deliberately NO COMMIT anywhere in this file. On any error the transaction is rolled
  // back and the client is released with the error so pg discards the connection.
  const payload = Buffer.alloc(2200, 7).toString("base64");
  const timedRolledBackInsert = async (sql: string): Promise<number> => {
    const c = await pool.connect();
    let failure: Error | undefined;
    try {
      await c.query("BEGIN");
      const t0 = performance.now();
      await c.query(sql, [orderId, payload]);
      const ms = performance.now() - t0;
      await c.query("ROLLBACK");
      return ms;
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e));
      try {
        await c.query("ROLLBACK");
      } catch {
        /* connection is discarded below */
      }
      throw e;
    } finally {
      c.release(failure);
    }
  };
  const insertOne = () =>
    timedRolledBackInsert("INSERT INTO print_jobs (order_id, job_type, printer_id, payload) VALUES ($1,'kot','probe-1',$2)");
  const insertTwo = () =>
    timedRolledBackInsert(
      "INSERT INTO print_jobs (order_id, job_type, printer_id, payload) VALUES ($1,'kot','probe-1',$2),($1,'kot','probe-2',$2)",
    );
  for (const [name, fn] of [["insert_job: 1 row (rolled back)", insertOne], ["insert_job: 2 rows, one statement (rolled back)", insertTwo]] as const) {
    await fn();
    const vals: number[] = [];
    for (let i = 0; i < iterations; i++) vals.push(await fn());
    vals.sort((a, b) => a - b);
    rows.push({ stage: name, n: vals.length, p50: +pct(vals, 50).toFixed(1), p95: +pct(vals, 95).toFixed(1), max: +vals[vals.length - 1].toFixed(1) });
  }

  const { PUSHER_APP_ID: appId, PUSHER_KEY: key, PUSHER_SECRET: secret } = process.env;
  if (appId && key && secret) {
    const pusher = new PusherServer({ appId, key, secret, cluster: process.env.PUSHER_CLUSTER || "ap2", useTLS: true });
    // Throwaway channel: random suffix, NEVER the restaurant's PUSHER_CHANNEL.
    const channel = `private-bagicha-probe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const data = { jobId: 0, orderId, jobType: "kot", printerId: "probe-1", payload };
    rows.push(await sample("pusher: trigger ×1", () => pusher.trigger(channel, "PRINT_JOB", data)));
    rows.push(
      await sample("pusher: trigger ×2 sequential (today's multi-printer cost)", async () => {
        await pusher.trigger(channel, "PRINT_JOB", data);
        await pusher.trigger(channel, "PRINT_JOB", data);
      }),
    );
    rows.push(
      await sample("pusher: triggerBatch ×2 (one call)", () =>
        pusher.triggerBatch([
          { channel, name: "PRINT_JOB", data },
          { channel, name: "PRINT_JOB", data },
        ]),
      ),
    );
  } else {
    console.warn("⚠ PUSHER_* not set — Pusher stages skipped");
  }

  console.log(`\n== stage probe (${iterations} iterations, ms) ==`);
  console.table(rows);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
