import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime, type RealtimeMessage } from "@/hooks/useRealtime";
import {
  claimAndExecute,
  canExecuteLocallyVerified,
  pollPendingJobs,
  type RemotePrintJob,
} from "@/lib/printStationCore";
import type { PrintConfigSettings } from "@shared/print/types";

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
  const { isAuthenticated } = useAuth();
  const { lastMessage, connectionStatus } = useRealtime();
  const lastStatusRef = useRef<string>(connectionStatus);

  // Printer configs, to skip claiming jobs this desktop host has no local execution path
  // for (e.g. a phone/RawBT-routed printer registered with a blank Windows queue name) —
  // without this, an Electron host races the owning phone station for every such job,
  // wins often, then deterministically fails (see desktop/print/usbSend.ts).
  // Gated on isAuthenticated: this hook is mounted unconditionally at the App root, so
  // without the gate it fires on the login screen too — /api/settings is requireAuth and
  // just 401s pre-login (handled gracefully, but it's a pointless request and log noise).
  const { data: settings } = useQuery<{ printSettings?: PrintConfigSettings }>({
    queryKey: ["/api/settings"],
    enabled: isAuthenticated,
  });
  const printersRef = useRef(settings?.printSettings?.printers);
  printersRef.current = settings?.printSettings?.printers;

  const canClaim = async (printerId: string): Promise<boolean> => {
    const printers = printersRef.current;
    if (!printers) return true; // settings not loaded yet — don't block on an unknown
    const printer = printers.find((p) => p.id === printerId);
    if (!printer) return true; // unrecognized id — fall back to prior (allow) behavior
    return canExecuteLocallyVerified(printer);
  };

  // Offline-recovery poll: wait for printer configs to load at least once before running,
  // so it doesn't claim pending jobs with zero verification during the brief startup window
  // before /api/settings resolves (usually already warm from TopNav/BottomNav/POS sharing the
  // same query). Bounded by a timeout so a genuinely failed settings fetch can't block
  // recovery forever — catching up on jobs missed while offline matters more than the gate.
  const didInitialPollRef = useRef(false);
  useEffect(() => {
    if (!window.electronAPI?.isElectron || !isAuthenticated) return;
    if (didInitialPollRef.current) return;
    if (settings !== undefined) {
      didInitialPollRef.current = true;
      void pollPendingJobs(electronExecutor, canClaim);
      return;
    }
    const timer = setTimeout(() => {
      if (didInitialPollRef.current) return;
      didInitialPollRef.current = true;
      void pollPendingJobs(electronExecutor, canClaim);
    }, 5_000);
    return () => clearTimeout(timer);
  }, [settings, isAuthenticated]);

  useEffect(() => {
    if (!window.electronAPI?.isElectron || !isAuthenticated) return;
    if (connectionStatus === "Open" && lastStatusRef.current !== "Open") {
      void pollPendingJobs(electronExecutor, canClaim);
    }
    lastStatusRef.current = connectionStatus;
  }, [connectionStatus, isAuthenticated]);

  useEffect(() => {
    if (!window.electronAPI?.isElectron || !isAuthenticated) return;
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
      canClaim,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new messages only
  }, [lastMessage]);
}
