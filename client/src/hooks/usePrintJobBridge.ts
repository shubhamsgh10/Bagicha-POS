import { useEffect, useRef } from "react";
import { useRealtime, type RealtimeMessage } from "@/hooks/useRealtime";
import {
  claimAndExecute,
  pollPendingJobs,
  type RemotePrintJob,
} from "@/lib/printStationCore";

/** Hands a claimed job to the Electron print queue (which retries + acks after the physical print). */
async function electronExecutor(job: RemotePrintJob): Promise<void> {
  const result = await window.electronAPI!.print({
    printerId: job.printerId,
    encoding: "escpos-base64" as const,
    data: job.payload,
    orderId: job.orderId,
    ackType: job.jobType,
    jobId: job.jobId,
  });
  if (!result.ok) {
    throw new Error(result.error || "Electron print enqueue failed");
  }
}

/**
 * Mounted once (App.tsx). Only acts inside the Electron host build — phones/browsers
 * receive the same PRINT_JOB broadcast but silently ignore it (no window.electronAPI).
 * Live path: realtime PRINT_JOB push -> ownership filter -> claim -> print.
 * Catch-up path: poll pending jobs (scoped to this station's printers) on mount and
 * whenever the realtime connection (re)opens, for jobs broadcast while offline.
 */
export function usePrintJobBridge(): void {
  const { lastMessage, connectionStatus } = useRealtime();
  const lastStatusRef = useRef<string>(connectionStatus);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    void pollPendingJobs(electronExecutor);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    if (connectionStatus === "Open" && lastStatusRef.current !== "Open") {
      void pollPendingJobs(electronExecutor);
    }
    lastStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    if (!lastMessage || lastMessage.type !== "PRINT_JOB") return;
    const msg = lastMessage as RealtimeMessage & RemotePrintJob;
    void claimAndExecute(
      {
        jobId: msg.jobId,
        orderId: msg.orderId,
        jobType: msg.jobType,
        printerId: msg.printerId,
        payload: msg.payload,
      },
      electronExecutor,
    );
  }, [lastMessage]);
}
