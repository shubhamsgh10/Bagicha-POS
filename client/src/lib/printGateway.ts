import type { PrintApiResponse, PrintJob } from "@shared/print/types";
import { apiUrl } from "@/lib/api";
import { printKOT, printOrderBill } from "@/lib/printBill";
import { claimPrintJob, releasePrintJob, ownsPrinter } from "@/lib/printStationCore";

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
  /** Called when API returns browserPrint for KOT */
  onBrowserKOT?: (data: PrintApiResponse) => void;
  /** Called when API returns browserPrint for bill */
  onBrowserBill?: () => void | Promise<void>;
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
      await options.onBrowserBill();
    } else if (options.onBrowserKOT) {
      options.onBrowserKOT(data);
    } else if (data.orderNumber && data.items) {
      printKOT(
        { orderNumber: data.orderNumber, tableNumber: data.tableNumber, createdAt: new Date() },
        data.items,
      );
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

    for (const pj of jobList) {
      // Jobs for printers this station doesn't own were already broadcast — leave
      // them for the owning station (outdoor tablet, other host) to claim.
      if (pj.jobId && !ownsPrinter(pj.printerId)) {
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
      await options.onBrowserBill();
      return "browser";
    } else if (options.onBrowserKOT) {
      options.onBrowserKOT(data);
      return "browser";
    } else if (data.orderNumber && data.items) {
      printKOT(
        { orderNumber: data.orderNumber, tableNumber: data.tableNumber, createdAt: new Date() },
        data.items,
      );
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
  options: Omit<PrintHandleOptions, "orderId" | "ackType"> = {},
): Promise<PrintHandleResult> {
  const res = await fetch(apiUrl("/api/print/bill"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
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
    ...options,
    orderId,
    ackType: "bill",
    pendingAck: data.pendingAck,
  });
}
