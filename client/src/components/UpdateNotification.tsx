import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCw, X, CheckCircle2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "idle" | "downloading" | "ready";

interface UpdateState {
  phase:   Phase;
  version?: string;
  percent?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UpdateNotification() {
  const [state,     setState]     = useState<UpdateState>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const api = window.electronAPI;

  useEffect(() => {
    // Only wire up listeners in Electron
    if (!api?.isElectron) return;

    const offStatus = api.onUpdateStatus(p => {
      if (p.status === "available") {
        setState({ phase: "downloading", version: p.version, percent: 0 });
        setDismissed(false);
      } else if (p.status === "current" || p.status === "error") {
        // Stay quiet — don't bother the user
        setState({ phase: "idle" });
      }
    });

    const offProgress = api.onUpdateProgress(p => {
      setState(prev => ({ ...prev, phase: "downloading", percent: p.percent }));
    });

    const offDownloaded = api.onUpdateDownloaded(p => {
      setState({ phase: "ready", version: p.version });
      setDismissed(false); // Always re-show when a new version is ready
    });

    return () => {
      offStatus();
      offProgress();
      offDownloaded();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstall = async () => {
    if (!api?.installUpdate) return;
    setInstalling(true);
    const result = await api.installUpdate();
    if (!result.ok) {
      setInstalling(false);
      if (result.reason === "pos-active") {
        // Non-modal warning — reset and let them try again after the order
        setState(prev => ({ ...prev }));
        alert("Please complete the current order before updating.");
      }
    }
    // If ok=true, app will restart — nothing further needed
  };

  // Not in Electron, or nothing to show, or user dismissed
  if (!api?.isElectron || state.phase === "idle" || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="update-notification"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0,  scale: 1    }}
        exit   ={{ opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        className="fixed bottom-4 right-4 z-[9999] w-64 rounded-2xl shadow-2xl overflow-hidden"
        style={{
          background: "var(--paper-0)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(229,231,235,0.8)",
        }}
      >
        {/* ── Downloading progress ────────────────────────────────────────── */}
        {state.phase === "downloading" && (
          <div className="p-3.5">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <Download className="w-3 h-3 text-blue-600 animate-bounce" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-gray-800">
                  Downloading update{state.version ? ` v${state.version}` : ""}
                </div>
                <div className="text-[10px] text-gray-400">Running in background…</div>
              </div>
              <button
                onClick={() => setDismissed(true)}
                className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
              <motion.div
                className="h-1.5 rounded-full bg-blue-500"
                animate={{ width: `${state.percent ?? 2}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <div className="text-[10px] text-gray-400 mt-1 text-right tabular-nums">
              {state.percent ?? 0}%
            </div>
          </div>
        )}

        {/* ── Ready to install ────────────────────────────────────────────── */}
        {state.phase === "ready" && (
          <div className="p-4">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[12px] font-bold text-gray-900">Update Ready</div>
                  {state.version && (
                    <div className="text-[10px] text-gray-400">Version {state.version}</div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setDismissed(true)}
                className="text-gray-300 hover:text-gray-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Changelog bullets */}
            <div className="space-y-1 mb-3.5">
              {["POS improvements", "Bug fixes", "Performance upgrades"].map(item => (
                <div key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                  <span className="text-[10px] text-gray-500">{item}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleInstall}
                disabled={installing}
                className="flex-1 text-[11px] font-semibold py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-wait"
              >
                {installing ? "Restarting…" : "Install & Restart"}
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="flex-1 text-[11px] font-semibold py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 active:scale-[0.98] transition-all"
              >
                Later
              </button>
            </div>

            {/* Safety note */}
            <p className="text-[9px] text-gray-400 text-center mt-2">
              Safe to install — closes any active orders first
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
