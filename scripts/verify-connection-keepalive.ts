/**
 * Verifies shared/connectionKeepAlive.ts — when the POS sends its keep-warm GET /api/ping. The
 * point of the ping is that the device's connection to the API never sits quiet for more than
 * ~15 s (a quiet connection is what the mobile network drops silently, costing the next KOT/Bill/
 * Settle tap Chromium's 10 s dead-connection timeout). Pure: a fake clock, no DOM.
 * Run: npx tsx scripts/verify-connection-keepalive.ts
 */
import {
  KEEPALIVE_IDLE_MS,
  KEEPALIVE_TICK_MS,
  KEEPALIVE_WAKE_GRACE_MS,
  isApiResourceUrl,
  shouldPing,
  type KeepAliveState,
} from "../shared/connectionKeepAlive";

const checks: Array<[string, boolean]> = [];
const S = (lastResponseAt: number | null, lastPingAt: number | null): KeepAliveState => ({ lastResponseAt, lastPingAt });

// Ticks
checks.push(["tick: a page that never heard from the API pings at once", shouldPing(S(null, null), 1000, "tick", true)]);
checks.push(["tick: a response 2 s ago → no ping", !shouldPing(S(8000, null), 10_000, "tick", true)]);
checks.push(["tick: quiet for exactly the idle limit → ping", shouldPing(S(0, null), KEEPALIVE_IDLE_MS, "tick", true)]);
checks.push(["tick: quiet just under the limit → no ping", !shouldPing(S(0, null), KEEPALIVE_IDLE_MS - 1, "tick", true)]);
checks.push(["tick: a ping already sent recently counts as activity (no double ping while one is in flight)", !shouldPing(S(0, 14_000), 16_000, "tick", true)]);
checks.push(["tick: inactive (hidden browser tab) never pings", !shouldPing(S(0, null), 60_000, "tick", false)]);

// Wake-ups (window shown / focused / back online)
checks.push(["wake: quiet 4 s → ping immediately (don't wait for the next tick)", shouldPing(S(0, null), 4000, "wake", true)]);
checks.push(["wake: a response 1 s ago → no ping", !shouldPing(S(9000, null), 10_000, "wake", true)]);
checks.push(["wake: hidden → no ping", !shouldPing(S(0, null), 60_000, "wake", false)]);

// Worst case: the connection is never quiet longer than idle limit + one tick.
{
  let lastPing: number | null = null;
  let worst = 0;
  let quietSince = 0;
  for (let t = 0; t <= 10 * 60_000; t += KEEPALIVE_TICK_MS) {
    if (shouldPing(S(null, lastPing), t, "tick", true)) {
      worst = Math.max(worst, t - quietSince);
      lastPing = t;
      quietSince = t;
    }
  }
  checks.push([`simulated 10 min of a silent POS: never quiet longer than ${KEEPALIVE_IDLE_MS + KEEPALIVE_TICK_MS} ms (got ${worst})`, worst <= KEEPALIVE_IDLE_MS + KEEPALIVE_TICK_MS]);
  // Production stalls were seen after ~30 s+ of silence; the worst case must stay well inside that.
  checks.push(["the worst-case quiet period is at most 20 s", KEEPALIVE_IDLE_MS + KEEPALIVE_TICK_MS <= 20_000]);
}

checks.push(["the wake grace is shorter than the tick", KEEPALIVE_WAKE_GRACE_MS < KEEPALIVE_TICK_MS]);

// Which Resource Timing entries count as API traffic on the same connection
const API = "https://bagicha-pos.vercel.app";
checks.push(["api: an /api/ request on the API origin counts", isApiResourceUrl(`${API}/api/orders/12/items`, API)]);
checks.push(["api: the ping itself counts", isApiResourceUrl(`${API}/api/ping`, API)]);
checks.push(["api: a page asset on the same origin does not", !isApiResourceUrl(`${API}/assets/index.js`, API)]);
checks.push(["api: another origin (Pusher, fonts) does not", !isApiResourceUrl("https://sockjs-ap2.pusher.com/api/x", API)]);
checks.push(["api: garbage never throws", !isApiResourceUrl("not a url", API)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
