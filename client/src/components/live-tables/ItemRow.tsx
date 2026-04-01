import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import type { LiveItem } from "@/hooks/useLiveTableOperations";

interface ItemRowProps {
  item: LiveItem;
  compact: boolean;
  isDelivered: boolean;
  onToggleDelivered: () => void;
}

export const ItemRow = memo(function ItemRow({
  item,
  compact,
  isDelivered,
  onToggleDelivered,
}: ItemRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8, height: 0 }}
      animate={{ opacity: 1, x: 0, height: "auto" }}
      exit={{ opacity: 0, x: -8, height: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      onClick={onToggleDelivered}
      className={`relative flex items-start gap-2 rounded-lg overflow-hidden cursor-pointer select-none transition-all ${
        compact ? "py-0.5 px-1" : "py-1.5 px-1.5"
      } ${
        isDelivered
          ? "bg-emerald-50/70 opacity-60"
          : item.isNew
          ? "bg-yellow-300/20 ring-1 ring-yellow-400/50"
          : "hover:bg-black/[0.03] active:bg-black/[0.06]"
      }`}
    >
      {/* Yellow glow overlay for new items */}
      {item.isNew && !isDelivered && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 rounded-lg bg-yellow-300/10 pointer-events-none"
        />
      )}

      {/* Qty badge / delivered checkmark */}
      <span
        className={`relative shrink-0 flex items-center justify-center text-[10px] font-bold min-w-[26px] h-5 rounded py-0.5 px-1 mt-0.5 transition-colors ${
          isDelivered
            ? "bg-emerald-100 text-emerald-600"
            : item.isNew
            ? "bg-yellow-400 text-yellow-900"
            : "bg-gray-100 text-gray-600"
        }`}
      >
        {isDelivered ? (
          <Check className="w-2.5 h-2.5" />
        ) : (
          `${item.quantity}x`
        )}
      </span>

      {/* Name + special instructions */}
      <span className="relative flex-1 min-w-0 flex flex-col">
        <span
          className={`font-medium leading-snug transition-colors ${
            compact ? "text-[10px] truncate" : "text-xs"
          } ${isDelivered ? "line-through text-gray-400" : "text-gray-800"}`}
        >
          {item.name}
          {item.size && (
            <span className="text-gray-400 font-normal ml-1">({item.size})</span>
          )}
        </span>
        {!compact && item.specialInstructions && (
          <span
            className={`text-[9px] leading-tight mt-0.5 italic ${
              isDelivered ? "text-gray-300" : "text-amber-600"
            }`}
          >
            {item.specialInstructions}
          </span>
        )}
      </span>

      {/* NEW badge */}
      <AnimatePresence>
        {item.isNew && !isDelivered && (
          <motion.span
            key="new-badge"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="relative shrink-0 self-center text-[8px] font-extrabold bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded-full animate-pulse"
          >
            NEW
          </motion.span>
        )}
      </AnimatePresence>

      {/* SERVED badge */}
      <AnimatePresence>
        {isDelivered && (
          <motion.span
            key="served-badge"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="relative shrink-0 self-center text-[8px] font-bold bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full"
          >
            SERVED
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
