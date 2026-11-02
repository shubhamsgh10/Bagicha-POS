/**
 * DB-free checks for the latency diagnostics (run in `npm run test:pure`):
 *  - shared/requestTiming.ts: Server-Timing parsing, slow-request classification, loggable paths
 *  - packages/api-client timedFetch: timing capture, GET timeout + single retry, writes never retried
 */
import { parseServerTiming, classifySlowRequest, loggablePath, GET_TIMEOUT_MS as SHARED_TIMEOUT } from "../shared/requestTiming";

// apiUrl() takes the same-origin path on localhost — avoids import.meta.env (Vite-only) under tsx.
(globalThis as any).window = { location: { hostname: "localhost" } };

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`PASS  ${name}`); } else { failed++; console.log(`FAIL  ${name}`, detail ?? ""); }
}

(async () => {
  const api = await import("../packages/api-client");

  // ── parseServerTiming ──
  const full = parseServerTiming('app;dur=42, cold;dur=3810, inst;desc="age=0s req=1"');
  check("parses app/cold/inst", full.appMs === 42 && full.coldMs === 3810 && full.instAgeS === 0 && full.instReq === 1, full);
  const warm = parseServerTiming('app;dur=7, inst;desc="age=982s req=27"');
  check("warm request: no cold", warm.appMs === 7 && warm.coldMs === null && warm.instAgeS === 982 && warm.instReq === 27, warm);
  check("missing header → all null", JSON.stringify(parseServerTiming(null)) === JSON.stringify({ appMs: null, coldMs: null, instAgeS: null, instReq: null }));
  check("garbage tolerated", parseServerTiming("foo, app;dur=x").appMs === null);

  // ── classifySlowRequest ──
  check("timeout", classifySlowRequest({ clientMs: 8000, timedOut: true }) === "timeout");
  check("no server timing → unknown", classifySlowRequest({ clientMs: 9000 }) === "unknown");
  check("server-heavy → server", classifySlowRequest({ clientMs: 6000, appMs: 4000 }) === "server");
  check("boot-heavy → cold_start", classifySlowRequest({ clientMs: 6000, appMs: 300, coldMs: 4200 }) === "cold_start");
  check("10s with an 8ms handler → network", classifySlowRequest({ clientMs: 10340, appMs: 8 }) === "network");
  check("split evenly below half each → network", classifySlowRequest({ clientMs: 10000, appMs: 2000, coldMs: 2000 }) === "network");

  // ── loggablePath ──
  check("strips query string", loggablePath("https://x.vercel.app/api/orders?startDate=2026&customer=Raj") === "/api/orders");
  check("keeps ids", loggablePath("/api/orders/2233/items") === "/api/orders/2233/items");

  // ── timedFetch ──
  check("client and shared timeouts agree", api.GET_TIMEOUT_MS === SHARED_TIMEOUT);
  const seen: any[] = [];
  api.setRequestObserver((t) => seen.push(t));
  const realFetch = globalThis.fetch;
  let calls = 0;
  const respond = (st = 'app;dur=5, inst;desc="age=9s req=3"') =>
    new Response("[]", { status: 200, headers: { "server-timing": st } });
  // A fetch that never answers until aborted.
  const hang = (init?: RequestInit) => new Promise<Response>((_, rej) => {
    init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
  });

  // 1. Normal GET: timed, Server-Timing captured.
  calls = 0; seen.length = 0;
  (globalThis as any).fetch = async () => { calls++; return respond(); };
  const r1 = await api.timedFetch("/api/tables");
  check("GET: returns the response", r1.status === 200 && calls === 1);
  check("GET: observer gets method/status/server-timing", seen.length === 1 && seen[0].method === "GET" && seen[0].status === 200 && /app;dur=5/.test(seen[0].serverTiming) && seen[0].attempt === 1);
  check("GET: recorded in recentRequestTimings", api.recentRequestTimings().some((t) => t.url === "/api/tables"));

  // 2. GET that stalls once, then answers: aborted after the timeout and retried once.
  calls = 0; seen.length = 0;
  (globalThis as any).fetch = (_u: string, init?: RequestInit) => { calls++; return calls === 1 ? hang(init) : Promise.resolve(respond()); };
  const r2 = await api.timedFetch("/api/live-status", undefined, { timeoutMs: 30 });
  check("stalled GET: retried and answered", r2.status === 200 && calls === 2);
  check("stalled GET: reported as attempt 2, not timed out", seen.length === 1 && seen[0].attempt === 2 && seen[0].timedOut === false);

  // 3. GET that stalls twice: rejects with a readable timeout error, reported as timedOut.
  calls = 0; seen.length = 0;
  (globalThis as any).fetch = (_u: string, init?: RequestInit) => { calls++; return hang(init); };
  let err: any = null;
  try { await api.timedFetch("/api/orders", undefined, { timeoutMs: 20 }); } catch (e) { err = e; }
  check("GET stalled twice: rejects after 2 attempts", calls === 2 && /timed out/i.test(String(err?.message)), { calls, err: String(err) });
  check("GET stalled twice: reported timedOut on attempt 2", seen.length === 1 && seen[0].timedOut === true && seen[0].attempt === 2 && seen[0].status === null);

  // 4. Writes are never aborted or retried (a replayed create/print could duplicate).
  calls = 0; seen.length = 0;
  (globalThis as any).fetch = async (_u: string, init?: RequestInit) => {
    calls++;
    check("PUT: no abort signal attached", init?.signal === undefined);
    await new Promise((r) => setTimeout(r, 40));
    return respond('app;dur=12, inst;desc="age=5s req=2"');
  };
  const r4 = await api.timedFetch("/api/orders/1/items", { method: "PUT", body: "{}" }, { timeoutMs: 10 });
  check("PUT: waits past the GET timeout, single attempt", r4.status === 200 && calls === 1 && seen[0].attempt === 1 && seen[0].clientMs >= 30);

  calls = 0; seen.length = 0;
  (globalThis as any).fetch = async () => { calls++; throw new TypeError("Failed to fetch"); };
  let e5: any = null;
  try { await api.timedFetch("/api/orders", { method: "POST", body: "{}" }); } catch (e) { e5 = e; }
  check("POST network error: not retried, error passed through", calls === 1 && e5 instanceof TypeError && seen[0].failed === true);

  // 5. A caller's own AbortSignal is respected (no extra timeout/retry layered on top).
  calls = 0;
  (globalThis as any).fetch = async (_u: string, init?: RequestInit) => { calls++; return init?.signal ? respond() : respond(); };
  const own = new AbortController();
  await api.timedFetch("/api/kot", { signal: own.signal });
  check("GET with caller signal: single attempt", calls === 1);

  // 6. An observer that throws never breaks the request.
  api.setRequestObserver(() => { throw new Error("observer bug"); });
  (globalThis as any).fetch = async () => respond();
  const r6 = await api.timedFetch("/api/tables");
  check("throwing observer is contained", r6.status === 200);

  api.setRequestObserver(null);
  (globalThis as any).fetch = realFetch;
  console.log(`${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
