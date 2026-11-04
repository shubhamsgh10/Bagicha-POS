/**
 * Verifies server/csrf.ts's decideCsrf — the cross-site request forgery rule in front of every
 * state-changing /api request. Real clients must pass (same-origin phones, the Electron host on
 * localhost:5179, the thin client that sends NO Origin, webhooks, dev on an ALLOWED_ORIGINS entry);
 * a form / no-cors fetch from another site or a sandboxed iframe (Origin: null) must not.
 * Run: npx tsx scripts/verify-csrf.ts
 */
import { decideCsrf, type CsrfInput } from "../server/csrf";

const checks: Array<[string, boolean]> = [];
const base: CsrfInput = {
  method: "POST",
  origin: undefined,
  hosts: ["bagicha-pos.vercel.app"],
  contentType: undefined,
  xRequestedWith: undefined,
  allowedOrigins: ["http://localhost:5173", "http://localhost:5000"],
};
const d = (over: Partial<CsrfInput>) => decideCsrf({ ...base, ...over });

// Safe methods are never blocked, whatever the origin.
checks.push(["GET from a foreign site passes", d({ method: "GET", origin: "https://evil.example" }).ok]);
checks.push(["HEAD passes", d({ method: "head", origin: "https://evil.example" }).ok]);
checks.push(["OPTIONS (preflight) passes", d({ method: "OPTIONS", origin: "https://evil.example" }).ok]);

// Legitimate writers.
checks.push(["no Origin (thin client / webhook / Electron main) passes", d({}).ok]);
checks.push(["empty Origin passes as absent", d({ origin: "  " }).ok]);
checks.push(["same-origin phone on Vercel passes", d({ origin: "https://bagicha-pos.vercel.app" }).ok]);
checks.push(["same-origin match is case-insensitive", d({ origin: "https://Bagicha-POS.vercel.app" }).ok]);
checks.push([
  "same origin via X-Forwarded-Host passes",
  d({ origin: "https://pos.example.in", hosts: ["internal:3000", "pos.example.in"] }).ok,
]);
checks.push([
  "Electron host build (localhost:5179 page → same server) passes",
  d({ origin: "http://localhost:5179", hosts: ["localhost:5179"] }).ok,
]);
checks.push([
  "LAN tablet on the host build passes",
  d({ origin: "http://192.168.1.20:5179", hosts: ["192.168.1.20:5179"] }).ok,
]);
checks.push(["dev Vite origin in ALLOWED_ORIGINS passes", d({ origin: "http://localhost:5173", hosts: ["127.0.0.1:5000"] }).ok]);
checks.push(["ALLOWED_ORIGINS='*' passes everything", d({ origin: "https://evil.example", allowedOrigins: ["*"] }).ok]);

// Forgery attempts.
const evilForm = d({ origin: "https://evil.example", contentType: "application/x-www-form-urlencoded" });
checks.push(["form POST from a foreign site is blocked", !evilForm.ok && evilForm.reason === "cross_site"]);
checks.push(["multipart form from a foreign site is blocked", !d({ origin: "https://evil.example", contentType: "multipart/form-data; boundary=x" }).ok]);
checks.push(["no-cors text/plain fetch from a foreign site is blocked", !d({ origin: "https://evil.example", contentType: "text/plain;charset=UTF-8" }).ok]);
checks.push(["bodyless no-cors POST from a foreign site is blocked", !d({ origin: "https://evil.example" }).ok]);
checks.push(["sandboxed-iframe form (Origin: null) is blocked", !d({ origin: "null", contentType: "application/x-www-form-urlencoded" }).ok]);
checks.push(["DELETE from a foreign site without JSON is blocked", !d({ method: "DELETE", origin: "https://evil.example" }).ok]);
checks.push([
  "a host that merely ENDS with ours is not same-origin",
  !d({ origin: "https://evil-bagicha-pos.vercel.app" }).ok,
]);
checks.push(["a port mismatch is not same-origin", !d({ origin: "http://localhost:5180", hosts: ["localhost:5179"] }).ok]);
checks.push([
  "an Origin whose path/userinfo mimics ours is not same-origin",
  !d({ origin: "https://bagicha-pos.vercel.app.evil.example" }).ok,
]);

// Requests a cross-site page cannot send without a (failing) CORS preflight.
checks.push(["foreign Origin with application/json passes (needs a preflight we refuse)", d({ origin: "https://evil.example", contentType: "application/json" }).ok]);
checks.push(["application/json with charset param counts as JSON", d({ origin: "null", contentType: "Application/JSON; charset=utf-8" }).ok]);
checks.push(["X-Requested-With header passes (needs a preflight)", d({ origin: "null", xRequestedWith: "XMLHttpRequest" }).ok]);
checks.push(["application/json-seq is not application/json", !d({ origin: "https://evil.example", contentType: "application/jsonx" }).ok]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? `\nAll ${checks.length} checks passed.` : `\n${failed} of ${checks.length} checks FAILED.`);
process.exit(failed === 0 ? 0 : 1);
