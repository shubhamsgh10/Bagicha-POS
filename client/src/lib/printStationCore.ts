import { apiUrl } from "@/lib/api";

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
 */
export async function claimAndExecute(job: RemotePrintJob, executor: PrintJobExecutor): Promise<void> {
  if (!job.jobId || !ownsPrinter(job.printerId)) return;
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
export async function pollPendingJobs(executor: PrintJobExecutor): Promise<void> {
  try {
    const owned = getOwnedPrinterIds();
    const qs = owned.length > 0 ? `?printerId=${encodeURIComponent(owned.join(","))}` : "";
    const res = await fetch(apiUrl(`/api/print/jobs/pending${qs}`), { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { jobs: RemotePrintJob[] };
    for (const job of data.jobs) {
      await claimAndExecute(job, executor);
    }
  } catch {
    // network hiccup — the next poll trigger (reconnect/visibility) retries
  }
}
