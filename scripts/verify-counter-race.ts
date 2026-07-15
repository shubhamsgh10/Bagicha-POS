/**
 * Verifies that bill/KOT counter issuance is race-free ACROSS PROCESSES.
 *
 * Background: settingsStore issued numbers from the per-process `settingsCache`
 * ("next = cache + 1") behind a per-process promise mutex. That holds on the
 * single always-on host, but on Vercel every serverless instance has its own
 * cache + mutex, so two instances handed out the SAME orderNumber — the loser hit
 * the orders.order_number UNIQUE constraint and surfaced as a 400 that "worked on
 * retry". The fix moves allocation into a single atomic UPDATE ... RETURNING.
 *
 * This runs against a THROWAWAY table (never the live id=1 settings row), so the
 * restaurant's real bill counter is untouched.
 *
 * Run: npx tsx -r dotenv/config scripts/verify-counter-race.ts
 */
import { pool } from "../server/db";

const TABLE = "_counter_race_test";
const CONCURRENCY = 25;

/** The OLD approach: read-modify-write via a per-instance in-memory cache. */
async function issueFromCache(cache: { v: number }): Promise<number> {
  const next = cache.v + 1; // read cache
  await pool.query(
    `UPDATE ${TABLE} SET settings = $1::json WHERE id = 1`,
    [JSON.stringify({ billCounter: next })],
  );
  cache.v = next; // write cache
  return next;
}

/** The NEW approach: mirrors settingsStore.issueCounter's atomic SQL exactly. */
async function issueAtomic(field: string): Promise<number> {
  const r = await pool.query(
    `UPDATE ${TABLE}
     SET settings = jsonb_set(
           settings::jsonb,
           ARRAY[$1]::text[],
           to_jsonb(COALESCE((settings ->> $1)::int, 0) + 1)
         )::json
     WHERE id = 1
     RETURNING (settings ->> $1)::int AS value`,
    [field],
  );
  return Number(r.rows[0]?.value);
}

async function reset() {
  await pool.query(`UPDATE ${TABLE} SET settings = '{"billCounter": 0}'::json WHERE id = 1`);
}

/** Unique + gapless 1..n means every caller got its own number. */
function assess(results: number[]): { unique: number; sequential: boolean } {
  const set = new Set(results);
  const sequential =
    set.size === results.length &&
    [...set].sort((a, b) => a - b).every((v, i) => v === i + 1);
  return { unique: set.size, sequential };
}

async function main() {
  const checks: Array<[string, boolean]> = [];

  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await pool.query(`CREATE TABLE ${TABLE} (id integer PRIMARY KEY, settings json NOT NULL)`);
  await pool.query(`INSERT INTO ${TABLE} (id, settings) VALUES (1, '{"billCounter": 0}'::json)`);

  try {
    // 1. Reproduce the bug: N "instances", each with its own cache, all at 0.
    //    Mirrors several Vercel lambdas that each seeded from the same DB value.
    await reset();
    const stale = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => issueFromCache({ v: 0 })),
    );
    const staleRes = assess(stale);
    checks.push([
      `OLD per-instance cache COLLIDES (got ${staleRes.unique}/${CONCURRENCY} unique — duplicates = 400s)`,
      staleRes.unique < CONCURRENCY,
    ]);

    // 2. The fix: same concurrency, allocation done by Postgres.
    await reset();
    const atomic = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => issueAtomic("billCounter")),
    );
    const atomicRes = assess(atomic);
    checks.push([
      `NEW atomic UPDATE issues ${CONCURRENCY} unique numbers`,
      atomicRes.unique === CONCURRENCY,
    ]);
    checks.push([`NEW atomic UPDATE is gapless 1..${CONCURRENCY}`, atomicRes.sequential]);

    // 3. RETURNING must yield the POST-update value (else numbering starts at 0).
    await reset();
    checks.push(["first issued number is 1, not 0", (await issueAtomic("billCounter")) === 1]);

    // 4. Counter is independent per field, and a sibling key is not clobbered.
    await pool.query(
      `UPDATE ${TABLE} SET settings = '{"billCounter": 7, "taxRate": 18}'::json WHERE id = 1`,
    );
    const kot = await issueAtomic("kotCounter");
    const row = await pool.query(`SELECT settings FROM ${TABLE} WHERE id = 1`);
    const s = row.rows[0].settings;
    checks.push(["missing counter key starts at 1", kot === 1]);
    checks.push(["sibling keys preserved (billCounter=7, taxRate=18)", s.billCounter === 7 && s.taxRate === 18]);
  } finally {
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.end();
  }

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nAll counter-race checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
