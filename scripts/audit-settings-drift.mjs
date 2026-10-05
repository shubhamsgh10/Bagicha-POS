/**
 * READ-ONLY audit: did any server instance ever run on fallback settings (18% tax / no printers)?
 *
 * Background (CLAUDE.md → "Settings must be DB-live"): a cold instance whose one-shot settings
 * read failed used to serve DEFAULT_SETTINGS indefinitely — orders saved on it were priced at 18%
 * instead of the configured 5%, and its bills/KOTs found "no printer" and bounced to a browser
 * print window. server/settingsCache.ts + settingsGuard now make that impossible; run this after
 * a few service days on the fixed build and expect NO events dated after the deploy.
 *
 * It never writes. Three signals, each with the date of the latest hit:
 *   1. Orders currently STORED at the default 18% tax (when the configured rate is something else).
 *   2. Item-edit saves whose total jumped by exactly the 5% ↔ 18% ratio with no item change
 *      (an instance on defaults priced it, or a healthy one corrected it).
 *   3. Bill prints that went to the browser instead of a printer, and KOT sends that were
 *      committed without a kitchen print_job. Only meaningful for the Vercel + USB-printer setup,
 *      where every printer-bound print writes a print_jobs row.
 *
 * Run: node scripts/audit-settings-drift.mjs [--days 14]
 */
import "dotenv/config";
import fs from "node:fs";
import pkg from "pg";

const { Pool } = pkg;
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Math.max(1, parseInt(process.argv[daysArg + 1], 10) || 14) : 14;
const DEFAULT_RATE = 0.18;

// TLS. Set PGSSLROOTCERT=<path to the Supabase CA .crt> (Supabase dashboard → Database → SSL) and the
// server certificate is VERIFIED. Without it this falls back to unverified TLS, exactly like
// server/db.ts and scripts/migrate-*.mjs: the Supabase pooler's chain isn't in Node's trust store
// (verification fails with SELF_SIGNED_CERT_IN_CHAIN), so verifying by default would just break the
// script. Unverified means a man-in-the-middle on your network could read the DB password — hence the warning.
const caPath = process.env.PGSSLROOTCERT;
const ssl = caPath ? { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: false };
if (!caPath) console.warn("! DB TLS certificate is NOT being verified (set PGSSLROOTCERT to a Supabase CA file to verify it).\n");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, connectionTimeoutMillis: 15_000 });
const fmt = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—");

try {
  const s = await pool.query(`SELECT (settings->>'taxRate')::numeric AS tax FROM restaurant_settings WHERE id = 1`);
  const configured = Number(s.rows[0]?.tax);
  console.log(`Configured tax rate: ${configured}%   |   window: last ${DAYS} days\n`);

  // 1. Orders stored at 18% while the configured rate is different.
  if (Math.abs(configured / 100 - DEFAULT_RATE) > 0.005) {
    const r = await pool.query(
      `SELECT id, order_number, created_at, total_amount FROM orders
        WHERE created_at > now() - ($1 || ' days')::interval AND status <> 'cancelled'
          AND subtotal_amount - discount_amount > 0
          AND abs(tax_amount / (subtotal_amount - discount_amount) - $2) < 0.005
        ORDER BY created_at`,
      [String(DAYS), DEFAULT_RATE],
    );
    console.log(`1. Orders stored at the default 18% tax: ${r.rowCount}`);
    for (const x of r.rows) console.log(`     #${x.id} ${x.order_number}  ${fmt(x.created_at)}  total ${x.total_amount}`);
  } else {
    console.log("1. Skipped — the configured tax rate IS 18%, so this signal is meaningless.");
  }

  // 2. Total flips by exactly 1.18/1.05 with no item change.
  const a = await pool.query(
    `SELECT entity_id, created_at, metadata FROM audit_logs
      WHERE action = 'order.items_edit' AND created_at > now() - ($1 || ' days')::interval ORDER BY created_at`,
    [String(DAYS)],
  );
  const ratio = (1 + DEFAULT_RATE) / (1 + configured / 100);
  const flips = a.rows.filter((x) => {
    const m = x.metadata || {};
    const noItemChange = !(m.added?.length || m.removed?.length || m.changed?.length);
    const b = Number(m.totalBefore), t = Number(m.totalAfter);
    if (!noItemChange || !b || !t) return false;
    return Math.abs(t / b - ratio) < 0.003 || Math.abs(b / t - ratio) < 0.003;
  });
  console.log(`\n2. Saves whose total moved by exactly the ${configured}% <-> 18% ratio with no item change: ${flips.length}`);
  for (const x of flips) console.log(`     order ${x.entity_id}  ${fmt(x.created_at)}  ${x.metadata.totalBefore} -> ${x.metadata.totalAfter}`);

  // 3a. Bills that did not produce a print job.
  const b = await pool.query(
    `WITH bj AS (SELECT order_id, count(*) n FROM print_jobs WHERE job_type = 'bill' GROUP BY order_id)
     SELECT o.id, o.order_number, o.created_at, o.bill_print_count, coalesce(bj.n, 0) AS jobs
       FROM orders o LEFT JOIN bj ON bj.order_id = o.id
      WHERE o.created_at > now() - ($1 || ' days')::interval AND o.bill_print_count > coalesce(bj.n, 0)
      ORDER BY o.created_at`,
    [String(DAYS)],
  );
  console.log(`\n3a. Orders with more bill prints than bill print_jobs (browser-fallback bills): ${b.rowCount}`);
  for (const x of b.rows) console.log(`     #${x.id} ${x.order_number}  ${fmt(x.created_at)}  bill prints ${x.bill_print_count}, jobs ${x.jobs}`);

  // 3b. KOT sends committed without a kitchen print job.
  const k = await pool.query(
    `WITH kj AS (SELECT order_id, count(DISTINCT date_trunc('second', created_at)) taps FROM print_jobs WHERE job_type = 'kot' GROUP BY order_id)
     SELECT o.id, o.order_number, o.created_at, o.kot_print_count, coalesce(kj.taps, 0) AS taps
       FROM orders o LEFT JOIN kj ON kj.order_id = o.id
      WHERE o.created_at > now() - ($1 || ' days')::interval AND o.status <> 'cancelled' AND o.kot_print_count > coalesce(kj.taps, 0)
      ORDER BY o.created_at`,
    [String(DAYS)],
  );
  console.log(`\n3b. Orders with more committed KOT sends than kitchen print_jobs: ${k.rowCount}`);
  for (const x of k.rows) console.log(`     #${x.id} ${x.order_number}  ${fmt(x.created_at)}  KOT commits ${x.kot_print_count}, job taps ${x.taps}`);

  console.log("\nDone (read-only). After the fix is deployed, expect no rows dated after the deploy time.");
} catch (e) {
  console.error("AUDIT ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
