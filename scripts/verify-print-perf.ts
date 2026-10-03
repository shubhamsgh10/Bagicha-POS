/**
 * Verifies shared/printPerf.ts — the stage timer behind the Server-Timing header and the
 * [print-perf] log lines. The clock is injected so the numbers are exact.
 * Run: npx tsx scripts/verify-print-perf.ts
 */
import { createStageTimer } from "../shared/printPerf";

const checks: Array<[string, boolean]> = [];

async function main() {
  let t = 0;
  const timer = createStageTimer(() => t);

  const v = await timer.time("db_order", async () => { t += 12.34; return "ok"; });
  checks.push(["time() returns fn's value", v === "ok"]);

  await timer.time("db_order", async () => { t += 1; });
  checks.push(["a repeated stage name sums (13.34 → 13.3)", timer.stages().db_order === 13.3]);

  await timer.time("bad name!", async () => { t += 5; });
  checks.push(["unsafe characters are sanitised to _", timer.stages().bad_name_ === 5]);

  let threw = false;
  try {
    await timer.time("boom", async () => { t += 2; throw new Error("x"); });
  } catch {
    threw = true;
  }
  checks.push(["time() rethrows the error", threw]);
  checks.push(["time() still records a failed stage", timer.stages().boom === 2]);

  timer.scoped("kot").add("db_order", 7);
  checks.push(["scoped() prefixes into the same timer", timer.stages().kot_db_order === 7]);
  timer.scoped("kot").scoped("x").add("y", 1);
  checks.push(["scoped() nests", timer.stages().kot_x_y === 1]);

  checks.push(["totalMs() measures since creation (20.34 → 20.3)", timer.totalMs() === 20.3]);

  checks.push([
    "toServerTiming() format",
    timer.toServerTiming() ===
      "db_order;dur=13.3, bad_name_;dur=5, boom;dur=2, kot_db_order;dur=7, kot_x_y;dur=1, total;dur=20.3",
  ]);
  checks.push([
    "toLogLine() format",
    timer.toLogLine("kot order=1") ===
      "[print-perf] kot order=1 db_order=13.3 bad_name_=5 boom=2 kot_db_order=7 kot_x_y=1 total=20.3",
  ]);

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
