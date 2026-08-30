import { apiUrl } from "@/lib/api";
import type { PrinterConfig } from "@shared/print/types";

/** Wire shape of a PRINT_JOB broadcast / pending-jobs row (see server/printRoutes.ts). */
export interface RemotePrintJob {
  jobId: number;
  orderId: number;
  jobType: "kot" | "bill";
  printerId: string;
  payload: string; // base64 ESC/POS
}

/** Executes an already-claimed job on this station's hardware (Electron IPC, RawBT, …). */
export type PrintJobExecutor = (job: RemotePrintJob) => Promise<void>;

/** Extra pre-claim check beyond ownership — e.g. "can this device actually execute this printer locally?" */
export type CanClaimPredicate = (printerId: string) => boolean | Promise<boolean>;

/**
 * Mirrors the executability rule in desktop/print/usbSend.ts + executor.ts: a "usb" printer
 * needs a saved Windows queue name or vendor/product id, a "network" printer needs an ip.
 * A printer registered with none of these (the RawBT/phone-routed convention — see
 * PrintSettingsPanel.tsx) has no local execution path on ANY Electron host and should
 * never be claimed by one, regardless of ownedPrinterIds.
 *
 * This is a SHAPE check only (does the config have the right fields filled in) — it can't
 * tell two Electron installs apart when they happen to share the same `windowsQueueName`
 * string (e.g. an identical printer model set up on both, or the field was last saved from
 * the wrong machine — `windowsQueueName` lives in the shared DB settings row, but a Windows
 * queue name is only ever valid on the one machine it was installed on). See
 * canExecuteLocallyVerified for the live, this-machine check that narrows that gap.
 */
export function canExecuteLocally(printer: PrinterConfig | undefined): boolean {
  if (!printer) return false;
  if (printer.type === "network") return !!printer.ip;
  return !!printer.windowsQueueName?.trim() || (printer.vendorId != null && printer.productId != null);
}

// Only successful (queue found) results are cached — a cached "not found" would silently
// starve a legitimate job with no automatic retry (usePrintJobBridge's broadcast handler
// evaluates a given job's canClaim exactly once), so every "not found" is re-checked fresh
// next time instead. In-flight promises are de-duped so two concurrent callers checking the
// same queue name (the tab's own printGateway.ts request path + the broadcast listener both
// often fire for the same job) share one PowerShell round-trip instead of spawning two.
const queueExistsTrueAt = new Map<string, number>();
const queueExistsInFlight = new Map<string, Promise<boolean>>();
const QUEUE_EXISTS_TTL_MS = 30_000;

/**
 * Electron-only, live version of canExecuteLocally: for a "usb" printer with a saved
 * windowsQueueName, asks THIS machine's Windows spooler whether a queue by that exact name
 * is registered right now (desktop/print/usbSend.ts's fast path trusts the saved name
 * blindly at execution time — this check runs the same query proactively, before claiming).
 *
 * IMPORTANT LIMITATION: this only confirms the queue NAME is registered on this machine —
 * it cannot tell a real, connected printer apart from an orphaned/ghost queue installed
 * under the same name with no hardware behind it (Windows' Get-Printer reports both
 * identically). If two machines both happen to have a queue by the identical name — e.g.
 * because the same printer model was set up on both at different times — this check passes
 * on both and can't disambiguate them; only per-device `ownedPrinterIds` scoping (a human
 * decision, not inferable from config) fully closes that case.
 *
 * Windows-queue names only mean anything on Windows: on Mac/Linux, desktop/print/usbSend.ts
 * ignores windowsQueueName entirely and prints via libusb using vendorId/productId — so this
 * check is skipped there (falls back to the vendorId/productId shape check) rather than
 * always failing, which would otherwise wrongly block an otherwise-printable Mac/Linux host.
 * Fails OPEN (assume executable) when IPC itself errors, or when Electron/checkPrinterQueueExists
 * isn't available, so a transient plumbing issue can't newly block a print that used to work.
 */
export async function canExecuteLocallyVerified(printer: PrinterConfig | undefined): Promise<boolean> {
  if (!canExecuteLocally(printer)) return false;
  if (printer!.type !== "usb") return true; // network printers are fully verified by the ip shape check above

  const queueName = printer!.windowsQueueName?.trim();
  const hasVidPid = printer!.vendorId != null && printer!.productId != null;
  if (!queueName || !window.electronAPI?.checkPrinterQueueExists) return true;
  if (window.electronAPI.platform !== "win32") return hasVidPid;

  const cachedAt = queueExistsTrueAt.get(queueName);
  if (cachedAt && Date.now() - cachedAt < QUEUE_EXISTS_TTL_MS) return true;

  let pending = queueExistsInFlight.get(queueName);
  if (!pending) {
    pending = window.electronAPI.checkPrinterQueueExists(queueName).catch(() => true);
    pending.finally(() => queueExistsInFlight.delete(queueName));
    queueExistsInFlight.set(queueName, pending);
  }
  const exists = await pending;
  if (exists) queueExistsTrueAt.set(queueName, Date.now());
  return exists;
}

const STATION_ENABLED_KEY = "printStation.enabled";

