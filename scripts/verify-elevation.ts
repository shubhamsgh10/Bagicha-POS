/**
 * Verifies the privileged-action elevation gate: role short-circuit, PIN grant
 * window, expiry, and level requirements.
 * Run: npx tsx scripts/verify-elevation.ts
 */
import { grantElevation, hasElevation } from "../server/elevation";

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

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
