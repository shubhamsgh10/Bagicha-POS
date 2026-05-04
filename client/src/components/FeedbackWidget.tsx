/**
 * FeedbackWidget.tsx
 *
 * Admin-side summary card for post-order NPS / feedback ratings.
 * Pulls from /api/feedback/stats and /api/feedback.
 */

import { useEffect, useState } from "react";
import { Star, MessageSquare, ThumbsDown, ThumbsUp, Loader2, RefreshCw } from "lucide-react";

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
  const [recent, setRecent] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetch("/api/feedback/stats", { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch("/api/feedback?limit=8", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      if (s) setStats(s);
      if (Array.isArray(r)) setRecent(r);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  if (loading && !stats) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!stats || stats.sent === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-gray-800">Feedback / NPS</h3>
        </div>
        <p className="text-xs text-gray-500">
          No feedback collected yet. Enable post-order NPS in <strong>Settings → Growth</strong>
          {" "}to start collecting customer ratings automatically.
        </p>
      </div>
    );
  }

  const avgFmt = stats.averageRating.toFixed(1);
  const responseRateFmt = `${stats.responseRate.toFixed(0)}%`;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-gray-800">Customer Feedback</h3>
        </div>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          icon={<Star className="w-4 h-4 text-amber-500 fill-amber-500" />}
          label="Avg Rating"
          value={`${avgFmt}/5`}
          color="text-amber-700"
          bg="bg-amber-50"
          border="border-amber-200"
        />
        <Stat
          icon={<ThumbsUp className="w-4 h-4 text-emerald-500" />}
          label="Promoters"
          value={String(stats.promoters)}
          color="text-emerald-700"
          bg="bg-emerald-50"
          border="border-emerald-200"
        />
        <Stat
          icon={<ThumbsDown className="w-4 h-4 text-red-500" />}
          label="Detractors"
          value={String(stats.detractors)}
          color="text-red-700"
          bg="bg-red-50"
          border="border-red-200"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>{stats.responded} of {stats.sent} responded</span>
        <span className="font-medium text-gray-700">{responseRateFmt} response rate</span>
      </div>

      {/* Distribution */}
      <div className="space-y-1.5">
        {[5, 4, 3, 2, 1].map(rating => {
          const count = stats.byRating[rating] ?? 0;
          const pct = stats.responded ? (count / stats.responded) * 100 : 0;
          return (
            <div key={rating} className="flex items-center gap-2 text-[11px]">
              <span className="w-3 text-gray-500">{rating}★</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full ${
                    rating >= 4 ? "bg-emerald-400" :
                    rating === 3 ? "bg-amber-300" : "bg-red-400"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-6 text-right text-gray-500">{count}</span>
            </div>
          );
        })}
      </div>

      {recent.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent</p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {recent.filter(r => r.rating !== null).slice(0, 6).map(r => (
              <div key={r.id} className="flex items-start justify-between gap-2 text-[11px] p-2 rounded-lg bg-gray-50">
                <div className="min-w-0">
                  <p className="font-medium text-gray-700 truncate">
                    {r.customerName ?? "Customer"} · #{r.orderId}
                  </p>
                  {r.comment && (
                    <p className="text-gray-500 truncate">{r.comment}</p>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3 h-3 ${
                        i < (r.rating ?? 0)
                          ? "text-amber-400 fill-amber-400"
                          : "text-gray-300"
                      }`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon, label, value, color, bg, border,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className={`rounded-lg ${bg} ${border} border px-2.5 py-2`}>
      <div className="flex items-center gap-1 mb-0.5">{icon}</div>
      <p className={`text-base font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
