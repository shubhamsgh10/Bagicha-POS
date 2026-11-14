# Local-first Phase 2 — Instant Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On the Electron desktop app, the screens' data (menu, categories, tables, settings, open orders, KOT list, staff cards, customer directory, sign-in state) is saved to disk and shown instantly at startup and during an outage, then refreshed from the server as usual.

**Architecture:** TanStack Query persistence. `PersistQueryClientProvider` (`@tanstack/react-query-persist-client`) replaces `QueryClientProvider` in `client/src/main.tsx` **only when `window.electronAPI?.isElectron`**; browsers/phones keep the plain provider and behave exactly as today. Storage is IndexedDB through a tiny `{getItem,setItem,removeItem}` adapter passed to `createAsyncStoragePersister` (`@tanstack/query-async-storage-persister`, which throttles writes). A pure allow-list decides which queries are saved. Logout wipes the saved copy before its existing reload.

**Tech Stack:** `@tanstack/react-query-persist-client@5.84.1`, `@tanstack/query-async-storage-persister@5.84.1` (match installed `@tanstack/react-query` 5.84.1), IndexedDB, `tsx` verify script.

Spec: `docs/superpowers/specs/2026-11-13-local-first-offline-design.md` (Phase 2). Read-only survival only: writes still need the server (that is phase 4).

## Rules
- `DATABASE_URL` in `.env` is the shared PRODUCTION DB. Browser-checking with `npm run dev` is allowed for READS only: do not create/edit/settle orders, do not change settings. `BACKGROUND_JOBS` must stay unset.
- `tsconfig.json` has no `target`: no `for…of`/spread over `Map`/`Set` in `client/` or `shared/` — use `Array.from`.
- New list queries elsewhere must keep using `apiJson` (CLAUDE.md). Don't edit `components/ui/`.
- Don't change `queryClient`'s defaults (`networkMode: "always"`, `retry: false`, `staleTime`) — they were tuned for the settle-latency fix.

## Files
- Create `client/src/lib/persistPolicy.ts` — pure: `shouldPersistQuery(queryKey, status)`, `PERSIST_MAX_AGE_MS`, `persistBuster(appVersion)`.
- Create `client/src/lib/idbStorage.ts` — IndexedDB key/value adapter (db `bagicha-cache`, store `kv`), every call try/catch → resolves null/undefined on failure (private mode, quota).
- Create `client/src/lib/queryPersistence.ts` — builds the persister; exports `persistOptions` and `clearPersistedCache()`.
- Modify `client/src/main.tsx` — Electron → `PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}`; else unchanged.
- Modify `client/src/hooks/useAuth.ts` — `logout` awaits `clearPersistedCache()` (never throws) before `window.location.reload()`.
- Create `scripts/verify-persist-policy.ts`; add `&& tsx scripts/verify-persist-policy.ts` to the end of the `test:pure` chain in `package.json`.

### Task 1: Install
- [ ] `npm install --save-exact @tanstack/react-query-persist-client@5.84.1 @tanstack/query-async-storage-persister@5.84.1`; confirm no caret in package.json; commit `chore: add react-query persistence packages`.

### Task 2: Persist policy (TDD)
- [ ] Find the real query keys: grep `queryKey:` and `useQuery<` in `client/src/pages/{Tables,POS,KOT,Billing,Orders,LiveTablesDashboard}.tsx`, `client/src/hooks/*.ts`, `client/src/App.tsx`, `client/src/lib/*.ts`. Default keys are the URL path as the first element (`["/api/menu"]`).
- [ ] Write `scripts/verify-persist-policy.ts` first (PASS/FAIL per assertion, exit 1 on any FAIL, same style as other `scripts/verify-*.ts`). Assertions:
  - persisted (status `"success"`): `["/api/auth/me"]`, `["/api/menu"]`, `["/api/categories"]`, `["/api/tables"]`, `["/api/settings"]`, `["/api/staff-members"]`, `["/api/live-status"]`, `["/api/kot", …]`, order lists used by Tables/POS/Live View (e.g. `["/api/orders", {open:true…}]` — use the real keys you found), `["/api/orders", <id>]` single order, the customer-directory key POS autocomplete uses.
  - NOT persisted: `["/api/orders","all"]` (whole history, large), any key with status `"error"` or `"pending"`, reports (`/api/reports/...`), `/api/dashboard/...`, `/api/payroll/...`, `/api/staff` (salaries), `/api/automation/...`, `/api/whatsapp/...`, `/api/audit...`, unknown keys (allow-list, not deny-list).
  - `PERSIST_MAX_AGE_MS === 24*60*60*1000`; `persistBuster("1.0.41") !== persistBuster("1.0.42")`.
