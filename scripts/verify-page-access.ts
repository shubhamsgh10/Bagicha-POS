/**
 * Verifies per-person page-access resolution + that the staffPageAccess setting round-trips.
 * Run: npx tsx -r dotenv/config scripts/verify-page-access.ts
 */
import { resolveStaffAllowedPages, personPageKey } from "../shared/pageAccess";
import { getSettings, saveSettings, initSettings } from "../server/settingsStore";

const k = personPageKey("staff", 5);
const cook    = resolveStaffAllowedPages(k, "Cook", {});                       // role default
const service = resolveStaffAllowedPages(k, "Service", {});                    // role default
const cleaner = resolveStaffAllowedPages(k, "Cleaning", {});                   // empty (only My Attendance)
const override = resolveStaffAllowedPages(k, "Cook", { [k]: ["/billing"] });   // override beats default
console.log("Cook default   :", cook);
console.log("Service default:", service);
console.log("Cleaning       :", cleaner);
console.log("Override (Cook):", override);

try {
  await initSettings();
  const before = getSettings().staffPageAccess ?? {};
  await saveSettings({ staffPageAccess: { ...before, "sm:999999": ["/kot"] } });
  const saved = getSettings().staffPageAccess?.["sm:999999"];
  console.log("Settings round-trip saved:", saved);
  const cleaned = { ...getSettings().staffPageAccess }; delete cleaned["sm:999999"];
  await saveSettings({ staffPageAccess: cleaned });
  const removed = getSettings().staffPageAccess?.["sm:999999"] === undefined;

  const ok = JSON.stringify(cook) === '["/kot"]'
    && JSON.stringify(service) === '["/tables","/orders","/billing"]'
    && cleaner.length === 0
    && JSON.stringify(override) === '["/billing"]'
    && JSON.stringify(saved) === '["/kot"]'
    && removed;
  console.log(ok ? "\nRESULT: PASS ✅" : "\nRESULT: FAIL ❌");
} catch (e: any) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
