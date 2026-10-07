/**
 * Verifies the privileged-action elevation gate: role short-circuit, PIN grant
 * window, expiry, and level requirements.
 * Run: npx tsx scripts/verify-elevation.ts
 */
import { grantElevation, hasElevation, hasFreshPin, freshPinApprover, requireFreshPin } from "../server/elevation";

const t0 = 1_000_000;
const checks: Array<[string, boolean]> = [];

// 1. Manager/admin session passes via role, no grant needed.
checks.push(["admin role passes", hasElevation({ user: { role: "admin" }, session: {} }, "manager", t0)]);
checks.push(["manager role passes manager gate", hasElevation({ user: { role: "manager" }, session: {} }, "manager", t0)]);

// 2. Bare staff session with no grant is rejected.
checks.push(["staff without grant rejected", !hasElevation({ user: { role: "staff" }, session: {} }, "manager", t0)]);

// 3. A manager-level grant lets a staff session pass within the window.
{
  const req: any = { user: { role: "staff" }, session: {} };
  grantElevation(req, 1, t0);
  checks.push(["staff with manager grant passes in-window", hasElevation(req, "manager", t0 + 10_000)]);
  checks.push(["grant expires after window", !hasElevation(req, "manager", t0 + 200_000)]);
}

// 4. A manager-level grant does NOT satisfy an admin-level gate.
{
  const req: any = { user: { role: "staff" }, session: {} };
  grantElevation(req, 1, t0);
  checks.push(["manager grant fails admin gate", !hasElevation(req, "admin", t0 + 10_000)]);
}

// 5. An admin-level grant satisfies both gates.
{
  const req: any = { user: { role: "staff" }, session: {} };
  grantElevation(req, 2, t0);
  checks.push(["admin grant passes admin gate", hasElevation(req, "admin", t0 + 10_000)]);
}

// 6. The FRESH-PIN gate (settle a due / correct a payment on the Orders page). Unlike hasElevation
//    it IGNORES the session's own role: a logged-in admin or manager must still have typed a
//    manager/admin PIN. This is what makes "always ask for a PIN" real on the server instead of
//    a client-side courtesy — rajbhaghel's login is a manager account, and under hasElevation
//    nobody using it would ever have been asked.
checks.push(["fresh-PIN: admin role with NO pin is refused", !hasFreshPin({ user: { role: "admin" }, session: {} }, "manager", t0)]);
checks.push(["fresh-PIN: manager role with NO pin is refused", !hasFreshPin({ user: { role: "manager" }, session: {} }, "manager", t0)]);
checks.push(["fresh-PIN: staff with no pin is refused", !hasFreshPin({ user: { role: "staff" }, session: {} }, "manager", t0)]);
{
  const req: any = { user: { role: "admin" }, session: {} };
  grantElevation(req, 1, t0, { id: "u:4", name: "rajbhaghel", role: "manager" });
  checks.push(["fresh-PIN: a logged-in ADMIN who typed a manager PIN passes", hasFreshPin(req, "manager", t0 + 10_000)]);
  checks.push(["fresh-PIN: the PIN expires after the window", !hasFreshPin(req, "manager", t0 + 200_000)]);
  checks.push(["fresh-PIN: records WHO approved while fresh", freshPinApprover(req, t0 + 10_000)?.name === "rajbhaghel" && freshPinApprover(req, t0 + 10_000)?.id === "u:4"]);
  checks.push(["fresh-PIN: approver is gone once expired", freshPinApprover(req, t0 + 200_000) === null]);
}
{
  const req: any = { user: { role: "staff" }, session: {} };
  grantElevation(req, 1, t0);
  checks.push(["fresh-PIN: a manager PIN does not satisfy an admin-only gate", !hasFreshPin(req, "admin", t0 + 10_000)]);
  checks.push(["fresh-PIN: no approver recorded when none was supplied", freshPinApprover(req, t0 + 10_000) === null]);
  grantElevation(req, 2, t0, { id: "u:1", name: "owner", role: "admin" });
  checks.push(["fresh-PIN: an ADMIN's pin satisfies the manager gate (either PIN works)", hasFreshPin(req, "manager", t0 + 10_000)]);
}
{
  // The middleware itself: 401 / 403 PIN_REQUIRED / next().
  const run = (req: any) => {
    let status = 0, body: any = null, nexted = false;
    const res: any = { status(c: number) { status = c; return res; }, json(b: any) { body = b; return res; } };
    requireFreshPin("manager")(req, res, () => { nexted = true; });
    return { status, body, nexted };
  };
  const anon = run({ isAuthenticated: () => false, session: {} });
  checks.push(["middleware: unauthenticated -> 401, not allowed through", anon.status === 401 && !anon.nexted]);
  const adminNoPin = run({ isAuthenticated: () => true, user: { role: "admin" }, session: {} });
  checks.push(["middleware: logged-in ADMIN without a PIN -> 403 PIN_REQUIRED", adminNoPin.status === 403 && adminNoPin.body?.code === "PIN_REQUIRED" && !adminNoPin.nexted]);
  const fresh: any = { isAuthenticated: () => true, user: { role: "staff" }, session: {} };
  grantElevation(fresh, 1);
  const ok = run(fresh);
  checks.push(["middleware: a just-verified PIN lets the request through", ok.nexted && ok.status === 0]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
