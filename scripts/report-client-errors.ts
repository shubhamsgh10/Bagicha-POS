/**
 * Read-only readout of client crash / error reports (`client.error` audit rows, written by
 * POST /api/client-errors — see shared/clientErrorReport.ts and client/src/lib/errorReporter.ts).
 *
 *   npx tsx -r dotenv/config scripts/report-client-errors.ts [--days 3] [--id <errorId>] [--limit 20]
 *
 * Prints each report with its stack, component, the last API requests and query errors before it.
 * One READ ONLY transaction (never a session-level SET — DATABASE_URL is the transaction pooler).
 */
import fs from "fs";
import pkg from "pg";
const { Pool } = pkg;

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const days = Math.max(1, Math.floor(Number(arg("--days") ?? 3)));
const limit = Math.max(1, Math.floor(Number(arg("--limit") ?? 20)));
const id = arg("--id");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set (run with -r dotenv/config)"); process.exit(1); }

const dbUrl = new URL(process.env.DATABASE_URL);
for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"]) dbUrl.searchParams.delete(k);
const ca = fs.readFileSync(new URL("../certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8");
const pool = new Pool({ connectionString: dbUrl.toString(), ssl: { ca, rejectUnauthorized: true }, max: 1 });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    // created_at is naive UTC: IST = + 5:30.
    const { rows } = await client.query(
      `select to_char(created_at + interval '5 hours 30 minutes', 'YYYY-MM-DD HH24:MI:SS') ist,
              actor_name, ip, metadata::jsonb m
         from audit_logs
        where action = 'client.error'
          and created_at > now() - make_interval(days => $1)
          and ($2::text is null or entity_id = $2)
        order by created_at desc
        limit $3`,
      [days, id ?? null, limit],
    );
    await client.query("COMMIT");
    if (!rows.length) { console.log(`No client.error reports in the last ${days} day(s).`); return; }
    for (const r of rows.reverse()) {
      const m = r.m ?? {};
      console.log("=".repeat(100));
      console.log(`${r.ist} IST  ${m.errorId}  ${m.kind}  ${m.electron ? `desktop ${m.appVersion ?? "?"}` : "browser"}  actor=${r.actor_name} ip=${r.ip}`);
      console.log(`${m.name ?? "Error"}: ${m.message}`);
      console.log(`route=${m.route} signedIn=${m.signedIn} online=${m.online} hidden=${m.hidden} uptime=${m.uptimeS}s persisted=${m.persisted}` +
        `${m.repeats ? ` repeats=${m.repeats}` : ""}${m.delayed ? " (sent later)" : ""}`);
      if (m.stack) console.log(`--- stack\n${String(m.stack).split("\n").slice(0, 12).join("\n")}`);
      if (m.componentStack) console.log(`--- component\n${String(m.componentStack).trim().split("\n").slice(0, 8).join("\n")}`);
      if (Array.isArray(m.requests) && m.requests.length) {
        console.log("--- last requests (oldest first)");
        for (const q of m.requests) console.log(`  -${q.ago}s  ${q.m} ${q.p} → ${q.s ?? (q.to ? "timeout" : q.f ? "network failure" : "?")} ${q.ms}ms`);
      }
      if (Array.isArray(m.queryErrors) && m.queryErrors.length) {
        console.log("--- query errors");
        for (const q of m.queryErrors) console.log(`  -${q.ago}s  ${q.key}: ${q.msg}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
