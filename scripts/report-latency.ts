/**
 * Latency report — "did the fix work, and where does the remaining slow time go?" Read-only.
 *
 *   npx tsx -r dotenv/config scripts/report-latency.ts                  last 14 days, by day
 *   npx tsx -r dotenv/config scripts/report-latency.ts --days 30
 *   npx tsx -r dotenv/config scripts/report-latency.ts --deployed 2026-11-02T10:00:00+05:30
 *                                                                      + a before/after comparison
 *
 * Sources (all already in the database):
 *  - Settle:   order.payment (every settle) vs perf.slow_settle (settles >= 4s, since 22 Oct 2026)
 *              → slow-settle RATE, the headline number to compare before/after.
 *  - Requests: perf.slow_request (any API request >= 4s or timed out, with server timing — from the
 *              latency-diagnostics release on) → count by cause: network / cold_start / server /
 *              timeout / unknown. Mostly "network" = the time is spent between the device and our
 *              code; "server" = our handler; "cold_start" = Vercel booting an instance.
 *  - Handlers: perf.slow_handler (server-side handler >= 1.5s).
 *  - Printing: print_jobs created → printed (the part after the server accepted the print).
 */
import pkg from "pg";
const { Pool } = pkg;

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const days = Number(arg("--days") ?? 14);
const deployed = arg("--deployed");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set (run with -r dotenv/config)"); process.exit(1); }
if (deployed && Number.isNaN(Date.parse(deployed))) { console.error("--deployed must be an ISO date/time"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const s = (ms: unknown) => (ms == null ? "–" : `${(Number(ms) / 1000).toFixed(1)}s`);

async function main() {
  await pool.query("SET default_transaction_read_only = on");
  const since = `now() - interval '${Math.max(1, Math.floor(days))} days'`;
  const day = `to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;

  const rows = await q(`
    with a as (select ${day} d, action, metadata::jsonb m from audit_logs
               where created_at > ${since} and action in ('order.payment','perf.slow_settle','perf.slow_request','perf.slow_handler'))
    select d,
      count(*) filter (where action='order.payment') settles,
      count(*) filter (where action='perf.slow_settle') slow_settles,
      percentile_cont(0.5) within group (order by (m->>'totalMs')::int) filter (where action='perf.slow_settle') slow_settle_p50,
      count(*) filter (where action='perf.slow_request') slow_req,
      count(*) filter (where action='perf.slow_request' and m->>'cause'='network') net,
      count(*) filter (where action='perf.slow_request' and m->>'cause'='cold_start') cold,
      count(*) filter (where action='perf.slow_request' and m->>'cause'='server') srv,
      count(*) filter (where action='perf.slow_request' and m->>'cause'='timeout') tmo,
      count(*) filter (where action='perf.slow_request' and (m->>'attempt')::int > 1) retried,
      count(*) filter (where action='perf.slow_handler') slow_handler
    from a group by d order by d`);
  const prints = await q(`
    select ${day} d, count(*) n,
      percentile_cont(0.5) within group (order by extract(epoch from printed_at-created_at)*1000) p50,
      percentile_cont(0.9) within group (order by extract(epoch from printed_at-created_at)*1000) p90
    from print_jobs where created_at > ${since} and printed_at is not null group by d`);
  const pByDay = new Map(prints.map((r: any) => [r.d, r]));

  console.log(`\nLatency by day (IST), last ${days} days`);
  console.log("date        settles  slow(>=4s)  rate  slow p50 | slow requests: total net cold srv tmo retried | slow handlers | print n  p50   p90");
  for (const r of rows as any[]) {
    const p: any = pByDay.get(r.d);
    console.log(
      `${r.d}  ${String(r.settles).padStart(7)}  ${String(r.slow_settles).padStart(10)}  ${pct(+r.slow_settles, +r.settles).padStart(4)}  ${s(r.slow_settle_p50).padStart(8)} |` +
      `${String(r.slow_req).padStart(20)} ${String(r.net).padStart(3)} ${String(r.cold).padStart(4)} ${String(r.srv).padStart(3)} ${String(r.tmo).padStart(3)} ${String(r.retried).padStart(7)} |` +
      `${String(r.slow_handler).padStart(14)} | ${String(p?.n ?? 0).padStart(7)} ${s(p?.p50).padStart(5)} ${s(p?.p90).padStart(5)}`,
    );
  }

  if (deployed) {
    const cmp = await q(`
      select (created_at >= $1::timestamptz) after,
        count(*) filter (where action='order.payment') settles,
        count(*) filter (where action='perf.slow_settle') slow,
        percentile_cont(0.5) within group (order by (metadata::jsonb->>'totalMs')::int) filter (where action='perf.slow_settle') p50
      from audit_logs where created_at > ${since} and action in ('order.payment','perf.slow_settle') group by 1 order by 1`, [deployed]);
    console.log(`\nBefore vs after ${deployed}`);
    for (const r of cmp as any[]) {
      console.log(`  ${r.after ? "after " : "before"}: ${r.settles} settles, ${r.slow} slow (${pct(+r.slow, +r.settles)}), slow median ${s(r.p50)}`);
    }
  }

  const recent = await q(`
    select to_char(created_at at time zone 'Asia/Kolkata','MM-DD HH24:MI') t, metadata::jsonb m from audit_logs
    where action='perf.slow_request' and created_at > ${since} order by created_at desc limit 15`);
  if (recent.length) {
    console.log("\nLatest slow requests (client time = server handler + cold start + everything else):");
    for (const { t, m } of recent as any[]) {
      const other = m.timedOut || m.appMs == null ? null : Math.max(0, m.clientMs - m.appMs - (m.coldMs ?? 0));
      console.log(`  ${t}  ${String(m.method).padEnd(4)} ${String(m.path).padEnd(34)} client ${s(m.clientMs).padStart(6)}  server ${m.appMs == null ? "  –  " : `${m.appMs}ms`.padStart(6)}  cold ${m.coldMs == null ? " – " : s(m.coldMs)}  other ${other == null ? "–" : s(other)}  → ${m.cause}${m.attempt > 1 ? " (retried)" : ""}  ${m.connection ?? ""}`);
    }
  } else {
    console.log("\nNo perf.slow_request rows yet (they start with the latency-diagnostics release).");
  }
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
