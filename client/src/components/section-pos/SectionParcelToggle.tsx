import { motion } from "framer-motion";
import { UtensilsCrossed, ShoppingBag } from "lucide-react";

/**
 * Big two-option segmented control for the quick-POS section counter. Sets the
 * mode NEW items are added as: "Eating Here" (no container charge) vs "Parcel"
 * (container charge per item). Items keep their own mode, so orders can mix both —
 * purely presentational; POS.tsx owns the state (activeItemMode).
 */
export function SectionParcelToggle({
  parcel,
  containerRate,
  onChange,
}: {
  parcel: boolean;
  containerRate: number;
  onChange: (parcel: boolean) => void;
}) {
  return (
    <div className="shrink-0 px-3 pb-2 pt-1 border-b border-[var(--line,#e5e7eb)]" style={{ background: "var(--paper-0, #fff)" }}>
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5 px-1">
        New items go to
      </div>
      <div className="relative flex gap-1 rounded-xl bg-gray-100 p-1">
        {/* Sliding active pill */}
        <motion.div
          className={`absolute top-1 bottom-1 rounded-lg ${parcel ? "bg-amber-500" : "bg-green-600"}`}
          initial={false}
          animate={{ left: parcel ? "50%" : "0.25rem", right: parcel ? "0.25rem" : "50%" }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        />
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`relative z-10 flex-1 h-14 rounded-lg flex items-center justify-center gap-2 text-base font-bold transition-colors ${
            !parcel ? "text-white" : "text-gray-500"
          }`}
        >
          <UtensilsCrossed className="w-5 h-5" />
          Eating Here
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`relative z-10 flex-1 h-14 rounded-lg flex flex-col items-center justify-center leading-tight transition-colors ${
            parcel ? "text-white" : "text-gray-500"
          }`}
        >
          <span className="flex items-center gap-2 text-base font-bold">
            <ShoppingBag className="w-5 h-5" />
            Parcel
          </span>
          <span className={`text-[11px] font-semibold ${parcel ? "text-amber-100" : "text-gray-400"}`}>
            +₹{containerRate}/item
          </span>
        </button>
      </div>
    </div>
  );
}
