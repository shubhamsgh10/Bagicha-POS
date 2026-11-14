/**
 * Locks which routes accept a one-time request key (server/requestKeys.ts) and that their client
 * callers send one — the desktop stall breaker only resends a write that carries a key, so a keyed
 * route with an unkeyed caller (or the reverse) silently loses the retry. Source-level, DB-free.
 * Run: npx tsx scripts/verify-keyed-routes.ts
 *
 * verify-pin and cancel were added on 10 Nov 2026: a cancel makes two trips (PIN check, then the
 * save/cancel) and on 9 Nov both waited out the shop PC's ~10 s dead-connection stall, never retried.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const routes = read("server/routes.ts");
const printRoutes = read("server/printRoutes.ts");

const checks: Array<[string, boolean]> = [];

/** The middleware list of `app.<method>("<path>", …, async` — null when the route isn't found. */
function middlewares(src: string, method: string, routePath: string): string[] | null {
  const esc = routePath.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const m = new RegExp(`app\\.${method}\\(\\s*"${esc}"\\s*,([^]*?)async\\s*\\(`).exec(src);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

const keyed: Array<[string, string, string]> = [
  [routes, "post", "/api/orders"],
  [routes, "put", "/api/orders/:id/items"],
  [routes, "post", "/api/orders/:id/payment"],
  [routes, "post", "/api/auth/verify-pin"],
  [routes, "put", "/api/orders/:id/cancel"],
  // Every other route on the shop PC's replay list (shared/replayRules.ts isReplayable): a replayed
  // entry whose answer was lost must replay the stored answer, not hit a false base conflict.
  [routes, "put", "/api/orders/:id/hold"],
  [routes, "put", "/api/orders/:id/recall"],
  [routes, "post", "/api/orders/:id/bill-requested"],
  [routes, "put", "/api/orders/:id"],
  [routes, "put", "/api/orders/:id/move-table"],
  [routes, "post", "/api/tables/:id/shift"],
  [routes, "put", "/api/kot/:id"],
  [routes, "post", "/api/orders/:id/settle-due"],
  [routes, "post", "/api/orders/:id/payment-method"],
  [printRoutes, "post", "/api/print/kot"],
  [printRoutes, "post", "/api/print/bill"],
  [printRoutes, "post", "/api/print/jobs/:id/claim"],
];
for (const [src, method, p] of keyed) {
  const mw = middlewares(src, method, p);
  checks.push([`${method.toUpperCase()} ${p} mounts requestKeys right after requireAuth`,
    !!mw && mw[0] === "requireAuth" && mw[1] === "requestKeys"]);
}

// verify-pin: the key must be checked BEFORE the PIN limiter, so a replayed answer is never counted
// as a wrong guess (the limiter counts a request as failed unless the handler sets res.locals.pinOk).
const pinMw = middlewares(routes, "post", "/api/auth/verify-pin");
checks.push(["verify-pin: requestKeys runs before pinLimiter",
  !!pinMw && pinMw.indexOf("requestKeys") >= 0 && pinMw.indexOf("requestKeys") < pinMw.indexOf("pinLimiter")]);
// cancel keeps its elevation gate.
const cancelMw = middlewares(routes, "put", "/api/orders/:id/cancel");
checks.push(["cancel: still requireElevation(\"manager\")", !!cancelMw && cancelMw.includes('requireElevation("manager")')]);

// Client callers send a key.
const pinGuard = read("client/src/components/PinGuard.tsx");
checks.push(["PinGuard sends verify-pin with a one-time key",
  /apiRequest\(\s*"POST",\s*"\/api\/auth\/verify-pin",[^;]*\{\s*idempotent:\s*true\s*\}/.test(pinGuard)]);
const pos = read("client/src/pages/POS.tsx");
checks.push(["POS sends Cancel Order with a one-time key",
  /apiRequest\(\s*"PUT",\s*`\/api\/orders\/\$\{activeOrderId\}\/cancel`,[^;]*\{\s*idempotent:\s*true\s*\}/.test(pos)]);

// The other replay-list callers send keys too (so a stalled/lost answer retries instead of conflicting).
const callers: Array<[string, RegExp]> = [
  ["client/src/components/DueSettleDialog.tsx", /settle-due`[^;]*\{\s*idempotent:\s*true\s*\}/s],
  ["client/src/components/PaymentMethodDialog.tsx", /payment-method`[^;]*\{\s*idempotent:\s*true\s*\}/s],
  ["client/src/pages/POS.tsx", /move-table`[^;]*\{\s*idempotent:\s*true\s*\}/s],
  ["client/src/pages/POS.tsx", /\/hold`[^;]*\{\s*idempotent:\s*true\s*\}/s],
  ["client/src/pages/POS.tsx", /\/recall`[^;]*\{\s*idempotent:\s*true\s*\}/s],
  ["client/src/pages/KOT.tsx", /\/api\/kot\/\$\{id\}`[^;]*\{\s*idempotent:\s*true\s*\}/s],
  ["client/src/pages/Orders.tsx", /\/api\/orders\/\$\{id\}`,\s*\{\s*status\s*\},\s*\{\s*idempotent:\s*true\s*\}/s],
  ["client/src/pages/Tables.tsx", /shift`[^;]*\{\s*idempotent:\s*true\s*\}/s],
];
for (const [file, re] of callers) checks.push([`${file} sends a one-time key (${re.source.slice(0, 24)}…)`, re.test(read(file))]);

// Every route on the replay list must mount requestKeys (server/sync/replay.ts skips the base check only for a true keyed retry).
{
  const mounted = new Set(keyed.map(([, m, p]) => `${m} ${p}`));
  for (const rp of ["post /api/orders", "put /api/orders/:id/items", "put /api/orders/:id", "post /api/orders/:id/payment", "put /api/orders/:id/cancel",
    "put /api/orders/:id/hold", "put /api/orders/:id/recall", "put /api/orders/:id/move-table", "post /api/tables/:id/shift", "post /api/print/kot",
    "post /api/print/bill", "post /api/orders/:id/bill-requested", "put /api/kot/:id", "post /api/orders/:id/settle-due", "post /api/orders/:id/payment-method"]) {
    checks.push([`replay-list route ${rp} is keyed`, mounted.has(rp)]);
  }
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} keyed-route checks passed`);
