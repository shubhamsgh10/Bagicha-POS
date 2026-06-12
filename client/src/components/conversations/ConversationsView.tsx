/**
 * ConversationsView.tsx — WhatsApp agent inbox (4th tab on the Customers page).
 *
 * Layout: thread list | chat | customer context (context pane hidden on small
 * screens). Real-time via useWhatsAppRealtime (WebSocket / Pusher events).
 */

import { useMemo, useState } from "react";
import { MessageCircle, PanelRightClose, PanelRightOpen, WifiOff } from "lucide-react";
import {
  useConversations,
  useWhatsAppStatus,
  useWhatsAppRealtime,
} from "@/hooks/useConversations";
import type { CustomerProfile } from "@/hooks/useCustomerIntelligence";
import { ThreadList } from "./ThreadList";
import { ChatView } from "./ChatView";
import { CustomerContextSidebar } from "./CustomerContextSidebar";

interface ConversationsViewProps {
  /** Intelligence profiles from useCustomerIntelligence — used for the context pane. */
  customers: CustomerProfile[];
}

export function ConversationsView({ customers }: ConversationsViewProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [contextOpen, setContextOpen] = useState(true);

  useWhatsAppRealtime(selectedId);
  const { conversations, isLoading } = useConversations();
  const { status } = useWhatsAppStatus();

  const selected = conversations.find(c => c.id === selectedId) ?? null;

  // Match the conversation to an intelligence profile by customer key or last-10 phone digits
  const matchedProfile = useMemo(() => {
    if (!selected) return undefined;
    const last10 = selected.phone.slice(-10);
    return customers.find(c =>
      (selected.customerKey && c.key === selected.customerKey) ||
      (c.phone && c.phone.replace(/\D/g, "").slice(-10) === last10),
    );
  }, [selected, customers]);

  const disconnected = status != null && status.state !== "connected";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Connection warning */}
      {disconnected && (
        <div className="shrink-0 px-4 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <WifiOff className="w-3 h-3 text-amber-600" />
          <span className="text-[10px] text-amber-700 font-medium">
            WhatsApp is {status?.state === "qr_pending" ? "waiting for QR pairing" : "not connected"} —
            go to Automation → Setup to connect. Replies are disabled until then.
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Thread list */}
        <div className={`${selected ? "hidden sm:block" : ""} w-full sm:w-72 lg:w-80 shrink-0 border-r border-gray-200 overflow-hidden`}>
          <ThreadList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={setSelectedId}
            isLoading={isLoading}
          />
        </div>

        {/* Chat */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <div className="h-full flex">
              <div className="flex-1 min-w-0 relative">
                <button
                  onClick={() => setContextOpen(o => !o)}
                  className="hidden lg:flex absolute top-2.5 right-2 z-10 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                  title={contextOpen ? "Hide customer info" : "Show customer info"}
                >
                  {contextOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                </button>
                <ChatView conversation={selected} onBack={() => setSelectedId(null)} />
              </div>

              {/* Customer context */}
              {contextOpen && (
                <div className="hidden lg:block w-64 shrink-0 border-l border-gray-200 bg-white overflow-hidden">
                  <CustomerContextSidebar conversation={selected} profile={matchedProfile} />
                </div>
              )}
            </div>
          ) : (
            <div className="h-full hidden sm:flex flex-col items-center justify-center text-center p-8">
              <div className="p-4 rounded-full bg-green-50 mb-3">
                <MessageCircle className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-sm font-semibold text-gray-700">Select a conversation</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">
                Customer WhatsApp messages appear here. The bot answers FAQs automatically —
                take over anytime to chat live.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