- [ ] Run it → FAIL (module missing). Implement `persistPolicy.ts` (allow-list of root paths + the explicit `["/api/orders","all"]` exclusion; only `status === "success"`). Run → PASS. `npm run check` → 0.
- [ ] Commit `feat(cache): allow-list for persisted queries`.

### Task 3: IndexedDB adapter + persister
- [ ] `idbStorage.ts`: lazily opens IndexedDB once (memoised promise); `getItem(key): Promise<string|null>`, `setItem(key, value): Promise<void>`, `removeItem(key): Promise<void>`; any error → `console.warn` + null/no-op (never throw, never block the app).
- [ ] `queryPersistence.ts`:
```ts
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { idbStorage } from "./idbStorage";
import { shouldPersistQuery, PERSIST_MAX_AGE_MS, persistBuster } from "./persistPolicy";

const persister = createAsyncStoragePersister({ storage: idbStorage, key: "bagicha-query-cache", throttleTime: 1000 });

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: persistBuster(<app version — find how the client knows it: grep `__APP_VERSION__`/`import.meta.env` / package version usage in client/src; if none, use a constant string "1" and say so>),
  dehydrateOptions: { shouldDehydrateQuery: (q) => shouldPersistQuery(q.queryKey, q.state.status) },
};

export async function clearPersistedCache(): Promise<void> {
  try { await persister.removeClient(); } catch (e) { console.warn("[cache] clear failed", e); }
}
```
- [ ] `main.tsx`: `const persist = !!(window as any).electronAPI?.isElectron;` and render `PersistQueryClientProvider` vs `QueryClientProvider` accordingly, keeping `RealtimeProvider` / `App` / `ErrorBoundary` nesting identical and keeping the existing comment about why the provider lives in main.tsx.
- [ ] `useAuth.ts` logout: `await apiRequest(...)` stays; then `await clearPersistedCache();` then reload. Also clear when logout's request throws? Keep existing behaviour for the request; the clear must run before reload in the success path.
- [ ] `npm run check` → 0; `npm run test:pure` → all PASS; `npm run build` → succeeds (client + server).
- [ ] Commit `feat(cache): persist screen data to IndexedDB on the desktop app`.

### Task 4: Verify in a browser (reads only)
The gate is Electron-only, so for this check temporarily force it (local edit, **do not commit**): `const persist = true;`.
- [ ] `npm run dev` (no `BACKGROUND_JOBS`). Log in with the dev login from the gitignored `.claude.local.md`; if it fails, stop the browser check and report — don't guess passwords.
- [ ] Open Tables, POS (no saving), KOT. Wait 2 s. Confirm IndexedDB `bagicha-cache`/`kv` has `bagicha-query-cache` and that it contains none of the excluded keys (inspect via devtools JS).
- [ ] Reload: Tables renders its tables before any `/api/tables` response arrives (check with the network panel / timing).
- [ ] Offline: block `/api/*` requests (devtools request blocking or Playwright `page.route` abort), reload → Tables/POS still show the saved menu/tables; no white screen.
- [ ] Logout → IndexedDB entry gone.
- [ ] Revert the forced gate (`git diff client/src/main.tsx` shows only the intended change), stop the dev server, delete any screenshot PNGs written into the repo root.
- [ ] Note in the report what was and wasn't verified.
