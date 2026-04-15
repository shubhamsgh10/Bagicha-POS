import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Users, Phone, ShoppingBag, TrendingUp, Clock, Star, AlertTriangle,
  UserCheck, UserPlus, Search, X, ChevronRight, Flame, Lightbulb,
  CalendarDays, BarChart2, Loader2, Send, Bell, BellOff, Edit2,
  LayoutList, Brain, Zap, Activity, Database, Sparkles, Award,
  Target, BarChart,
} from "lucide-react";
import {
  useCustomerIntelligence,
  useCustomerOrderDetails,
  type CustomerProfile,
  type CustomerTag,
} from "@/hooks/useCustomerIntelligence";
import { LoyaltyCard } from "@/components/loyalty/LoyaltyCard";
import { RecommendationBox } from "@/components/recommendations/RecommendationBox";
import {
  sendViaWhatsAppWeb,
  getTemplateInfo,
  type WhatsAppTemplate,
} from "@/utils/whatsapp";
import { AutomationPanel } from "@/components/AutomationPanel";
import { CustomerTimeline } from "@/components/crm/CustomerTimeline";
import {
  useCrmProfile,
  useCrmExtrasSync,
  useServerRecommendations,
  type CrmSegment,
} from "@/hooks/useCrmProfile";

const WA_TEMPLATES: WhatsAppTemplate[] = ["thank_you", "inactive_offer", "vip_reward"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function relativeTime(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:00 ${suffix}`;
}
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ── Extra customer data persisted in localStorage ─────────────────────────────

interface CustomerExtra {
  email: string;
  dateOfBirth: string;
  dateOfAnniversary: string;
  locality: string;
  gstNo: string;
  address: string;
  doNotSendUpdate: boolean;
  isFavorite: boolean;
  tags: string;
  remark: string;
  notificationEnabled: boolean;
}

const EXTRA_KEY = "bagicha_customer_extras";

function loadExtras(): Record<string, CustomerExtra> {
  try { return JSON.parse(localStorage.getItem(EXTRA_KEY) || "{}"); } catch { return {}; }
}
function saveExtras(data: Record<string, CustomerExtra>) {
  localStorage.setItem(EXTRA_KEY, JSON.stringify(data));
}
function defaultExtra(): CustomerExtra {
  return {
    email: "", dateOfBirth: "", dateOfAnniversary: "",
    locality: "", gstNo: "", address: "",
    doNotSendUpdate: false, isFavorite: false,
    tags: "", remark: "", notificationEnabled: true,
  };
}

// ── Tag config (unchanged) ─────────────────────────────────────────────────────

type FilterKey = "all" | CustomerTag;

const TAG_CONFIG: Record<
  CustomerTag,
  { label: string; bg: string; text: string; border: string; icon: any; cardRing: string }
> = {
  VIP:       { label: "VIP",      bg: "bg-amber-100",   text: "text-amber-700",  border: "border-amber-300",  icon: Star,          cardRing: "ring-1 ring-amber-300/60"  },
  Regular:   { label: "Regular",  bg: "bg-indigo-100",  text: "text-indigo-700", border: "border-indigo-200", icon: UserCheck,     cardRing: "ring-1 ring-indigo-200/60" },
  New:       { label: "New",      bg: "bg-emerald-100", text: "text-emerald-700",border: "border-emerald-200",icon: UserPlus,      cardRing: "ring-1 ring-emerald-200/60"},
  "At Risk": { label: "At Risk",  bg: "bg-red-100",     text: "text-red-700",    border: "border-red-200",    icon: AlertTriangle, cardRing: "ring-1 ring-red-300/60"    },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",      label: "All"      },
  { key: "VIP",      label: "VIP"      },
  { key: "Regular",  label: "Regular"  },
  { key: "New",      label: "New"      },
  { key: "At Risk",  label: "At Risk"  },
];

// ── TagBadge ──────────────────────────────────────────────────────────────────

function TagBadge({ tag }: { tag: CustomerTag }) {
  const c = TAG_CONFIG[tag];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      <Icon className="w-2.5 h-2.5" />{c.label}
    </span>
  );
}

// ── RFM Score Panel ───────────────────────────────────────────────────────────

function RfmScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  const pct = Math.round((score / 10) * 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-semibold text-gray-500">{label}</span>
        <span className={`text-[9px] font-bold ${color}`}>{score}/10</span>
      </div>
      <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color.replace("text-", "bg-")}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RfmPanel({ segment }: { segment: CrmSegment }) {
  const segColors: Record<string, string> = {
    VIP:      "text-amber-600 bg-amber-50 border-amber-200",
    Regular:  "text-indigo-600 bg-indigo-50 border-indigo-200",
    New:      "text-emerald-600 bg-emerald-50 border-emerald-200",
    "At Risk":"text-red-600 bg-red-50 border-red-200",
    Lapsed:   "text-gray-500 bg-gray-50 border-gray-200",
  };
  const cls = segColors[segment.segment] ?? "text-gray-600 bg-gray-50 border-gray-200";

  return (
    <section>
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
        <Database className="w-3 h-3" /> CRM Intelligence
      </h3>
      <div className="bg-white border border-gray-100 rounded-xl p-3 space-y-3">
        {/* Segment + RFM total */}
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg border ${cls}`}>
            <Activity className="w-3 h-3" />
            {segment.segment}
          </span>
          <div className="text-right">
            <div className="text-base font-bold text-gray-800">{segment.rfmScore}<span className="text-[9px] text-gray-400 font-normal">/30</span></div>
            <div className="text-[8px] text-gray-400">RFM Score</div>
          </div>
        </div>

        {/* Score bars */}
        <div className="space-y-1.5">
          <RfmScoreBar label="Recency"   score={segment.recencyScore}   color="text-blue-500"    />
          <RfmScoreBar label="Frequency" score={segment.frequencyScore} color="text-indigo-500"  />
          <RfmScoreBar label="Monetary"  score={segment.monetaryScore}  color="text-emerald-500" />
        </div>

        <p className="text-[8px] text-gray-400">
          Updated {new Date(segment.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </p>
      </div>
    </section>
  );
}

// ── Server Recommendations Panel ──────────────────────────────────────────────

function ServerRecsPanel({ customerKey }: { customerKey: string }) {
  const { recommendations, isLoading } = useServerRecommendations(customerKey);

  if (isLoading) return null;
  if (!recommendations || recommendations.isEmpty) return null;

  const { upsells } = recommendations;
  if (!upsells.length) return null;

  return (
    <section>
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
        <Target className="w-3 h-3" /> Upsell Opportunities
      </h3>
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100 rounded-xl p-3 space-y-1.5">
        <p className="flex items-center gap-1.5 text-[9px] text-purple-600 font-semibold">
          <Sparkles className="w-3 h-3" /> Items this customer hasn't tried yet
        </p>
        {upsells.map((item, i) => (
          <div key={item.itemId} className="flex items-center gap-2 bg-white/70 rounded-lg px-2 py-1.5">
            <span className="text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full bg-purple-100 text-purple-600 shrink-0">
              {i + 1}
            </span>
            <span className="text-xs font-medium text-gray-800 truncate flex-1">{item.itemName}</span>
            {item.score > 0 && (
              <span className="text-[8px] font-semibold text-purple-500 bg-purple-50 px-1 py-0.5 rounded shrink-0">
                co-bought {item.score}×
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Edit Customer Modal ───────────────────────────────────────────────────────

function EditCustomerModal({
  customer,
  extra,
  onSave,
  onClose,
}: {
  customer: CustomerProfile;
  extra: CustomerExtra;
  onSave: (data: CustomerExtra) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CustomerExtra>({ ...extra });
  const set = (k: keyof CustomerExtra, v: any) => setForm(p => ({ ...p, [k]: v }));

  const labelCls = "text-sm text-gray-700 pt-2 shrink-0 w-40";
  const inputCls = "flex-1 text-sm border border-gray-300 rounded px-3 py-2 bg-white focus:outline-none focus:border-blue-400 transition-colors";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">Edit Customer</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form body */}
        <div className="px-8 py-5 space-y-4">

          {/* Mobile — read-only (primary key) */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Mobile</label>
            <input
              value={customer.phone || customer.name}
              readOnly
              className={`${inputCls} bg-gray-50 text-gray-600 cursor-not-allowed`}
            />
          </div>

          {/* Name */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Name</label>
            <input
              value={form.email ? customer.name : customer.name}
              readOnly
              className={`${inputCls} bg-gray-50 text-gray-600 cursor-not-allowed`}
              placeholder="Derived from orders"
            />
          </div>

          {/* Email */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Email</label>
            <input
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="customer@email.com"
              type="email"
              className={inputCls}
            />
          </div>

          {/* Date of Birth */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Date of Birth</label>
            <input
              value={form.dateOfBirth}
              onChange={e => set("dateOfBirth", e.target.value)}
              type="date"
              className={inputCls}
            />
          </div>

          {/* Date of Anniversary */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Date of Anniversary</label>
            <input
              value={form.dateOfAnniversary}
              onChange={e => set("dateOfAnniversary", e.target.value)}
              type="date"
              className={inputCls}
            />
          </div>

          {/* Primary Locality */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Primary Locality</label>
            <input
              value={form.locality}
              onChange={e => set("locality", e.target.value)}
              placeholder="Area / locality"
              className={inputCls}
            />
          </div>

          {/* GST No. */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>GST No.</label>
            <input
              value={form.gstNo}
              onChange={e => set("gstNo", e.target.value)}
              placeholder="22AAAAA0000A1Z5"
              className={inputCls}
            />
          </div>

          {/* Primary Address */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Primary Address</label>
            <textarea
              value={form.address}
              onChange={e => set("address", e.target.value)}
              placeholder="Full address"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Checkboxes */}
          <div className="flex items-start gap-4">
            <label className={labelCls}></label>
            <div className="flex-1 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.doNotSendUpdate}
                  onChange={e => set("doNotSendUpdate", e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-blue-500"
                />
                <span className="text-sm text-gray-700">Do not send any Update</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isFavorite}
                  onChange={e => set("isFavorite", e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-blue-500"
                />
                <span className="text-sm text-gray-700">Mark as Favorite</span>
              </label>
            </div>
          </div>

          {/* Customer Tags */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Customer Tags</label>
            <input
              value={form.tags}
              onChange={e => set("tags", e.target.value)}
              placeholder="e.g. VIP, Vegan, Regular"
              className={inputCls}
            />
          </div>

          {/* Customer Remark */}
          <div className="flex items-start gap-4">
            <label className={labelCls}>Customer Remark</label>
            <textarea
              value={form.remark}
              onChange={e => set("remark", e.target.value)}
              placeholder="Internal notes about this customer"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-8 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(form); onClose(); }}
            className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Save Customer
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── LISTING VIEW — matches Petpooja reference ─────────────────────────────────

function CustomerListingView({
  customers,
  isLoading,
  extras,
  onEdit,
  onToggleNotif,
}: {
  customers: CustomerProfile[];
  isLoading: boolean;
  extras: Record<string, CustomerExtra>;
  onEdit: (c: CustomerProfile) => void;
  onToggleNotif: (key: string) => void;
}) {
  const [search, setSearch] = useState("");

  const displayed = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [customers, search]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="shrink-0 px-5 py-3 border-b border-gray-200 flex items-center gap-3">
        <div className="relative flex items-center border border-gray-300 rounded-lg bg-white overflow-hidden">
          <Search className="w-3.5 h-3.5 text-gray-400 ml-3 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search"
            className="pl-2 pr-3 py-1.5 text-sm bg-transparent outline-none placeholder-gray-400 w-40"
          />
          <button className="border-l border-gray-200 px-2 py-1.5">
            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
        <span className="text-xs text-gray-400 ml-auto">{displayed.length} customers</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-300">
            <Users className="w-10 h-10 mb-3" />
            <p className="text-sm text-gray-400 font-medium">No customers found</p>
            <p className="text-xs text-gray-300 mt-1">
              {customers.length === 0
                ? "Customers appear here after orders are placed with phone/name"
                : "Try a different search"}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600">Mobile</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600">Email</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600">Name</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-600 hidden md:table-cell">Add</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((c, i) => {
                const ex = extras[c.key] ?? defaultExtra();
                const notifOn = ex.notificationEnabled;
                return (
                  <motion.tr
                    key={c.key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.01 }}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    {/* Mobile */}
                    <td className="px-5 py-3.5 text-sm font-mono text-gray-800">
                      {c.phone || <span className="text-gray-400">—</span>}
                    </td>

                    {/* Email */}
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      {ex.email || <span className="text-gray-300">—</span>}
                    </td>

                    {/* Name */}
                    <td className="px-5 py-3.5 text-sm text-gray-800">
                      {c.name !== "Unknown" ? c.name : <span className="text-gray-300">—</span>}
                    </td>

                    {/* Add (tags / locality) */}
                    <td className="px-5 py-3.5 text-xs text-gray-500 hidden md:table-cell">
                      {ex.tags || ex.locality || <span className="text-gray-300">—</span>}
                    </td>

                    {/* Action */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-3">
                        {/* Edit pencil */}
                        <button
                          onClick={() => onEdit(c)}
                          title="Edit customer"
                          className="text-gray-500 hover:text-blue-600 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {/* Notification Status */}
                        <button
                          onClick={() => onToggleNotif(c.key)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded transition-all ${
                            notifOn
                              ? "border-gray-300 text-gray-600 hover:border-gray-400 bg-white"
                              : "border-red-200 text-red-500 bg-red-50 hover:bg-red-100"
                          }`}
                        >
                          {notifOn
                            ? <><Bell className="w-3 h-3" /> Notification Status</>
                            : <><BellOff className="w-3 h-3" /> Muted</>
                          }
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── INTELLIGENCE VIEW — original code, unchanged ──────────────────────────────

function StatPill({ icon: Icon, label, value, color, sub }: {
  icon: any; label: string; value: number | string; color: string; sub?: string;
}) {
  return (
    <div className="flex-1 min-w-[70px] bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function CustomerCard({ customer, index, onClick }: {
  customer: CustomerProfile; index: number; onClick: () => void;
}) {
  const ring = TAG_CONFIG[customer.tag].cardRing;
  const { crmData } = useCrmProfile(customer.key);
  const rfm = crmData?.segment;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ delay: index * 0.02, duration: 0.18, ease: "easeOut" }}
      onClick={onClick}
      className={`bg-white/70 backdrop-blur-sm border border-white/60 rounded-2xl p-3.5 shadow-sm cursor-pointer hover:shadow-md hover:bg-white/90 transition-all duration-150 ${ring}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900 truncate leading-tight">{customer.name}</h3>
            <TagBadge tag={customer.tag} />
          </div>
          {customer.phone && (
            <div className="flex items-center gap-1 mt-0.5">
              <Phone className="w-2.5 h-2.5 text-gray-400" />
              <span className="text-[10px] text-gray-400">{customer.phone}</span>
            </div>
          )}
        </div>
        {/* RFM score chip — only shown when DB has computed it */}
        {rfm ? (
          <div className="shrink-0 flex flex-col items-end gap-0.5">
            <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 flex items-center gap-0.5">
              <BarChart className="w-2.5 h-2.5" />{rfm.rfmScore}
            </span>
          </div>
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-black/5">
        <div className="text-center">
          <div className="text-sm font-bold text-gray-800">{customer.totalVisits}</div>
          <div className="text-[8px] text-gray-400 font-medium">Visits</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-gray-800">{formatCurrency(customer.totalSpend)}</div>
          <div className="text-[8px] text-gray-400 font-medium">Total Spend</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-gray-800">{formatCurrency(customer.avgOrderValue)}</div>
          <div className="text-[8px] text-gray-400 font-medium">Avg Order</div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2.5 gap-2">
        <span className="flex items-center gap-1 text-[10px] text-gray-400">
          <CalendarDays className="w-2.5 h-2.5" />
          {relativeTime(customer.lastVisit)}
        </span>
        {customer.suggestion && (
          <span className="flex items-center gap-0.5 text-[8px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full truncate max-w-[130px]">
            <Lightbulb className="w-2.5 h-2.5 shrink-0" />
            {customer.tag === "At Risk" ? "Offer discount" : customer.tag === "VIP" ? "Reward VIP" : "Upgrade soon"}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function CustomerDrawer({ customer, onClose }: { customer: CustomerProfile; onClose: () => void }) {
  const orderIds = customer.orders.map(o => o.id);
  const { favoriteItem, ordersWithItems, isLoading: loadingItems } = useCustomerOrderDetails(orderIds);
  const cfg = TAG_CONFIG[customer.tag];
  const Icon = cfg.icon;
  const [waSent, setWaSent] = useState<WhatsAppTemplate | null>(null);

  // CRM enrichment — falls back gracefully if DB unavailable
  const { crmData } = useCrmProfile(customer.key);

  function handleSendWA(template: WhatsAppTemplate) {
    if (!customer.phone) return;
    sendViaWhatsAppWeb(customer.phone, template, customer.name);
    setWaSent(template);
    setTimeout(() => setWaSent(null), 2500);
  }

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="fixed top-14 right-0 bottom-0 w-full max-w-sm bg-white/95 backdrop-blur-xl border-l border-gray-200/60 shadow-2xl z-40 flex flex-col overflow-hidden"
    >
      <div className="shrink-0 px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 leading-tight">{customer.name}</h2>
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                <Icon className="w-3 h-3" />{cfg.label}
              </span>
            </div>
            {customer.phone && (
              <div className="flex items-center gap-1 mt-1">
                <Phone className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-500">{customer.phone}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        {customer.suggestion && (
          <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200/60 rounded-xl px-3 py-2">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700 font-medium">{customer.suggestion}</p>
          </div>
        )}
        {customer.phone && (
          <div className="mt-3 space-y-1.5">
            <p className="flex items-center gap-1.5 text-[9px] font-bold text-gray-400 uppercase tracking-wide">
              <Send className="w-3 h-3" /> Send WhatsApp
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {WA_TEMPLATES.map(t => {
                const info = getTemplateInfo(t);
                const sent = waSent === t;
                return (
                  <button key={t} onClick={() => handleSendWA(t)} className={`flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                    sent ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white/70 border-gray-200 text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700"
                  }`}>
                    <span>{info.emoji}</span>
                    <span>{sent ? "Opened!" : info.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <section>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Metrics</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Visits",      value: customer.totalVisits,                  icon: ShoppingBag, color: "text-indigo-600" },
              { label: "Total Spend", value: formatCurrency(customer.totalSpend),   icon: TrendingUp,  color: "text-emerald-600" },
              { label: "Avg Order",   value: formatCurrency(customer.avgOrderValue),icon: BarChart2,   color: "text-amber-600" },
            ].map(m => (
              <div key={m.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                <m.icon className={`w-3.5 h-3.5 mx-auto mb-1 ${m.color}`} />
                <div className="text-xs font-bold text-gray-800">{m.value}</div>
                <div className="text-[8px] text-gray-400 mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Behavior</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600"><Clock className="w-3.5 h-3.5 text-gray-400" />Peak order time</span>
              <span className="text-xs font-semibold text-gray-800">{customer.peakHour !== null ? formatHour(customer.peakHour) : "—"}</span>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600"><CalendarDays className="w-3.5 h-3.5 text-gray-400" />First visit</span>
              <span className="text-xs font-semibold text-gray-800">{formatDate(customer.firstVisit.toISOString())}</span>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600"><CalendarDays className="w-3.5 h-3.5 text-gray-400" />Last visit</span>
              <span className="text-xs font-semibold text-gray-800">{relativeTime(customer.lastVisit)}</span>
            </div>
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-gray-600"><TrendingUp className="w-3.5 h-3.5 text-gray-400" />Spending tier</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                customer.spendCategory === "High" ? "bg-emerald-100 text-emerald-700" :
                customer.spendCategory === "Medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
              }`}>{customer.spendCategory}</span>
            </div>
            {favoriteItem && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <span className="flex items-center gap-2 text-xs text-gray-600"><Flame className="w-3.5 h-3.5 text-amber-500" />Favorite item</span>
                <span className="text-xs font-semibold text-amber-700 truncate max-w-[120px]">{favoriteItem}</span>
              </div>
            )}
            {loadingItems && !favoriteItem && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />
                <span className="text-xs text-gray-400">Loading order details…</span>
              </div>
            )}
          </div>
        </section>

        <LoyaltyCard customerKey={customer.key} totalSpend={customer.totalSpend} />

        {/* CRM: RFM Score Panel — shows when DB has computed scores */}
        {crmData?.segment && <RfmPanel segment={crmData.segment} />}

        <RecommendationBox ordersWithItems={ordersWithItems} isLoading={loadingItems} />

        {/* CRM: Server-side upsell recommendations */}
        <ServerRecsPanel customerKey={customer.key} />

        {/* CRM Timeline — renders nothing if DB unavailable */}
        <CustomerTimeline customerKey={customer.key} />

        <section>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Recent Orders</h3>
          <div className="space-y-2">
            {customer.orders.slice(0, 5).map(order => (
              <div key={order.id} className="bg-gray-50 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-800">#{order.orderNumber}</span>
                  <span className="text-xs font-bold text-emerald-600">{formatCurrency(order.totalAmount)}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-gray-400 capitalize">{order.orderType}</span>
                  <span className="text-[9px] text-gray-400">{formatDate(order.createdAt)}</span>
                </div>
                {ordersWithItems.find((o: any) => o?.id === order.id)?.items?.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200/60 space-y-0.5">
                    {ordersWithItems
                      .find((o: any) => o?.id === order.id)
                      ?.items?.slice(0, 3)
                      .map((item: any, i: number) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="text-[8px] font-bold bg-gray-200 text-gray-600 rounded px-1 py-0.5 min-w-[18px] text-center">{item.quantity}x</span>
                          <span className="text-[9px] text-gray-600 truncate">
                            {item.name ?? item.menuItemName ?? "Item"}
                            {item.size && <span className="text-gray-400"> ({item.size})</span>}
                          </span>
                        </div>
                      ))}
                    {(ordersWithItems.find((o: any) => o?.id === order.id)?.items?.length ?? 0) > 3 && (
                      <p className="text-[8px] text-gray-400 mt-0.5">+{(ordersWithItems.find((o: any) => o?.id === order.id)?.items?.length ?? 0) - 3} more items</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </motion.div>
  );
}

// ── CRM Status Banner ─────────────────────────────────────────────────────────

function CrmStatusBanner({ customerCount }: { customerCount: number }) {
  // Use the first customer's key as a probe — if it returns any valid JSON
  // (even { exists: false }), the DB is reachable. If it throws a 500, DB is down.
  const { data: probe, isLoading, isError } = useQuery<{ exists: boolean }>({
    queryKey: ["/api/crm/customers/__probe__"],
    staleTime: 60_000,
    retry: false,
    enabled: customerCount > 0,
  });

  // Connected = we got a response (any response, exists or not) without a server error
  const isConnected = !isError && probe !== undefined;

  if (!customerCount) return null;

  return (
    <div className={`shrink-0 mx-5 mb-2 rounded-xl px-3 py-2 flex items-center gap-2 text-[10px] font-semibold border transition-colors ${
      isLoading
        ? "bg-gray-50 border-gray-100 text-gray-400"
        : isConnected
        ? "bg-indigo-50 border-indigo-100 text-indigo-600"
        : "bg-amber-50 border-amber-100 text-amber-600"
    }`}>
      {isLoading ? (
        <><Loader2 className="w-3 h-3 animate-spin" /> Connecting to CRM engine…</>
      ) : isConnected ? (
        <>
          <Database className="w-3 h-3" />
          <span>CRM Engine Active</span>
          <span className="ml-auto text-[9px] font-normal opacity-70">
            RFM scores · Event tracking · Smart recommendations
          </span>
        </>
      ) : (
        <>
          <Activity className="w-3 h-3" />
          <span>Local mode — DB unreachable, check server connection</span>
        </>
      )}
    </div>
  );
}

function IntelligenceView({
  customers,
  stats,
  isLoading,
}: {
  customers: CustomerProfile[];
  stats: { total: number; vip: number; atRisk: number; activeToday: number };
  isLoading: boolean;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerProfile | null>(null);

  const displayed = useMemo(() => {
    let list = customers;
    if (filter !== "all") list = list.filter(c => c.tag === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q));
    }
    return list;
  }, [customers, filter, search]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Stats row */}
      <div className="shrink-0 px-5 pb-3 pt-3 flex gap-2">
        <StatPill icon={Users}         label="Total"        value={stats.total}       color="text-gray-700" />
        <StatPill icon={UserCheck}     label="Active Today" value={stats.activeToday} color="text-indigo-600" />
        <StatPill icon={Star}          label="VIP"          value={stats.vip}         color="text-amber-500" />
        <StatPill icon={AlertTriangle} label="At Risk"      value={stats.atRisk}      color="text-red-500" />
      </div>

      {/* CRM Engine status banner */}
      <CrmStatusBanner customerCount={stats.total} />

      {/* Filters + search */}
      <div className="shrink-0 px-5 pb-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl p-1 shadow-sm">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
              filter === f.key ? "bg-gradient-to-br from-gray-500 to-gray-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            }`}>{f.label}</button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Name or phone…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-white/60 backdrop-blur-sm border border-white/50 rounded-xl shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-300 placeholder:text-gray-300"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {isLoading ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-2xl bg-gray-100/80 h-[130px]" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-300">
              <Users className="w-14 h-14 mb-4" />
              <p className="text-sm font-semibold text-gray-400">No customers found</p>
              <p className="text-xs mt-1 text-gray-300">
                {customers.length === 0 ? "Customers appear here once orders with names/phones are placed" : "Try adjusting filters or search"}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              <AnimatePresence>
                {displayed.map((customer, i) => (
                  <CustomerCard
                    key={customer.key}
                    customer={customer}
                    index={i}
                    onClick={() => setSelected(prev => prev?.key === customer.key ? null : customer)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <AnimatePresence>
          {selected && (
            <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setSelected(null)} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {selected && <CustomerDrawer key={selected.key} customer={selected} onClose={() => setSelected(null)} />}
        </AnimatePresence>
      </div>

      {/* Legend bar */}
      <div className="shrink-0 px-5 py-2 border-t border-gray-100/60 flex items-center gap-4 flex-wrap">
        {FILTERS.slice(1).map(f => (
          <span key={f.key} className="text-[10px] text-gray-500 font-medium">
            {f.label}: <span className="font-bold text-gray-700">{customers.filter(c => c.tag === f.key).length}</span>
          </span>
        ))}
        <span className="text-[10px] text-gray-400 ml-auto">Showing {displayed.length} of {customers.length}</span>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CustomerDashboard() {
  const { customers, stats, isLoading } = useCustomerIntelligence();

  const [tab, setTab]               = useState<"listing" | "intelligence" | "automation">("listing");
  const [extras, setExtras]         = useState<Record<string, CustomerExtra>>(loadExtras);
  const [editTarget, setEditTarget] = useState<CustomerProfile | null>(null);

  // Persist extras to localStorage whenever they change
  useEffect(() => { saveExtras(extras); }, [extras]);

  // Background sync: push localStorage extras → DB (non-blocking, fire-and-forget)
  useCrmExtrasSync(extras, !isLoading);

  const handleSaveExtra = (customer: CustomerProfile, data: CustomerExtra) => {
    // 1. Update localStorage immediately (existing behavior — unchanged)
    setExtras(prev => ({ ...prev, [customer.key]: data }));

    // 2. Sync to DB in background (non-blocking — failure is silent)
    fetch(`/api/crm/customers/${encodeURIComponent(customer.key)}/profile`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({
        ...data,
        name:  customer.name,
        phone: customer.phone || undefined,
        // Remap UI field names → DB field names
        dob:         data.dateOfBirth,
        anniversary: data.dateOfAnniversary,
      }),
    }).catch(e => console.warn("[CRM] Profile sync failed (non-fatal):", e));
  };

  const handleToggleNotif = (key: string) => {
    setExtras(prev => {
      const current = prev[key] ?? defaultExtra();
      return { ...prev, [key]: { ...current, notificationEnabled: !current.notificationEnabled } };
    });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">

      {/* ── Page header + tab switcher ──────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-4 pb-0 border-b border-gray-200">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-100">
              <Users className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Customers</h1>
              <p className="text-[10px] text-gray-400">{stats.total} total · {stats.activeToday} active today</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0">
          {([
            { key: "listing",      label: "Customer Listing", icon: LayoutList },
            { key: "intelligence", label: "Intelligence",     icon: Brain },
            { key: "automation",   label: "Automation",       icon: Zap },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? "border-blue-600 text-blue-700 bg-blue-50/50"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      {tab === "listing" ? (
        <CustomerListingView
          customers={customers}
          isLoading={isLoading}
          extras={extras}
          onEdit={setEditTarget}
          onToggleNotif={handleToggleNotif}
        />
      ) : tab === "intelligence" ? (
        <IntelligenceView
          customers={customers}
          stats={stats}
          isLoading={isLoading}
        />
      ) : (
        <AutomationPanel
          customers={customers}
          extras={extras}
          isLoading={isLoading}
        />
      )}

      {/* ── Edit Customer modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {editTarget && (
          <EditCustomerModal
            customer={editTarget}
            extra={extras[editTarget.key] ?? defaultExtra()}
            onSave={data => handleSaveExtra(editTarget, data)}
            onClose={() => setEditTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
