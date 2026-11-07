/**
 * Verifies server/backgroundJobs.ts — background jobs are off unless BACKGROUND_JOBS asks for
 * them — and that server/index.ts and the Electron host build are wired to it. Pure: no DB.
 * Run: npx tsx scripts/verify-background-jobs.ts
 */
import fs from "fs";
import { backgroundJobsDecision as d } from "../server/backgroundJobs";

const checks: Array<[string, boolean]> = [];

checks.push(["not set → off", d({}).on === false]);
checks.push(["empty → off", d({ BACKGROUND_JOBS: "" }).on === false]);
checks.push(["on → on", d({ BACKGROUND_JOBS: "on" }).on === true]);
checks.push(["ON / 1 / true / yes (any case, spaces) → on",
  ["ON", "1", "true", " Yes "].every((v) => d({ BACKGROUND_JOBS: v }).on === true)]);
checks.push(["off / 0 / false / no → off",
  ["off", "0", "false", "no"].every((v) => d({ BACKGROUND_JOBS: v }).on === false)]);
checks.push(["an unrecognised value → off, and the reason says so",
  d({ BACKGROUND_JOBS: "maybe" }).on === false && /not on\/off/.test(d({ BACKGROUND_JOBS: "maybe" }).reason)]);
checks.push(["NODE_ENV=production alone does not turn them on", d({ NODE_ENV: "production" }).on === false]);

// Wiring (source-level): every job starts after the off-switch's early return, and the host build opts in.
const index = fs.readFileSync("server/index.ts", "utf8");
const gate = index.indexOf("if (!jobs.on)");
const starts = ["startAutomationScheduler()", "startSegmentationScheduler(", "seedDefaultRules()",
  "startDailyScheduler()", "initWhatsAppDriver()", "startOutboundWorker()"];
checks.push(["server/index.ts checks the switch", gate > 0]);
checks.push(["server/index.ts starts every job only after the switch",
  starts.every((s) => { const at = index.indexOf(s); return at > gate && index.indexOf(s, at + 1) === -1; })]);
const main = fs.readFileSync("desktop/main.ts", "utf8");
checks.push(["Electron host build passes BACKGROUND_JOBS (default on) to its embedded server",
  /BACKGROUND_JOBS:\s*process\.env\.BACKGROUND_JOBS\s*\|\|\s*"on"/.test(main)]);
const serverFn = fs.readFileSync("server-fn.ts", "utf8");
checks.push(["Vercel entry (server-fn.ts) starts none of the jobs", starts.every((s) => !serverFn.includes(s))]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
