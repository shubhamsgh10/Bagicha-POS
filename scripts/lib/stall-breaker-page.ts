/**
 * Page script for scripts/verify-stall-breaker-electron.cjs — runs the REAL timedFetch stall breaker
 * (packages/api-client) in an Electron window. Bundled with esbuild at test time; not part of the app.
 */
import { setApiBaseUrl, setStallBreaker, timedFetch, withIdempotencyKey, stallResetCount, type StallResetInfo } from "../../packages/api-client";

type Win = Window & {
  electronAPI?: { resetConnections?: () => Promise<void> };
  __PUSHER__?: { key: string; cluster: string } | null;
  runCase?: (name: string) => Promise<Record<string, unknown>>;
  pusherState?: () => Promise<string>;
};
const w = window as Win;
const resets: StallResetInfo[] = [];

setApiBaseUrl(""); // same origin: the test page is served by the test server
setStallBreaker({
  enabled: () => true,
  reset: () => w.electronAPI!.resetConnections!(),
  onReset: (i) => resets.push(i),
  // Production check timings; no minimum gap so consecutive cases can each reset (the gap is unit-tested).
  timings: { resetMinGapMs: 0 },
});

let pusher: WebSocket | null = null;
let pong = false;
if (w.__PUSHER__) {
  pusher = new WebSocket(`wss://ws-${w.__PUSHER__.cluster}.pusher.com/app/${w.__PUSHER__.key}?protocol=7&client=js&version=8.4.0&flash=false`);
  pusher.onmessage = (e) => {
    try { if (JSON.parse(String(e.data)).event === "pusher:pong") pong = true; } catch { /* ignore */ }
  };
}

const json = { "Content-Type": "application/json" };
w.runCase = async (name: string) => {
  const t0 = performance.now();
  const before = stallResetCount();
  const ms = () => Math.round(performance.now() - t0);
  try {
    let status = 0;
    if (name === "warm" || name === "get") status = (await timedFetch("/api/data")).status;
    if (name === "keyed") status = (await timedFetch("/api/save", withIdempotencyKey({ method: "POST", headers: json, body: "{}" }))).status;
    if (name === "unkeyed") status = (await timedFetch("/api/save", { method: "POST", headers: json, body: "{}" })).status;
    if (name === "slow") status = (await timedFetch("/api/slow")).status;
    return { ok: true, status, ms: ms(), resets: stallResetCount() - before, last: resets[resets.length - 1] ?? null };
  } catch (e) {
    return { ok: false, error: String((e as Error).message), ms: ms(), resets: stallResetCount() - before };
  }
};
w.pusherState = async () => {
  if (!pusher) return "skipped (no VITE_PUSHER_KEY / VITE_PUSHER_CLUSTER in .env)";
  if (pusher.readyState !== WebSocket.OPEN) return `NOT OPEN (readyState ${pusher.readyState})`;
  pong = false;
  pusher.send(JSON.stringify({ event: "pusher:ping", data: {} }));
  for (let i = 0; i < 30 && !pong; i++) await new Promise((r) => setTimeout(r, 100));
  return pong ? "OPEN + pong" : "OPEN but no pong";
};
