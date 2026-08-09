/**
 * Verifies server/selfScope.ts: requireUserAccount rejects a staff-member session
 * before it can reach a `users`-row endpoint by id, and sanitizeUser never lets
 * password/pin/totpSecret leak into a response body.
 * Run: npx tsx scripts/verify-self-scope.ts
 */
import { requireUserAccount, sanitizeUser } from "../server/selfScope";

const checks: Array<[string, boolean]> = [];

function callMiddleware(req: any): { nextCalled: boolean; status: number | null; body: any } {
  let nextCalled = false;
  let status: number | null = null;
  let body: any = null;
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: any) { body = payload; return this; },
  };
  requireUserAccount(req, res, () => { nextCalled = true; });
  return { nextCalled, status, body };
}

// 1. A real `users` session (no _isStaffMember) passes through.
{
  const { nextCalled, status } = callMiddleware({ user: { id: 7, role: "admin" } });
  checks.push(["users session passes requireUserAccount", nextCalled && status === null]);
}

// 2. A staff-member session (`{id, _isStaffMember:true}`) is rejected with 403, next() never runs.
{
  const { nextCalled, status } = callMiddleware({ user: { id: 7, _isStaffMember: true, role: "staff" } });
  checks.push(["staff-member session rejected (403)", !nextCalled && status === 403]);
}

// 3. The rejection happens even when the staff-member id collides with a real admin's id —
//    this is the exact id-collision shape the id shares with `users`.
{
  const { nextCalled, status } = callMiddleware({ user: { id: 1, _isStaffMember: true, role: "staff" } });
  checks.push(["colliding id (staff sm.id === users.id) still rejected", !nextCalled && status === 403]);
}

// 4. sanitizeUser strips password/pin/totpSecret and keeps everything else.
{
  const row = {
    id: 1, username: "owner", role: "admin",
    password: "hashed-secret", pin: "1234", totpSecret: "base32secret",
    showOnMobile: false, totpEnabled: false, createdAt: "2026-01-01",
  };
  const safe = sanitizeUser(row) as any;
  checks.push(["sanitizeUser strips password", !("password" in safe)]);
  checks.push(["sanitizeUser strips pin", !("pin" in safe)]);
  checks.push(["sanitizeUser strips totpSecret", !("totpSecret" in safe)]);
  checks.push(["sanitizeUser keeps id/username/role", safe.id === 1 && safe.username === "owner" && safe.role === "admin"]);
  checks.push(["sanitizeUser keeps other non-sensitive fields", safe.showOnMobile === false && safe.createdAt === "2026-01-01"]);
}

// 5. sanitizeUser doesn't mutate the input object (defensive copy).
{
  const row = { id: 2, password: "x", pin: "9999" };
  const safe = sanitizeUser(row) as any;
  checks.push(["sanitizeUser does not mutate input", row.password === "x" && row.pin === "9999" && !("password" in safe)]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
