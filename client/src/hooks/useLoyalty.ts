import { useState } from "react";

// ── Config ────────────────────────────────────────────────────────────────────

/** ₹100 spent → 10 points */
const EARN_RATE = 0.1; // pts per ₹1

/** 100 points → ₹10 discount */
const REDEEM_RATE = 0.1; // ₹ per point

/** Minimum points needed to redeem */
const MIN_REDEEM = 100;

const LS_KEY = "bagicha_loyalty_redemptions";

// ── LocalStorage helpers ──────────────────────────────────────────────────────

function readRedemptions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeRedemptions(data: Record<string, number>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

// ── Public pure helpers ───────────────────────────────────────────────────────

export function computePointsEarned(totalSpend: number): number {
  return Math.floor(totalSpend * EARN_RATE);
}

export function pointsToRupees(points: number): number {
  return Math.floor(points * REDEEM_RATE);
}

/** How many points can actually be redeemed right now (always a multiple of MIN_REDEEM) */
export function redeemablePoints(current: number): number {
  return Math.floor(current / MIN_REDEEM) * MIN_REDEEM;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoyaltyInfo {
  earned: number;      // lifetime points from spend
  redeemed: number;    // total already redeemed (from localStorage)
  current: number;     // earned – redeemed
  rupeeValue: number;  // redeemable portion converted to ₹
  canRedeem: boolean;  // current >= MIN_REDEEM
}

// ── Per-customer hook ─────────────────────────────────────────────────────────

export function useLoyalty(
  customerKey: string,
  totalSpend: number
): LoyaltyInfo & { redeem: (points: number) => void } {
  const [redemptions, setRedemptions] = useState<Record<string, number>>(readRedemptions);

  const earned   = computePointsEarned(totalSpend);
  const redeemed = redemptions[customerKey] ?? 0;
  const current  = Math.max(0, earned - redeemed);
  const rupeeValue = pointsToRupees(redeemablePoints(current));
  const canRedeem  = current >= MIN_REDEEM;

  function redeem(points: number) {
    if (points <= 0 || points > current) return;
    const next: Record<string, number> = {
      ...redemptions,
      [customerKey]: (redemptions[customerKey] ?? 0) + points,
    };
    setRedemptions(next);
    writeRedemptions(next);
  }

  return { earned, redeemed, current, rupeeValue, canRedeem, redeem };
}
