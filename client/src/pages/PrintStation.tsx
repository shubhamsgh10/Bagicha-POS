import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Wifi, WifiOff, RefreshCw, TestTube2 } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useRealtime, type RealtimeMessage } from "@/hooks/useRealtime";
import { useToast } from "@/hooks/use-toast";
import {
  claimAndExecute,
  pollPendingJobs,
  getOwnedPrinterIds,
  setOwnedPrinterIds,
  isStationEnabled,
  setStationEnabled,
  hydrateFromDurableStore,
  type RemotePrintJob,
} from "@/lib/printStationCore";

interface JobLogEntry {
  job: RemotePrintJob;
  at: number;
  status: "sent" | "error";
  error?: string;
}

/**
 * Hands ESC/POS bytes to the RawBT Android app (Bluetooth/USB-OTG thermal printing).
 * Chrome on Android prefers the intent:// wrapper (with a Play Store fallback if RawBT
 * isn't installed); other browsers get the plain rawbt: scheme.
 * NOTE: some Chrome versions block custom-scheme launches without a user gesture —
 * the on-screen job list's "Print again" button is the guaranteed (tap = gesture) path.
 */
function sendToRawBT(payloadBase64: string): void {
  const ua = navigator.userAgent;
  const isAndroidChrome = /android/i.test(ua) && /chrome/i.test(ua);
  const uri = isAndroidChrome
    ? `intent:base64,${payloadBase64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.browser_fallback_url=${encodeURIComponent(
        "https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter",
      )};end;`
    : `rawbt:base64,${payloadBase64}`;
  const a = document.createElement("a");
  a.href = uri;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function ackJob(job: RemotePrintJob): Promise<void> {
  await fetch(apiUrl("/api/print/ack"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ orderId: job.orderId, type: job.jobType, jobId: job.jobId }),
  });
}

