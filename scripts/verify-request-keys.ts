/**
 * Verifies shared/requestKeys.ts — the pure rules behind the one-time request keys
 * (Idempotency-Key) that make a retried KOT/Bill/Settle safe. Pure: no DB, no Express.
 * Run: npx tsx scripts/verify-request-keys.ts
 */
import {
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  MAX_STORED_BODY_CHARS,
  isValidIdempotencyKey,
  decideRepeat,
  bodyHashInput,
  keyPath,
  storableBody,
  isMissingTableError,
  type KeyFingerprint,
  type StoredKey,
} from "../shared/requestKeys";

const checks: Array<[string, boolean]> = [];
const fp: KeyFingerprint = { actorId: "u:7", method: "PUT", path: "/api/orders/12/items", bodyHash: "abc" };
const row = (over: Partial<StoredKey>): StoredKey => ({ ...fp, state: "done", responseStatus: 200, responseBody: { id: 12 }, ...over });

// Header names (the client package keeps its own copy — they must match)
checks.push(["header name", IDEMPOTENCY_HEADER === "Idempotency-Key"]);
checks.push(["replayed header name", REPLAYED_HEADER === "Idempotent-Replayed"]);

// Key validation
checks.push(["a UUID is valid", isValidIdempotencyKey("3f2c9a1e-8b7d-4c3a-9e1f-0a1b2c3d4e5f")]);
checks.push(["the client fallback shape is valid", isValidIdempotencyKey("k-lq2x9a-abcdef123456ghijkl")]);
checks.push(["too short is invalid", !isValidIdempotencyKey("abc")]);
checks.push(["spaces/punctuation are invalid", !isValidIdempotencyKey("bad key!")]);
checks.push(["over 100 chars is invalid", !isValidIdempotencyKey("a".repeat(101))]);
checks.push(["a non-string is invalid", !isValidIdempotencyKey(42)]);

// decideRepeat
checks.push(["done + same fingerprint → replay with the stored answer", (() => {
  const d = decideRepeat(row({}), fp);
  return d.kind === "replay" && d.status === 200 && (d.body as any).id === 12;
})()]);
checks.push(["a stored error is replayed too (never re-run)", (() => {
  const d = decideRepeat(row({ responseStatus: 500, responseBody: { message: "x" } }), fp);
  return d.kind === "replay" && d.status === 500;
})()]);
checks.push(["processing → wait", decideRepeat(row({ state: "processing", responseStatus: null, responseBody: null }), fp).kind === "wait"]);
checks.push(["done but no stored body (too big) → replay_unavailable", decideRepeat(row({ responseBody: null }), fp).kind === "replay_unavailable"]);
checks.push(["other user → mismatch", decideRepeat(row({ actorId: "sm:7" }), fp).kind === "mismatch"]);
checks.push(["other method → mismatch", decideRepeat(row({ method: "POST" }), fp).kind === "mismatch"]);
checks.push(["other path → mismatch", decideRepeat(row({ path: "/api/orders/13/items" }), fp).kind === "mismatch"]);
checks.push(["other body → mismatch", decideRepeat(row({ bodyHash: "zzz" }), fp).kind === "mismatch"]);
checks.push(["mismatch wins over processing", decideRepeat(row({ state: "processing", actorId: "u:8" }), fp).kind === "mismatch"]);

// Helpers
checks.push(["bodyHashInput is stable JSON", bodyHashInput({ a: 1, b: [2] }) === '{"a":1,"b":[2]}']);
checks.push(["bodyHashInput of no body", bodyHashInput(undefined) === "null"]);
checks.push(["keyPath drops the query string", keyPath("/api/print/bill?x=1") === "/api/print/bill"]);
checks.push(["keyPath keeps a plain path", keyPath("/api/print/jobs/5/claim") === "/api/print/jobs/5/claim"]);
checks.push(["storableBody keeps a normal answer", (storableBody({ ok: true }) as any).ok === true]);
checks.push(["storableBody drops an answer over the limit", storableBody({ big: "x".repeat(MAX_STORED_BODY_CHARS) }) === null]);
checks.push(["missing table: pg error code", isMissingTableError({ code: "42P01" })]);
checks.push(["missing table: wrapped cause", isMissingTableError({ cause: { code: "42P01" } })]);
checks.push(["other DB errors are not 'missing table'", !isMissingTableError({ code: "23505" }) && !isMissingTableError(null)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
