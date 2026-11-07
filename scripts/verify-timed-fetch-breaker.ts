/**
 * Verifies timedFetch's stall breaker (packages/api-client/index.ts) end to end in Node, with a fake
 * global fetch whose requests can answer, stall (until reset/abort) or fail, and tiny timings.
 * "reset" here rejects every stalled request, like Electron's closeAllConnections does to in-flight
 * HTTP/2 requests. Run: npx tsx scripts/verify-timed-fetch-breaker.ts
 */
import { setApiBaseUrl, setStallBreaker, timedFetch, withIdempotencyKey, stallResetCount, type StallResetInfo } from "../packages/api-client";
import { CONNECTION_DROPPED_MESSAGE, IDEMPOTENCY_HEADER } from "../packages/api-client/stallBreaker";

setApiBaseUrl("http://api.test"); // never touch import.meta.env in Node

type Mode = { kind: "ok"; afterMs: number; status?: number } | { kind: "stall" } | { kind: "network_error" };
interface Call { url: string; method: string; key: string | null }

let calls: Call[] = [];
let n = 0;
let pingMode: Mode = { kind: "ok", afterMs: 0 };
let plan: (nth: number) => Mode = () => ({ kind: "ok", afterMs: 0 });
const stalled = new Set<(e: Error) => void>();
let resetCalls = 0;
const infos: StallResetInfo[] = [];

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const isPing = url.endsWith("/api/ping");
  const mode = isPing ? pingMode : plan(++n);
  if (!isPing) calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), key: new Headers(init?.headers ?? undefined).get(IDEMPOTENCY_HEADER) });
  return new Promise<Response>((resolve, reject) => {
    const fail = (e: Error) => { stalled.delete(fail); reject(e); };
    const signal = init?.signal;
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => fail(new DOMException("Aborted", "AbortError")), { once: true });
    if (mode.kind === "network_error") return fail(new TypeError("Failed to fetch"));
    if (mode.kind === "stall") { stalled.add(fail); return; }
    setTimeout(() => { stalled.delete(fail); resolve(new Response(null, { status: mode.status ?? 200 })); }, mode.afterMs);
  });
}) as typeof fetch;

