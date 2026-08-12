/**
 * find-attendance-device.mjs — scans the current LAN subnet for a live host on
 * port 4370 (the K30 Pro's default ZKTeco/eSSL port). Use this when the device's
 * IP is unknown or has changed (e.g. after swapping the restaurant's WiFi router)
 * and you can't check the device's own screen for its current IP right now.
 *
 * Read-only, no dependencies — just a fast TCP port probe using Node's built-in
 * `net` module to shortlist candidate IPs. It does NOT speak the ZKTeco protocol
 * itself, so confirm each hit is actually the K30 Pro (not some other device that
 * happens to have port 4370 open) with:
 *   node scripts/zk-probe.mjs <candidate-ip>
 *
 * --- How to run ---------------------------------------------------------------
 *   node scripts/find-attendance-device.mjs [subnet-prefix] [port]
 *
 *   With no args, auto-detects this machine's current LAN /24 (e.g. "192.168.1.")
 *   from its active network interface and scans .1–.254 on port 4370.
 *
 *   Examples:
 *      node scripts/find-attendance-device.mjs
 *      node scripts/find-attendance-device.mjs 192.168.29.
 * --------------------------------------------------------------------------------
 */

import net from "net";
import os from "os";

const argPrefix = process.argv[2];
const port = Number(process.argv[3]) || 4370;
const TIMEOUT_MS = 400;
const CONCURRENCY = 32;

function detectSubnetPrefix() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const parts = iface.address.split(".");
        return { prefix: `${parts[0]}.${parts[1]}.${parts[2]}.`, self: iface.address, via: name };
      }
    }
  }
  return null;
}

let prefix = argPrefix;
let selfInfo = null;
if (!prefix) {
  selfInfo = detectSubnetPrefix();
  if (!selfInfo) {
    console.error("Could not auto-detect a LAN IPv4 interface. Pass a subnet prefix explicitly, e.g.:");
    console.error("  node scripts/find-attendance-device.mjs 192.168.1.");
    process.exit(1);
  }
  prefix = selfInfo.prefix;
}
if (!prefix.endsWith(".")) prefix += ".";

console.log(`\n── Scanning ${prefix}1-254 on port ${port} (timeout ${TIMEOUT_MS}ms) ──────────`);
if (selfInfo) console.log(`This machine: ${selfInfo.self} (via ${selfInfo.via})`);
console.log("Run this ON the restaurant PC — it must be connected to the SAME (new) WiFi/LAN as the device.\n");

function probe(ip) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open ? ip : null);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, ip);
  });
}

const targets = Array.from({ length: 254 }, (_, i) => `${prefix}${i + 1}`);
const hits = [];
let scanned = 0;

async function worker() {
  while (targets.length) {
    const ip = targets.shift();
    const hit = await probe(ip);
    scanned++;
    if (hit) {
      hits.push(hit);
      console.log(`\x1b[32m✓ OPEN\x1b[0m  ${hit}:${port}`);
    }
    if (scanned % 50 === 0) process.stdout.write(`  …scanned ${scanned}/254\r`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nScan complete — ${hits.length} host(s) responding on port ${port}.`);
if (hits.length === 0) {
  console.log("\nNo hosts found. Possible causes:");
  console.log("  • This PC and the device are on different subnets/networks — double check this");
  console.log("    machine is actually on the restaurant's new WiFi, not a phone hotspot or old saved network.");
  console.log("  • The K30 Pro lost its WiFi pairing when the router changed — on the device's own");
  console.log("    screen: Menu → Comm → WiFi, re-enter the new SSID/password (or use Menu → Comm →");
  console.log("    Ethernet/IP Address to read its current IP directly if it's wired instead of WiFi).");
  console.log("  • Windows Firewall on this PC may be blocking outbound probes — try running as Administrator.");
} else {
  console.log("\nConfirm which one is the K30 Pro (reads real enrolled users/logs back):");
  for (const ip of hits) console.log(`  node scripts/zk-probe.mjs ${ip} ${port}`);
  console.log("\nOnce confirmed, update the Device IP field in Staff → Device tab to this address and Save.");
  console.log("Then set a DHCP reservation for the device's MAC on the new router so this doesn't happen again.");
}
console.log();
