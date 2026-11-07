/**
 * Verifies the WhatsApp library (Baileys, ~40 MB / ~0.6 s) is loaded only when the Baileys
 * driver connects, not at every server start or Vercel cold start, and that the lazy loader
 * still hands the driver everything it uses. Pure: no DB, no network, no WhatsApp session.
 * Run: npx tsx scripts/verify-baileys-lazy.ts
 */
import fs from "fs";
import path from "path";

const checks: Array<[string, boolean]> = [];

// 1. No value import of Baileys or pino anywhere in the server / shared code — type imports only.
function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : tsFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const files = ["server", "shared"].flatMap(tsFiles).concat(["server-fn.ts"]);
const VALUE_IMPORT = /^\s*import\s+(?!type\b)[^;]*?\sfrom\s+["'](@whiskeysockets\/baileys|pino)["']/m;
const offenders = files.filter((f) => VALUE_IMPORT.test(fs.readFileSync(f, "utf8")));
checks.push([`no top-level value import of Baileys/pino in ${files.length} server/shared files${offenders.length ? " — found in " + offenders.join(", ") : ""}`,
  offenders.length === 0]);

const driverSrc = fs.readFileSync("server/services/whatsapp/baileysDriver.ts", "utf8");
checks.push(["baileysDriver loads the library inside connect()",
  /private async connect\(\)[\s\S]*?await loadBaileys\(\)[\s\S]*?useMultiFileAuthState\(/.test(driverSrc)]);

// 2. Importing the driver module does not load the library; loadBaileys() does, once.
const mb = () => process.memoryUsage().rss / 1048576;
const before = mb();
const { loadBaileys } = await import("../server/services/whatsapp/baileysDriver");
const afterImport = mb();
checks.push([`importing baileysDriver costs < 15 MB (was ${(afterImport - before).toFixed(1)} MB; Baileys itself is ~40)`,
  afterImport - before < 15]);

const t0 = Date.now();
const { baileys, pino } = await loadBaileys();
const loadMs = Date.now() - t0;
const afterLoad = mb();
checks.push([`loadBaileys() actually loads the library (+${(afterLoad - afterImport).toFixed(1)} MB in ${loadMs} ms)`,
  afterLoad - afterImport > 10]);
checks.push(["makeWASocket is a function", typeof baileys.makeWASocket === "function"]);
checks.push(["useMultiFileAuthState is a function", typeof baileys.useMultiFileAuthState === "function"]);
checks.push(["fetchLatestBaileysVersion is a function", typeof baileys.fetchLatestBaileysVersion === "function"]);
checks.push(["DisconnectReason.loggedOut is 401", baileys.DisconnectReason?.loggedOut === 401]);
checks.push(["pino is a logger factory", typeof pino === "function" && typeof pino({ level: "silent" }).info === "function"]);
const again = await loadBaileys();
checks.push(["a second call reuses the same load", again.baileys === baileys]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