export default function PrintStation() {
  const { toast } = useToast();
  const isElectron = !!window.electronAPI?.isElectron;

  const [enabled, setEnabled] = useState(isStationEnabled);
  const [ownedIds, setOwnedIds] = useState<string[]>(() => getOwnedPrinterIds());
  const [log, setLog] = useState<JobLogEntry[]>([]);

  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const printers: Array<{ id: string; name: string; type: string; width?: number }> =
    settings?.printSettings?.printers ?? [];

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const addLog = useCallback((entry: JobLogEntry) => {
    setLog((prev) => [entry, ...prev].slice(0, 20));
  }, []);

  // Self-heal on mount: the initial useState above already read localStorage synchronously
  // (so first paint isn't blocked on IPC), but Electron's durable, file-backed copy is the
  // one that survives whatever silently reverted localStorage — correct the UI (and
  // localStorage itself) the moment it resolves, which is near-instant (local file read).
  useEffect(() => {
    if (!isElectron) return;
    hydrateFromDurableStore().then((durable) => {
      if (!durable) return;
      setEnabled(durable.enabled);
      setOwnedIds(durable.ownedPrinterIds);
    });
  }, [isElectron]);

  /** RawBT executor: hand off → ack (ack failure is logged, never released — RawBT already has the bytes). */
  const rawbtExecutor = useCallback(
    async (job: RemotePrintJob) => {
      sendToRawBT(job.payload);
      addLog({ job, at: Date.now(), status: "sent" });
      try {
        await ackJob(job);
      } catch (e: any) {
        console.warn("[printStation] ack failed (job already handed to RawBT):", e);
      }
    },
    [addLog],
  );

  const toggleStation = (next: boolean) => {
    setEnabled(next);
    setStationEnabled(next);
  };

  const toggleOwned = (printerId: string) => {
    const next = ownedIds.includes(printerId)
      ? ownedIds.filter((id) => id !== printerId)
      : [...ownedIds, printerId];
    setOwnedIds(next);
    setOwnedPrinterIds(next);
  };

  // ── Live PRINT_JOB handling + catch-up ──────────────────────────────────────
  const { lastMessage, connectionStatus } = useRealtime();
  const lastStatusRef = useRef<string>(connectionStatus);

  useEffect(() => {
    if (!enabled || isElectron) return;
    void pollPendingJobs(rawbtExecutor);
  }, [enabled, isElectron, rawbtExecutor]);

  useEffect(() => {
    if (!enabled || isElectron) return;
    if (connectionStatus === "Open" && lastStatusRef.current !== "Open") {
      void pollPendingJobs(rawbtExecutor);
    }
    lastStatusRef.current = connectionStatus;
  }, [connectionStatus, enabled, isElectron, rawbtExecutor]);

  useEffect(() => {
    if (!enabled || isElectron) return;
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
      rawbtExecutor,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new messages only
  }, [lastMessage]);

  // ── Keep the screen awake while the station is on ──────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let lock: any = null;
    const acquire = async () => {
      // Already held — skip. Without this guard, a visibilitychange->"visible" firing
      // while a still-live lock is held (or resolving) piles up an extra sentinel that
      // never gets an explicit .release() call, since the cleanup below only knows about
      // whichever lock reference this closure variable last got overwritten with.
      if (lock) return;
      try {
        lock = await (navigator as any).wakeLock?.request("screen");
        // Browsers auto-release the sentinel when the tab is hidden — clear our
        // reference when that happens so a later acquire() isn't skipped forever.
        lock?.addEventListener?.("release", () => { lock = null; });
      } catch {
        lock = null;
        /* unsupported / not visible — retried on visibilitychange */
      }
    };
    void acquire();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void acquire();
        if (!isElectron) void pollPendingJobs(rawbtExecutor);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release?.().catch(() => {});
    };
  }, [enabled, isElectron, rawbtExecutor]);

  const testHandoff = () => {
    // Minimal ESC/POS: init, "RawBT TEST OK", 3 feeds, cut — enough to verify the whole chain.
    const bytes = [0x1b, 0x40, ...Array.from(new TextEncoder().encode("RawBT TEST OK\n")), 0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00];
    sendToRawBT(btoa(String.fromCharCode(...bytes)));
    toast({ title: "Test sent to RawBT", description: "If nothing prints, check RawBT is installed and paired to the printer." });
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Printer className="w-5 h-5" />
          Print Station
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Turns this device into a printer station: it receives print jobs for its selected
          printers and prints them via the RawBT app (Bluetooth / USB-OTG).
        </p>
      </div>

      {isElectron && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          This is the desktop app — it already prints its own jobs natively, so Station Mode
          above stays OFF here. The printer checklist below still matters though: leave a
          printer unchecked if it isn't wired to this device (e.g. a phone/Bluetooth printer
          routed through RawBT) so this desktop never tries to claim jobs meant for it.
        </div>
      )}

      {/* Station toggle */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">Station mode</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Keep this page open and the screen on. Jobs arrive in ~1–2 s.
          </p>
        </div>
        <button
          type="button"
          disabled={isElectron}
          onClick={() => toggleStation(!enabled)}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 ${
            enabled ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </div>

      {!enabled && !isElectron && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 flex items-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          Station Mode is OFF — this device will not receive or print any jobs until you turn it ON above.
        </div>
      )}

      {/* Connection state */}
      <div className="flex items-center gap-2 text-xs text-gray-500 px-1">
        {connectionStatus === "Open" ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-green-500" /> Live connection open
          </>
        ) : (
          <>
            <WifiOff className="w-3.5 h-3.5 text-red-400" /> {connectionStatus}… (catch-up poll
            will recover missed jobs)
          </>
        )}
      </div>

      {/* Owned printers */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm font-medium text-gray-800 mb-1">This station prints on</p>
        <p className="text-xs text-gray-400 mb-3">
          Select only the printer(s) physically connected to this device. Leaving all
          unselected means "everything" — don't do that when more than one station exists.
        </p>
        <div className="space-y-2">
          {printers.map((p) => (
            <label key={p.id} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ownedIds.includes(p.id)}
                onChange={() => toggleOwned(p.id)}
                className="accent-emerald-500 w-4 h-4"
              />
              <span className="text-sm text-gray-700">{p.name}</span>
              <span className="text-[10px] text-gray-400 uppercase">{p.type}{p.width ? ` · ${p.width} col` : ""}</span>
            </label>
          ))}
          {printers.length === 0 && (
            <p className="text-xs text-gray-400">No printers registered — add one in Settings → Print Settings → Printer Setup.</p>
          )}
        </div>
      </div>

      {/* Test + recent jobs */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-800">Recent jobs</p>
          <button
            type="button"
            onClick={testHandoff}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
          >
            <TestTube2 className="w-3.5 h-3.5" />
            Test RawBT
          </button>
        </div>
        {log.length === 0 ? (
          <p className="text-xs text-gray-400 py-2 text-center">No jobs handled yet</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {log.map((e, i) => (
              <div key={`${e.job.jobId}-${i}`} className="py-2 flex items-center gap-2 text-xs">
                <span className="text-gray-400 tabular-nums shrink-0">
                  {new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${
                  e.job.jobType === "kot" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                }`}>
                  {e.job.jobType.toUpperCase()}
                </span>
                <span className="text-gray-500 truncate flex-1">Order #{e.job.orderId}</span>
                {/* Manual retap = user gesture — the guaranteed RawBT launch path */}
                <button
                  type="button"
                  onClick={() => sendToRawBT(e.job.payload)}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-gray-500 hover:text-emerald-600 hover:border-emerald-300 transition-colors shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  Print again
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
