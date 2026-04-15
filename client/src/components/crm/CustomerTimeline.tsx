/**
 * CustomerTimeline.tsx
 *
 * Phase 8 — CRM Event Timeline
 *
 * Shows a chronological feed of every customer touchpoint:
 *   orders, messages, automation triggers, profile updates, milestones.
 *
 * SAFE TO ADD: Does NOT change any existing component props.
 * Drop-in addition to CustomerDrawer via the useCrmProfile hook.
 */

import { useMemo } from "react";
import {
  ShoppingBag, MessageCircle, Zap, Star, User, Info,
  Loader2, AlertCircle,
} from "lucide-react";
import { useCrmTimeline, type TimelineEntry } from "@/hooks/useCrmProfile";

// ── Props ─────────────────────────────────────────────────────────────────────

interface CustomerTimelineProps {
  /** customer.key (phone || name) — same as CustomerProfile.key */
  customerKey: string;
}

// ── Event icon + colour map ───────────────────────────────────────────────────

const EVENT_META: Record<string, {
  Icon:  React.FC<{ className?: string }>;
  dot:   string;
  label: string;
}> = {
  ORDER_PLACED:    { Icon: ShoppingBag,    dot: "bg-indigo-500",  label: "Order placed" },
  VISIT:           { Icon: ShoppingBag,    dot: "bg-indigo-400",  label: "Visit" },
  MESSAGE_SENT:    { Icon: MessageCircle,  dot: "bg-green-500",   label: "Message sent" },
  MILESTONE:       { Icon: Star,           dot: "bg-amber-500",   label: "Milestone" },
  INACTIVE:        { Icon: AlertCircle,    dot: "bg-orange-400",  label: "Went inactive" },
  COUPON_USED:     { Icon: Star,           dot: "bg-purple-500",  label: "Coupon used" },
  PROFILE_UPDATE:  { Icon: User,           dot: "bg-gray-400",    label: "Profile updated" },
};

const DEFAULT_META = { Icon: Info, dot: "bg-gray-300", label: "Event" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const diff  = Math.floor((today.getTime() - d.getTime()) / 86_400_000);

  if (diff === 0) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Yesterday";
  if (diff < 7)  return `${diff}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function entryTitle(entry: TimelineEntry): string {
  const meta = entry.metadata as Record<string, unknown> | null ?? {};

  if (entry.eventType === "ORDER_PLACED") {
    const num = meta["orderNumber"];
    const amt = meta["totalAmount"];
    return num ? `Order #${num}${amt ? ` · ₹${Number(amt).toFixed(0)}` : ""}` : "Order placed";
  }
  if (entry.eventType === "MESSAGE_SENT") {
    const trigger  = meta["trigger"] as string | undefined;
    const channel  = meta["channel"] as string | undefined;
    return [
      trigger ? trigger.replace(/_/g, " ").toLowerCase() : "Message",
      channel ? `via ${channel}` : "",
    ].filter(Boolean).join(" ");
  }
  if (entry.eventType === "MILESTONE") {
    const type  = meta["milestoneType"] as string | undefined;
    const value = meta["value"];
    if (type === "VISIT_MILESTONE") return `${value}th visit reached 🏆`;
    if (type === "SEGMENT_UPGRADE") return `Upgraded to ${value} ⭐`;
    return `Milestone: ${value}`;
  }

  const metaObj = EVENT_META[entry.eventType];
  return metaObj?.label ?? entry.eventType.replace(/_/g, " ").toLowerCase();
}

// ── Timeline row ──────────────────────────────────────────────────────────────

function TimelineRow({ entry, isLast }: { entry: TimelineEntry; isLast: boolean }) {
  const meta = EVENT_META[entry.eventType] ?? DEFAULT_META;
  const Icon = meta.Icon;

  return (
    <div className="flex gap-3">
      {/* Stem */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${meta.dot} shadow-sm`}>
          <Icon className="w-3 h-3 text-white" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1" />}
      </div>

      {/* Content */}
      <div className={`pb-4 flex-1 min-w-0 ${isLast ? "" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-gray-800 capitalize truncate">
            {entryTitle(entry)}
          </p>
          <span className="text-[9px] text-gray-400 shrink-0 whitespace-nowrap">
            {formatTime(entry.createdAt)}
          </span>
        </div>

        {/* Extra detail for messages */}
        {entry.eventType === "MESSAGE_SENT" && (entry.metadata as any)?.preview && (
          <p className="text-[9px] text-gray-500 mt-0.5 truncate">
            "{(entry.metadata as any).preview}"
          </p>
        )}

        {/* Extra detail for orders */}
        {entry.eventType === "ORDER_PLACED" && (entry.metadata as any)?.totalAmount && (
          <p className="text-[9px] text-indigo-500 font-medium mt-0.5">
            ₹{Number((entry.metadata as any).totalAmount).toFixed(0)}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CustomerTimeline({ customerKey }: CustomerTimelineProps) {
  const { entries, isLoading, isError } = useCrmTimeline(customerKey);

  if (isLoading) {
    return (
      <section>
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
          Activity Timeline
        </h3>
        <div className="flex items-center gap-2 text-gray-400 bg-gray-50 rounded-xl px-3 py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="text-xs">Loading timeline…</span>
        </div>
      </section>
    );
  }

  // Silently hide if DB not available (graceful degradation)
  if (isError || !entries.length) return null;

  return (
    <section>
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
        Activity Timeline
      </h3>

      <div className="bg-white/60 border border-gray-100 rounded-xl px-3 pt-3 pb-1">
        {entries.map((entry, i) => (
          <TimelineRow
            key={entry.id}
            entry={entry}
            isLast={i === entries.length - 1}
          />
        ))}
      </div>
    </section>
  );
}
