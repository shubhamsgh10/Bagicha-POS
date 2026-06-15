/**
 * CustomerContextSidebar.tsx — right pane of the WhatsApp agent inbox.
 * Shows the customer's intelligence profile (segment, visits, spend, last
 * visit) next to the chat so agents reply with full context.
 */

import { Star, AlertTriangle, UserCheck, UserPlus, Phone, ShoppingBag, TrendingUp, Clock, HelpCircle } from "lucide-react";
import { useCrmProfile } from "@/hooks/useCrmProfile";
import type { CustomerProfile } from "@/hooks/useCustomerIntelligence";
import type { ConversationSummary } from "@/hooks/useConversations";

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const TAG_STYLES: Record<string, { icon: typeof Star; cls: string }> = {
  "VIP":     { icon: Star,          cls: "bg-amber-50 text-amber-700" },
  "At Risk": { icon: AlertTriangle, cls: "bg-red-50 text-red-600" },
  "Regular": { icon: UserCheck,     cls: "bg-green-50 text-green-700" },
  "New":     { icon: UserPlus,      cls: "bg-blue-50 text-blue-600" },
  "Lapsed":  { icon: AlertTriangle, cls: "bg-gray-100 text-gray-600" },
};

interface CustomerContextSidebarProps {
  conversation: ConversationSummary;
  /** Intelligence profile matched by key/phone from useCustomerIntelligence (may be undefined). */
  profile: CustomerProfile | undefined;
}

export function CustomerContextSidebar({ conversation, profile }: CustomerContextSidebarProps) {
  const customerKey = conversation.customerKey ?? profile?.key ?? null;
  const { crmData } = useCrmProfile(customerKey);

  const segment = crmData?.segment?.segment ?? conversation.segment ?? profile?.tag;

  // Unknown number — no order history linked yet
  if (!profile && !conversation.customerId) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex flex-col items-center text-center py-6">
          <div className="p-3 rounded-full bg-gray-100 mb-2">
            <HelpCircle className="w-5 h-5 text-gray-400" />
          </div>
          <p className="text-xs font-semibold text-gray-700">Unknown number</p>
          <p className="text-[10px] text-gray-400 mt-1">
            +{conversation.phone} hasn't been linked to any order yet. Once they place an order with
            this phone number, their profile appears here automatically.
          </p>
        </div>
      </div>
    );
  }

  const tagStyle = segment ? TAG_STYLES[segment] : undefined;
  const TagIcon = tagStyle?.icon ?? UserCheck;

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Identity */}
      <div>
        <h4 className="text-sm font-bold text-gray-900">
          {conversation.customerName || profile?.name || conversation.displayName}
        </h4>
        <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
          <Phone className="w-2.5 h-2.5" /> +{conversation.phone}
        </p>
        {segment && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mt-2 ${tagStyle?.cls ?? "bg-gray-100 text-gray-600"}`}>
            <TagIcon className="w-3 h-3" /> {segment}
          </span>
        )}
      </div>

      {/* Intelligence stats */}
      {profile && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-gray-50 p-2.5">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 font-semibold uppercase"><ShoppingBag className="w-2.5 h-2.5" /> Visits</div>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{profile.totalVisits}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-2.5">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 font-semibold uppercase"><TrendingUp className="w-2.5 h-2.5" /> Total spend</div>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(profile.totalSpend)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-2.5">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 font-semibold uppercase"><TrendingUp className="w-2.5 h-2.5" /> Avg order</div>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(profile.avgOrderValue)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-2.5">
            <div className="flex items-center gap-1 text-[9px] text-gray-400 font-semibold uppercase"><Clock className="w-2.5 h-2.5" /> Last visit</div>
            <p className="text-sm font-bold text-gray-900 mt-0.5">
              {profile.daysSinceLastVisit === 0 ? "Today" : `${profile.daysSinceLastVisit}d ago`}
            </p>
          </div>
        </div>
      )}

      {/* Suggestion from intelligence */}
      {profile?.suggestion && (
        <div className="rounded-xl bg-indigo-50 p-3">
          <p className="text-[9px] font-bold text-indigo-500 uppercase mb-1">Suggestion</p>
          <p className="text-[11px] text-indigo-900">{profile.suggestion}</p>
        </div>
      )}

      {/* RFM scores when available */}
      {crmData?.segment && (
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-[9px] font-bold text-gray-400 uppercase mb-1.5">RFM score</p>
          <div className="flex items-center gap-3 text-[10px] text-gray-600">
            <span>R <b>{crmData.segment.recencyScore}</b></span>
            <span>F <b>{crmData.segment.frequencyScore}</b></span>
            <span>M <b>{crmData.segment.monetaryScore}</b></span>
            <span className="ml-auto font-bold text-gray-900">{crmData.segment.rfmScore}/30</span>
          </div>
        </div>
      )}
    </div>
  );
}