/** Has this device been turned into a /print-station? Only PrintStation.tsx's toggle writes this. */
export function isStationEnabled(): boolean {
  try {
    return localStorage.getItem(STATION_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STATION_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore quota/private-mode errors */
  }
  persistToDurableStoreAsync();
}

const OWNED_PRINTERS_KEY = "printStation.ownedPrinterIds";

/** Printer ids this station is responsible for. Empty = owns ALL (single-station default). */
export function getOwnedPrinterIds(): string[] {
  try {
    const raw = localStorage.getItem(OWNED_PRINTERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function setOwnedPrinterIds(ids: string[]): void {
  try {
    localStorage.setItem(OWNED_PRINTERS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota/private-mode errors */
  }
  persistToDurableStoreAsync();
}

/**
 * Best-effort durable mirror of the two settings above — Electron only, fire-and-forget.
 * localStorage stays the source of truth for every SYNCHRONOUS read in this module (job
 * claiming is on a hot, real-time path and can't await IPC) — this just keeps a durable,
 * file-backed (userData/print-station-config.json, see desktop/main.ts) copy current so
 * hydrateFromDurableStore() below has something correct to restore from.
 */
function persistToDurableStoreAsync(): void {
  if (!window.electronAPI?.isElectron) return;
  void window.electronAPI
    .setPrintStationConfig({ enabled: isStationEnabled(), ownedPrinterIds: getOwnedPrinterIds() })
    .catch(() => { /* best-effort */ });
}

/**
 * Self-heal for a reverted/stale localStorage value: pulls this device's durable,
 * file-backed config and — if one exists — overwrites localStorage to match, so whatever
 * caused a value to silently revert (a user reported "RP3160" re-checking itself days after
 * being unchecked, with no code path that re-adds an id — pointing at a browser-storage
 * durability gap under Electron's file:// thin-client origin, not application logic) gets
 * corrected on the next load instead of persisting indefinitely. No-ops outside Electron.
 * Idempotent — safe to call from multiple mount points (both PrintStation.tsx and
 * usePrintJobBridge.ts do, since the latter's job-claiming can run without the settings
 * page ever having been opened this session).
 */
export async function hydrateFromDurableStore(): Promise<{ enabled: boolean; ownedPrinterIds: string[] } | null> {
  if (!window.electronAPI?.isElectron) return null;
  try {
    const durable = await window.electronAPI.getPrintStationConfig();
    if (!durable) {
      // No durable file yet (first run on this install since this fix shipped) — seed it
      // from whatever localStorage already has, so it becomes authoritative from here on.
      persistToDurableStoreAsync();
      return null;
    }
    localStorage.setItem(STATION_ENABLED_KEY, durable.enabled ? "1" : "0");
    localStorage.setItem(OWNED_PRINTERS_KEY, JSON.stringify(durable.ownedPrinterIds));
    return durable;
  } catch {
    return null;
  }
}

export function ownsPrinter(printerId: string): boolean {
  const owned = getOwnedPrinterIds();
  return owned.length === 0 || owned.includes(printerId);
}

/** Atomically claims a print_jobs row so only one station ever executes a given job. */
export async function claimPrintJob(jobId: number): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(`/api/print/jobs/${jobId}/claim`), {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { claimed: boolean };
    return data.claimed;
  } catch {
    return false;
  }
}

/** Returns a claimed-but-unprintable job to the pending pool so another station can rescue it. */
export async function releasePrintJob(jobId: number, error?: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/print/jobs/${jobId}/release`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ error }),
    });
  } catch {
    /* old servers 404 here; the 2-min stale-claim reclaim covers it */
  }
}

/**
 * Ownership check → atomic claim → execute. Releases the claim if the executor throws.
 * The executor (or its downstream queue) is responsible for the /api/print/ack.
 * `canClaim`, when given, is an extra pre-claim gate (see canExecuteLocally) — used by
 * Electron hosts so they never race a phone/RawBT station for a printer they can't serve.
 */
export async function claimAndExecute(
  job: RemotePrintJob,
  executor: PrintJobExecutor,
  canClaim?: CanClaimPredicate,
): Promise<void> {
  if (!job.jobId || !ownsPrinter(job.printerId)) return;
  if (canClaim && !(await canClaim(job.printerId))) return;
  const claimed = await claimPrintJob(job.jobId);
  if (!claimed) return; // another station (or this tab's direct print path) took it
  try {
    await executor(job);
  } catch (e: any) {
    console.warn("[printStation] executor failed, releasing job", job.jobId, e);
    await releasePrintJob(job.jobId, e?.message ?? String(e));
  }
}

/** Catch-up: drain pending jobs for this station's printers (offline recovery path). */
export async function pollPendingJobs(executor: PrintJobExecutor, canClaim?: CanClaimPredicate): Promise<void> {
  try {
    const owned = getOwnedPrinterIds();
    const qs = owned.length > 0 ? `?printerId=${encodeURIComponent(owned.join(","))}` : "";
    const res = await fetch(apiUrl(`/api/print/jobs/pending${qs}`), { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { jobs: RemotePrintJob[] };
    for (const job of data.jobs) {
      await claimAndExecute(job, executor, canClaim);
    }
  } catch {
    // network hiccup — the next poll trigger (reconnect/visibility) retries
  }
}
