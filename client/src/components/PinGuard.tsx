import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Delete } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface PinGuardProps {
  actionLabel: string;
  /** Which tier's PIN is accepted: "manager" = manager or admin; "admin" = admin only */
  requiredRole?: "manager" | "admin";
  onSuccess: () => void;
  onCancel: () => void;
}

const styles = `
  @keyframes pinGuardIn {
    from { opacity: 0; transform: scale(0.94) translateY(8px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
  }
  @keyframes pinShake {
    0%,100% { transform: translateX(0); }
    20%     { transform: translateX(-6px); }
    40%     { transform: translateX(6px); }
    60%     { transform: translateX(-4px); }
    80%     { transform: translateX(4px); }
  }
  @keyframes dotPop {
    0%   { transform: scale(0.6); }
    60%  { transform: scale(1.25); }
    100% { transform: scale(1); }
  }
  @keyframes ripple {
    0%   { transform: scale(0); opacity: 0.35; }
    100% { transform: scale(2.4); opacity: 0; }
  }
  .pin-guard-card { animation: pinGuardIn 0.22s cubic-bezier(0.34,1.46,0.64,1) both; }
  .pin-shake       { animation: pinShake 0.35s ease; }
  .dot-pop         { animation: dotPop 0.2s cubic-bezier(0.34,1.56,0.64,1) both; }
  .key-btn {
    position: relative; overflow: hidden;
    transition: background 0.12s, transform 0.1s, box-shadow 0.12s;
  }
  .key-btn:active:not(:disabled) { transform: scale(0.93); }
  .key-btn .ripple-ring {
    position: absolute; border-radius: 50%;
    width: 100%; aspect-ratio: 1;
    top: 50%; left: 50%;
    transform-origin: center;
    translate: -50% -50%;
    background: rgba(99,102,241,0.18);
    animation: ripple 0.45s ease-out forwards;
    pointer-events: none;
  }
`;

