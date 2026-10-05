import type { PrintApiResponse, PrintConfigSettings, PrintJob } from "@shared/print/types";
import { apiUrl } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { printKotFallback } from "@/lib/printBill";
import { withBrowserPayloads } from "@shared/print/browserPayload";
import { claimPrintJob, releasePrintJob, ownsPrinter, canExecuteLocallyVerified } from "@/lib/printStationCore";

/** Same rationale as usePrintJobBridge.ts: don't let this host claim a printer it can't
 *  physically execute (e.g. a phone/RawBT-routed printer, or a printer wired to a
 *  DIFFERENT Electron host that merely shares the same DB-stored windowsQueueName) —
 *  reads the already-cached /api/settings query rather than a fresh fetch, since this
 *  runs on every print tap. */
async function canExecuteHere(printerId: string): Promise<boolean> {
  const settings = queryClient.getQueryData<{ printSettings?: PrintConfigSettings }>(["/api/settings"]);
  const printers = settings?.printSettings?.printers;
  if (!printers) return true;
  const printer = printers.find((p) => p.id === printerId);
  if (!printer) return true;
  return canExecuteLocallyVerified(printer);
}

export { claimPrintJob } from "@/lib/printStationCore";

export type PrintHandleResult =
  | "hardware"
  | "browser"
  | "skipped"
  | "noop"
  | "dispatched"
  | "failed";

export interface PrintHandleOptions {
  orderId?: number;
  ackType?: "kot" | "bill";
  pendingAck?: boolean;
  /**
   * Called when a KOT must go through the browser instead of a thermal printer. Receives the
   * response with the tickets' ESC/POS bytes attached whenever they are known (see fallbackData) —
   * hand it to printKotFallback() so the fallback is the real KOT.
   */
  onBrowserKOT?: (data: PrintApiResponse) => void;
  /**
   * Called when a bill must go through the browser instead of a thermal printer. Same contract:
   * hand the data to printBillFallback() so the fallback is the real bill.
   */
  onBrowserBill?: (data: PrintApiResponse) => void | Promise<void>;
}

/**
 * Makes sure a fallback response carries the tickets' ESC/POS bytes. The server attaches them on
 * every fallback it decides itself; when the fallback is decided HERE instead (Electron failed to
 * enqueue the job), the bytes are in `printJob(s)`, so lift them into the same shape — using each
 * printer's configured width from the cached settings (48 columns when unknown).
 */
function fallbackData(data: PrintApiResponse): PrintApiResponse {
  const settings = queryClient.getQueryData<{ printSettings?: PrintConfigSettings }>(["/api/settings"]);
  const printers = settings?.printSettings?.printers;
  return withBrowserPayloads(data, (id) => printers?.find((p) => p.id === id)?.width);
}

async function ackPrint(orderId: number, type: "kot" | "bill"): Promise<void> {
  await fetch(apiUrl("/api/print/ack"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ orderId, type }),
  });
}

/** Route a /api/print/* JSON response to Electron, server-printed, or browser fallback. */
export async function handlePrintResponse(
  data: PrintApiResponse & { orderId?: number; pendingAck?: boolean },
  options: PrintHandleOptions = {},
): Promise<PrintHandleResult> {
  if (data.reason === "no_delta" || data.reason === "kot_disabled") {
    return "skipped";
  }

  if (data.browserPrint) {
    if (options.onBrowserBill) {
      await options.onBrowserBill(fallbackData(data));
    } else if (options.onBrowserKOT) {
      options.onBrowserKOT(fallbackData(data));
    } else if (data.orderNumber && data.items) {
      printKotFallback(fallbackData(data));
    }
    return "browser";
  }

  // One tap may produce multiple routed jobs (one per section printer).
  const jobList: PrintJob[] = data.printJobs ?? (data.printJob ? [data.printJob] : []);

  if (jobList.length === 0) {
    if (data.printed === true) return "hardware";
    if (data.printed === false && !data.browserPrint) return "skipped";
    return "noop";
  }

  if (window.electronAPI?.isElectron) {
    let executed = 0;
    let dispatched = 0;
    let lastError: string | undefined;

    // Category routing can produce several routed jobs from one tap (CLAUDE.md's
    // "Multi-station printing") — run the executability checks for all of them
    // concurrently rather than one-at-a-time, since each can involve a PowerShell
    // round-trip (canExecuteLocallyVerified) and they're independent of each other.
    const executable = await Promise.all(
      jobList.map((pj) => (pj.jobId ? canExecuteHere(pj.printerId) : Promise.resolve(true))),
    );

    for (let i = 0; i < jobList.length; i++) {
      const pj = jobList[i];
      // Jobs for printers this station doesn't own — or can't physically execute
      // (e.g. a phone/RawBT-routed printer) — were already broadcast; leave them for
      // the owning station (outdoor tablet, other host) to claim.
      if (pj.jobId && (!ownsPrinter(pj.printerId) || !executable[i])) {
        dispatched++;
        continue;
      }
      if (pj.jobId) {
        const claimed = await claimPrintJob(pj.jobId);
        if (!claimed) {
          // Already claimed (printed or in-flight) by the broadcast listener — don't print twice.
          dispatched++;
          continue;
        }
      }
      const result = await window.electronAPI.print(pj);
      if (result.ok) {
        // Ack is handled by the Electron print queue internally — do not double-ack here.
        executed++;
      } else {
        lastError = result.error;
        if (pj.jobId) await releasePrintJob(pj.jobId, result.error);
      }
    }

    if (executed > 0) return "hardware";
    if (dispatched > 0) return "dispatched";

    // Every job failed to enqueue — fall back to browser print.
    console.warn("[print] Electron print failed, falling back to browser:", lastError);
    if (options.onBrowserBill) {
      await options.onBrowserBill(fallbackData(data));
      return "browser";
    } else if (options.onBrowserKOT) {
      options.onBrowserKOT(fallbackData(data));
      return "browser";
    } else if (data.orderNumber && data.items) {
      printKotFallback(fallbackData(data));
      return "browser";
    }
    return "failed";
  }

  // No local Electron printer — the server already broadcast these jobs (PRINT_JOB)
  // for the owning stations to pick up and print. Nothing to do here.
  if (data.dispatched || jobList.some((j) => j.jobId)) {
    return "dispatched";
  }
  if (data.pendingAck) {
    return "noop";
  }

  return "noop";
}

/** Direct bill print via API → thermal/Electron/server (no browser dialog unless fallback requested). */
export async function printBillDirect(
  orderId: number,
  options: Omit<PrintHandleOptions, "orderId" | "ackType"> & { markBilled?: "always" | "on_send" } = {},
): Promise<PrintHandleResult> {
  const { markBilled, ...handleOptions } = options;
  const res = await fetch(apiUrl("/api/print/bill"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, ...(markBilled ? { markBilled } : {}) }),
    credentials: "include",
  });
  const data = (await res.json()) as PrintApiResponse & {
    orderId?: number;
    pendingAck?: boolean;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.message ?? "Bill print failed");
  }
  return handlePrintResponse(data, {
    ...handleOptions,
    orderId,
    ackType: "bill",
    pendingAck: data.pendingAck,
  });
}
