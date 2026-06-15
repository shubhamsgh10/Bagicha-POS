/**
 * ThreadList.tsx — left pane of the WhatsApp agent inbox.
 * Threads sorted by latest activity with unread pills and bot/human badges.
 */

import { Bot, User, BellOff } from "lucide-react";
import type { ConversationSummary } from "@/hooks/useConversations";

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function displayNameOf(c: ConversationSummary): string {
  return c.customerName || c.displayName || `+${c.phone}`;
}

interface ThreadListProps {
  conversations: ConversationSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  isLoading: boolean;
}

export function ThreadList({ conversations, selectedId, onSelect, isLoading }: ThreadListProps) {
  if (isLoading) {
    return <div className="p-4 text-xs text-gray-400">Loading conversations…</div>;
  }
  if (!conversations.length) {
    return (
      <div className="p-6 text-center">
        <p className="text-xs text-gray-400">
          No conversations yet. When customers message your WhatsApp number, threads appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full divide-y divide-gray-100">
      {conversations.map(c => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors touch-manipulation ${
            selectedId === c.id ? "bg-green-50" : "hover:bg-gray-50"
          }`}
        >
          {/* Avatar */}
          <div className="shrink-0 w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
            {displayNameOf(c).replace("+", "").charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-900 truncate">{displayNameOf(c)}</span>
              <span className="text-[10px] text-gray-400 shrink-0">{relativeTime(c.lastMessageAt)}</span>
            </div>

            <div className="flex items-center justify-between gap-2 mt-0.5">
              <span className="text-[11px] text-gray-500 truncate">{c.lastMessagePreview ?? ""}</span>
              {c.unreadCount > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {c.unreadCount}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-1">
              {c.optedOut ? (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  <BellOff className="w-2.5 h-2.5" /> Opted out
                </span>
              ) : c.botActive ? (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                  <Bot className="w-2.5 h-2.5" /> Bot
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                  <User className="w-2.5 h-2.5" /> {c.assignedAgent ?? "Human"}
                </span>
              )}
              {c.segment && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                  {c.segment}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