const TINY = { checkAfterMs: 40, checkTimeoutMs: 40, resetMinGapMs: 0 };
function install(enabled: boolean, timings: Partial<typeof TINY> = TINY) {
  setStallBreaker({
    enabled: () => enabled,
    reset: async () => { resetCalls++; Array.from(stalled).forEach((f) => f(new TypeError("Failed to fetch"))); },
    onReset: (i) => infos.push(i),
    timings,
  });
}
function fresh(p: (nth: number) => Mode, ping: Mode) {
  calls = []; n = 0; resetCalls = 0; infos.length = 0; stalled.clear(); plan = p; pingMode = ping;
}
const keyedPost = () => withIdempotencyKey({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const checks: Array<[string, boolean]> = [];
const t = () => performance.now();

async function main() {
  // A. Breaker disabled → unchanged: a fast answer passes, no ping, no reset.
  install(false); fresh(() => ({ kind: "ok", afterMs: 5 }), { kind: "ok", afterMs: 0 });
  checks.push(["disabled: fast answer passes", (await timedFetch("/api/x", keyedPost())).status === 200 && resetCalls === 0]);

  // K. Breaker disabled → a keyed POST network error is NOT retried (browsers unchanged).
  fresh(() => ({ kind: "network_error" }), { kind: "ok", afterMs: 0 });
  let threw = false;
  try { await timedFetch("/api/x", keyedPost()); } catch { threw = true; }
  checks.push(["disabled: keyed POST network error → thrown, sent once", threw && calls.length === 1]);

  install(true);

  // B. Fast answer → no check, no reset.
  fresh(() => ({ kind: "ok", afterMs: 5 }), { kind: "stall" });
  checks.push(["fast answer: no reset", (await timedFetch("/api/x", keyedPost())).status === 200 && resetCalls === 0 && calls.length === 1]);

  // C. Keyed POST on a dead connection → reset, same-key retry, success.
  fresh((i) => (i === 1 ? { kind: "stall" } : { kind: "ok", afterMs: 5 }), { kind: "stall" });
  let t0 = t();
  const c = await timedFetch("/api/save", keyedPost());
  const cMs = t() - t0;
  checks.push(["dead connection, keyed POST: recovers with 200", c.status === 200]);
  checks.push(["…after exactly one reset", resetCalls === 1]);
  checks.push(["…resent once with the SAME key", calls.length === 2 && !!calls[0].key && calls[0].key === calls[1].key]);
  checks.push(["…detected after check-after + check-timeout (≥ 80 ms, < 400 ms)", cMs >= 80 && cMs < 400]);
  checks.push(["…onReset reports retryOutcome ok", infos.length === 1 && infos[0].retryOutcome === "ok" && infos[0].keyed && infos[0].retryStatus === 200]);

  // D. Slow but alive → check answers → no reset.
  fresh(() => ({ kind: "ok", afterMs: 150 }), { kind: "ok", afterMs: 0 });
  checks.push(["slow but alive: 200, no reset, sent once", (await timedFetch("/api/x", keyedPost())).status === 200 && resetCalls === 0 && calls.length === 1]);

  // E. UNKEYED POST on a dead connection → reset, clear error, NOT resent.
  fresh(() => ({ kind: "stall" }), { kind: "stall" });
  let msg = "";
  try { await timedFetch("/api/x", { method: "POST", body: "{}" }); } catch (e) { msg = (e as Error).message; }
  checks.push(["unkeyed POST: clear 'connection dropped' error", msg === CONNECTION_DROPPED_MESSAGE]);
  checks.push(["…not resent", calls.length === 1 && resetCalls === 1]);
  checks.push(["…reported as not_retried", infos.length === 1 && infos[0].retryOutcome === "not_retried"]);

  // F. GET on a dead connection → reset + retry.
  fresh((i) => (i === 1 ? { kind: "stall" } : { kind: "ok", afterMs: 5 }), { kind: "stall" });
  checks.push(["dead connection, GET: recovers", (await timedFetch("/api/data")).status === 200 && calls.length === 2 && resetCalls === 1]);

  // H. Keyed POST, immediate network error (another request's reset) → resent once with the same key.
  fresh((i) => (i === 1 ? { kind: "network_error" } : { kind: "ok", afterMs: 5 }), { kind: "ok", afterMs: 0 });
  const h = await timedFetch("/api/save", keyedPost());
  checks.push(["keyed POST network error: resent with the same key", h.status === 200 && calls.length === 2 && calls[0].key === calls[1].key && resetCalls === 0]);

  // I. Unkeyed POST network error → original error, not resent.
  fresh(() => ({ kind: "network_error" }), { kind: "ok", afterMs: 0 });
  let iMsg = "";
  try { await timedFetch("/api/x", { method: "POST", body: "{}" }); } catch (e) { iMsg = (e as Error).message; }
  checks.push(["unkeyed POST network error: original error, sent once", iMsg === "Failed to fetch" && calls.length === 1]);

  // J. Caller aborts → not retried.
  fresh(() => ({ kind: "stall" }), { kind: "ok", afterMs: 0 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  let jThrew = false;
  try { await timedFetch("/api/data", { signal: ac.signal }); } catch { jThrew = true; }
  checks.push(["caller abort: thrown, not retried", jThrew && calls.length === 1]);

  // G. Gap: a second dead-connection stall within resetMinGapMs is left alone (keeps waiting).
  install(true, { ...TINY, resetMinGapMs: 10_000 });
  fresh((i) => (i === 1 ? { kind: "stall" } : i === 2 ? { kind: "ok", afterMs: 5 } : { kind: "ok", afterMs: 300 }), { kind: "stall" });
  await timedFetch("/api/save", keyedPost()); // resets once
  t0 = t();
  const g = await timedFetch("/api/save", keyedPost()); // answers at 300 ms; its silent check must NOT reset again
  checks.push(["gap: second stall within 10 s is not reset again", g.status === 200 && resetCalls === 1 && t() - t0 >= 250]);

  // L. Counter
  checks.push(["stallResetCount counts resets", stallResetCount() >= 4]);

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
