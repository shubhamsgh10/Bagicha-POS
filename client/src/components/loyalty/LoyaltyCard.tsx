import { useState } from "react";
import { Gift, Star } from "lucide-react";
import { useLoyalty, redeemablePoints, pointsToRupees } from "@/hooks/useLoyalty";

interface LoyaltyCardProps {
  customerKey: string;
  totalSpend: number;
}

export function LoyaltyCard({ customerKey, totalSpend }: LoyaltyCardProps) {
  const { earned, redeemed, current, canRedeem, redeem } = useLoyalty(customerKey, totalSpend);
  const [flash, setFlash] = useState<"idle" | "success">("idle");

  const toRedeem      = redeemablePoints(current);
  const redeemValue   = pointsToRupees(toRedeem);
  const ptsUntilNext  = current < 100 ? 100 - current : 0;

  function handleRedeem() {
    if (!canRedeem || toRedeem === 0) return;
    redeem(toRedeem);
    setFlash("success");
    setTimeout(() => setFlash("idle"), 2500);
  }

  return (
    <section>
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
        Loyalty Points
      </h3>

      <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200/60 rounded-xl p-3.5 space-y-3">
        {/* Points summary row */}
        <div className="grid grid-cols-3 divide-x divide-amber-200/60 text-center">
          <div className="pr-2">
            <div className="text-base font-bold text-amber-700">{earned}</div>
            <div className="text-[8px] text-amber-500 font-semibold uppercase tracking-wide">Earned</div>
          </div>
          <div className="px-2">
            <div className="text-base font-bold text-gray-500">{redeemed}</div>
            <div className="text-[8px] text-gray-400 font-semibold uppercase tracking-wide">Redeemed</div>
          </div>
          <div className="pl-2">
            <div className={`text-base font-bold ${current > 0 ? "text-emerald-600" : "text-gray-400"}`}>
              {current}
            </div>
            <div className="text-[8px] text-gray-400 font-semibold uppercase tracking-wide">Available</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="w-full h-1.5 bg-amber-200/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (current / Math.max(earned, 1)) * 100)}%` }}
            />
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Gift className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[10px] text-amber-700 font-medium truncate">
              {canRedeem
                ? `Redeem ${toRedeem} pts → ₹${redeemValue} off`
                : `${ptsUntilNext} more pts to unlock`}
            </span>
          </div>

          {canRedeem && flash === "idle" && (
            <button
              onClick={handleRedeem}
              className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition-all"
            >
              Redeem
            </button>
          )}
          {flash === "success" && (
            <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-emerald-600">
              <Star className="w-3 h-3" /> Applied!
            </span>
          )}
        </div>

        {/* Rate hint */}
        <p className="text-[8px] text-amber-400 leading-relaxed">
          ₹100 spent = 10 pts &nbsp;·&nbsp; 100 pts = ₹10 discount
        </p>
      </div>
    </section>
  );
}
