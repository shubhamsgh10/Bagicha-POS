import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Users, IndianRupee, ShoppingBag } from "lucide-react";
import type { EnrichedTable } from "@/hooks/useLiveTables";

// ── Live elapsed-time display ─────────────────────────────────────────────────

function getElapsedLabel(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function LiveTimer({ createdAt }: { createdAt: string }) {
  const [label, setLabel] = useState(() => getElapsedLabel(createdAt));
  useEffect(() => {
    const id = setInterval(() => setLabel(getElapsedLabel(createdAt)), 60_000);
    return () => clearInterval(id);
  }, [createdAt]);
  return <span>{label}</span>;
}

// ── Status styling map ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; dot: string; card: string; badge: string; pulse: boolean }
> = {
  free: {
    label: "Available",
    dot: "bg-emerald-400",
    card: "bg-white/70 border-emerald-200/70",
    badge: "bg-emerald-100 text-emerald-700",
    pulse: false,
  },
  running: {
    label: "Running",
    dot: "bg-amber-400",
    card: "bg-amber-50/80 border-amber-300/70",
    badge: "bg-amber-100 text-amber-700",
    pulse: true,
  },
  billed: {
    label: "Billing Pending",
    dot: "bg-red-400",
    card: "bg-red-50/80 border-red-300/70",
    badge: "bg-red-100 text-red-700",
    pulse: true,
  },
};

const DEFAULT_STATUS = STATUS_CONFIG.free;

// ── Component ─────────────────────────────────────────────────────────────────

interface TableCardProps {
  table: EnrichedTable;
  index: number;
  onSelect: (table: EnrichedTable) => void;
}

export const TableCard = memo(function TableCard({
  table,
  index,
  onSelect,
}: TableCardProps) {
  const cfg = STATUS_CONFIG[table.status] ?? DEFAULT_STATUS;
  const itemCount = table.order?.items?.length ?? 0;
  const total = table.order ? parseFloat(table.order.totalAmount) : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={{ delay: index * 0.025, duration: 0.18, ease: "easeOut" }}
      whileHover={{ scale: 1.025, y: -2 }}
      onClick={() => onSelect(table)}
      className={`
        relative cursor-pointer select-none
        backdrop-blur-sm border rounded-2xl p-4 shadow-sm
        hover:shadow-md hover:shadow-black/5 transition-shadow
        ${cfg.card}
      `}
    >
      {/* Status badge — top right */}
      <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
        <div className="relative flex items-center justify-center h-2.5 w-2.5">
          {cfg.pulse && (
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-50`}
            />
          )}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
        </div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>

      {/* Table name + section */}
      <div className="mb-3 pr-2">
        <h3 className="text-sm font-bold text-gray-800 truncate leading-tight">
          {table.name}
        </h3>
        <p className="text-[10px] text-gray-400 capitalize mt-0.5">{table.section}</p>
      </div>

      {/* Order details (running / billed) */}
      {table.order ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-gray-700">
            <IndianRupee className="w-3 h-3 text-gray-500 shrink-0" />
            <span className="text-sm font-bold leading-none">
              {total.toLocaleString("en-IN", { minimumFractionDigits: 0 })}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-gray-500">
            <ShoppingBag className="w-3 h-3 shrink-0" />
            <span className="text-xs">
              {itemCount} item{itemCount !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-gray-500">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="text-xs">
              <LiveTimer createdAt={table.order.createdAt} />
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-gray-400 text-xs">
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span>Seats {table.capacity}</span>
        </div>
      )}
    </motion.div>
  );
});
