import { Sparkles, TrendingUp, Loader2 } from "lucide-react";
import { useRecommendations } from "@/hooks/useRecommendations";

interface RecommendationBoxProps {
  ordersWithItems: any[];
  isLoading?: boolean;
}

const REASON_STYLE: Record<string, string> = {
  "Most ordered":       "bg-amber-100 text-amber-700",
  "Frequently ordered": "bg-[var(--info-bg)] text-[var(--ink-700)]",
  "Occasional":         "bg-gray-100 text-gray-600",
};

export function RecommendationBox({ ordersWithItems, isLoading }: RecommendationBoxProps) {
  const { topItems, categoryPrefs, isEmpty } = useRecommendations(ordersWithItems);

  if (isLoading) {
    return (
      <section>
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
          AI Recommendations
        </h3>
        <div className="bg-gradient-to-br from-[var(--info-bg)] to-[var(--success-bg)] border border-[var(--line)] rounded-xl p-3.5 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-[var(--ink-500)] animate-spin" />
          <span className="text-xs text-[var(--ink-500)]">Analysing order history…</span>
        </div>
      </section>
    );
  }

  if (isEmpty) return null;

  return (
    <section>
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
        AI Recommendations
      </h3>

      <div className="bg-gradient-to-br from-[var(--info-bg)] to-[var(--success-bg)] border border-[var(--line)] rounded-xl p-3.5 space-y-2.5">
        <p className="flex items-center gap-1.5 text-[10px] text-[var(--ink-600)] font-semibold">
          <Sparkles className="w-3 h-3" />
          Suggest for next order:
        </p>

        <div className="space-y-1.5">
          {topItems.map((item, i) => (
            <div
              key={item.itemName}
              className="flex items-center justify-between bg-[var(--paper-0)] rounded-lg px-2.5 py-1.5 gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full ${
                  i === 0 ? "bg-amber-100 text-amber-700" : "bg-[var(--info-bg)] text-[var(--ink-700)]"
                }`}>
                  {i + 1}
                </span>
                <span className="text-xs font-semibold text-gray-800 truncate">
                  {item.itemName}
                </span>
              </div>
              <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                REASON_STYLE[item.reason] ?? "bg-gray-100 text-gray-600"
              }`}>
                {item.reason}
              </span>
            </div>
          ))}
        </div>

        {categoryPrefs.length > 0 && (
          <div className="pt-2 border-t border-[var(--line)] flex items-center gap-1.5 flex-wrap">
            <TrendingUp className="w-3 h-3 text-[var(--ink-500)] shrink-0" />
            <span className="text-[9px] text-[var(--ink-600)] font-semibold">Prefers:</span>
            {categoryPrefs.map(cp => (
              <span
                key={cp.category}
                className="text-[9px] font-semibold bg-[var(--info-bg)] text-[var(--ink-700)] px-1.5 py-0.5 rounded-full"
              >
                {cp.category}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
