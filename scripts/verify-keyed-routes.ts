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
