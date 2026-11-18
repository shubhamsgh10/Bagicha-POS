/** DB-free checks for shared/clientErrorReport.ts (crash reports from clients, POST /api/client-errors). */
import {
  sanitizeClientErrorReport,
  clientErrorLogLine,
  clientErrorSignature,
  topStackFrame,
  CLIENT_ERROR_LIMITS,
} from "../shared/clientErrorReport";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}`); }
}

const stack = "TypeError: Cannot read properties of null (reading 'filter')\n    at Tables (index-abc.js:12:34)\n    at renderWithHooks (index-abc.js:1:2)";
const good = {
  errorId: "M3X9-AB12",
  kind: "render",
  name: "TypeError",
  message: "Cannot read properties of null (reading 'filter')",
  stack,
  componentStack: "\n    at Tables\n    at Router",
  route: "/tables",
  appVersion: "1.0.43",
  electron: true,
  online: true,
  hidden: false,
  uptimeS: 3600.4,
  signedIn: true,
  persisted: true,
  userAgent: "Mozilla/5.0 Electron/33",
  requests: [
    { m: "GET", p: "/api/live-status", s: 200, ms: 80, ago: 20 },
    { m: "GET", p: "/api/tables?x=1", s: 401, ms: 120, ago: 1 },
    { m: "GET", p: "/api/ping", s: null, ms: 8000, ago: 0, to: true },
  ],
  queryErrors: [{ key: "/api/tables", msg: "401: Unauthorized", ago: 1 }],
};

const r = sanitizeClientErrorReport(good)!;
check("accepts a well-formed report", r !== null);
check("keeps kind/message/route", r.kind === "render" && r.message.startsWith("Cannot read") && r.route === "/tables");
check("rounds numbers", r.uptimeS === 3600);
check("strips the query string from request paths", r.requests[1].p === "/api/tables");
check("keeps timeout flag", r.requests[2].to === true && r.requests[2].s === null);
check("keeps query errors", r.queryErrors.length === 1 && r.queryErrors[0].key === "/api/tables");

check("rejects a non-object", sanitizeClientErrorReport("boom") === null && sanitizeClientErrorReport(null) === null && sanitizeClientErrorReport([1]) === null);
check("rejects an unknown kind", sanitizeClientErrorReport({ ...good, kind: "nope" }) === null);
check("rejects an empty message", sanitizeClientErrorReport({ ...good, message: "" }) === null);
check("bad error id becomes 'unknown'", sanitizeClientErrorReport({ ...good, errorId: "<script>" })!.errorId === "unknown");

const huge = sanitizeClientErrorReport({
  ...good,
  message: "x".repeat(10_000),
  stack: "y".repeat(100_000),
  componentStack: "z".repeat(100_000),
  route: "/".repeat(5000),
  requests: Array.from({ length: 500 }, (_, i) => ({ m: "GET", p: `/api/r${i}`, s: 200, ms: 1, ago: 1 })),
  queryErrors: Array.from({ length: 500 }, (_, i) => ({ key: `/api/q${i}`, msg: "m".repeat(5000), ago: 1 })),
})!;
check("clamps message", huge.message.length === CLIENT_ERROR_LIMITS.message);
check("clamps stack", huge.stack!.length === CLIENT_ERROR_LIMITS.stack);
check("clamps component stack", huge.componentStack!.length === CLIENT_ERROR_LIMITS.componentStack);
check("clamps route", huge.route!.length === CLIENT_ERROR_LIMITS.route);
check("keeps only the LAST requests", huge.requests.length === CLIENT_ERROR_LIMITS.requests && huge.requests.at(-1)!.p === "/api/r499");
check("clamps query errors", huge.queryErrors.length === CLIENT_ERROR_LIMITS.queryErrors && huge.queryErrors[0].msg.length === 200);
check("worst case stays small", JSON.stringify(huge).length < 16_000);

const typed = sanitizeClientErrorReport({ ...good, electron: "yes", uptimeS: "1", requests: [{ p: 5 }, "x", { p: "/api/a", s: "200" }] })!;
check("wrongly typed fields become null", typed.electron === null && typed.uptimeS === null);
check("junk request rows are dropped / normalised", typed.requests.length === 1 && typed.requests[0].s === null && typed.requests[0].m === "?");

const line = clientErrorLogLine(r, "u:4:rajbhaghel");
check("log line is one searchable line", !line.includes("\n") && line.startsWith("[client-error] M3X9-AB12 render TypeError"));
check("log line names the route, app and actor", line.includes("route=/tables") && line.includes("desktop 1.0.43") && line.includes("actor=u:4:rajbhaghel"));
check("log line lists recent failed requests", line.includes("GET /api/tables 401") && line.includes("GET /api/ping timeout"));
check("log line shows top frame", line.includes("at=Tables (index-abc.js:12:34)"));
check("signed-out is flagged", clientErrorLogLine({ ...r, signedIn: false }).includes("signed-out"));

check("topStackFrame finds the first frame", topStackFrame(stack) === "at Tables (index-abc.js:12:34)");
check("topStackFrame handles no stack", topStackFrame(null) === null);
check("signature: same error twice is equal", clientErrorSignature("render", "a", stack) === clientErrorSignature("render", "a", stack));
check("signature: different frame differs", clientErrorSignature("render", "a", stack) !== clientErrorSignature("render", "a", "Error\n    at Other (x.js:1:1)"));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log("\nAll passed");
