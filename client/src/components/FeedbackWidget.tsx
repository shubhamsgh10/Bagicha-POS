import { apiUrl } from '@/lib/api';
/**
 * FeedbackWidget.tsx
 *
 * Admin-side compact NPS summary for the Intelligence tab.
 */

import { useEffect, useState } from "react";
import { Star, MessageSquare, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";

interface Stats {
  sent:           number;
  responded:      number;
  responseRate:   number;
  averageRating:  number;
  byRating:       Record<number, number>;
  promoters:      number;
  detractors:     number;
}

interface FeedbackRow {
  id:           number;
  orderId:      number;
  customerName: string | null;
  rating:       number | null;
  comment:      string | null;
  sentiment:    string | null;
  submittedAt:  string | null;
  createdAt:    string;
}

export function FeedbackWidget() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const s = await fetch(apiUrl("/api/feedback/stats"), { credentials: "include" }).then(r => r.ok ? r.json() : null);
      if (s) setStats(s);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  if (loading && !stats) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-[11px] text-gray-400">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading feedback…
      </div>
    );
  }

  if (!stats || stats.sent === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-lg">
        <MessageSquare className="w-3 h-3 text-amber-500 shrink-0" />
        <p className="text-[11px] text-amber-700 leading-tight">
          No feedback yet — enable NPS in <strong>Settings → Growth</strong>
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-white border border-gray-100 rounded-lg shadow-sm">
      <MessageSquare className="w-3 h-3 text-amber-500 shrink-0" />
      <div className="flex items-center gap-3 flex-1 min-w-0 overflow-x-auto scrollbar-none">
        <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 whitespace-nowrap">
          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
          {stats.averageRating.toFixed(1)}/5
        </span>
        <span className="flex items-center gap-1 text-[11px] text-emerald-600 whitespace-nowrap">
          <ThumbsUp className="w-3 h-3" /> {stats.promoters}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-red-500 whitespace-nowrap">
          <ThumbsDown className="w-3 h-3" /> {stats.detractors}
        </span>
        <span className="text-[11px] text-gray-400 whitespace-nowrap">
          {stats.responseRate.toFixed(0)}% responded
        </span>
      </div>
    </div>
  );
}
