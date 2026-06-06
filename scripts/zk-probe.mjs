/**
 * zk-probe.mjs — Stage-2 "go / no-go" spike for the K30 Pro attendance integration.
 *
 * Purpose: confirm that the `node-zklib` library can actually talk to YOUR eSSL K30 Pro
 * over the LAN before we build the real Electron sync agent. This is the single biggest
 * unknown in the plan. If this works, we proceed with direct-device polling. If it does
 * NOT work, we fall back to the eTimeTrackLite CSV-folder bridge (no other code changes).
 *
 * It does NOT write anything to the device or the database — read-only probe.
 *
 * --- How to run -------------------------------------------------------------------------
 *   1. Install the library once:   npm i node-zklib
 *   2. Put the K30 on the same LAN as this PC, give it a static IP, note that IP.
 *   3. Run:                         node scripts/zk-probe.mjs <device-ip> [port] [--live]
 *
 *   Examples:
 *      node scripts/zk-probe.mjs 192.168.1.150
 *      node scripts/zk-probe.mjs 192.168.1.150 4370 --live
 *
 *   --live  keeps the connection open for ~30s and prints punches AS THEY HAPPEN — punch a
 *           finger on the device and watch it show up here (this proves near-real-time).
 * ---------------------------------------------------------------------------------------
 */

const ip = process.argv[2];
const port = Number(process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : 4370);
const live = process.argv.includes("--live");

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  ${m}`);

if (!ip) {
  console.log("\nUsage: node scripts/zk-probe.mjs <device-ip> [port] [--live]\n");
  console.log("Example: node scripts/zk-probe.mjs 192.168.1.150 4370 --live\n");
  process.exit(1);
}

let ZKLib;
try {
  ({ default: ZKLib } = await import("node-zklib"));
} catch {
  bad("Could not load `node-zklib`. Install it first:  npm i node-zklib");
  process.exit(1);
}

console.log(`\n── K30 Pro probe ───────────────────────────────────────────────`);
console.log(`Target: ${ip}:${port}   (timeout 10s)\n`);

// new ZKLib(ip, port, timeout, inport)
const zk = new ZKLib(ip, port, 10000, 4000);

try {
  await zk.createSocket();
  ok(`Connected to ${ip}:${port}`);
} catch (e) {
  bad(`Could not connect: ${e?.message ?? e}`);
  console.log("\nTroubleshooting:");
  info("• Confirm the IP is correct and reachable:  ping " + ip);
  info("• Device and this PC must be on the SAME network/subnet.");
  info("• On the device set Comm Key / password to 0 (node-zklib has no comm-key support).");
  info("• Make sure no other software (eTimeTrackLite) is holding the device connection.");
  info("• If this keeps failing → use the eTimeTrackLite CSV-folder fallback from the plan.");
  process.exit(2);
}

try {
  const deviceInfo = await zk.getInfo();
  ok("Read device info");
  info(`Users enrolled : ${deviceInfo.userCounts}`);
  info(`Logs stored    : ${deviceInfo.logCounts}`);
  info(`Log capacity   : ${deviceInfo.logCapacity}`);
} catch (e) {
  bad(`getInfo failed: ${e?.message ?? e}`);
}

try {
  const users = await zk.getUsers();
  const list = users?.data ?? users ?? [];
  ok(`Read enrolled users (${list.length})`);
  for (const u of list.slice(0, 10)) {
    // each user: { uid, userId/role, name, ... } — field names vary by firmware
    info(`uid=${u.uid ?? "?"}  id=${u.userId ?? u.user_id ?? "?"}  name="${u.name ?? ""}"`);
  }
  if (list.length > 10) info(`… and ${list.length - 10} more`);
  console.log("\n  ⇧ The `id` column is what you type into a staff profile's biometricId.\n");
} catch (e) {
  bad(`getUsers failed: ${e?.message ?? e}`);
}

try {
  const att = await zk.getAttendances();
  const rows = att?.data ?? att ?? [];
  ok(`Read attendance logs (${rows.length})`);
  for (const r of rows.slice(-10)) {
    // each log: { userId/deviceUserId, recordTime/timestamp, ip, ... }
    const id = r.userId ?? r.deviceUserId ?? r.user_id ?? "?";
    const t = r.recordTime ?? r.timestamp ?? r.time ?? "?";
    info(`id=${id}  time=${t instanceof Date ? t.toISOString() : t}`);
  }
} catch (e) {
  bad(`getAttendances failed: ${e?.message ?? e}`);
}

if (live) {
  console.log("\n── LIVE mode: punch a finger now (listening ~30s) ──────────────");
  try {
    zk.getRealTimeLogs((data) => {
      console.log(`\x1b[36m● LIVE PUNCH\x1b[0m ${JSON.stringify(data)}`);
    });
  } catch (e) {
    bad(`getRealTimeLogs failed: ${e?.message ?? e}`);
  }
  await new Promise((res) => setTimeout(res, 30000));
}

try {
  await zk.disconnect();
} catch {}

console.log("\n\x1b[32mPROBE COMPLETE.\x1b[0m If users + logs printed above, node-zklib works with your K30 →");
console.log("we proceed with direct-device polling. If it failed, we use the CSV fallback.\n");
process.exit(0);
