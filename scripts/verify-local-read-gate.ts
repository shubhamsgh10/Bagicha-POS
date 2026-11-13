// Pure: which requests the shop PC's local server answers from its own database.
import { isLocalRead, isLocalOnly } from "../server/local/localReadGate";
import { readLocalModeConfig, isLocalMode } from "../server/local/localMode";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failures++;
}

const G = (path: string, query: Record<string, unknown> = {}, cov?: Date | null) => isLocalRead("GET", path, query, cov);

// listed paths
for (const p of ["/api/auth/me", "/api/menu", "/api/categories", "/api/tables", "/api/settings", "/api/live-status", "/api/kot", "/api/orders/customers", "/api/orders/hold"]) {
  check(`GET ${p} is local`, G(p));
}
check("trailing slash is tolerated", G("/api/menu/"));
check("query string on a listed path does not matter (/api/menu?all=true)", G("/api/menu", { all: "true" }));

// the staff-member cards must come from the cloud (PINs are not synced)
check("GET /api/staff-members proxies", !G("/api/staff-members"));

// non-GET never local
for (const m of ["POST", "PUT", "PATCH", "DELETE"]) check(`${m} /api/menu proxies`, !isLocalRead(m, "/api/menu"));
check("POST /api/orders proxies", !isLocalRead("POST", "/api/orders"));

// /api/orders needs a filter
check("bare /api/orders (whole history) proxies", !G("/api/orders"));
check("/api/orders?status=pending alone proxies", !G("/api/orders", { status: "pending" }));
check("/api/orders?endDate= alone proxies", !G("/api/orders", { endDate: "2026-11-14T00:00:00.000Z" }));
check("/api/orders?open=true is local", G("/api/orders", { open: "true" }));
check("/api/orders?unpaid=true is local", G("/api/orders", { unpaid: "true" }));
check("/api/orders?due=true is local", G("/api/orders", { due: "true" }));
check("/api/orders?updatedSince= is local", G("/api/orders", { updatedSince: "2026-11-14T00:00:00.000Z" }));
check("/api/orders?open=false is not a filter", !G("/api/orders", { open: "false" }));
check("/api/orders?open= (empty) is not a filter", !G("/api/orders", { open: "" }));
check("/api/orders?unpaid=true&endDate= (Billing backlog) is local", G("/api/orders", { unpaid: "true", endDate: "2026-11-14T00:00:00.000Z" }));

// dated lists only when the local copy covers them
const cov = new Date("2026-11-11T12:00:00.000Z");
check("dated list inside the coverage window is local", G("/api/orders", { startDate: "2026-11-13T23:30:00.000Z", endDate: "2026-11-14T23:29:59.999Z" }, cov));
check("dated list before the coverage window proxies", !G("/api/orders", { startDate: "2026-11-01T00:00:00.000Z", endDate: "2026-11-02T00:00:00.000Z" }, cov));
check("dated list with unknown coverage (no snapshot yet) proxies", !G("/api/orders", { startDate: "2026-11-13T23:30:00.000Z" }, null));
check("dated list with an unparseable date proxies", !G("/api/orders", { startDate: "not-a-date" }, cov));
check("dated list is local when coverage isn't being checked (undefined)", G("/api/orders", { startDate: "2026-11-13T23:30:00.000Z" }));

// single order
check("/api/orders/42 is local", G("/api/orders/42"));
check("/api/orders/42/items is not (not listed)", !G("/api/orders/42/items"));
check("/api/orders/abc proxies", !G("/api/orders/abc"));
check("/api/orders/due proxies", !G("/api/orders/due"));

// everything else
for (const p of ["/api/auth/context", "/api/reports/sales", "/api/print/preview", "/api/pusher/auth", "/api/staff", "/api/users", "/api/customers", "/api/health", "/api/sync/snapshot"]) {
  check(`GET ${p} proxies`, !G(p));
}
check("/api/auth/login proxies", !isLocalRead("POST", "/api/auth/login"));

// local-only endpoints
check("/api/local/status is local-only", isLocalOnly("/api/local/status"));
check("/api/local/sync-now is local-only", isLocalOnly("/api/local/sync-now"));
check("/api/locality is NOT local-only", !isLocalOnly("/api/locality"));
check("/api/menu is NOT local-only", !isLocalOnly("/api/menu"));

// env parsing
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
