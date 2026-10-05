/**
 * Verifies server/settingsCache.ts — the settings cache that must never silently serve
 * the built-in fallback defaults (18% tax, no printers) as if they were the restaurant's
 * real configuration.
 *
 * Root cause this locks in: a cold Vercel instance whose one-shot settings read failed fell
 * back to DEFAULT_SETTINGS forever, so orders saved on it were priced at 18% and bills/KOTs
 * found "no printer" and went to a browser window. See CLAUDE.md "Settings must be DB-live".
 *
 * Pure (no DB, no timers except one tiny real attempt-timeout case).
 * Run: npx tsx scripts/verify-settings-cache.ts
 */
import { createSettingsCache, SettingsUnavailableError } from "../server/settingsCache";

type S = { taxRate: number; tag: string };
const FALLBACK: S = { taxRate: 18, tag: "fallback" };
const REAL: S = { taxRate: 5, tag: "db" };

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

function harness(over: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  let t = 1_000_000;
  const state = { loads: 0, mode: "fail" as "fail" | "ok", value: REAL };
  const cache = createSettingsCache<S>({
    load: async () => {
      state.loads++;
      if (state.mode === "fail") throw new Error("db down");
      return state.value;
    },
    fallback: () => FALLBACK,
    attempts: 3,
    backoffMs: [250, 750],
    maxAgeMs: 60_000,
    staleRetryMs: 10_000,
    attemptTimeoutMs: 1_000,
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); },
    log: () => {},
    ...over,
  });
  return { cache, state, sleeps, advance: (ms: number) => { t += ms; } };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  return null;
}

