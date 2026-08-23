// Bypasses ZKLib's buggy TCP-first fallback (only tries UDP on ECONNREFUSED) by
// speaking ZKLibUDP directly — for embedded devices whose minimal TCP stack just
// silently drops (ETIMEDOUT) instead of sending RST (ECONNREFUSED) on a closed port.
import zklibMod from "node-zklib";
// node-zklib doesn't export ZKLibUDP publicly, so pull it via the package's internal path.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ZKLibUDP = require("node-zklib/zklibudp.js");

const ip = process.argv[2];
const port = Number(process.argv[3]) || 4370;
const inport = Number(process.argv[4]) || (5000 + Math.floor(Math.random() * 1000));

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`HARD_TIMEOUT_${label}_${ms}ms`)), ms)),
  ]);

const udp = new ZKLibUDP(ip, port, 3000, inport);
try {
  await withTimeout(udp.createSocket(), 3000, "udpCreateSocket");
  await withTimeout(udp.connect(), 3000, "udpConnect");
  console.log(`[${ip}] UDP CMD_CONNECT SUCCEEDED (sessionId=${udp.sessionId})`);
  try {
    const info = await withTimeout(udp.getInfo(), 3000, "udpGetInfo");
    console.log(`[${ip}] INFO:`, info);
    console.log(`[${ip}] RESULT: CONFIRMED_ZKTECO_DEVICE`);
  } catch (e2) {
    console.log(`[${ip}] connect ok but getInfo failed:`, e2?.message ?? e2);
  }
  await udp.disconnect().catch(() => {});
} catch (e) {
  console.log(`[${ip}] UDP FAILED:`, e?.message ?? e);
}
process.exit(0);
