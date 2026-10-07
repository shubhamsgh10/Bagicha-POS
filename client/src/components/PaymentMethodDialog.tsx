/**
 * "Staff tapped the wrong method" — correct a settled order's Cash/UPI split without
 * touching the amount collected.
 *
 * Validation is shared/paymentEdit.ts's planPaymentEdit, the SAME function the route runs,
 * so this dialog can never be stricter or looser than what the server will accept (the
 * lesson shared/settlement.ts already encodes). It is re-run on every keystroke, which is
 * also where the inline message comes from — no second copy of the rules lives here.
 *
 * The PIN comes AFTER the form is filled: the server grant lasts 90s, and a manager typing
 * a reason first could otherwise watch it expire between the PIN pad and Save.
 *
 * A manager/admin PIN is asked for EVERY time, whoever is logged in — the server enforces it
 * too (requireFreshPin ignores the session's own role). It used to be skipped for admin/manager
 * logins, but the restaurant's everyday login is a manager account, so nobody was ever asked.
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { describeApiError } from "@/lib/apiError";
import { useToast } from "@/hooks/use-toast";
import { PinGuard } from "@/components/PinGuard";
import { lockedDialogProps } from "@/lib/dialogLock";
import { collectedByMethod, paymentLabel } from "@shared/paymentSplit";
import { planPaymentEdit } from "@shared/paymentEdit";
import { todayBusinessDate } from "@shared/businessDay";

type Mode = "cash" | "upi" | "part";

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: any;
}

export function PaymentMethodDialog({ open, onOpenChange, order }: Props) {
  const { toast } = useToast();
  // The provider's client, not the module-level singleton: in Vite dev the module can be served under two
  // URLs (see App.tsx's Router) and invalidating the wrong instance leaves the list stale after a save.
  const queryClient = useQueryClient();

  const before = collectedByMethod(order ?? {});
  const beforeCash = before.cash ?? 0;
  const beforeUpi = before.upi ?? 0;
  const collectedTotal = round2(beforeCash + beforeUpi);

  // Initialised from the order, not "cash"/0: the parent only mounts this dialog while it is
  // open (see Orders.tsx), so there is no "open" transition for an effect to reset state on —
  // starting at placeholder values and correcting them in an effect would flash the wrong
  // mode for a frame.
  const [mode, setMode] = useState<Mode>(() => (beforeCash > 0 && beforeUpi > 0 ? "part" : beforeUpi > 0 ? "upi" : "cash"));
  const [cash, setCash] = useState(() => beforeCash);
  const [upi, setUpi] = useState(() => beforeUpi);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Open showing what is currently recorded, so the manager is correcting something they can
  // see rather than a blank form. Save stays disabled until it actually differs.
  useEffect(() => {
    if (!open) return;
    const both = beforeCash > 0 && beforeUpi > 0;
    setMode(both ? "part" : beforeUpi > 0 ? "upi" : "cash");
    setCash(beforeCash);
    setUpi(beforeUpi);
    setReason("");
    setReasonTouched(false);
    setShowPin(false);
    // Re-running this on every keystroke would stomp what is being typed — it is an
    // open/close reset, keyed on the order being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  const selectMode = (m: Mode) => {
    setMode(m);
    if (m === "cash") { setCash(collectedTotal); setUpi(0); }
    else if (m === "upi") { setUpi(collectedTotal); setCash(0); }
    else { setCash(beforeCash > 0 ? beforeCash : collectedTotal); setUpi(beforeCash > 0 ? round2(collectedTotal - beforeCash) : 0); }
  };

  const parse = (v: string) => Math.max(0, parseFloat(v) || 0);
  // Two-way complement on the edited field's own onChange — never an onFocus/onBlur cascade,
  // which is the bug SettlementDialog's own comment documents.
  const setPartCash = (v: string) => { const n = parse(v); setCash(n); setUpi(Math.max(0, round2(collectedTotal - n))); };
  const setPartUpi  = (v: string) => { const n = parse(v); setUpi(n);  setCash(Math.max(0, round2(collectedTotal - n))); };

  const plan = order
    ? planPaymentEdit(order, { cash, upi, reason }, todayBusinessDate())
    : null;
  const canSave = !!plan?.ok;
  // Don't scold someone for an empty reason box they haven't reached yet.
  const hideMessage = plan && !plan.ok && plan.code === "reason_required" && !reasonTouched;
  const message = plan && !plan.ok && !hideMessage ? plan.message : "";

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${order.id}/payment-method`, { cash, upi, reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment method updated", description: plan?.ok ? `${plan.before.label} → ${plan.after.label}` : undefined });
      // One prefix match covers the list AND this order's own detail (["/api/orders", id]).
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-status"] });
      // Reports' payment tiles and the owner's activity list both change as a result.
      queryClient.invalidateQueries({ predicate: q => {
        const k = String(q.queryKey[0] ?? "");
        return k.indexOf("/api/reports/") === 0;
      }});
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const info = describeApiError(err);
      toast({
        title: info.code === "PIN_REQUIRED" ? "PIN needed" : "Could not update payment method",
        description: info.code === "PIN_REQUIRED" ? "The PIN check expired — press Save and enter the PIN again." : info.message,
        variant: "destructive",
      });
    },
  });

  const submit = () => {
    if (!canSave || mutation.isPending) return;
    // The PIN pad is a modal of its own; stop the form's last-focused control (the Save button,
    // or the reason box) from also receiving the digits typed for the PIN.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setShowPin(true);
  };

  if (!order) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" {...lockedDialogProps(showPin)}>
          <DialogHeader>
            <DialogTitle className="text-base">Change payment method</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl bg-[var(--paper-100)] border border-[var(--line)] px-3 py-2 text-xs space-y-0.5">
              <div className="flex justify-between text-gray-500">
                <span>Bill total</span><span>{inr(parseFloat(order.totalAmount || "0"))}</span>
              </div>
              <div className="flex justify-between font-semibold text-gray-800">
                <span>Collected</span><span>{inr(collectedTotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                {/* Read straight off the order, NOT off the plan — the plan is a rejection
                    ("no_change") until something is actually edited, which would leave the
                    one line the manager most needs to see blank on open. */}
                <span>Recorded as</span><span className="font-medium text-gray-700">{paymentLabel(order)}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 rounded-lg overflow-hidden border border-[var(--line)]">
              {([["cash", "All Cash"], ["upi", "All UPI"], ["part", "Part"]] as [Mode, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectMode(key)}
                  className={`py-2 text-xs font-semibold transition-colors ${
                    mode === key
                      ? "bg-[var(--green-800)] text-white"
                      : "bg-[var(--paper-100)] text-gray-600 hover:bg-[var(--paper-200)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "part" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-500 w-12 shrink-0">Cash</label>
                  <Input type="number" min={0} value={cash || ""} onChange={e => setPartCash(e.target.value)}
                         className="text-right h-10 text-base font-semibold" placeholder="0" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-500 w-12 shrink-0">UPI</label>
                  <Input type="number" min={0} value={upi || ""} onChange={e => setPartUpi(e.target.value)}
                         className="text-right h-10 text-base font-semibold" placeholder="0" />
                </div>
              </div>
            ) : (
              <div className="text-center text-sm text-gray-600">
                Whole bill recorded as <span className="font-semibold text-gray-800">{mode === "cash" ? "Cash" : "UPI"}</span> · {inr(collectedTotal)}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Reason <span className="text-red-500">*</span></label>
              <Input
                value={reason}
                onChange={e => { setReason(e.target.value); setReasonTouched(true); }}
                placeholder="e.g. customer actually paid by UPI"
                className="h-10"
                maxLength={200}
              />
            </div>

            <p className="text-[11px] text-gray-400 text-center">
              This changes only how the {inr(collectedTotal)} is recorded — never the amount.
            </p>

            {message && (
              <p className="text-xs text-red-600 bg-red-50/70 border border-red-200/60 rounded-lg px-3 py-2">{message}</p>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={submit} disabled={!canSave || mutation.isPending}>
                {mutation.isPending ? "Saving…" : "Save (PIN)"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showPin && (
        <PinGuard
          actionLabel={plan?.ok ? `Payment method → ${plan.after.label}` : "Change payment method"}
          requiredRole="manager"
          onSuccess={() => { setShowPin(false); mutation.mutate(); }}
          onCancel={() => setShowPin(false)}
        />
      )}
    </>
  );
}
