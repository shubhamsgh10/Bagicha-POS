import { useState, useEffect } from "react";
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

export function PinGuard({ actionLabel, requiredRole = "manager", onSuccess, onCancel }: PinGuardProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const title = requiredRole === "admin" ? "Admin PIN Required" : "Manager PIN Required";
  const hint  = requiredRole === "admin" ? "Enter admin PIN to authorise" : "Enter manager or admin PIN";

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
        setError("Incorrect PIN. Try again.");
        setPin("");
      }
    },
    onError: () => {
      setError("Could not verify PIN. Try again.");
      setPin("");
    },
  });

  useEffect(() => {
    if (pin.length === 4) verifyMutation.mutate(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const handleKey = (digit: string) => {
    if (verifyMutation.isPending) return;
    if (pin.length >= 6) return;
    setError("");
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

  const dots = Array.from({ length: 6 }).map((_, i) => (
    <div
      key={i}
      className={`w-3.5 h-3.5 rounded-full transition-all ${
        i < pin.length
          ? verifyMutation.isPending ? "bg-yellow-400 scale-110" : "bg-green-400 scale-110"
          : "bg-gray-600"
      }`}
    />
  ));

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="bg-gray-900 text-white rounded-2xl shadow-2xl w-72 p-6 flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between w-full">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{title}</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action label */}
        <div className="text-center">
          <p className="text-xs text-gray-400">Action:</p>
          <p className="text-sm font-semibold text-white mt-0.5">{actionLabel}</p>
        </div>

        {/* PIN dots */}
        <div className="flex gap-3 my-1">{dots}</div>

        {/* Status */}
        {verifyMutation.isPending ? (
          <p className="text-xs text-yellow-400 -mt-2">Verifying...</p>
        ) : error ? (
          <p className="text-xs text-red-400 -mt-2">{error}</p>
        ) : (
          <p className="text-xs text-gray-500 -mt-2">{hint}</p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2 w-full">
          {["1","2","3","4","5","6","7","8","9"].map((d) => (
            <button
              key={d}
              onClick={() => handleKey(d)}
              disabled={verifyMutation.isPending}
              className="h-12 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-50 text-white text-lg font-medium transition-colors"
            >
              {d}
            </button>
          ))}
          <button
            onClick={handleBackspace}
            disabled={verifyMutation.isPending}
            className="h-12 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-50 text-white flex items-center justify-center transition-colors"
          >
            <Delete className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleKey("0")}
            disabled={verifyMutation.isPending}
            className="h-12 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-50 text-white text-lg font-medium transition-colors"
          >
            0
          </button>
          <button
            onClick={handleConfirm}
            disabled={verifyMutation.isPending || pin.length < 4}
            className="h-12 rounded-xl bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-40 text-white text-sm font-bold transition-colors"
          >
            {verifyMutation.isPending ? "..." : "OK"}
          </button>
        </div>

        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1">
          Cancel
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
