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
import { lockedDialogProps } from "@/lib/dialogLock";
import { resolveSettlement, type SettlementMode } from "@shared/settlement";

export interface SettlementPayment {
  method: "cash" | "upi";
  amount: number;
}

export interface SettlementData {
  payments: SettlementPayment[];
  totalPaid: number;
  changeAmount: number;
  // Money the bill was short by, written off as a loss. 0 unless the staff explicitly
  // confirmed a short settle — see the confirm footer below and shared/settlement.ts.
  shortfallAmount: number;
  // True only when this settle is carrying a real write-off — the caller (POS.tsx) gates
  // this behind the "writeOff" CartAction (manager PIN) before sending the request; the
  // server independently re-checks elevation regardless of what this flag says.
  allowShortfall: boolean;
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
  // Settling an order that is ALREADY a Due (Orders page): marking it Due again makes no sense, so
  // the Due pill is hidden and only Cash / UPI / Part remain. POS never sets this.
  hideDueMode?: boolean;
  // Replaces the default "Collect Payment · #n · ₹x" heading (e.g. "Settle Due · #1806 · ₹398").
  title?: string;
  // While true the dialog ignores outside-clicks / Escape and goes inert (see lib/dialogLock.ts). The
  // Orders page opens a PIN pad ON TOP of this dialog; a click on that pad is "outside" this dialog's
  // content, which would otherwise close it (and wipe what was typed) in the middle of the approval.
  lockClose?: boolean;
}

const MODES: { key: SettlementMode; label: string; icon: string }[] = [
  { key: "cash", label: "Cash", icon: "💵" },
  { key: "upi",  label: "UPI",  icon: "📱" },
  { key: "due",  label: "Due",  icon: "🕒" },
  { key: "part", label: "Part", icon: "➗" },
];

interface CustomerSuggestion { name: string; phone: string | null; }

