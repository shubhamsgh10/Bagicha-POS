/**
 * DB-free regression for the 17 Nov 2026 desktop crash loop: the session expired (24 h), the Tables
 * poll got a 401, the default queryFn turned it into a "successful" null, `tables.filter` threw
 * (ErrorBoundary), the desktop query persister saved that null to IndexedDB next to a still-signed-in
 * /api/auth/me, and every Reload restored the same pair and crashed again.
 */
import { QueryClient, dehydrate, hydrate } from "@tanstack/query-core";
import { persistOptions, deserializeSavedCache } from "../client/src/lib/queryPersistence";
import { queryClient as appClient } from "../client/src/lib/queryClient";
import { setApiBaseUrl } from "../packages/api-client";

setApiBaseUrl("http://api.test"); // never touch import.meta.env in Node

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`PASS  ${name}`);
  else { failed++; console.log(`FAIL  ${name}`); }
}

const realFetch = globalThis.fetch;
let nextStatus = 200;
let nextBody: unknown = [];
(globalThis as any).fetch = async () =>
  new Response(nextStatus === 200 ? JSON.stringify(nextBody) : "Unauthorized", { status: nextStatus });

async function main() {
  const defaultFn = appClient.getDefaultOptions().queries!.queryFn as any;

  // 1. The app's default queryFn on a 401 for an ordinary list must NOT resolve to a successful null.
  nextStatus = 401;
  let threw = false;
  let value: unknown = "unset";
  try { value = await defaultFn({ queryKey: ["/api/tables"], meta: undefined, signal: new AbortController().signal }); }
  catch (e: any) { threw = String(e?.message ?? e).startsWith("401"); }
  check("default queryFn rejects a 401 (no successful null for /api/tables)", threw && value === "unset");

  // 2. Simulate the incident end to end on a QueryClient using that default queryFn.
  const qc = new QueryClient({ defaultOptions: { queries: { queryFn: defaultFn, retry: false } } });
  nextStatus = 200; nextBody = { id: 4, username: "rajbhaghel", role: "manager" };
  await qc.fetchQuery({ queryKey: ["/api/auth/me"] });
  nextBody = [{ id: 1, name: "T1", status: "free" }];
  await qc.fetchQuery({ queryKey: ["/api/tables"] });
  nextStatus = 401; // session expires; next Tables poll
  await qc.fetchQuery({ queryKey: ["/api/tables"], staleTime: 0 }).catch(() => {});
  const live = qc.getQueryData<any>(["/api/tables"]);
  check("after the 401 the in-memory tables list is still an array", Array.isArray(live));

  // 3. What the desktop persister would save, round-tripped through JSON like IndexedDB.
  const saved = JSON.parse(JSON.stringify(dehydrate(qc, persistOptions.dehydrateOptions)));
  const restored = new QueryClient();
  hydrate(restored, saved);
  const t = restored.getQueryData<any>(["/api/tables"]);
  check("a restored tables list is never null (would crash tables.filter on every reload)", t === undefined || Array.isArray(t));

  // 4. The persist policy itself never saves a null result for a list/data query.
  const shouldSave = persistOptions.dehydrateOptions!.shouldDehydrateQuery!;
  const fakeQuery = (key: unknown[], data: unknown) => ({ queryKey: key, state: { status: "success", data } }) as any;
  check("policy: null tables result is not saved", !shouldSave(fakeQuery(["/api/tables"], null)));
  check("policy: null settings result is not saved", !shouldSave(fakeQuery(["/api/settings"], null)));
  check("policy: a real tables list is saved", shouldSave(fakeQuery(["/api/tables"], [])));
  check("policy: signed-out auth/me (null) is still saved", shouldSave(fakeQuery(["/api/auth/me"], null)));

  // 5. 18 Nov 2026 (client.error 8TE7M-EJ99): 1.0.43 restored a copy SAVED BY 1.0.42 that held
  //    tables=null and crashed on start. Restore must filter by today's rules, not trust the file.
  const legacyBlob = JSON.stringify({
    timestamp: Date.now(),
    buster: "whatever",
    clientState: {
      mutations: [],
      queries: [
        { queryKey: ["/api/auth/me"], queryHash: '["/api/auth/me"]', state: { status: "success", data: { id: 4 }, dataUpdatedAt: 1 } },
        { queryKey: ["/api/tables"], queryHash: '["/api/tables"]', state: { status: "success", data: null, dataUpdatedAt: 1 } },
        { queryKey: ["/api/menu"], queryHash: '["/api/menu"]', state: { status: "success", data: [{ id: 1 }], dataUpdatedAt: 1 } },
        { queryKey: ["/api/reports/x"], queryHash: '["/api/reports/x"]', state: { status: "success", data: [], dataUpdatedAt: 1 } },
      ],
    },
  });
  const cleaned = deserializeSavedCache(legacyBlob);
  const keys = cleaned.clientState.queries.map((q) => String(q.queryKey[0]));
  check("restore drops a saved null tables list", !keys.includes("/api/tables"));
  check("restore keeps auth/me and real lists", keys.includes("/api/auth/me") && keys.includes("/api/menu"));
  check("restore drops roots no longer allowed", !keys.includes("/api/reports/x"));
  const restored2 = new QueryClient();
  hydrate(restored2, cleaned.clientState);
  check("after restore, tables is undefined (page default [] applies), not null", restored2.getQueryData(["/api/tables"]) === undefined);
  check("cache version bumped so 1.0.42/1.0.43 copies are discarded", persistOptions.buster === "bagicha-cache-v1:2");
}

main()
  .catch((e) => { failed++; console.log("FAIL  threw:", e); })
  .finally(() => {
    globalThis.fetch = realFetch;
    if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
    console.log("\nAll passed");
    process.exit(0);
  });
