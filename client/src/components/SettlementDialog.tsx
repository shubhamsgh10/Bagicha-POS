import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/api";

export interface SettlementPayment {
  method: "cash" | "upi";
  amount: number;
}

export interface SettlementData {
  payments: SettlementPayment[];
  totalPaid: number;
  changeAmount: number;
  isDue: boolean;
  customerName?: string;
  customerPhone?: string;
}

export interface SettlementItem {
  name: string;
  quantity: number;
  price: number;       // per-unit
  size?: string | null;
  serviceMode?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grandTotal: number;
  onSettle: (data: SettlementData) => void;
  isLoading?: boolean;
  // Optional order context — when provided, the dialog shows a full order summary
  // (customer + itemized list + totals) so it doubles as the "comprehensive pay-later" view.
  items?: SettlementItem[];
  subtotal?: number;
  taxAmount?: number;
  discountAmount?: number;
  orderLabel?: string;             // e.g. "#110"
  initialCustomerName?: string;
  initialCustomerPhone?: string;
  // When provided, shows a "Cancel Order" link that hands off to the caller's own
  // cancel-confirm flow (with its reason box) — undefined hides the link entirely,
  // e.g. for a cart that hasn't been saved as a real order yet.
  onCancelOrder?: () => void;
}

const METHODS: { key: "cash" | "upi"; label: string; icon: string }[] = [
  { key: "cash",  label: "Cash", icon: "💵" },
  { key: "upi",   label: "UPI",  icon: "📱" },
];

interface CustomerSuggestion { name: string; phone: string | null; }

