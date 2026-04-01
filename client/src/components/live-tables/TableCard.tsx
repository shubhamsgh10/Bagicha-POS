import { memo, useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Clock, Users, CheckCircle2 } from "lucide-react";
import type { LiveItem, LiveTableState } from "@/hooks/useLiveTableOperations";
import { ItemRow } from "./ItemRow";

// ── Elapsed helpers ───────────────────────────────────────────────────────────

function getElapsedMins(startedAt: string | null): number {
  if (!startedAt) return 0;
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000);
}

function getElapsedLabel(startedAt: string | null): string {
  const mins = getElapsedMins(startedAt);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Urgency hook — checks every 30s ──────────────────────────────────────────

type Urgency = "normal" | "warning" | "urgent";

function useUrgency(startedAt: string | null, status: string): Urgency {
  const [mins, setMins] = useState(() => getElapsedMins(startedAt));

  useEffect(() => {
    if (!startedAt || status === "free") return;
    setMins(getElapsedMins(startedAt));
    const id = setInterval(() => setMins(getElapsedMins(startedAt)), 30_000);
    return () => clearInterval(id);
  }, [startedAt, status]);

  if (status === "free") return "normal";
  if (mins >= 20) return "urgent";
  if (mins >= 10) return "warning";
  return "normal";
}

// ── Item key (stable across DB re-inserts) ────────────────────────────────────

function itemKey(item: LiveItem) {
  return `${item.menuItemId}|${item.size ?? ""}`;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; dot: string; card: string; badge: string; pulse: boolean }
> = {
  free: {
    label: "Idle",
    dot: "bg-emerald-400",
    card: "bg-white/70 border-emerald-200/60",
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
    label: "Billing",
    dot: "bg-red-400",
    card: "bg-red-50/80 border-red-300/70",
    badge: "bg-red-100 text-red-700",
    pulse: true,
  },
};

const DEFAULT_STATUS = STATUS_CONFIG.free;

// ── Component ─────────────────────────────────────────────────────────────────

interface TableCardProps {
  table: LiveTableState;
  index: number;
  compact: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export const TableCard = memo(function TableCard({
  table,
  index,
  compact,
  isExpanded,
  onToggle,
}: TableCardProps) {
  const cfg = STATUS_CONFIG[table.status] ?? DEFAULT_STATUS;
  const urgency = useUrgency(table.startedAt, table.status);
  const totalQty = table.items.reduce((s, i) => s + i.quantity, 0);
  const hasItems = table.items.length > 0;

  // ── Delivery tracking (local UI state) ────────────────────────────────────
  const [deliveredKeys, setDeliveredKeys] = useState<Set<string>>(new Set());

  // Drop keys for items that have been removed from the order
  useEffect(() => {
    const currentKeys = new Set(table.items.map(itemKey));
    setDeliveredKeys(prev => {
      const filtered = new Set([...prev].filter(k => currentKeys.has(k)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [table.items]);

  const toggleDelivered = useCallback((key: string) => {
    setDeliveredKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pendingCount = table.items.filter(i => !deliveredKeys.has(itemKey(i))).length;
  const allServed = hasItems && pendingCount === 0;

  // Pending-first sort so served items sink to the bottom
  const sortedItems = [...table.items].sort((a, b) => {
    const aD = deliveredKeys.has(itemKey(a)) ? 1 : 0;
    const bD = deliveredKeys.has(itemKey(b)) ? 1 : 0;
    return aD - bD;
  });

  // Auto-expand when new items arrive
  useEffect(() => {
    if (table.hasNewItems) onToggle();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.hasNewItems]);

  // Urgency ring classes
  const urgencyRing = allServed
    ? "ring-2 ring-emerald-400/60"
    : urgency === "urgent"
    ? "ring-2 ring-red-500/60"
    : urgency === "warning"
    ? "ring-2 ring-yellow-400/60"
    : "";

  const urgencyTimeColor =
    urgency === "urgent"
      ? "text-red-500 font-semibold"
      : urgency === "warning"
      ? "text-yellow-600 font-semibold"
      : "text-gray-400";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={{ delay: index * 0.02, duration: 0.18, ease: "easeOut" }}
      className={`
        relative backdrop-blur-sm border rounded-2xl shadow-sm
        ${allServed ? "bg-emerald-50/80 border-emerald-300/70" : cfg.card} ${urgencyRing}
        ${compact ? "p-2.5" : "p-3.5"}
      `}
    >
      {/* Animated urgency pulse overlay */}
      {urgency !== "normal" && !allServed && (
        <span
          className={`absolute inset-0 rounded-2xl pointer-events-none animate-pulse ${
            urgency === "urgent"
              ? "ring-2 ring-red-500/30"
              : "ring-2 ring-yellow-400/30"
          }`}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        className="flex items-start justify-between gap-2 cursor-pointer"
        onClick={() => hasItems && onToggle()}
      >
        {/* Left: name + new-item ping */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {table.hasNewItems && !allServed && (
              <span className="shrink-0 relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400" />
              </span>
            )}
            {allServed && (
              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
            )}
            <h3
              className={`font-bold text-gray-800 truncate leading-tight ${
                compact ? "text-[11px]" : "text-sm"
              }`}
            >
              {table.name}
            </h3>
          </div>

          {!compact && (
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[9px] text-gray-400 capitalize">{table.section}</p>
              {table.orderNumber && (
                <p className="text-[9px] text-gray-400 font-medium">#{table.orderNumber}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: pending badge + status dot + chevron */}
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {/* Pending count pill */}
          {hasItems && !allServed && (
            <span className="text-[8px] font-bold bg-orange-100 text-orange-600 px-1 py-0.5 rounded-full leading-none">
              {pendingCount}
            </span>
          )}

          <div className="relative flex h-2 w-2">
            {cfg.pulse && !allServed && (
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-50`}
              />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                allServed ? "bg-emerald-400" : cfg.dot
              }`}
            />
          </div>

          {hasItems && (
            <span className="text-gray-400">
              {isExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </span>
          )}
        </div>
      </div>

      {/* ── Summary row (normal mode) ───────────────────────────── */}
      {!compact && (
        <div className="flex items-center gap-3 mt-2">
          {hasItems ? (
            <>
              {allServed ? (
                <span className="text-[10px] font-semibold text-emerald-600">
                  All items served ✓
                </span>
              ) : (
                <span className="text-[10px] text-gray-500">
                  <span className="font-semibold text-orange-600">{pendingCount}</span>
                  {" pending · "}
                  <span className="text-gray-400">{totalQty} total</span>
                </span>
              )}
              {table.startedAt && (
                <span
                  className={`flex items-center gap-0.5 text-[10px] ${urgencyTimeColor}`}
                >
                  <Clock className="w-2.5 h-2.5" />
                  {getElapsedLabel(table.startedAt)}
                </span>
              )}
            </>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <Users className="w-2.5 h-2.5" />
              Seats {table.capacity}
            </span>
          )}
        </div>
      )}

      {/* ── Compact mode summary ────────────────────────────────── */}
      {compact && hasItems && (
        <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-black/5">
          <span className={`text-[9px] font-semibold ${allServed ? "text-emerald-600" : "text-orange-600"}`}>
            {allServed ? "All served" : `${pendingCount} pending`}
          </span>
          {table.startedAt && (
            <span className={`text-[9px] ${urgencyTimeColor}`}>
              {getElapsedLabel(table.startedAt)}
            </span>
          )}
        </div>
      )}

      {/* ── Inline expanded items list ──────────────────────────── */}
      <AnimatePresence initial={false}>
        {isExpanded && hasItems && (
          <motion.div
            key="items-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div
              className={`border-t border-black/5 space-y-0.5 ${
                compact ? "mt-1.5 pt-1.5" : "mt-2.5 pt-2.5"
              }`}
            >
              {/* Hint text */}
              {!compact && (
                <p className="text-[8px] text-gray-300 mb-1 select-none">
                  Tap item to mark as served
                </p>
              )}
              <AnimatePresence>
                {sortedItems.map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    compact={compact}
                    isDelivered={deliveredKeys.has(itemKey(item))}
                    onToggleDelivered={() => toggleDelivered(itemKey(item))}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
