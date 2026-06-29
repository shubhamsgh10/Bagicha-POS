import type { PrintApiResponse } from "@shared/print/types";
import { apiUrl } from "@/lib/api";
import { printKOT, printOrderBill } from "@/lib/printBill";

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

/** Atomically claims a print_jobs row so only one consumer (this tab's direct path,
 *  or the PRINT_JOB broadcast listener) ever executes a given job. */
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

  if (data.printed === true && !data.printJob) {
    return "hardware";
  }

  if (data.printJob && window.electronAPI?.isElectron) {
    if (data.printJob.jobId) {
      const claimed = await claimPrintJob(data.printJob.jobId);
      if (!claimed) {
        // Already claimed (printed or in-flight) by the PRINT_JOB broadcast listener — don't print twice.
        return "dispatched";
      }
    }
    const result = await window.electronAPI.print(data.printJob);
    if (!result.ok) {
      // Electron queue enqueue failed — fall back to browser print
      console.warn("[print] Electron print failed, falling back to browser:", result.error);
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
    // Ack is handled by the Electron print queue internally — do not double-ack here
    return "hardware";
  }

  if (data.printJob && !window.electronAPI?.print) {
    // No local Electron printer — the server already broadcast this job (PRINT_JOB)
    // for a remote desktop host to pick up and print. Nothing to do here.
    if (data.dispatched || data.printJob.jobId) {
      return "dispatched";
    }
    if (data.pendingAck) {
      return "noop";
    }
  }

  if (data.printed === false && !data.browserPrint && !data.printJob) {
    return "skipped";
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