export function PinGuard({ actionLabel, requiredRole = "manager", onSuccess, onCancel }: PinGuardProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; key: string }[]>([]);
  const rippleId = useRef(0);

  const isAdmin = requiredRole === "admin";
  const title = isAdmin ? "Admin Authorization" : "Manager Authorization";
  const hint  = isAdmin ? "Enter admin PIN · press OK for 4-digit" : "Manager or admin PIN · press OK for 4-digit";

  const verifyMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/auth/verify-pin", { pin: p, requiredRole });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.valid) {
        setError("");
        onSuccess();
      } else {
        setError("Incorrect PIN — try again");
        setPin("");
        setShake(true);
        setTimeout(() => setShake(false), 400);
      }
    },
    onError: () => {
      setError("Could not verify PIN");
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    },
  });

  useEffect(() => {
    if (pin.length === 6) verifyMutation.mutate(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const addRipple = (key: string) => {
    const id = ++rippleId.current;
    setRipples((r) => [...r, { id, key }]);
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 500);
  };

  const handleKey = (digit: string) => {
    if (verifyMutation.isPending) return;
    if (pin.length >= 6) return;
    setError("");
    addRipple(digit);
    setPin((p) => p + digit);
  };

  const handleBackspace = () => {
    if (verifyMutation.isPending) return;
    setPin((p) => p.slice(0, -1));
    setError("");
  };

  const handleConfirm = () => {
    if (verifyMutation.isPending) return;
    if (pin.length < 4) { setError("PIN must be at least 4 digits"); return; }
    verifyMutation.mutate(pin);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") handleKey(e.key);
      else if (e.key === "Backspace") handleBackspace();
      else if (e.key === "Enter") handleConfirm();
      else if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const accentColor = isAdmin ? "#f59e0b" : "#6366f1";
  const accentLight = isAdmin ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.10)";

  const modal = (
    <>
      <style>{styles}</style>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ background: "rgba(240,242,248,0.55)", backdropFilter: "blur(12px)" }}
        onClick={onCancel}
      >
        <div
          className={`pin-guard-card${shake ? " pin-shake" : ""} flex flex-col items-center`}
          style={{
            background: "rgba(255,255,255,0.82)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow: "0 8px 40px rgba(100,110,160,0.18), 0 1px 0 rgba(255,255,255,0.9) inset",
            borderRadius: "24px",
            width: "300px",
            padding: "28px 24px 22px",
            gap: "0",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between w-full mb-4">
            <div>
              <div
                className="text-[10px] font-semibold tracking-[0.12em] uppercase mb-0.5"
                style={{ color: accentColor }}
              >
                {isAdmin ? "Admin" : "Manager"} PIN
              </div>
              <h2 className="text-[15px] font-semibold text-gray-800 leading-tight">{title}</h2>
            </div>
            <button
              onClick={onCancel}
              className="rounded-full flex items-center justify-center transition-colors mt-0.5"
              style={{
                width: 28, height: 28,
                background: "rgba(0,0,0,0.055)",
                color: "#9ca3af",
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action chip */}
          <div
            className="w-full rounded-xl px-3 py-2 mb-5 text-center"
            style={{ background: accentLight, border: `1px solid ${accentColor}22` }}
          >
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">Action</p>
            <p className="text-sm font-semibold text-gray-700">{actionLabel}</p>
          </div>

          {/* PIN dots */}
          <div className="flex gap-2.5 mb-2">
            {Array.from({ length: 6 }).map((_, i) => {
              const filled = i < pin.length;
              const pending = filled && verifyMutation.isPending;
              return (
                <div
                  key={i}
                  className={filled ? "dot-pop" : ""}
                  style={{
                    width: 13, height: 13,
                    borderRadius: "50%",
                    transition: "background 0.15s, box-shadow 0.15s",
                    background: filled
                      ? pending ? "#fbbf24" : accentColor
                      : "rgba(0,0,0,0.09)",
                    boxShadow: filled
                      ? `0 0 0 3px ${accentColor}22`
                      : "none",
                  }}
                />
              );
            })}
          </div>

          {/* Status line */}
          <div className="h-5 mb-4 flex items-center justify-center">
            {verifyMutation.isPending ? (
              <p className="text-[11px] font-medium text-amber-500">Verifying…</p>
            ) : error ? (
              <p className="text-[11px] font-medium text-red-500">{error}</p>
            ) : (
              <p className="text-[11px] text-gray-400">{hint}</p>
            )}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2 w-full">
            {["1","2","3","4","5","6","7","8","9"].map((d) => (
              <button
                key={d}
                onClick={() => handleKey(d)}
                disabled={verifyMutation.isPending}
                className="key-btn h-12 rounded-2xl text-gray-700 text-[17px] font-medium disabled:opacity-40"
                style={{
                  background: "rgba(255,255,255,0.75)",
                  border: "1px solid rgba(0,0,0,0.08)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.9) inset",
                }}
              >
                {d}
                {ripples.filter((r) => r.key === d).map((r) => (
                  <span key={r.id} className="ripple-ring" />
                ))}
              </button>
            ))}

            {/* Backspace */}
            <button
              onClick={handleBackspace}
              disabled={verifyMutation.isPending}
              className="key-btn h-12 rounded-2xl flex items-center justify-center text-gray-500 disabled:opacity-40"
              style={{
                background: "rgba(255,255,255,0.75)",
                border: "1px solid rgba(0,0,0,0.08)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.9) inset",
              }}
            >
              <Delete className="w-4 h-4" />
            </button>

            {/* 0 */}
            <button
              onClick={() => handleKey("0")}
              disabled={verifyMutation.isPending}
              className="key-btn h-12 rounded-2xl text-gray-700 text-[17px] font-medium disabled:opacity-40"
              style={{
                background: "rgba(255,255,255,0.75)",
                border: "1px solid rgba(0,0,0,0.08)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.9) inset",
              }}
            >
              0
              {ripples.filter((r) => r.key === "0").map((r) => (
                <span key={r.id} className="ripple-ring" />
              ))}
            </button>

            {/* Confirm */}
            <button
              onClick={handleConfirm}
              disabled={verifyMutation.isPending || pin.length < 4}
              className="key-btn h-12 rounded-2xl text-white text-sm font-bold disabled:opacity-35"
              style={{
                background: pin.length >= 4 && !verifyMutation.isPending
                  ? `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`
                  : "rgba(0,0,0,0.10)",
                color: pin.length >= 4 && !verifyMutation.isPending ? "#fff" : "#9ca3af",
                border: "none",
                boxShadow: pin.length >= 4 && !verifyMutation.isPending
                  ? `0 4px 14px ${accentColor}44`
                  : "none",
                transition: "background 0.2s, box-shadow 0.2s, color 0.2s",
              }}
            >
              {verifyMutation.isPending ? "···" : "OK"}
            </button>
          </div>

          {/* Cancel link */}
          <button
            onClick={onCancel}
            className="mt-4 text-[11px] text-gray-400 hover:text-gray-600 transition-colors tracking-wide"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
}