async function main() {
  // 1. A failing boot read leaves the cache NOT live — fallback is readable but never "live".
  {
    const h = harness();
    const ok = await h.cache.init();
    check("failing init: returns false", ok === false);
    check("failing init: cache is not live", h.cache.isLive() === false);
    check("failing init: get() still returns the fallback (sync callers never crash)", h.cache.get().tag === "fallback");
    check("failing init: retried `attempts` times", h.state.loads === 3);
    check("failing init: backoff between attempts is 250ms then 750ms", JSON.stringify(h.sleeps) === "[250,750]");
    const err = (() => { try { h.cache.getLive(); return null; } catch (e) { return e; } })();
    check("getLive() throws SettingsUnavailableError when not live", err instanceof SettingsUnavailableError);
    check("…with HTTP status 503", (err as any)?.status === 503);
  }

  // 2. ensureLive() self-heals as soon as the DB is reachable again.
  {
    const h = harness();
    await h.cache.init();
    h.state.mode = "ok";
    await h.cache.ensureLive();
    check("ensureLive recovers once the loader recovers", h.cache.isLive() === true);
    check("recovered cache serves the DB value, not the fallback", h.cache.get().taxRate === 5 && h.cache.getLive().tag === "db");
  }

  // 3. …and refuses (503) while the DB is still unreachable — never serves the fallback.
  {
    const h = harness();
    await h.cache.init();
    const e = await rejects(h.cache.ensureLive());
    check("ensureLive rejects with SettingsUnavailableError while the loader still fails", e instanceof SettingsUnavailableError && (e as any).status === 503);
    check("cache stays not-live after a failed ensureLive", h.cache.isLive() === false);
  }

  // 4. The boot counter-sync (afterLoad) failing must NOT discard successfully loaded settings.
  {
    const h = harness();
    h.state.mode = "ok";
    const ok = await h.cache.init(async () => { throw new Error("counter sync failed"); });
    check("afterLoad throwing: init still reports the settings load as successful", ok === true);
    check("afterLoad throwing: settings stay live with the DB value", h.cache.isLive() && h.cache.get().tag === "db");
  }

  // 5. afterLoad is skipped when the load itself failed (never repair counters from a fallback blob).
  {
    const h = harness();
    let ran = false;
    await h.cache.init(async () => { ran = true; });
    check("afterLoad does not run when the settings load failed", ran === false);
  }

  // 6. Concurrent callers share ONE load.
  {
    const h = harness();
    h.state.mode = "ok";
    await Promise.all([h.cache.ensureLive(), h.cache.ensureLive(), h.cache.ensureLive(), h.cache.refresh()]);
    check("concurrent ensureLive/refresh calls share a single DB load", h.state.loads === 1);
  }

  // 7. A slow refresh that started BEFORE a save must not overwrite the saved value.
  {
    let release!: (v: S) => void;
    const h = harness({ load: () => new Promise<S>((res) => { release = res; }) });
    const p = h.cache.refresh();
    await tick();
    h.cache.set({ taxRate: 7, tag: "saved" });
    release({ taxRate: 5, tag: "older-read" });
    await p;
    check("stale in-flight refresh does not override a newer set()", h.cache.get().tag === "saved");
    check("set() marks the cache live", h.cache.isLive() === true);
  }

  // 8. TTL: fresh → no reload; stale → reload picks up cross-instance edits.
  {
    const h = harness();
    h.state.mode = "ok";
    await h.cache.init();
    await h.cache.ensureLive();
    check("fresh cache: ensureLive does not hit the DB", h.state.loads === 1);
    h.advance(61_000);
    h.state.value = { taxRate: 12, tag: "edited-elsewhere" };
    await h.cache.ensureLive();
    check("stale cache: ensureLive reloads", h.state.loads === 2);
    check("stale reload picks up the edit made by another instance", h.cache.get().taxRate === 12);
  }

  // 9. A failed refresh while live keeps the last real value, makes ONE attempt, and backs off.
  {
    const h = harness();
    h.state.mode = "ok";
    await h.cache.init();
    h.state.mode = "fail";
    h.advance(61_000);
    const sleepsBefore = h.sleeps.length;
    const loadsBefore = h.state.loads;
    await h.cache.ensureLive();
    check("stale + DB down: ensureLive does not throw", true);
    check("stale + DB down: keeps serving the last real value", h.cache.isLive() && h.cache.get().tag === "db");
    check("stale + DB down: a single attempt, no retry sleeps on the request path", h.state.loads === loadsBefore + 1 && h.sleeps.length === sleepsBefore);
    await h.cache.ensureLive();
    check("stale + DB down: does not hammer the DB again within staleRetryMs", h.state.loads === loadsBefore + 1);
    h.advance(11_000);
    await h.cache.ensureLive();
    check("stale + DB down: tries again after staleRetryMs", h.state.loads === loadsBefore + 2);
  }

  // 10. Retry: first attempt fails, second succeeds.
  {
    const h = harness();
    let n = 0;
    const cache = createSettingsCache<S>({
      load: async () => { n++; if (n < 2) throw new Error("blip"); return REAL; },
      fallback: () => FALLBACK, attempts: 3, backoffMs: [250, 750],
      sleep: async (ms: number) => { h.sleeps.push(ms); }, log: () => {},
    });
    const ok = await cache.refresh();
    check("transient blip: retried and succeeded", ok === true && n === 2 && cache.isLive());
    check("transient blip: slept the first backoff once", JSON.stringify(h.sleeps) === "[250]");
  }

  // 11. A loader that never answers counts as a failed attempt (bounded boot / request time).
  {
    const h = harness({ load: () => new Promise<S>(() => {}), attempts: 2, attemptTimeoutMs: 15 });
    const t0 = Date.now();
    const ok = await h.cache.refresh();
    check("hung loader: times out per attempt and reports failure", ok === false && h.cache.isLive() === false);
    check("hung loader: bounded (2 × 15ms, not forever)", Date.now() - t0 < 1_500);
  }

  // 12. reset() drops liveness (used by the bench to restore real settings).
  {
    const h = harness();
    h.cache.set(REAL);
    h.cache.reset();
    check("reset(): not live and back to the fallback", h.cache.isLive() === false && h.cache.get().tag === "fallback");
  }

  // 13. set() right after boot counts as fresh — no immediate reload.
  {
    const h = harness();
    h.cache.set(REAL);
    await h.cache.ensureLive();
    check("after set(): ensureLive does not reload within the TTL", h.state.loads === 0);
  }

  // 14. patch() (used for bill/KOT counters) must not make a cache look fresher than it is —
  //     otherwise an instance that issues order numbers every few seconds would never re-read
  //     the tax rate / printers another instance saved.
  {
    const h = harness();
    h.state.mode = "ok";
    await h.cache.init();
    h.cache.patch((s) => ({ ...s, tag: "patched" }));
    check("patch(): updates the value in place", h.cache.get().tag === "patched");
    h.advance(61_000);
    await h.cache.ensureLive();
    check("patch(): does not extend freshness — a stale cache still reloads", h.state.loads === 2);

    const cold = harness();
    cold.cache.patch((s) => ({ ...s, tag: "x" }));
    check("patch(): no-op, and not live, when nothing has loaded", cold.cache.isLive() === false && cold.cache.get().tag === "fallback");
  }

  // 15. refresh({attempts:1}) makes exactly one attempt (used on the GET /api/settings hot path).
  {
    const h = harness();
    await h.cache.refresh({ attempts: 1 });
    check("refresh({attempts:1}): one attempt, no backoff sleeps", h.state.loads === 1 && h.sleeps.length === 0);
  }
}

main()
  .then(() => {
    let failed = 0;
    for (const [name, ok] of checks) {
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
      if (!ok) failed++;
    }
    console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("verify-settings-cache crashed:", e);
    process.exit(1);
  });
