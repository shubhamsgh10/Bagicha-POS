/**
 * ChatView.tsx — center pane of the WhatsApp agent inbox.
 * Message bubbles with WhatsApp-style delivery ticks, agent reply box,
 * and Take over / Return to bot controls.
 */

import { useEffect, useRef, useState } from "react";
import {
  Bot, User, Send, Loader2, Check, CheckCheck, Clock, AlertCircle, BellOff, Zap, ChevronLeft,
} from "lucide-react";
import {
  useConversationMessages,
  useConversationActions,
  type ConversationSummary,
  type ConversationMessage,
} from "@/hooks/useConversations";

function Ticks({ status }: { status: ConversationMessage["status"] }) {
  switch (status) {
    case "pending":   return <Clock className="w-3 h-3 text-gray-400" />;
    case "sent":      return <Check className="w-3 h-3 text-gray-400" />;
    case "delivered": return <CheckCheck className="w-3 h-3 text-gray-400" />;
    case "read":      return <CheckCheck className="w-3 h-3 text-sky-500" />;
    case "failed":    return <AlertCircle className="w-3 h-3 text-red-500" />;
  }
}

function SenderBadge({ msg }: { msg: ConversationMessage }) {
  if (msg.sender === "bot") {
    return <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-600 font-semibold"><Bot className="w-2.5 h-2.5" /> Bot</span>;
  }
  if (msg.sender === "automation") {
    return <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 font-semibold"><Zap className="w-2.5 h-2.5" /> {msg.trigger ?? "Auto"}</span>;
  }
  if (msg.sender === "agent") {
    return <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700 font-semibold"><User className="w-2.5 h-2.5" /> {msg.senderName ?? "Agent"}</span>;
  }
  return null;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

interface ChatViewProps {
  conversation: ConversationSummary;
  /** Mobile: return to the thread list. */
  onBack?: () => void;
}

export function ChatView({ conversation, onBack }: ChatViewProps) {
  const { messages, isLoading } = useConversationMessages(conversation.id);
  const { reply, takeover, returnToBot, markRead } = useConversationActions(conversation.id);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages; clear unread when the thread is open
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (conversation.unreadCount > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, conversation.unreadCount]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || reply.isPending) return;
    reply.mutate(text, { onSuccess: () => setDraft("") });
  };

  const title = conversation.customerName || conversation.displayName || `+${conversation.phone}`;

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* ── Thread header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-1.5">
          {onBack && (
            <button onClick={onBack} className="sm:hidden p-1 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 truncate">{title}</h3>
            <p className="text-[10px] text-gray-400">+{conversation.phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {conversation.botActive ? (
            <button
              onClick={() => takeover.mutate()}
              disabled={takeover.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <User className="w-3.5 h-3.5" /> Take over
            </button>
          ) : (
            <button
              onClick={() => returnToBot.mutate()}
              disabled={returnToBot.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Bot className="w-3.5 h-3.5" /> Return to bot
            </button>
          )}
        </div>
      </div>

      {/* ── Opt-out banner ────────────────────────────────────────────────── */}
      {conversation.optedOut && (
        <div className="shrink-0 px-4 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center gap-1.5">
          <BellOff className="w-3 h-3 text-gray-500" />
          <span className="text-[10px] text-gray-500 font-medium">
            Customer opted out of promotional messages (sent STOP). You can still reply to their questions here.
          </span>
        </div>
      )}

      {/* ── Messages ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 bg-[#f0ebe3]/40 space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : (
          messages.map((msg, i) => {
            const showDay = i === 0 || dayLabel(messages[i - 1].createdAt) !== dayLabel(msg.createdAt);
            const isOut = msg.direction === "out";
            return (
              <div key={msg.id}>
                {showDay && (
                  <div className="flex justify-center my-2">
                    <span className="text-[9px] font-semibold text-gray-500 bg-white/80 px-2 py-0.5 rounded-full shadow-sm">
                      {dayLabel(msg.createdAt)}
                    </span>
                  </div>
                )}
                <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 shadow-sm ${
                    isOut ? "bg-green-100 rounded-br-sm" : "bg-white rounded-bl-sm"
                  }`}>
                    {isOut && <SenderBadge msg={msg} />}
                    <p className="text-xs text-gray-800 whitespace-pre-wrap break-words">{msg.body}</p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[9px] text-gray-400">
                        {new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      {isOut && <Ticks status={msg.status} />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Reply box ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 p-3 border-t border-gray-200 bg-white">
        {reply.isError && (
          <p className="text-[10px] text-red-500 mb-1">{(reply.error as Error)?.message}</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={conversation.botActive
              ? "Replying will take over from the bot…"
              : "Type a reply…"}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-green-600/30 focus:border-green-600 max-h-28"
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || reply.isPending}
            className="shrink-0 p-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-40 touch-manipulation"
          >
            {reply.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
