import ZKLib from "node-zklib";

const ip = process.argv[2];
const port = Number(process.argv[3]) || 4370;
const zk = new ZKLib(ip, port, 3000, Number(process.argv[4]) || 4000);

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`HARD_TIMEOUT_${label}_${ms}ms`)), ms)),
  ]);

try {
  await withTimeout(zk.createSocket(), 5000, "createSocket");
  console.log(`[${ip}] CONNECTED via`, zk.connectionType);
  const info = await withTimeout(zk.getInfo(), 5000, "getInfo");
  console.log(`[${ip}] INFO:`, info);
  await zk.disconnect().catch(() => {});
  console.log(`[${ip}] RESULT: LIKELY_K30`);
} catch (e) {
  const code = e?.err?.code ?? e?.code ?? "?";
  const msg = e?.err?.message ?? e?.message ?? String(e);
  console.log(`[${ip}] FAILED code=${code} msg=${msg}`);
}
process.exit(0);
