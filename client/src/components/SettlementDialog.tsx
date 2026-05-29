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
  method: "cash" | "upi" | "card";
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grandTotal: number;
  onSettle: (data: SettlementData) => void;
  onPrintBill: () => void;
  isLoading?: boolean;
}

const METHODS: { key: "cash" | "upi" | "card"; label: string; icon: string }[] = [
  { key: "cash",  label: "Cash", icon: "💵" },
  { key: "upi",   label: "UPI",  icon: "📱" },
  { key: "card",  label: "Card", icon: "💳" },
];

interface CustomerSuggestion { name: string; phone: string | null; }

export function SettlementDialog({ open, onOpenChange, grandTotal, onSettle, onPrintBill, isLoading }: Props) {
  const [cash,  setCash]  = useState(0);
  const [upi,   setUpi]   = useState(0);
  const [card,  setCard]  = useState(0);
  const [isDue, setIsDue] = useState(false);
  const [customerName,  setCustomerName]  = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // Customer autocomplete (phone-first)
  const [suggestions, setSuggestions]     = useState<CustomerSuggestion[]>([]);
  const [showSuggest, setShowSuggest]     = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortCtrlRef  = useRef<AbortController | null>(null);
  const phoneRef      = useRef<HTMLDivElement>(null);

  const totalEntered = cash + upi + card;
  const remaining    = grandTotal - totalEntered;
  const changeDue    = remaining < 0 ? Math.abs(remaining) : 0;
  const balanceDue   = remaining > 0 ? remaining : 0;
  const canSettle    = isDue || totalEntered >= grandTotal;

  useEffect(() => {
    if (!open) {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (abortCtrlRef.current) abortCtrlRef.current.abort();
      setCash(0); setUpi(0); setCard(0);
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

  const amounts: Record<"cash" | "upi" | "card", number> = { cash, upi, card };
  const setters: Record<"cash" | "upi" | "card", (v: number) => void> = {
    cash: setCash, upi: setUpi, card: setCard,
  };

  // Running balance per row
  const rowRemaining: number[] = [];
  let balance = grandTotal;
  for (const m of METHODS) {
    balance = Math.max(0, balance - amounts[m.key]);
    rowRemaining.push(balance);
  }

  const parse = (v: string) => Math.max(0, parseFloat(v) || 0);

  // On blur: auto-fill remaining into the next empty method
  const handleBlur = (idx: number) => {
    const rem = grandTotal - (cash + upi + card);
    if (rem <= 0) return;
    for (let i = idx + 1; i < METHODS.length; i++) {
      const next = METHODS[i].key;
      if (amounts[next] === 0) {
        setters[next](parseFloat(rem.toFixed(2)));
        break;
      }
    }
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
    const payments: SettlementPayment[] = METHODS
      .filter(m => amounts[m.key] > 0)
      .map(m => ({ method: m.key, amount: amounts[m.key] }));
    if (!isDue && payments.length === 0) return;
    onSettle({
      payments,
      totalPaid: totalEntered,
      changeAmount: changeDue,
      isDue,
      customerName:  isDue ? customerName  : undefined,
      customerPhone: isDue ? customerPhone : undefined,
    });
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setCash(0); setUpi(0); setCard(0);
      setIsDue(false); setCustomerName(""); setCustomerPhone("");
      setSuggestions([]); setShowSuggest(false);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Collect Payment · ₹{grandTotal.toFixed(0)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Payment table */}
          <table className="w-full text-sm">
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
                      value={amounts[m.key] || ""}
                      onChange={e => setters[m.key](parse(e.target.value))}
                      onBlur={() => handleBlur(i)}
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
          <div className={`rounded-lg px-3 py-2 text-sm flex justify-between items-center ${
            balanceDue > 0
              ? "bg-red-50 text-red-700"
              : changeDue > 0
              ? "bg-blue-50 text-blue-700"
              : "bg-green-50 text-green-700"
          }`}>
            <span>Total entered <strong>₹{totalEntered.toFixed(0)}</strong></span>
            <span className="font-bold">
              {balanceDue > 0
                ? `Balance due ₹${balanceDue.toFixed(0)}`
                : changeDue > 0
                ? `Change ₹${changeDue.toFixed(0)}`
                : "✓ Settled"}
            </span>
          </div>

          {/* Mark Due toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isDue}
              onChange={e => setIsDue(e.target.checked)}
              className="accent-amber-500 w-4 h-4"
            />
            <span className="text-sm font-medium text-amber-700">
              Mark as Due (customer pays later)
            </span>
          </label>

          {/* Customer details — phone-first with autocomplete */}
          {isDue && (
            <div className="space-y-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-xs text-amber-700 font-medium">
                Customer details for due tracking:
              </p>

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
              onClick={onPrintBill}
              className="flex-1 text-xs"
            >
              🖨 Print Bill
            </Button>
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
