/**
 * Verifies packages/api-client/stallBreaker.ts (the desktop stall breaker's pure rules) and
 * shared/rollingBudget.ts (the "at most N diagnostic reports per hour" budget). Pure: fake clock.
 * Run: npx tsx scripts/verify-stall-breaker.ts
 */
import {
  DEFAULT_STALL_TIMINGS,
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  decideAfterCheck,
  shouldRetry,
  hasIdempotencyKey,
  newIdempotencyKey,
} from "../packages/api-client/stallBreaker";
import { IDEMPOTENCY_HEADER as SERVER_HEADER, REPLAYED_HEADER as SERVER_REPLAYED, isValidIdempotencyKey } from "../shared/requestKeys";
import { createRollingBudget } from "../shared/rollingBudget";

const checks: Array<[string, boolean]> = [];
const T = DEFAULT_STALL_TIMINGS;

checks.push(["production timings: check after 1.5 s, check timeout 1.5 s, one reset per 10 s",
  T.checkAfterMs === 1500 && T.checkTimeoutMs === 1500 && T.resetMinGapMs === 10_000]);
checks.push(["worst-case detection (check after + check timeout) stays ≤ 3.5 s", T.checkAfterMs + T.checkTimeoutMs <= 3500]);
checks.push(["client and server agree on the key header", IDEMPOTENCY_HEADER === SERVER_HEADER]);
checks.push(["client and server agree on the replayed header", REPLAYED_HEADER === SERVER_REPLAYED]);

// decideAfterCheck
checks.push(["check answered → keep waiting (server just slow)", decideAfterCheck("answered", 50_000, null, T) === "keep_waiting"]);
checks.push(["check silent, no earlier reset → reset", decideAfterCheck("silent", 50_000, null, T) === "reset"]);
checks.push(["check silent, reset 3 s ago → keep waiting (connection just renewed)", decideAfterCheck("silent", 50_000, 47_000, T) === "keep_waiting"]);
checks.push(["check silent, reset exactly 10 s ago → reset", decideAfterCheck("silent", 50_000, 40_000, T) === "reset"]);

// shouldRetry
const R = (method: string, keyed: boolean, failure: "reset_by_this_request" | "network" | "timeout" | "caller_aborted", hasCallerSignal = false, breakerActive = true) =>
  shouldRetry({ method, keyed, hasCallerSignal, breakerActive, failure });
checks.push(["GET after its own reset → retry", R("GET", false, "reset_by_this_request")]);
checks.push(["GET after a timeout → retry (unchanged behaviour)", R("GET", false, "timeout")]);
checks.push(["GET after a network error → retry (unchanged behaviour)", R("GET", false, "network")]);
checks.push(["GET with a caller signal, network error → no retry (unchanged behaviour)", !R("GET", false, "network", true)]);
checks.push(["GET with a caller signal, reset by the breaker → retry", R("GET", false, "reset_by_this_request", true)]);
checks.push(["caller aborted → never retry", !R("GET", false, "caller_aborted")]);
checks.push(["keyed POST after its own reset → retry", R("POST", true, "reset_by_this_request")]);
checks.push(["keyed POST after a network error (another request's reset) → retry", R("POST", true, "network")]);
checks.push(["UNKEYED POST after a reset → never resent", !R("POST", false, "reset_by_this_request")]);
checks.push(["UNKEYED PUT after a network error → never resent", !R("PUT", false, "network")]);
checks.push(["keyed POST network error with the breaker OFF (browser) → no retry (unchanged)", !R("POST", true, "network", false, false)]);

// Key helpers
checks.push(["hasIdempotencyKey: plain object", hasIdempotencyKey({ [IDEMPOTENCY_HEADER]: "abcdefgh1" })]);
checks.push(["hasIdempotencyKey: case-insensitive", hasIdempotencyKey({ "idempotency-key": "abcdefgh1" })]);
checks.push(["hasIdempotencyKey: Headers instance", hasIdempotencyKey(new Headers({ [IDEMPOTENCY_HEADER]: "abcdefgh1" }))]);
checks.push(["hasIdempotencyKey: none", !hasIdempotencyKey({ "Content-Type": "application/json" }) && !hasIdempotencyKey(undefined)]);
const k1 = newIdempotencyKey();
const k2 = newIdempotencyKey();
checks.push(["new keys are valid for the server", isValidIdempotencyKey(k1) && isValidIdempotencyKey(k2)]);
checks.push(["new keys differ", k1 !== k2]);

// Rolling budget (60 per hour)
{
  const b = createRollingBudget(3, 60_000);
  const took = [b.tryTake(0), b.tryTake(1), b.tryTake(2), b.tryTake(3)];
  checks.push(["budget: first N allowed, then refused", took.join() === "true,true,true,false"]);
  // At 60_000 the report from t=0 has left the window (60_000 - 0 is not < 60_000); 1 and 2 have not.
  checks.push(["budget: refills as old reports age out of the window", b.tryTake(60_000) === true]);
  checks.push(["budget: still at most N in any window after refill", b.tryTake(60_000) === false]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
