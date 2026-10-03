/**
 * Standalone virtual print station.
 * Run: npx tsx scripts/virtual-print-station.ts --base-url http://127.0.0.1:5000 --channel private-bagicha-bench-xyz [--cookie "connect.sid=..."]
 * It only handles jobs whose printerId starts with "bench-". Ctrl+C to stop.
 */
import "dotenv/config";
import { startVirtualStation } from "./lib/virtualStation";

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const baseUrl = opt("--base-url");
const channel = opt("--channel");
const cookie = opt("--cookie");
if (!baseUrl || !channel) {
  console.error("usage: tsx scripts/virtual-print-station.ts --base-url <url> --channel <pusher channel> [--cookie <cookie header>]");
  process.exit(2);
}

const station = await startVirtualStation({
  baseUrl,
  channel,
  headers: cookie ? { Cookie: cookie } : undefined,
  onEvent: (e) =>
    console.log(
      `job ${e.jobId} (${e.jobType}, ${e.printerId}): event→claim ${(e.tClaim - e.tEvent).toFixed(0)}ms, claim→ack ${(e.tAck - e.tClaim).toFixed(0)}ms`,
    ),
});
console.log(`virtual station listening on ${channel}; Ctrl+C to stop`);
process.on("SIGINT", () => {
  station.stop();
  process.exit(0);
});
