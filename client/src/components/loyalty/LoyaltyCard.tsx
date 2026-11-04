import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { apiJson } from "@/lib/api";

interface LoyaltyCardProps {
  customerKey: string;
  /** Kept for the caller's signature; the balance now comes from the server ledger. */
  totalSpend?: number;
}

interface ServerLoyalty {
  balance: number;
  redeemable: number;
  rupeeValue: number;
  minRedeemPoints: number;
}

/**
 * Shows the customer's points from the SERVER ledger (GET /api/loyalty/:key) — the same
 * balance Billing redeems against. It used to compute "earned/redeemed" from a browser-only
 * localStorage ledger, so the number here never matched what the bill could actually use.
 */
export function LoyaltyCard({ customerKey }: LoyaltyCardProps) {
  const { data, isLoading, isError } = useQuery<ServerLoyalty>({
    queryKey: ["/api/loyalty", customerKey],
    queryFn: () => apiJson<ServerLoyalty>(`/api/loyalty/${encodeURIComponent(customerKey)}`),
    enabled: !!customerKey,
    staleTime: 60_000,
  });

  const balance = data?.balance ?? 0;
  const redeemable = data?.redeemable ?? 0;
  const minPts = data?.minRedeemPoints ?? 100;
  const ptsUntilNext = balance < minPts ? minPts - balance : 0;

  return (
    <section>
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
        Loyalty Points
      </h3>

      <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200/60 rounded-xl p-3.5 space-y-3">
        {isError ? (
          <p className="text-[11px] text-red-600">Could not load the points balance.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 divide-x divide-amber-200/60 text-center">
              <div className="pr-2">
                <div className={`text-base font-bold ${balance > 0 ? "text-emerald-600" : "text-gray-400"}`}>
                  {isLoading ? "…" : balance}
                </div>
                <div className="text-[8px] text-gray-400 font-semibold uppercase tracking-wide">Available</div>
              </div>
              <div className="px-2">
                <div className="text-base font-bold text-amber-700">{isLoading ? "…" : redeemable}</div>
                <div className="text-[8px] text-amber-500 font-semibold uppercase tracking-wide">Redeemable</div>
              </div>
              <div className="pl-2">
                <div className="text-base font-bold text-gray-600">₹{isLoading ? "…" : data?.rupeeValue ?? 0}</div>
                <div className="text-[8px] text-gray-400 font-semibold uppercase tracking-wide">Worth</div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="w-full h-1.5 bg-amber-200/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-yellow-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (balance / Math.max(minPts, 1)) * 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Gift className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-[10px] text-amber-700 font-medium truncate">
                  {redeemable > 0 ? `Redeem ${redeemable} pts on the bill` : `${ptsUntilNext} more pts to unlock`}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
