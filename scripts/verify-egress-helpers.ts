/**
 * DB-free checks for the egress/caching helpers (run in `npm run test:pure`):
 *  - shared/orderHistorySync.ts   — incremental merge of a cached order history
 *  - shared/realtimeInvalidation.ts — which queries a realtime event refreshes
 *  - server/httpConditional.ts    — If-None-Match matching for the DB-hash ETags
 *  - server/principalCache.ts     — the deserializeUser cache (TTL, copies, no cached failures)
 */
import { deltaSince, mergeOrderRows, ORDER_SYNC_OVERLAP_MS } from "../shared/orderHistorySync";
import { isOrderEvent, isOrderDerivedKey } from "../shared/realtimeInvalidation";
import { ifNoneMatchHits } from "../server/httpConditional";
import { cachedPrincipal, forgetPrincipal, forgetAllPrincipals, PRINCIPAL_TTL_MS } from "../server/principalCache";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`, detail ?? ""); }
}

(async () => {
  // ── orderHistorySync ──
  const base = [
    { id: 3, createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:05:00.000Z", total: "10" },
    { id: 2, createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-21T09:00:00.000Z", total: "20" },
    { id: 1, createdAt: "2026-10-18T10:00:00.000Z", updatedAt: "2026-10-18T10:00:00.000Z", total: "30" },
  ];
  const since = deltaSince(base);
  check("deltaSince = newest updatedAt minus overlap",
    since?.getTime() === Date.parse("2026-10-21T09:00:00.000Z") - ORDER_SYNC_OVERLAP_MS, since);
  check("deltaSince null for empty list", deltaSince([]) === null);
  check("deltaSince null when no row has updatedAt", deltaSince([{ id: 1, createdAt: "2026-10-18T10:00:00.000Z" }]) === null);

  check("merge with no changes returns the same array", mergeOrderRows(base, []) === base);
  const merged = mergeOrderRows(base, [
    { id: 2, createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-22T08:00:00.000Z", total: "25" }, // changed
    { id: 4, createdAt: "2026-10-22T07:00:00.000Z", updatedAt: "2026-10-22T07:00:00.000Z", total: "40" }, // new
  ]);
  check("merge keeps newest-first by createdAt", JSON.stringify(merged.map(r => r.id)) === "[4,3,2,1]", merged.map(r => r.id));
  check("merge replaces a changed row", merged.find(r => r.id === 2)?.total === "25");
  check("merge leaves untouched rows as the same objects", merged.find(r => r.id === 1) === base[2]);
  const tie = mergeOrderRows([{ id: 5, createdAt: "2026-10-22T07:00:00.000Z" }], [{ id: 6, createdAt: "2026-10-22T07:00:00.000Z" }]);
  check("merge breaks createdAt ties by id desc", JSON.stringify(tie.map(r => r.id)) === "[6,5]");

  // ── realtimeInvalidation ──
  for (const t of ["NEW_ORDER", "ORDER_UPDATE", "TABLE_UPDATE", "KOT_UPDATE", "NEW_DELIVERY_ORDER"]) {
    check(`order event: ${t}`, isOrderEvent(t));
  }
  for (const t of ["PRINT_JOB", "WA_MESSAGE", "MENU_UPDATE", "CACHE_BUST", undefined]) {
    check(`not an order event: ${t}`, !isOrderEvent(t as any));
  }
  const refreshed: unknown[][] = [
    ["/api/orders", "2026-10-21"], ["/api/orders", "123"], ["/api/orders/123"], ["/api/orders/hold"],
    ["/api/orders", "unpaid-backlog", "2026-10-21"], ["/api/live-status"], ["/api/tables"], ["/api/kot"],
    ["/api/kot/running"], ["/api/dashboard/stats"], ["/api/reports/tabs"], ["/api/inventory/low-stock"],
    ["/api/menu/sold-today"], ["/api/orders", "active-window", "2026-10-21"],
  ];
  for (const k of refreshed) check(`refreshed on order event: ${JSON.stringify(k)}`, isOrderDerivedKey(k));
  const untouched: unknown[][] = [
    ["/api/orders", "all"],                 // whole history — synced incrementally instead
    ["/api/orders/customers"], ["/api/orders/customer-history"],
    ["/api/menu"], ["/api/menu?all=true"], ["/api/categories"], ["/api/settings"], ["/api/users"],
    ["/api/inventory-categories"],           // shares a prefix string, not a root
    ["/api/ordersX"], ["print-queue"], [42],
  ];
  for (const k of untouched) check(`not refreshed on order event: ${JSON.stringify(k)}`, !isOrderDerivedKey(k));

  // ── httpConditional ──
  const tag = 'W/"menu-abc"';
  check("If-None-Match exact", ifNoneMatchHits(tag, tag));
  check("If-None-Match in a list", ifNoneMatchHits(`W/"x", ${tag}`, tag));
  check("If-None-Match *", ifNoneMatchHits("*", tag));
  check("If-None-Match absent", !ifNoneMatchHits(undefined, tag));
  check("If-None-Match different hash", !ifNoneMatchHits('W/"menu-abd"', tag));
  check("If-None-Match other variant (menu vs menu-all)", !ifNoneMatchHits('W/"menu-all-abc"', tag));

  // ── principalCache ──
  forgetAllPrincipals();
  let loads = 0;
  const load = async () => { loads++; return { id: 7, role: "manager" }; };
  const t0 = 1_000_000;
  const a = await cachedPrincipal("u:7", load, t0);
  const b = await cachedPrincipal("u:7", load, t0 + PRINCIPAL_TTL_MS - 1);
  check("second read within TTL is served from cache", loads === 1, loads);
  check("each hit is a separate copy", a !== b && a?.role === "manager" && b?.role === "manager");
  (a as any).role = "admin";
  const c = await cachedPrincipal("u:7", load, t0 + 1);
  check("mutating one copy does not leak into the cache", c?.role === "manager", c);
  await cachedPrincipal("u:7", load, t0 + PRINCIPAL_TTL_MS);
  check("expired entry reloads", loads === 2, loads);
  forgetPrincipal("u:7");
  await cachedPrincipal("u:7", load, t0 + PRINCIPAL_TTL_MS + 1);
  check("forgetPrincipal forces a reload", loads === 3, loads);
  check("users and staff keys are distinct", (await cachedPrincipal("sm:7", async () => ({ id: 7, role: "staff" }), t0))?.role === "staff");

  let attempts = 0;
  const flaky = async () => { attempts++; if (attempts === 1) throw new Error("db blip"); return { id: 9 }; };
  let threw = false;
  try { await cachedPrincipal("u:9", flaky, t0); } catch { threw = true; }
  await new Promise((r) => setTimeout(r, 0)); // let the failure handler drop the entry
  const ok = await cachedPrincipal("u:9", flaky, t0 + 1);
  check("a failed load is not cached", threw && ok?.id === 9 && attempts === 2, { threw, attempts });

  const missing = await cachedPrincipal("u:404", async () => undefined, t0);
  check("a missing principal resolves to undefined", missing === undefined);

  console.log(`${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
