import { Printer, Lock } from "lucide-react";

const fmt = (n: number) => `₹${n.toFixed(0)}`;

/**
 * Section-counter action area: compact totals breakdown + a giant
 * "Print Bill · ₹X" button so the true grand total (tax + container included)
 * is the biggest number on screen — staff read THIS to the customer.
 * All handlers/labels come from POS.tsx unchanged (go(...) PIN gates, settlePhase).
 */
export function SectionActionBar({
  subtotal,
  tax,
  taxRatePct,
  containerCharge,
  containerRate,
  containerCount,
  grandTotal,
  hasItems,
  isPending,
  printLocked,
  settleLocked,
  settleLabel,
  onPrintBill,
  onSettle,
}: {
  subtotal: number;
  tax: number;
  taxRatePct: number;
  containerCharge: number;
  containerRate: number;
  containerCount: number;
  grandTotal: number;
  hasItems: boolean;
  isPending: boolean;
  printLocked: boolean;
  settleLocked: boolean;
  settleLabel: string;
  onPrintBill: () => void;
  onSettle: () => void;
}) {
  return (
    <div className="space-y-2">
      {/* Compact breakdown — small on purpose; the button carries the big number */}
      <div className="px-1 space-y-0.5 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>Items</span>
          <span className="tabular-nums">{fmt(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>GST ({taxRatePct}%)</span>
          <span className="tabular-nums">{fmt(tax)}</span>
        </div>
        {containerCharge > 0 && (
          <div className="flex justify-between text-amber-600 font-medium">
            <span>Container ({containerCount} × ₹{containerRate})</span>
            <span className="tabular-nums">{fmt(containerCharge)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 mt-1 border-t border-dashed border-gray-200 text-sm font-bold text-gray-900">
          <span>Total</span>
          <span className="tabular-nums">{fmt(grandTotal)}</span>
        </div>
      </div>

      {/* Signature: the bill total IS the button */}
      <button
        disabled={!hasItems || isPending || printLocked}
        onClick={onPrintBill}
        className="w-full h-16 rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2.5"
      >
        <Printer className="w-5 h-5 shrink-0" />
        <span className="text-base font-bold">Print Bill</span>
        <span className="text-2xl font-black tabular-nums">· {fmt(grandTotal)}</span>
        {printLocked && <Lock className="w-4 h-4 opacity-60" />}
      </button>

      <button
        disabled={!hasItems || isPending || settleLocked}
        onClick={onSettle}
        className="w-full h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
      >
        {settleLabel}
        {settleLocked && <Lock className="w-4 h-4 opacity-60" />}
      </button>
    </div>
  );
}
