import { useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";
import { claimPrintJob } from "@/lib/printGateway";
import { useRealtime, type RealtimeMessage } from "@/hooks/useRealtime";

interface RemotePrintJob {
  jobId: number;
  orderId: number;
  jobType: "kot" | "bill";
  printerId: string;
  payload: string;
}

async function executeClaimedJob(job: RemotePrintJob): Promise<void> {
  const claimed = await claimPrintJob(job.jobId);
  if (!claimed) return; // another host (or this tab's direct print response) already took it

  const printJob = {
    printerId: job.printerId,
    encoding: "escpos-base64" as const,
    data: job.payload,
    orderId: job.orderId,
    ackType: job.jobType,
    jobId: job.jobId,
  };
  await window.electronAPI!.print(printJob);
  // Ack (and the printJobs row flip to 'printed') is handled inside the Electron print queue.
}

async function pollPendingJobs(): Promise<void> {
  try {
    const res = await fetch(apiUrl("/api/print/jobs/pending"), { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { jobs: RemotePrintJob[] };
    for (const job of data.jobs) {
      await executeClaimedJob(job);
    }
  } catch {
    // network hiccup — next poll trigger (reconnect or interval) will retry
  }
}

/**
 * Mounted once (App.tsx). Only acts inside the Electron host build — phones/browsers
 * receive the same PRINT_JOB broadcast but silently ignore it (no window.electronAPI).
 * Live path: realtime PRINT_JOB push -> claim -> print. Catch-up path: poll pending jobs
 * on mount and whenever the realtime connection (re)opens, for jobs broadcast while this
 * desktop host was offline.
 */
export function usePrintJobBridge(): void {
  const { lastMessage, connectionStatus } = useRealtime();
  const lastStatusRef = useRef<string>(connectionStatus);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    void pollPendingJobs();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    if (connectionStatus === "Open" && lastStatusRef.current !== "Open") {
      void pollPendingJobs();
    }
    lastStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    if (!lastMessage || lastMessage.type !== "PRINT_JOB") return;
    const msg = lastMessage as RealtimeMessage & RemotePrintJob;
    void executeClaimedJob({
      jobId: msg.jobId,
      orderId: msg.orderId,
      jobType: msg.jobType,
      printerId: msg.printerId,
      payload: msg.payload,
    });
  }, [lastMessage]);
}
