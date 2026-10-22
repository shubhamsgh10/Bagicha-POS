/**
 * Verifies client/src/lib/queueCheckCache.ts — the cache behind the desktop host's "does this Windows
 * printer queue exist?" check that runs before it claims every print job. The check spawns a fresh
 * PowerShell (~1.0–1.2 s measured), and the old cache only remembered a "yes" for 30 s, so ~95% of prints
 * waited ~1.1 s just to be told what it already knew. This cache answers "yes" instantly for hours and
 * re-verifies in the background (stale-while-revalidate). A "no" is NEVER cached or served stale: the
 * protection against a second PC with no such queue grabbing jobs must keep working.
 * Run: npx tsx scripts/verify-queue-check-cache.ts
 */
import { createQueueCheckCache } from "../client/src/lib/queueCheckCache";

const checks: Array<[string, boolean]> = [];
const add = (name: string, ok: boolean) => checks.push([name, ok]);

/** A check() whose answers the test controls, and that counts its calls. */
function controllableCheck() {
  const calls: Array<{ queue: string; resolve: (v: boolean) => void; reject: (e: Error) => void }> = [];
  const check = (queue: string) =>
    new Promise<boolean>((resolve, reject) => { calls.push({ queue, resolve, reject }); });
  return { check, calls };
}
/** "resolved" if p settles within a macrotask tick, else "pending" — distinguishes instant from awaiting. */
const state = (p: Promise<unknown>) =>
  Promise.race([p.then(() => "resolved", () => "rejected"), new Promise<string>((r) => setImmediate(() => r("pending")))]);
const tick = () => new Promise<void>((r) => setImmediate(r));

const FRESH = 30_000, MAX_STALE = 12 * 3_600_000;
function make(initial = 1_000_000) {
  let t = initial;
  const c = controllableCheck();
  const cache = createQueueCheckCache({ check: c.check, now: () => t, freshMs: FRESH, maxStaleMs: MAX_STALE });
  return { cache, c, advance: (ms: number) => { t += ms; } };
}

(async () => {
  // 1. First ever call has nothing to go on → it must wait for the real check.
  {
    const { cache, c } = make();
    const p = cache.exists("Q");
    add("first call waits for the real check", (await state(p)) === "pending" && c.calls.length === 1);
    c.calls[0].resolve(true);
    add("…and returns its answer", (await p) === true);
  }

  // 2. Fresh (< 30 s): instant, no new check.
  {
    const { cache, c, advance } = make();
    const first = cache.exists("Q"); c.calls[0].resolve(true); await first;
    advance(29_000);
    const p = cache.exists("Q");
    add("within 30 s: instant yes, no new check", (await state(p)) === "resolved" && (await p) === true && c.calls.length === 1);
  }

  // 3. Stale (30 s – 12 h): instant yes + exactly ONE background re-check, even while that check is slow.
  {
    const { cache, c, advance } = make();
    const first = cache.exists("Q"); c.calls[0].resolve(true); await first;
    advance(31_000);
    const p = cache.exists("Q");
    add("stale: still an instant yes (does not wait for PowerShell)", (await state(p)) === "resolved" && (await p) === true);
    add("stale: one background re-check started", c.calls.length === 2);
    const p2 = cache.exists("Q"); const p3 = cache.exists("Q");
    add("stale: more callers while it is in flight do NOT start another check", (await state(p2)) === "resolved" && (await state(p3)) === "resolved" && c.calls.length === 2);
    c.calls[1].resolve(true); await tick();
    advance(5_000);
    const p4 = cache.exists("Q");
    add("after the background 'yes' lands the entry is fresh again (no new check)", (await p4) === true && c.calls.length === 2);
  }

  // 4. Background re-check says NO → the cached yes is dropped; the next caller waits for a real answer.
  {
    const { cache, c, advance } = make();
    const first = cache.exists("Q"); c.calls[0].resolve(true); await first;
    advance(60_000);
    const stale = cache.exists("Q"); await stale;      // instant yes + background check
    c.calls[1].resolve(false); await tick();            // queue is gone
    const next = cache.exists("Q");
    add("after a background 'no' the next call waits for a fresh check", (await state(next)) === "pending" && c.calls.length === 3);
    c.calls[2].resolve(false);
    add("…and a confirmed 'no' is returned as false", (await next) === false);
  }

  // 5. A 'no' is never cached.
  {
    const { cache, c } = make();
    const a = cache.exists("Q"); c.calls[0].resolve(false); await a;
    const b = cache.exists("Q");
    add("'no' is not cached: asking again runs the check again", c.calls.length === 2 && (await state(b)) === "pending");
    c.calls[1].resolve(true);
    add("…and a later 'yes' is accepted", (await b) === true);
  }

  // 6. Older than the max-stale window (12 h) → don't trust it; wait for a real check.
  {
    const { cache, c, advance } = make();
    const first = cache.exists("Q"); c.calls[0].resolve(true); await first;
    advance(MAX_STALE + 1_000);
    const p = cache.exists("Q");
    add("older than 12 h: waits for a real check instead of serving the old yes", (await state(p)) === "pending" && c.calls.length === 2);
    c.calls[1].resolve(true); await p;
  }

  // 7. Concurrent first callers share one check (the tab's own print path + the broadcast listener both ask).
  {
    const { cache, c } = make();
    const a = cache.exists("Q"); const b = cache.exists("Q");
    add("two concurrent first callers share ONE check", c.calls.length === 1);
    c.calls[0].resolve(true);
    add("…and both get the answer", (await a) === true && (await b) === true);
  }

  // 8. prewarm: starts a background check when unverified/stale, no-op when fresh, shares in-flight.
  {
    const { cache, c, advance } = make();
    cache.prewarm("Q");
    add("prewarm on an unverified queue starts one check", c.calls.length === 1);
    cache.prewarm("Q");
    add("…a second prewarm shares it", c.calls.length === 1);
    const p = cache.exists("Q");
    add("…and exists() joins the same check", c.calls.length === 1 && (await state(p)) === "pending");
    c.calls[0].resolve(true); await p;
    cache.prewarm("Q");
    add("prewarm on a fresh queue does nothing", c.calls.length === 1);
    advance(31_000);
    cache.prewarm("Q");
    add("prewarm on a stale queue re-verifies in the background", c.calls.length === 2);
    c.calls[1].resolve(true); await tick();
  }

  // 9. Queues are independent.
  {
    const { cache, c } = make();
    const a = cache.exists("A"); const b = cache.exists("B");
    add("different queues each get their own check", c.calls.length === 2 && c.calls[0].queue === "A" && c.calls[1].queue === "B");
    c.calls[0].resolve(true); c.calls[1].resolve(false);
    add("…with their own answers", (await a) === true && (await b) === false);
  }

  // 10. A background re-check that throws is swallowed: no crash, and the entry keeps serving.
  {
    const { cache, c, advance } = make();
    const first = cache.exists("Q"); c.calls[0].resolve(true); await first;
    advance(31_000);
    await cache.exists("Q");
    let unhandled = false;
    const onUnhandled = () => { unhandled = true; };
    process.once("unhandledRejection", onUnhandled);
    c.calls[1].reject(new Error("powershell crashed")); await tick(); await tick();
    process.off("unhandledRejection", onUnhandled);
    const p = cache.exists("Q");
    add("a throwing background check is swallowed (no unhandled rejection)", !unhandled);
    add("…and the previous 'yes' still serves, with a retry started", (await state(p)) === "resolved" && (await p) === true && c.calls.length === 3);
    c.calls[2].resolve(true); await tick();
  }

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
