/**
 * PublicFeedback.tsx
 *
 * Token-gated, no-auth post-order rating page.
 * Customers receive a WhatsApp link → land here → submit a rating.
 * Low ratings (≤3) auto-issue a recovery coupon (server-side).
 */

import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Star, CheckCircle2, AlertTriangle, Loader2, Heart } from "lucide-react";

interface FeedbackInfo {
  token:           string;
  rating:          number | null;
  submitted:       boolean;
  customerName:    string | null;
  restaurantName:  string;
}

export default function PublicFeedback() {
  const [, params] = useRoute<{ token: string }>("/feedback/:token");
  const token = params?.token ?? "";

  const [info, setInfo]         = useState<FeedbackInfo | null>(null);
  const [loadErr, setLoadErr]   = useState<string | null>(null);
  const [rating, setRating]     = useState(0);
  const [hover, setHover]       = useState(0);
  const [comment, setComment]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);
  const [coupon, setCoupon]     = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/feedback/${token}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d: FeedbackInfo) => {
        setInfo(d);
        if (d.submitted) setDone(true);
      })
      .catch(() => setLoadErr("This feedback link is invalid or has expired."));
  }, [token]);

  async function handleSubmit() {
    if (!rating || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/feedback/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Submit failed");
      setDone(true);
      if (data.recoveryCoupon) setCoupon(data.recoveryCoupon);
    } catch (e: any) {
      alert(e?.message ?? "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadErr) {
    return (
      <Shell>
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900">Link not valid</h1>
          <p className="text-gray-500 mt-2">{loadErr}</p>
        </div>
      </Shell>
    );
  }

  if (!info) {
    return (
      <Shell>
        <div className="flex justify-center items-center py-10">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center py-6">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-9 h-9 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Thank you!</h1>
          <p className="text-gray-600">Your feedback helps us serve you better.</p>

          {coupon && (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-5 text-left">
              <div className="flex items-start gap-3">
                <Heart className="w-5 h-5 text-amber-600 mt-0.5" />
                <div>
                  <h3 className="font-bold text-amber-900">A little gift for you</h3>
                  <p className="text-sm text-amber-700 mt-1 mb-3">
                    We're sorry your visit didn't meet expectations. Please give us
                    another try with this coupon — ₹100 off, valid 30 days:
                  </p>
                  <div className="bg-white border-2 border-amber-300 border-dashed rounded-lg px-4 py-2 inline-block">
                    <code className="text-base font-bold tracking-wider text-amber-900">{coupon}</code>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  const first = info.customerName?.split(" ")[0] ?? "there";

  return (
    <Shell>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Hi {first}! 🌿</h1>
        <p className="text-gray-500 mt-1">How was your experience at {info.restaurantName}?</p>
      </div>

      <div className="flex justify-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="p-1 transition-transform hover:scale-110 active:scale-95"
            aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
          >
            <Star
              className={`w-12 h-12 ${
                n <= (hover || rating)
                  ? "text-amber-400 fill-amber-400"
                  : "text-gray-300"
              }`}
            />
          </button>
        ))}
      </div>

      <textarea
        rows={3}
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Anything we could do better? (optional)"
        className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!rating || submitting}
        className="w-full mt-5 py-3 rounded-xl bg-emerald-500 text-white font-semibold shadow-sm hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? "Sending..." : "Submit Feedback"}
      </button>

      <p className="text-[11px] text-gray-400 text-center mt-3">
        Powered by {info.restaurantName}
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-amber-50 flex items-start justify-center p-4 pt-12">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-gray-100 p-7">
        {children}
      </div>
    </div>
  );
}
