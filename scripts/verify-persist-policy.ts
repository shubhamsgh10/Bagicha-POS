/** DB-free checks for client/src/lib/persistPolicy.ts (which queries are saved to disk on the desktop app). */
import { shouldPersistQuery, PERSIST_MAX_AGE_MS, persistBuster } from "../client/src/lib/persistPolicy";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}`); }
}

const yes: [string, readonly unknown[]][] = [
  ["auth/me", ["/api/auth/me"]],
  ["menu", ["/api/menu"]],
  ["categories", ["/api/categories"]],
  ["tables", ["/api/tables"]],
  ["settings", ["/api/settings"]],
  ["staff-members (login cards)", ["/api/staff-members"]],
  ["live-status", ["/api/live-status"]],
  ["kot today", ["/api/kot", "today", "2026-11-14"]],
  ["orders by business day", ["/api/orders", "2026-11-14"]],
  ["orders active-window", ["/api/orders", "active-window", "2026-11-14"]],
  ["orders unpaid-backlog", ["/api/orders", "unpaid-backlog", "2026-11-14"]],
  ["single order", ["/api/orders", "42"]],
  ["held orders", ["/api/orders/hold"]],
  ["customer directory", ["/api/orders/customers"]],
];
for (const [n, k] of yes) check(`persists ${n}`, shouldPersistQuery(k, "success"));

const no: [string, readonly unknown[]][] = [
  ["whole order history", ["/api/orders", "all"]],
  ["customer-history", ["/api/orders/customer-history"]],
  ["reports", ["/api/reports/staff-tables", "a", "b"]],
  ["dashboard", ["/api/dashboard/stats"]],
  ["payroll", ["/api/payroll/people"]],
  ["staff (salaries)", ["/api/staff"]],
  ["staff performance", ["/api/staff/performance"]],
  ["automation", ["/api/automation/config"]],
  ["whatsapp", ["/api/whatsapp/conversations"]],
  ["audit", ["/api/audit-logs"]],
  ["unknown key", ["/api/something-new"]],
  ["empty key", []],
  ["non-string key", [{ a: 1 }]],
];
for (const [n, k] of no) check(`does not persist ${n}`, !shouldPersistQuery(k, "success"));

check("does not persist error status with no data", !shouldPersistQuery(["/api/menu"], "error", false));
check("does not persist pending status", !shouldPersistQuery(["/api/menu"], "pending", false));
// Offline: a failed refetch flips a loaded query to "error" but keeps its data — it must stay
// saved, or a second restart during the same outage comes up empty.
check("keeps saved data through a failed refetch", shouldPersistQuery(["/api/menu"], "error", true));
check("failed refetch still respects the allow-list", !shouldPersistQuery(["/api/reports/sales"], "error", true));
check("max age is 24h", PERSIST_MAX_AGE_MS === 24 * 60 * 60 * 1000);
check("buster differs per version", persistBuster("1.0.41") !== persistBuster("1.0.42"));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log("\nAll passed");
