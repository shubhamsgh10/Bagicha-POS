/**
 * Catch-up sync after scripts/copy-db-to-new-project.sh: copies rows that changed on the OLD project
 * after the dump into the NEW project, without clobbering anything production has since written to
 * the new one. Run it after every app/host has been switched to the new DATABASE_URL (so the old
 * project is no longer receiving writes). Dry-run by default; `--apply` writes, in one transaction.
 *
 *   node scripts/sync-db-delta.mjs --dump backups/supabase-public-<ts>.dump [--apply]
 *
 * URLs: OLD = `# OLD_DATABASE_URL="…"` comment in .env (or OLD_DATABASE_URL env), NEW = DATABASE_URL.
 *
 * Rules, per table (all 40 public tables; there are no foreign keys):
 *  - The dump's sequence values are the BASELINE: an integer id at or below it existed when the dump
 *    was taken; above it, the row was created afterwards on whichever side holds it.
 *  - Row only in OLD → insert into NEW (unless that id is above baseline AND already used in NEW:
 *    both sides created the same id → CONFLICT, reported, nothing written).
 *  - Row in both, content differs → take OLD's version, except when NEW's updated_at is newer
 *    (edited on the new project after the switch) or the id is above baseline (independent rows that
 *    collided) → CONFLICT.
 *  - Row only in NEW with id ≤ baseline → it existed at dump time and was deleted on OLD since →
 *    delete from NEW (e.g. order_items replaced by an order edit). Above baseline → created on NEW → keep.
 *    Non-integer keys (sessions, customers_master uuid) are never deleted.
 *  - Afterwards every sequence in NEW is set to max(old, new) so new inserts can't reuse an id.
 * Any CONFLICT aborts --apply; resolve by hand.
 */
import 'dotenv/config';
import fs from 'fs';
import { execFileSync } from 'child_process';
import pkg from 'pg';
const { Pool } = pkg;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dumpPath = args[args.indexOf('--dump') + 1];
if (!args.includes('--dump') || !dumpPath || !fs.existsSync(dumpPath)) { console.error('--dump <file> required'); process.exit(1); }

const envFile = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const OLD = process.env.OLD_DATABASE_URL || envFile.match(/^# OLD_DATABASE_URL="?([^"\n]+)"?/m)?.[1];
const NEW = process.env.DATABASE_URL;
if (!OLD || !NEW || OLD === NEW) { console.error('Need distinct OLD_DATABASE_URL and DATABASE_URL'); process.exit(1); }

// Baseline sequence values from the dump: setval('public.<seq>', <n>, true)
const baseline = new Map();
for (const m of execFileSync('pg_restore', ['-f', '-', dumpPath], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .matchAll(/setval\('public\.([a-z0-9_]+)', (\d+), (true|false)\)/g)) baseline.set(m[1], Number(m[2]));

const mk = (u) => new Pool({ connectionString: u, ssl: { rejectUnauthorized: false }, max: 2 });
const oldDb = mk(OLD), newDb = mk(NEW);

const tables = (await oldDb.query(`select tablename from pg_tables where schemaname='public' order by 1`)).rows.map(r => r.tablename);
const plan = []; const conflicts = [];

for (const t of tables) {
  const meta = (await oldDb.query(`
    select a.attname, format_type(a.atttypid, a.atttypmod) typ,
           pg_get_serial_sequence('public.' || quote_ident($1), a.attname) seq
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = ('public.' || quote_ident($1))::regclass and i.indisprimary`, [t])).rows[0];
  const key = meta.attname;
  const intKey = meta.typ === 'integer';
  const base = meta.seq ? baseline.get(meta.seq.replace(/^public\./, '').replace(/"/g, '')) : undefined;
  const hasUpdated = (await oldDb.query(`select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='updated_at'`, [t])).rowCount > 0;
  const q = `select "${key}"::text k, md5(x::text) h${hasUpdated ? ', updated_at u' : ''} from public."${t}" x`;
  const [a, b] = await Promise.all([oldDb.query(q), newDb.query(q)]);
  const A = new Map(a.rows.map(r => [r.k, r])), B = new Map(b.rows.map(r => [r.k, r]));
  const above = (k) => intKey && base !== undefined && Number(k) > base;
  const upsert = [], del = [];
  for (const [k, ra] of A) {
    const rb = B.get(k);
    if (!rb) { upsert.push(k); continue; }
    if (ra.h === rb.h) continue;
    if (above(k)) { conflicts.push(`${t}.${key}=${k}: created independently on both sides`); continue; }
    if (hasUpdated && rb.u && ra.u && new Date(rb.u) > new Date(ra.u)) { conflicts.push(`${t}.${key}=${k}: edited on NEW after OLD's last change`); continue; }
    upsert.push(k);
  }
  for (const k of B.keys()) if (!A.has(k) && intKey && base !== undefined && !above(k)) del.push(k);
  if (upsert.length || del.length) plan.push({ t, key, upsert, del });
}

for (const p of plan) console.log(`${p.t}: upsert ${p.upsert.length}${p.upsert.length ? ' [' + p.upsert.slice(0, 10) + ']' : ''}, delete ${p.del.length}${p.del.length ? ' [' + p.del.slice(0, 10) + ']' : ''}`);
for (const c of conflicts) console.log(`CONFLICT ${c}`);
if (!plan.length && !conflicts.length) console.log('No differences to sync.');

if (apply && conflicts.length) { console.error('Conflicts — nothing applied.'); process.exitCode = 1; }
else if (apply && plan.length) {
  const c = await newDb.connect();
  try {
    await c.query('BEGIN');
    for (const p of plan) {
      if (p.del.length) await c.query(`delete from public."${p.t}" where "${p.key}"::text = any($1)`, [p.del]);
      if (!p.upsert.length) continue;
      const rows = (await oldDb.query(`select row_to_json(x) j from public."${p.t}" x where "${p.key}"::text = any($1)`, [p.upsert])).rows;
      const cols = (await c.query(`select attname from pg_attribute where attrelid = ('public.' || quote_ident($1))::regclass and attnum > 0 and not attisdropped order by attnum`, [p.t])).rows.map(r => `"${r.attname}"`);
      const set = cols.filter(x => x !== `"${p.key}"`).map(x => `${x} = excluded.${x}`).join(', ');
      for (const { j } of rows) {
        await c.query(`insert into public."${p.t}" (${cols}) select ${cols} from json_populate_record(null::public."${p.t}", $1::json)
                       on conflict ("${p.key}") do update set ${set}`, [j]);
      }
    }
    const seqs = (await oldDb.query(`select sequencename s, last_value v from pg_sequences where schemaname='public' and last_value is not null`)).rows;
    for (const { s, v } of seqs) {
      await c.query(`select setval($1, greatest($2::bigint, coalesce((select last_value from pg_sequences where schemaname='public' and sequencename=$3), 1)))`, [`public.${s}`, v, s]);
    }
    await c.query('COMMIT');
    console.log('Applied.');
  } catch (e) { await c.query('ROLLBACK'); console.error('FAILED, rolled back:', e.message); process.exitCode = 1; }
  finally { c.release(); }
} else if (!apply && plan.length) console.log('Dry run — re-run with --apply to write.');

await oldDb.end(); await newDb.end();
