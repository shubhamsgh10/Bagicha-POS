// Pure: which requests the shop PC's local server answers from its own database.
import { isLocalRead, isLocalOnly } from "../server/local/localReadGate";
import { readLocalModeConfig, isLocalMode } from "../server/local/localMode";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}

import { isCloudOnlyGet, isCloudFirstGet, classifyWrite, CLOUD_ONLY_GET_PREFIXES } from "../server/local/localReadGate";
const G = (path: string, query: Record<string, unknown> = {}) => isLocalRead("GET", path, query);

// Phase 4: EVERY GET is local unless it is on the short cloud-only list.
for (const p of ["/api/auth/me", "/api/menu", "/api/categories", "/api/tables", "/api/settings", "/api/live-status", "/api/kot", "/api/orders/customers",
  "/api/orders/hold", "/api/orders", "/api/orders/42", "/api/orders/due", "/api/reports/sales", "/api/staff", "/api/users", "/api/inventory",
  "/api/customers/search", "/api/attendance/today", "/api/payroll/people", "/api/admin/audit-logs", "/api/staff-members", "/api/health", "/api/print/jobs/pending",
  "/api/loyalty/9999999999", "/api/dashboard/stats", "/api/coupons"]) {
  check(`GET ${p} is local`, G(p));
}
check("an unfiltered whole-history /api/orders is local too (full history is synced)", G("/api/orders", {}));
check("trailing slash is tolerated", G("/api/menu/"));
for (const p of ["/api/whatsapp/status", "/api/whatsapp/conversations", "/api/automation/config", "/api/crm/segments", "/api/razorpay/status", "/api/feedback/stats",
  "/api/digest/history", "/api/sync/devices", "/api/pusher/auth", "/api/realtime/config", "/api/auth/2fa/status", "/api/admin/backups", "/api/coupons/redemptions"]) {
  check(`GET ${p} is cloud-only`, isCloudOnlyGet(p) && !G(p));
}
check("/api/couponsX is not swallowed by the /api/coupons/redemptions rule", !isCloudOnlyGet("/api/coupons"));
check("/api/auth/context is cloud-first (local fallback offline)", isCloudFirstGet("/api/auth/context") && !G("/api/auth/context"));
check("cloud-only list is the documented 12 prefixes", CLOUD_ONLY_GET_PREFIXES.length === 12);

// writes
const W = (m: string, p: string) => classifyWrite(m, p);
check("login paths are cloud-first", ["/api/auth/login", "/api/auth/card-login", "/api/auth/staff-pin-login"].every((p) => W("POST", p) === "login"));
check("verify-pin is local", W("POST", "/api/auth/verify-pin") === "verify-pin");
check("logout goes through the proxy", W("POST", "/api/auth/logout") === "logout");
for (const [m, p] of [["POST", "/api/orders"], ["PUT", "/api/orders/5/items"], ["PUT", "/api/orders/5"], ["POST", "/api/orders/5/payment"], ["PUT", "/api/orders/5/cancel"],
  ["PUT", "/api/orders/5/hold"], ["PUT", "/api/orders/5/recall"], ["PUT", "/api/orders/5/move-table"], ["POST", "/api/tables/2/shift"], ["POST", "/api/print/kot"],
  ["POST", "/api/print/bill"], ["POST", "/api/orders/5/bill-requested"], ["PUT", "/api/kot/9"], ["POST", "/api/orders/5/settle-due"], ["POST", "/api/orders/5/payment-method"]]) {
  check(`${m} ${p} is replayed`, W(m, p) === "replay");
}
for (const [m, p] of [["POST", "/api/orders/merge"], ["POST", "/api/orders/5/split"], ["POST", "/api/orders/5/ebill"], ["POST", "/api/coupons/apply"], ["POST", "/api/loyalty/redeem"],
  ["POST", "/api/menu"], ["PUT", "/api/menu/3"], ["POST", "/api/categories"], ["PUT", "/api/tables/3"], ["PUT", "/api/inventory/3"], ["POST", "/api/staff-members"],
  ["PUT", "/api/settings"], ["POST", "/api/razorpay/create-order"], ["POST", "/api/whatsapp/send"], ["DELETE", "/api/menu/3"], ["POST", "/api/dues/settle-customer"], ["POST", "/api/auth/2fa/setup"]]) {
  check(`${m} ${p} is online-only`, W(m, p) === "online-only");
}
check("print plumbing (ack/claim) stays local, not replayed", W("POST", "/api/print/ack") === "local" && W("POST", "/api/print/jobs/4/claim") === "local");
check("telemetry is quiet", W("POST", "/api/perf/slow-print") === "quiet");
check("non-GET is never a local read", !isLocalRead("POST", "/api/menu") && !isLocalRead("PUT", "/api/orders/1"));
check("local-only endpoints", isLocalOnly("/api/local/status") && isLocalOnly("/api/local/problems/3/retry") && !isLocalOnly("/api/localx"));

const base = { BAGICHA_LOCAL_MODE: "1", BAGICHA_DB: "pglite", BAGICHA_PGLITE_DIR: "C:\\data\\localdb", BAGICHA_CLOUD_URL: "https://x.vercel.app/", BAGICHA_DEVICE_TOKEN: "a".repeat(64) } as NodeJS.ProcessEnv;
check("isLocalMode only for exactly '1'", isLocalMode(base) && !isLocalMode({}) && !isLocalMode({ BAGICHA_LOCAL_MODE: "true" }));
const cfg = readLocalModeConfig(base);
check("config parsed, trailing slash stripped", cfg.cloudUrl === "https://x.vercel.app" && cfg.pgliteDir === "C:\\data\\localdb" && cfg.deviceToken.length === 64);
for (const k of ["BAGICHA_DB", "BAGICHA_PGLITE_DIR", "BAGICHA_CLOUD_URL", "BAGICHA_DEVICE_TOKEN"]) {
  const e = { ...base, [k]: "" } as NodeJS.ProcessEnv;
  let msg = "";
  try { readLocalModeConfig(e); } catch (err: any) { msg = err.message; }
  check(`missing ${k} fails with a clear message`, msg.includes("BAGICHA_LOCAL_MODE=1 needs") && msg.includes(k === "BAGICHA_DB" ? "BAGICHA_DB=pglite" : k), msg);
}
let bad = "";
try { readLocalModeConfig({ ...base, BAGICHA_DB: "pg" } as NodeJS.ProcessEnv); } catch (err: any) { bad = err.message; }
check("BAGICHA_DB other than pglite is refused", bad.includes("BAGICHA_DB=pglite"));

console.log(failures === 0 ? "\nAll local-read-gate checks passed" : `\n${failures} local-read-gate check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