export function SettlementDialog({
  open, onOpenChange, grandTotal, onSettle, isLoading,
  items, subtotal, taxAmount, discountAmount, orderLabel,
  initialCustomerName, initialCustomerPhone, onCancelOrder,
}: Props) {
  const [cash,  setCash]  = useState(0);
  const [upi,   setUpi]   = useState(0);
  const [isDue, setIsDue] = useState(false);
  const [customerName,  setCustomerName]  = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const inr = (n: number) => `₹${Math.round(n)}`;

  // Prefill customer fields from the order each time the dialog opens.
  useEffect(() => {
    if (open) {
      setCustomerName(initialCustomerName ?? "");
      setCustomerPhone(initialCustomerPhone ?? "");
    }
  }, [open, initialCustomerName, initialCustomerPhone]);

  // Customer autocomplete (phone-first)
  const [suggestions, setSuggestions]     = useState<CustomerSuggestion[]>([]);
  const [showSuggest, setShowSuggest]     = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortCtrlRef  = useRef<AbortController | null>(null);
  const phoneRef      = useRef<HTMLDivElement>(null);

  const totalEntered = cash + upi;
  const remaining    = grandTotal - totalEntered;
  const changeDue    = remaining < 0 ? Math.abs(remaining) : 0;
  const balanceDue   = remaining > 0 ? remaining : 0;
  // ₹1 tolerance matches the server's own settle guard (routes.ts POST /:id/payment:
  // "paidAmt < orderTotal - 1" is rejected) — grandTotal is the paisa-precise stored
  // total (tax math routinely leaves a fractional remainder), but real cash/UPI amounts
  // are always whole rupees, so a strict/exact comparison here would silently block a
  // payment the server would happily accept. Must stay in sync with that server check.
  const canSettle    = isDue || totalEntered >= grandTotal - 1;

  useEffect(() => {
    if (!open) {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (abortCtrlRef.current) abortCtrlRef.current.abort();
      setCash(0); setUpi(0);
      setIsDue(false); setCustomerName(""); setCustomerPhone("");
      setSuggestions([]); setShowSuggest(false);
    }
  }, [open]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (phoneRef.current && !phoneRef.current.contains(e.target as Node)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const amounts: Record<"cash" | "upi", number> = { cash, upi };
  const setters: Record<"cash" | "upi", (v: number) => void> = {
    cash: setCash, upi: setUpi,
  };

  // Running balance per row
  const rowRemaining: number[] = [];
  let balance = grandTotal;
  for (const m of METHODS) {
    balance = Math.max(0, balance - amounts[m.key]);
    rowRemaining.push(balance);
  }

  const parse = (v: string) => Math.max(0, parseFloat(v) || 0);

  // Auto-fill UPI with the remaining balance (grandTotal - cash) the moment its own
  // field gains focus — covers both "cash entered, tab/click into UPI" (remaining
  // splits in) and "click UPI first" (cash is still 0, so the whole bill lands in).
  // Deliberately keyed off UPI's OWN focus event, not a blur on some other field —
  // the previous implementation cascaded on *any* field's blur, so clicking anything
  // else on screen (e.g. the Pay Later checkbox) blurred whatever was last focused
  // and silently dropped the remaining amount into the next box.
  const handleUpiFocus = () => {
    if (upi !== 0) return; // never clobber an amount the staff already typed/edited
    const rem = grandTotal - cash;
    if (rem > 0) setUpi(Math.round(rem));
  };

  // Phone-first customer search with debounce + AbortController
  const searchCustomers = (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (abortCtrlRef.current) abortCtrlRef.current.abort();
    if (q.trim().length < 2) { setSuggestions([]); setShowSuggest(false); return; }
    searchTimer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortCtrlRef.current = ctrl;
      setSearchLoading(true);
      try {
        const res = await fetch(apiUrl(`/api/customers/search?q=${encodeURIComponent(q.trim())}`), {
          signal: ctrl.signal,
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
          setShowSuggest(data.length > 0);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") console.warn("Customer search error", e);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  };

  const handlePhoneChange = (value: string) => {
    setCustomerPhone(value);
    searchCustomers(value);
  };

  const selectSuggestion = (s: CustomerSuggestion) => {
    setCustomerPhone(s.phone ?? "");
    setCustomerName(s.name ?? "");
    setShowSuggest(false);
    setSuggestions([]);
  };

  const handleSettle = () => {
    // Pay Later means nothing was collected right now — the whole bill goes on the
    // tab. Force an empty breakdown here regardless of what's in the boxes (belt and
    // suspenders alongside resetting them when the checkbox is ticked, see below):
    // the server marks paymentStatus "pending" purely off isDue, but it still stores
    // whatever paidAmount/paymentBreakdown comes through — a leftover auto-filled
    // amount would otherwise record a phantom "already paid" total on a due order.
    if (isDue) {
      onSettle({
        payments: [],
        totalPaid: 0,
        changeAmount: 0,
        isDue: true,
        customerName,
        customerPhone,
      });
      return;
    }
    const payments: SettlementPayment[] = METHODS
      .filter(m => amounts[m.key] > 0)
      .map(m => ({ method: m.key, amount: amounts[m.key] }));
    if (payments.length === 0) return;
    onSettle({
      payments,
      totalPaid: totalEntered,
      changeAmount: changeDue,
      isDue: false,
      customerName: undefined,
      customerPhone: undefined,
    });
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setCash(0); setUpi(0);
      setIsDue(false); setCustomerName(""); setCustomerPhone("");
      setSuggestions([]); setShowSuggest(false);
    }
    onOpenChange(v);
  };

  // Ticking Pay Later clears any amounts already in the boxes (e.g. from the UPI
  // auto-fill above) so the summary/table can't keep showing "✓ Settled" for an
  // order that's actually going on the customer's tab.
  const handleDueToggle = (checked: boolean) => {
    setIsDue(checked);
    if (checked) { setCash(0); setUpi(0); }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            Collect Payment{orderLabel ? ` · ${orderLabel}` : ""} · {inr(grandTotal)}
          </DialogTitle>
        </DialogHeader>

        {onCancelOrder && (
          <div className="flex justify-end -mt-1">
            <button
              type="button"
              onClick={onCancelOrder}
              className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
            >
              ✕ Cancel Order instead
            </button>
          </div>
        )}

        <div className="space-y-3">
          {/* Order summary — customer + itemized list + totals (shown when order context is passed) */}
          {items && items.length > 0 && (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-100)] p-3 space-y-2">
              {(initialCustomerName || initialCustomerPhone) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700">{initialCustomerName || "Walk-in"}</span>
                  {initialCustomerPhone && <span className="text-gray-500">{initialCustomerPhone}</span>}
                </div>
              )}
              <div className="max-h-40 overflow-y-auto divide-y divide-[var(--line)]">
                {items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between py-1 text-xs">
                    <span className="text-gray-700 pr-2">
                      {it.name}
                      {it.size ? <span className="text-gray-400"> ({it.size})</span> : null}
                      <span className="text-gray-400"> × {it.quantity}</span>
                      {it.serviceMode && it.serviceMode !== "dinein" && (
                        <span className="text-[10px] text-amber-600"> · {it.serviceMode === "pickup" ? "Parcel" : it.serviceMode}</span>
                      )}
                    </span>
                    <span className="text-gray-700 font-medium whitespace-nowrap">{inr(it.price * it.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="pt-1 border-t border-[var(--line)] space-y-0.5 text-xs">
                {subtotal != null && (
                  <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{inr(subtotal)}</span></div>
                )}
                {discountAmount != null && discountAmount > 0 && (
                  <div className="flex justify-between text-gray-500"><span>Discount</span><span className="text-red-500">-{inr(discountAmount)}</span></div>
                )}
                {taxAmount != null && taxAmount > 0 && (
                  <div className="flex justify-between text-gray-500"><span>Tax</span><span>{inr(taxAmount)}</span></div>
                )}
                <div className="flex justify-between font-bold text-gray-800 pt-0.5"><span>Total due</span><span>{inr(grandTotal)}</span></div>
              </div>
            </div>
          )}

          {/* Payment table — disabled while Pay Later is on, since nothing is being
              collected right now and any leftover amount would be misleading. */}
          <table className={`w-full text-sm ${isDue ? "opacity-40 pointer-events-none" : ""}`}>
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left pb-2 font-medium">Method</th>
                <th className="text-right pb-2 font-medium pr-2">Amount (₹)</th>
                <th className="text-right pb-2 font-medium w-20">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map((m, i) => (
                <tr key={m.key} className="border-b last:border-0">
                  <td className="py-2 font-medium text-sm">{m.icon} {m.label}</td>
                  <td className="py-2 text-right pr-2">
                    <Input
                      type="number"
                      min={0}
                      disabled={isDue}
                      value={amounts[m.key] || ""}
                      onChange={e => setters[m.key](parse(e.target.value))}
                      onFocus={m.key === "upi" ? handleUpiFocus : undefined}
                      placeholder="0"
                      className="w-28 text-right h-8 text-sm ml-auto"
                    />
                  </td>
                  <td className={`py-2 text-right font-semibold text-sm ${
                    rowRemaining[i] > 0 ? "text-red-600" : "text-green-600"
                  }`}>
                    ₹{rowRemaining[i].toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary bar */}
          {isDue ? (
            <div className="rounded-lg px-3 py-2 text-sm bg-amber-50 text-amber-700 font-medium">
              Marked as Due — ₹{grandTotal.toFixed(0)} will be added to the customer's tab
            </div>
          ) : (
            <div className={`rounded-lg px-3 py-2 text-sm flex justify-between items-center ${
              !canSettle
                ? "bg-red-50 text-red-700"
                : changeDue > 0
                ? "bg-blue-50 text-blue-700"
                : "bg-green-50 text-green-700"
            }`}>
              <span>Total entered <strong>₹{totalEntered.toFixed(0)}</strong></span>
              <span className="font-bold">
                {!canSettle
                  ? `Balance due ₹${balanceDue.toFixed(0)}`
                  : changeDue > 0
                  ? `Change ₹${changeDue.toFixed(0)}`
                  : "✓ Settled"}
              </span>
            </div>
          )}

          {/* Mark Due toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isDue}
              onChange={e => handleDueToggle(e.target.checked)}
              className="accent-amber-500 w-4 h-4"
            />
            <span className="text-sm font-medium text-amber-700">
              Pay Later — add to customer's tab
            </span>
          </label>

          {/* Customer details — phone-first with autocomplete */}
          {isDue && (
            <div className="space-y-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-xs text-amber-700 font-medium">
                Customer details for due tracking:
              </p>
              {!customerPhone.trim() && (
                <p className="text-[11px] text-amber-600/80">Add a phone to send payment reminders later.</p>
              )}

              {/* Phone with autocomplete dropdown */}
              <div className="relative" ref={phoneRef}>
                <Input
                  placeholder="Phone number (type 2+ digits to search)"
                  value={customerPhone}
                  onChange={e => handlePhoneChange(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
                  className="h-8 text-sm pr-6"
                  autoComplete="off"
                  inputMode="tel"
                />
                {searchLoading && (
                  <span className="absolute right-2 top-1.5 text-xs text-gray-400">…</span>
                )}
                {showSuggest && suggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
                    {suggestions.map((s, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onMouseDown={() => selectSuggestion(s)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex justify-between items-center border-b last:border-0"
                      >
                        <span className="font-mono font-semibold text-gray-800">{s.phone}</span>
                        {s.name && (
                          <span className="text-xs text-gray-500 ml-2 truncate">{s.name}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Input
                placeholder="Customer name"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              className="flex-1 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSettle}
              disabled={!canSettle || isLoading}
              className="flex-[2] bg-green-600 hover:bg-green-700 text-white text-xs font-bold"
            >
              {isLoading ? "Settling…" : "✓ Settle Now"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
