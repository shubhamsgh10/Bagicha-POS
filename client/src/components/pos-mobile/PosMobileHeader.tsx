import { useState } from "react";
import { ChevronLeft, Search, User, X } from "lucide-react";

interface Customer { name: string; phone: string }

interface Props {
  onBack: () => void;
  title: string;                 // "Table 3" / "Delivery" / "Pickup"
  timer?: React.ReactNode;       // running timer for a saved table order
  orderTypeLabel: string;        // "Dine-in" / "Delivery" / "Pickup"
  orderNumber?: string;          // serialNum(activeOrderId)
  roleSwitcher: React.ReactNode;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  guestName: string;
  guestPhone: string;
  onGuestNameChange: (v: string) => void;
  onGuestPhoneChange: (v: string) => void;
  onPickCustomer: (c: Customer) => void;
  customers: Customer[];
  dropdownLimit: number;
}

/** Two-row compact POS header for phones (Compact POS design). */
export function PosMobileHeader(p: Props) {
  const [guestOpen, setGuestOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const guestLabel = p.guestName || p.guestPhone || "Guest";
  const hasGuest = !!(p.guestName || p.guestPhone);
  const filtered = p.guestName.trim()
    ? p.customers.filter(c => c.name.toLowerCase().includes(p.guestName.toLowerCase()))
    : p.customers.slice(0, p.dropdownLimit);

  return (
    <div className="shrink-0 relative z-40 flex flex-col gap-[7px] px-3 pt-2 pb-2"
      style={{ background: "var(--paper-50)", borderBottom: "1px solid var(--line)" }}>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Back to tables" onClick={p.onBack}
          className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-white"
          style={{ border: "1px solid var(--line)" }}>
          <ChevronLeft className="w-[18px] h-[18px]" style={{ color: "var(--text-1)" }} />
        </button>
        <span className="shrink min-w-0 inline-flex items-center gap-[7px] h-10 px-[11px] rounded-xl text-sm font-extrabold"
          style={{ background: "var(--green-800)", color: "#F4F8F0" }}>
          <span className="truncate">{p.title}</span>
          {p.timer && <span className="font-mono text-[10.5px] font-bold shrink-0" style={{ color: "var(--green-300)" }}>{p.timer}</span>}
        </span>
        <span className="shrink-0 inline-flex items-center h-[26px] px-[9px] rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em]"
          style={{ background: "var(--success-bg)", color: "var(--green-700)" }}>
          {p.orderTypeLabel}
        </span>
        <span className="flex-1 min-w-0 text-right font-mono text-[10.5px] font-bold truncate" style={{ color: "var(--text-2)" }}>
          {p.orderNumber ?? ""}
        </span>
        <div className="shrink-0">{p.roleSwitcher}</div>
      </div>

      <div className="flex gap-1.5">
        <div className="flex-1 min-w-0 flex items-center gap-[7px] h-10 px-2.5 bg-white rounded-xl" style={{ border: "1px solid var(--line-strong)" }}>
          <Search className="w-[15px] h-[15px] shrink-0" style={{ color: "var(--text-2)" }} />
          <input value={p.searchQuery} onChange={e => p.onSearchChange(e.target.value)} placeholder="Search item"
            className="flex-1 min-w-0 bg-transparent outline-none text-base placeholder:text-[var(--text-3)]" style={{ color: "var(--text-strong)" }} />
          {p.searchQuery && (
            <button type="button" aria-label="Clear search" onClick={() => p.onSearchChange("")} className="shrink-0 w-8 h-8 flex items-center justify-center">
              <X className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
            </button>
          )}
        </div>
        <button type="button" aria-expanded={guestOpen} onClick={() => setGuestOpen(v => !v)}
          className="shrink-0 max-w-[150px] h-10 px-[11px] rounded-xl flex items-center gap-1.5 text-[12.5px] font-bold overflow-hidden whitespace-nowrap"
          style={{
            border: `1px solid ${guestOpen ? "var(--green-600)" : "var(--line-strong)"}`,
            background: guestOpen ? "var(--success-bg)" : "#fff",
            color: hasGuest ? "var(--green-800)" : "var(--text-1)",
          }}>
          <User className="w-[15px] h-[15px] shrink-0" />
          <span className="truncate">{guestLabel}</span>
        </button>
      </div>

      {guestOpen && (
        <div className="flex gap-1.5">
          <div className="relative flex-[1.3] min-w-0">
            <input
              name="customerName" autoComplete="off" placeholder="Customer name" value={p.guestName}
              onChange={e => { p.onGuestNameChange(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              className="w-full h-10 px-[11px] rounded-xl bg-white outline-none text-base"
              style={{ border: "1px solid var(--line-strong)", color: "var(--text-strong)" }}
            />
            {showDropdown && filtered.length > 0 && (
              // onMouseDown preventDefault: dragging the scrollbar must not blur the input
              // (the 150 ms onBlur timer would close the list mid-scroll).
              <div onMouseDown={e => e.preventDefault()}
                className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto overscroll-contain custom-scrollbar">
                {filtered.map((c, i) => (
                  <button key={i} type="button" onMouseDown={e => e.preventDefault()}
                    onClick={() => { p.onPickCustomer(c); setShowDropdown(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 border-b border-gray-50 last:border-0">
                    <div className="text-sm font-semibold text-gray-800">{c.name}</div>
                    {c.phone && <div className="text-xs text-gray-400 mt-0.5">{c.phone}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input type="tel" inputMode="tel" placeholder="Phone number" value={p.guestPhone}
            onChange={e => p.onGuestPhoneChange(e.target.value)}
            className="flex-1 min-w-0 h-10 px-[11px] rounded-xl bg-white outline-none font-mono text-base"
            style={{ border: "1px solid var(--line-strong)", color: "var(--text-strong)" }} />
        </div>
      )}
    </div>
  );
}