export function SettlementDialog({
  open, onOpenChange, grandTotal, onSettle, isLoading,
  items, subtotal, taxAmount, discountAmount, orderLabel,
  initialCustomerName, initialCustomerPhone, onCancelOrder,
  hideDueMode, title, lockClose,
}: Props) {
  const [mode, setMode] = useState<SettlementMode>("cash");
  const [cash, setCash] = useState(0);
  const [upi,  setUpi]  = useState(0);
  const [customerName,  setCustomerName]  = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // A short settle needs an explicit second tap naming the exact write-off amount before
  // it's sent — see the confirm footer below. Reset any time the mode/amounts change so an
  // edit after confirming re-requires confirmation.
  const [confirmingShortfall, setConfirmingShortfall] = useState(false);

  const inr = (n: number) => `₹${Math.round(n)}`;

  // Prefill customer fields from the order + reset to a clean Cash state each time the
  // dialog opens — Cash-at-full-total is the common case (Petpooja's own default tab).
  useEffect(() => {
    if (open) {
      setCustomerName(initialCustomerName ?? "");
      setCustomerPhone(initialCustomerPhone ?? "");
      setMode("cash");
      setCash(Math.round(grandTotal));
      setUpi(0);
      setConfirmingShortfall(false);
    }
    // grandTotal deliberately excluded — it can tick slightly on re-render (e.g. live cart
    // edits) and re-running this on every such change would stomp whatever staff already typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCustomerName, initialCustomerPhone]);

  // Customer autocomplete (phone-first) — shown in Due mode
  const [suggestions, setSuggestions]     = useState<CustomerSuggestion[]>([]);
  const [showSuggest, setShowSuggest]     = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortCtrlRef  = useRef<AbortController | null>(null);
  const phoneRef      = useRef<HTMLDivElement>(null);

  const settlement = resolveSettlement({ mode, cash, upi, orderTotal: grandTotal });

  useEffect(() => {
    if (!open) {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (abortCtrlRef.current) abortCtrlRef.current.abort();
      setMode("cash"); setCash(0); setUpi(0);
      setCustomerName(""); setCustomerPhone("");
      setConfirmingShortfall(false);
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

  const parse = (v: string) => Math.max(0, parseFloat(v) || 0);

  // Selecting a mode prefills its amount(s) with sensible defaults — the whole bill for a
  // single method, split-ready (cash = full, upi = 0) for Part — same "just works" feel as
  // Petpooja's own settlement box. Any prior edit-in-progress confirm step is cleared, since
  // switching modes changes what would actually be settled.
  const selectMode = (m: SettlementMode) => {
    setMode(m);
    setConfirmingShortfall(false);
    if (m === "cash") { setCash(Math.round(grandTotal)); setUpi(0); }
    else if (m === "upi") { setUpi(Math.round(grandTotal)); setCash(0); }
    else if (m === "part") { setCash(Math.round(grandTotal)); setUpi(0); }
    else { setCash(0); setUpi(0); }
  };

  const setSingleAmount = (v: string) => {
    const val = parse(v);
    if (mode === "cash") setCash(val); else if (mode === "upi") setUpi(val);
    setConfirmingShortfall(false);
  };
  // Part mode auto-fills the OTHER box with whatever's left of the bill, live, as the
  // staff types — editing Cash drives UPI to (total - cash) and vice versa, so entering
  // one amount is normally enough to complete a two-way split. This is deliberately an
  // onChange-driven complement on the field actually being edited, not an onBlur cascade
  // across fields — the earlier single-amount box's onFocus auto-fill was removed for
  // exactly that "any blur anywhere stomps a box" failure mode (see git history); keying
  // this off the edited field's own onChange has no such cross-field trigger to misfire.
  // A staff member who wants a genuinely uneven split (not summing to the total) can
  // still get there by editing whichever field they set second, last.
  const setPartCash = (v: string) => {
    const val = parse(v);
    setCash(val);
    setUpi(Math.max(0, Math.round(grandTotal - val)));
    setConfirmingShortfall(false);
  };
  const setPartUpi = (v: string) => {
    const val = parse(v);
    setUpi(val);
    setCash(Math.max(0, Math.round(grandTotal - val)));
    setConfirmingShortfall(false);
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

  const dueReady = customerName.trim().length > 0 && customerPhone.trim().length > 0;

  // Shared by both the main Settle button and the confirm footer's "Yes, write off" button —
  // the first tap on a short settle only arms the confirm step; the second (identical) call,
  // now with confirmingShortfall already true, actually sends it.
  const handleSettle = () => {
    if (mode === "due") {
      if (!dueReady) return;
      onSettle({
        payments: [],
        totalPaid: 0,
        changeAmount: 0,
        shortfallAmount: 0,
        allowShortfall: false,
        isDue: true,
        customerName,
        customerPhone,
      });
      return;
    }
    if (settlement.payments.length === 0) return;
    if (settlement.isShort && !confirmingShortfall) {
      setConfirmingShortfall(true);
      return;
    }
    onSettle({
      payments: settlement.payments,
      totalPaid: settlement.totalPaid,
      changeAmount: settlement.changeAmount,
      shortfallAmount: settlement.shortfallAmount,
      allowShortfall: settlement.isShort,
      isDue: false,
      customerName: undefined,
      customerPhone: undefined,
    });
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setMode("cash"); setCash(0); setUpi(0);
      setCustomerName(""); setCustomerPhone("");
      setConfirmingShortfall(false);
      setSuggestions([]); setShowSuggest(false);
    }
    onOpenChange(v);
  };

  const canSettle = mode === "due" ? dueReady : settlement.payments.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
        {...lockedDialogProps(!!lockClose)}
      >
        <DialogHeader>
          <DialogTitle>
            {title ?? <>Collect Payment{orderLabel ? ` · ${orderLabel}` : ""} · {inr(grandTotal)}</>}
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

          {/* Mode pills — Cash / UPI / Due / Part, Petpooja-style single-select. The area
              below swaps to match whichever is active. */}
          <div className={`grid ${hideDueMode ? "grid-cols-3" : "grid-cols-4"} rounded-lg overflow-hidden border border-[var(--line)] ${confirmingShortfall ? "opacity-40 pointer-events-none" : ""}`}>
            {MODES.filter(m => !(hideDueMode && m.key === "due")).map(m => (
              <button
                key={m.key}
                type="button"
                onClick={() => selectMode(m.key)}
                className={`py-2 text-xs font-semibold transition-colors ${
                  mode === m.key
                    ? "bg-[var(--green-800)] text-white"
                    : "bg-[var(--paper-100)] text-gray-600 hover:bg-[var(--paper-200)]"
                }`}
              >
                <div className="text-sm">{m.icon}</div>
                {m.label}
              </button>
            ))}
          </div>

          {/* Cash / UPI — one editable "Settlement Amount" box, prefilled with the bill total */}
          {(mode === "cash" || mode === "upi") && (
            <div className={confirmingShortfall ? "opacity-40 pointer-events-none" : ""}>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Settlement Amount</label>
              <Input
                type="number"
                min={0}
                value={(mode === "cash" ? cash : upi) || ""}
                onChange={e => setSingleAmount(e.target.value)}
                placeholder="0"
                className="text-right h-10 text-base font-semibold"
                autoFocus
              />
            </div>
          )}

          {/* Part — split across both methods */}
          {mode === "part" && (
            <div className={`space-y-2 ${confirmingShortfall ? "opacity-40 pointer-events-none" : ""}`}>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500 w-14 shrink-0">💵 Cash</label>
                <Input
                  type="number"
                  min={0}
                  value={cash || ""}
                  onChange={e => setPartCash(e.target.value)}
                  placeholder="0"
                  className="text-right h-9 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-500 w-14 shrink-0">📱 UPI</label>
                <Input
                  type="number"
                  min={0}
                  value={upi || ""}
                  onChange={e => setPartUpi(e.target.value)}
                  placeholder="0"
                  className="text-right h-9 text-sm"
                />
              </div>
              <div className="text-right text-xs text-gray-500">
                Remaining {inr(Math.max(0, grandTotal - cash - upi))}
              </div>
            </div>
          )}

          {/* Summary bar — covered / change / short / due */}
          {mode === "due" ? (
            <div className="rounded-lg px-3 py-2 text-sm bg-amber-50 text-amber-700 font-medium">
              Marked as Due — {inr(grandTotal)} will be added to the customer's tab
            </div>
          ) : (
            <div className={`rounded-lg px-3 py-2 text-sm flex justify-between items-center ${
              settlement.isShort
                ? "bg-red-50 text-red-700"
                : settlement.changeAmount > 0
                ? "bg-blue-50 text-blue-700"
                : "bg-green-50 text-green-700"
            }`}>
              <span>Total entered <strong>{inr(settlement.totalPaid)}</strong></span>
              <span className="font-bold">
                {settlement.isShort
                  ? `Short by ${inr(settlement.shortfallAmount)} — will be written off`
                  : settlement.changeAmount > 0
                  ? `Change ${inr(settlement.changeAmount)}`
                  : "✓ Settled"}
              </span>
            </div>
          )}

          {/* Due mode — phone-first customer details, both fields mandatory */}
          {mode === "due" && (
            <div className="space-y-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-xs text-amber-700 font-medium">
                Customer name and phone are required to add this to a tab:
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

          {/* Action buttons — replaced by an explicit write-off confirm when settling short */}
          {confirmingShortfall ? (
            <div className="space-y-2 pt-1">
              <div className="rounded-lg px-3 py-2 text-xs bg-red-50 text-red-700 border border-red-200">
                Bill {inr(grandTotal)} · Collecting {inr(settlement.totalPaid)} · {inr(settlement.shortfallAmount)} will be recorded as a loss
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingShortfall(false)}
                  className="flex-1 text-xs"
                >
                  Go back
                </Button>
                <Button
                  size="sm"
                  onClick={handleSettle}
                  disabled={isLoading}
                  className="flex-[2] bg-red-600 hover:bg-red-700 text-white text-xs font-bold"
                >
                  {isLoading ? "Settling…" : `Yes, write off ${inr(settlement.shortfallAmount)}`}
                </Button>
              </div>
            </div>
          ) : (
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
                className={`flex-[2] text-white text-xs font-bold ${
                  mode === "due"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : settlement.isShort
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {isLoading
                  ? "Settling…"
                  : mode === "due"
                  ? "Mark as Due"
                  : settlement.isShort
                  ? `Settle Short · ${inr(settlement.totalPaid)}`
                  : "✓ Settle Now"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
