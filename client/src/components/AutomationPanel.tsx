import { apiUrl } from '@/lib/api';

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, CheckCircle, Zap, MessageSquare, ChevronDown, ChevronUp,
  RotateCcw, Phone, History, Settings, AlertTriangle, Loader2,
  Moon, Shield, Bell, Key, Globe, Star, UserPlus, RefreshCw,
  Cake, Play, Wifi, WifiOff, Clock, BarChart2, Eye, Bot,
  CheckCircle2, Info,
} from "lucide-react";
import { type CustomerProfile } from "@/hooks/useCustomerIntelligence";
import {
  buildFollowUpQueue,
  getBlockedCustomers,
  type BlockedCustomer,
  logMessageSent,
  loadAutomationLog,
  clearAutomationLog,
  TRIGGER_LABELS,
  type FollowUpItem,
  type TriggerType,
  loadAutomationSettings,
  saveAutomationSettings,
  type AutomationSettings,
  DEFAULT_SETTINGS,
  DEFAULT_MESSAGE_TEMPLATES,
  loadRunLog,
  clearRunLog,
  type RunLogEntry,
  runCustomerAutomation,
  type RunResult,
  getAutomationProvider,
  isInQuietHours,
  syncSettingsToServer,
} from "@/lib/automationEngine";
import { WhatsAppConnectionCard } from "@/components/conversations/WhatsAppConnectionCard";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerExtra {
  doNotSendUpdate: boolean;
  notificationEnabled: boolean;
}

interface GrowthConfig {
  birthdayEnabled:      boolean;
  birthdayHour:         number;
  feedbackEnabled:      boolean;
  feedbackDelayMinutes: number;
  dailyDigestEnabled:   boolean;
  dailyDigestHour:      number;
  ownerWhatsappPhone:   string;
  watiApiKey:           string;
  watiEndpoint:         string;
  metaPhoneNumberId:    string;
  metaAccessToken:      string;
  restaurantName:       string;
}

const DEFAULT_GC: GrowthConfig = {
  birthdayEnabled:      false,
  birthdayHour:         9,
  feedbackEnabled:      false,
  feedbackDelayMinutes: 120,
  dailyDigestEnabled:   false,
  dailyDigestHour:      23,
  ownerWhatsappPhone:   "",
  watiApiKey:           "",
  watiEndpoint:         "",
  metaPhoneNumberId:    "",
  metaAccessToken:      "",
  restaurantName:       "Bagicha",
};

interface Props {
  customers: CustomerProfile[];
  extras: Record<string, CustomerExtra>;
  isLoading: boolean;
}

type PanelTab = "send" | "rules" | "messages" | "history" | "setup";

// ── Tiny reusables ────────────────────────────────────────────────────────────

function TriggerBadge({ trigger }: { trigger: string }) {
  const meta = TRIGGER_LABELS[trigger as TriggerType] ?? { label: trigger, emoji: "📨", color: "text-gray-600 bg-gray-50 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${meta.color}`}>
      {meta.emoji} {meta.label}
    </span>
  );
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${value ? "bg-green-500" : "bg-gray-300"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function RuleCard({
  emoji, title, description, badge, checked, onChange, alwaysOn, children,
}: {
  emoji: string; title: string; description: string; badge?: string;
  checked: boolean; onChange: (v: boolean) => void; alwaysOn?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className={`border rounded-xl p-3.5 transition-colors ${checked ? "border-green-200 bg-green-50/40" : "border-gray-200 bg-white"}`}>
      <div className="flex items-start gap-3">
        <span className="text-lg mt-0.5 shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-gray-800">{title}</p>
              {badge && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--info-bg)] text-[var(--ink-700)] border border-[var(--line)]">{badge}</span>}
            </div>
            {alwaysOn
              ? <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">Always On</span>
              : <Toggle value={checked} onChange={onChange} />}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{description}</p>
          {checked && children && <div className="mt-2.5 pt-2.5 border-t border-gray-100">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[11px] text-gray-500 w-28 shrink-0">{label}</span>
      {children}
    </div>
  );
}

const inputCls = "text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400 bg-white";

// ── Queue card ────────────────────────────────────────────────────────────────

function QueueCard({ item, onSent }: { item: FollowUpItem; onSent: (item: FollowUpItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editedMsg, setEditedMsg] = useState(item.message);
  const [sent, setSent] = useState(false);

  const handleSend = useCallback(() => {
    if (!item.customer.phone) return;
    const digits = item.customer.phone.replace(/\D/g, "");
    const phone  = digits.startsWith("91") ? digits : `91${digits}`;
    if (phone.length < 12) return;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(editedMsg)}`, "_blank", "noopener,noreferrer");
    logMessageSent(item.customer.key, item.customer.name, item.trigger as TriggerType, editedMsg, "web");
    setSent(true);
    setTimeout(() => onSent(item), 700);
  }, [item, editedMsg, onSent]);

  if (sent) {
    return (
      <motion.div initial={{ opacity: 1, height: "auto" }} animate={{ opacity: 0, height: 0, marginBottom: 0 }} transition={{ duration: 0.35 }} className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-medium">
          <CheckCircle className="w-4 h-4" /> WhatsApp opened for {item.customer.name}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--paper-100)] to-[var(--paper-200)] flex items-center justify-center shrink-0 text-sm font-bold text-[var(--ink-700)]">
          {item.customer.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{item.customer.name}</span>
            <TriggerBadge trigger={item.trigger} />
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
            <Phone className="w-2.5 h-2.5" />
            {item.customer.phone || "No phone"} · {item.customer.daysSinceLastVisit}d ago · {item.customer.totalVisits} visit{item.customer.totalVisits !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button type="button" onClick={handleSend} disabled={!item.customer.phone} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold rounded-lg transition-colors">
            <Send className="w-3 h-3" /> Send
          </button>
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-t border-gray-100">
            <div className="px-4 py-3 bg-gray-50">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Edit message before sending</p>
              <textarea value={editedMsg} onChange={e => setEditedMsg(e.target.value)} rows={4} className="w-full text-xs text-gray-800 bg-white border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-green-400" />
              <p className="text-[9px] text-gray-400 mt-1">Opens WhatsApp with this message pre-filled. You confirm before it sends.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Template order ────────────────────────────────────────────────────────────

const TEMPLATE_ORDER: TriggerType[] = ["BIRTHDAY", "WELCOME", "WIN_BACK", "AT_RISK", "VIP_REWARD", "FAVORITE_ITEM"];

const TOKEN_CHIPS = [
  { token: "{name}",       hint: "Customer first name" },
  { token: "{restaurant}", hint: "Restaurant name" },
  { token: "{visits}",     hint: "Total visit count" },
  { token: "{days}",       hint: "Days since last visit" },
  { token: "{favItem}",    hint: "Favourite menu item" },
];

function MessageTemplatesEditor({
  templates, onChange,
}: {
  templates: Partial<Record<TriggerType, string>>;
  onChange: (t: Partial<Record<TriggerType, string>>) => void;
}) {
  const [open, setOpen] = useState<TriggerType | null>(null);

  function setTpl(trigger: TriggerType, value: string) { onChange({ ...templates, [trigger]: value }); }
  function resetTpl(trigger: TriggerType) { const n = { ...templates }; delete n[trigger]; onChange(n); }

  return (
    <div className="space-y-2">
      {TEMPLATE_ORDER.map(trigger => {
        const meta     = TRIGGER_LABELS[trigger];
        const isCustom = !!templates[trigger];
        const current  = templates[trigger] || DEFAULT_MESSAGE_TEMPLATES[trigger];
        const isOpen   = open === trigger;
        return (
          <div key={trigger} className="border border-gray-200 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setOpen(isOpen ? null : trigger)} className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
              <span className="text-sm">{meta.emoji}</span>
              <span className="flex-1 text-xs font-semibold text-gray-700">{meta.label}</span>
              {isCustom && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--info-bg)] text-[var(--ink-700)] border border-[var(--line)]">Custom</span>}
              {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
            </button>
            {isOpen && (
              <div className="px-3 py-3 space-y-2 bg-white border-t border-gray-100">
                <textarea value={current} onChange={e => setTpl(trigger, e.target.value)} rows={4} className="w-full text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--green-500)] focus:bg-white transition-colors" />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex flex-wrap gap-1">
                    {TOKEN_CHIPS.map(({ token, hint }) => (
                      <button key={token} type="button" title={hint} onClick={() => setTpl(trigger, current + token)} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--info-bg)] border border-[var(--line)] text-[var(--ink-700)] hover:bg-[var(--info-bg)] transition-colors">
                        {token}
                      </button>
                    ))}
                  </div>
                  {isCustom && (
                    <button type="button" onClick={() => resetTpl(trigger)} className="shrink-0 text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Reset default
                    </button>
                  )}
                </div>
                <p className="text-[9px] text-gray-400">Tokens like <code className="bg-gray-100 px-1 rounded">{"{name}"}</code> are replaced with live customer data when sending.</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Log row ────────────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: RunLogEntry }) {
  const meta = entry.trigger ? TRIGGER_LABELS[entry.trigger] : null;
  const time = new Date(entry.timestamp).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs ${entry.type === "success" ? "border-emerald-100 bg-emerald-50" : "border-red-100 bg-red-50"}`}>
      <span className={`shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold ${entry.type === "success" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`}>
        {entry.type === "success" ? "✓" : "✗"}
      </span>
      {entry.type === "success" ? (
        <div className="flex-1 flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-gray-800">{entry.customerName}</span>
          {meta && <TriggerBadge trigger={entry.trigger!} />}
        </div>
      ) : (
        <p className="flex-1 text-red-600 text-[10px]">{entry.errorMessage}</p>
      )}
      <span className="text-[9px] text-gray-400 shrink-0">{time}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function AutomationPanel({ customers, extras, isLoading }: Props) {
  const [tab, setTab]               = useState<PanelTab>("send");
  const [sentKeys, setSentKeys]     = useState<Set<string>>(new Set());
  const [logVersion, setLogVersion] = useState(0);

  // Client-side settings (localStorage)
  const [settings, setSettingsState] = useState<AutomationSettings>(() => loadAutomationSettings());
  const updateSettings = useCallback((s: AutomationSettings) => {
    setSettingsState(s);
    saveAutomationSettings(s);
  }, []);

  // Server-side growth config
  const [gc, setGc]           = useState<GrowthConfig>(DEFAULT_GC);
  const [gcLoading, setGcLoading] = useState(true);
  const [gcSaving, setGcSaving]   = useState(false);

  useEffect(() => {
    fetch(apiUrl("/api/automation/config"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setGc(prev => ({ ...prev, ...d })); })
      .catch(() => {})
      .finally(() => setGcLoading(false));
  }, []);

  const saveGc = useCallback(async (patch: Partial<GrowthConfig>) => {
    const updated = { ...gc, ...patch };
    setGc(updated);
    setGcSaving(true);
    try {
      await fetch(apiUrl("/api/automation/config"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch { /* silent */ }
    setGcSaving(false);
  }, [gc]);

  // Run state
  const [running, setRunning]     = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError]   = useState<string | null>(null);
  const runningRef                = useRef(false);

  // Enrich customers with manual phone from extras
  const enrichedCustomers = useMemo(
    () => customers.map(c => ({ ...c, phone: c.phone || (extras[c.key] as any)?.phone || "" })),
    [customers, extras]
  );

  const queue = useMemo(
    () => buildFollowUpQueue(enrichedCustomers, extras, undefined, settings).filter(i => !sentKeys.has(i.customer.key)),
    [enrichedCustomers, extras, sentKeys, settings]
  );

  const blocked = useMemo(
    () => getBlockedCustomers(enrichedCustomers, extras, settings).filter(b => !sentKeys.has(b.customer.key)),
    [enrichedCustomers, extras, settings, sentKeys]
  );

  const handleSent = useCallback((item: FollowUpItem) => {
    setSentKeys(prev => { const s = new Set(prev); s.add(item.customer.key); return s; });
    setLogVersion(v => v + 1);
  }, []);

  const runLog  = useMemo(() => loadRunLog(),                          [logVersion]);
  const sendLog = useMemo(() => loadAutomationLog().slice().reverse(), [logVersion]);

  const handleRunNow = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true); setRunResult(null); setRunError(null);
    try {
      const result = await runCustomerAutomation(customers, extras, settings);
      setRunResult(result);
      setLogVersion(v => v + 1);
    } catch (err: any) {
      setRunError(err?.message ?? "Automation failed");
      setLogVersion(v => v + 1);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [customers, extras, settings]);

  const today     = new Date().toDateString();
  const sentToday = sendLog.filter(e => new Date(e.sentAt).toDateString() === today).length;

  const provider         = getAutomationProvider(settings);
  const quietHoursActive = isInQuietHours(settings.quietHours);
  const isWebMode        = settings.whatsappMode === "web";
  const whatsappLabel    = provider === "unconfigured" ? "⚠️ Not configured" : settings.whatsappMode === "meta" ? "🔵 Meta API" : settings.whatsappMode === "api" ? "🤖 WATI API" : "🌐 WhatsApp Web";

  const TABS: { key: PanelTab; label: string; icon: React.ElementType }[] = [
    { key: "send",     label: "Send",     icon: Send },
    { key: "rules",    label: "Rules",    icon: Zap },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "history",  label: "History",  icon: History },
    { key: "setup",    label: "Setup",    icon: Settings },
  ];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-gray-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading customer data…
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

      {/* ── Tab nav ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex border-b border-gray-100 bg-gray-50">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-2.5 text-[11px] font-semibold border-b-2 transition-colors touch-manipulation ${
              tab === t.key ? "border-green-700 text-green-700 bg-white" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <t.icon className="w-3 h-3" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">

        {/* ══════════════════════════════════════════════════════════════════
            SEND TAB — queue + run now, all in one place
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === "send" && (
          <>
            {/* Status strip */}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setTab("setup")}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border hover:opacity-80 ${settings.enabled ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}
              >
                {settings.enabled ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {settings.enabled ? "Auto ON" : "Auto OFF"}
              </button>
              <button type="button" onClick={() => setTab("setup")}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border hover:opacity-80 ${provider === "unconfigured" && !isWebMode ? "bg-red-50 text-red-600 border-red-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}
              >
                {whatsappLabel}
              </button>
              {quietHoursActive && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-orange-50 text-orange-600 border-orange-200">
                  <Moon className="w-3 h-3" /> Quiet hours
                </span>
              )}
              <span className="text-[9px] text-gray-400 italic self-center">↑ tap to change</span>
            </div>

            {/* Warning: API mode not configured */}
            {!isWebMode && provider === "unconfigured" && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  <strong>WhatsApp API not configured.</strong> Go to{" "}
                  <button type="button" className="underline font-semibold" onClick={() => setTab("setup")}>Setup</button>{" "}
                  to add credentials, or switch to <strong>WhatsApp Web</strong> (free, no account needed).
                </p>
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--info-bg)] px-3 py-2.5">
                <p className="text-[9px] font-semibold text-[var(--ink-600)] uppercase tracking-wide">Need Follow-Up</p>
                <p className="text-2xl font-bold text-[var(--ink-700)]">{queue.length}</p>
                <p className="text-[9px] text-[var(--ink-500)]">customers today</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                <p className="text-[9px] font-semibold text-emerald-500 uppercase tracking-wide">Sent Today</p>
                <p className="text-2xl font-bold text-emerald-700">{sentToday}</p>
                <p className="text-[9px] text-emerald-400">messages sent</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wide">Total</p>
                <p className="text-2xl font-bold text-gray-700">{customers.length}</p>
                <p className="text-[9px] text-gray-400">customers</p>
              </div>
            </div>

            {/* Run Now card (API mode) */}
            {!isWebMode && (
              <div className="rounded-2xl bg-green-800 text-white overflow-hidden">
                <div className="p-4">
                  <p className="text-sm font-bold mb-1 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-green-300" /> Send All Messages Now
                  </p>
                  <p className="text-[10px] text-green-200 mb-3 leading-relaxed">
                    {!settings.enabled ? "Automation is OFF — enable it in Setup." : quietHoursActive ? `Quiet hours active (${settings.quietHours.start}:00 – ${settings.quietHours.end}:00). No sends.` : `Sends to all ${queue.length} eligible customers automatically via ${settings.whatsappMode === "meta" ? "Meta API" : "WATI API"}.`}
                  </p>
                  <button type="button" onClick={handleRunNow} disabled={running || !settings.enabled || provider === "unconfigured"}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-white text-sm font-semibold transition-colors min-h-[44px] touch-manipulation bg-green-600/50 hover:bg-green-600/70 border-green-400/40 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Play className="w-4 h-4" /> Send Now</>}
                  </button>
                  {runError && (
                    <div className="mt-3 flex items-start gap-2 bg-red-900/40 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-300 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-red-200">{runError}</p>
                    </div>
                  )}
                  {runResult && !runError && (
                    <div className="mt-3 grid grid-cols-4 gap-2 text-center bg-green-900/30 rounded-lg px-3 py-2.5">
                      {[["Scanned", runResult.scanned], ["Eligible", runResult.eligible], ["Sent", runResult.sent], ["Failed", runResult.failed]].map(([l, v]) => (
                        <div key={l as string}>
                          <p className="text-base font-bold text-white">{v}</p>
                          <p className="text-[9px] text-green-300">{l}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Queue */}
            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400">
                <CheckCircle className="w-10 h-10 mb-3 text-emerald-400" />
                <p className="text-sm font-semibold text-gray-600">All caught up!</p>
                <p className="text-xs mt-1 max-w-[220px]">
                  {!settings.enabled ? "Automation is OFF — enable it in Setup." : blocked.length > 0 ? `${blocked.length} customer${blocked.length !== 1 ? "s" : ""} need follow-up but can't be reached (see below).` : "No follow-ups pending right now."}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[var(--ink-600)]" />
                    {isWebMode ? `${queue.length} message${queue.length !== 1 ? "s" : ""} to send` : `${queue.length} in queue`}
                  </p>
                  {isWebMode && <span className="text-[10px] text-gray-400">Click Send → confirm in WhatsApp</span>}
                </div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {queue.map(item => <QueueCard key={item.customer.key} item={item} onSent={handleSent} />)}
                  </AnimatePresence>
                </div>
              </>
            )}

            {/* Blocked customers */}
            {blocked.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {blocked.length} customer{blocked.length !== 1 ? "s" : ""} need follow-up but can't be reached
                </p>
                {blocked.map(b => (
                  <div key={b.customer.key} className="flex items-center gap-2 text-xs text-amber-700 pl-1">
                    <span className="font-medium truncate max-w-[120px]">{b.customer.name}</span>
                    <TriggerBadge trigger={b.trigger} />
                    <span className="text-[10px] opacity-70 ml-auto shrink-0">{b.reason === "no_phone" ? "No phone number" : "Opted out"}</span>
                  </div>
                ))}
                {blocked.some(b => b.reason === "no_phone") && (
                  <p className="text-[10px] text-amber-600 pt-1 border-t border-amber-200">
                    Add phone numbers in Customer Listing → Edit Customer to enable WhatsApp.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            RULES TAB — all automation triggers in one place
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === "rules" && (
          <>
            {gcLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400 gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                {gcSaving && (
                  <div className="flex items-center gap-1.5 text-[10px] text-green-600 font-semibold">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                  </div>
                )}

                {/* ── Customer Follow-Up ── */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Customer Follow-Up</p>
                  <div className="space-y-2">

                    <RuleCard emoji="🎂" title="Birthday Wishes" badge="Server"
                      description="Automatically sends a birthday greeting with a 15% off coupon on the customer's birthday. Runs once daily at the time you set."
                      checked={gc.birthdayEnabled} onChange={v => saveGc({ birthdayEnabled: v })}
                    >
                      <FieldRow label="Send time">
                        <input type="number" min={0} max={23} value={gc.birthdayHour} onChange={e => saveGc({ birthdayHour: Math.max(0, Math.min(23, +e.target.value)) })} className={`${inputCls} w-16`} />
                        <span className="text-[11px] text-gray-500">:00 (24h)</span>
                      </FieldRow>
                      <BirthdayRunButton />
                    </RuleCard>

                    <RuleCard emoji="💐" title="Anniversary Wishes" badge="Server"
                      description="Sends an anniversary greeting with a 20% off coupon. Shares the birthday scan schedule — runs at the same time each day."
                      checked={gc.birthdayEnabled} onChange={v => saveGc({ birthdayEnabled: v })}
                    />

                    <RuleCard emoji="🎉" title="Welcome New Customers"
                      description="Sends a welcome offer after a customer's very first visit. Only fires once per customer."
                      checked={settings.welcomeEnabled} onChange={v => updateSettings({ ...settings, welcomeEnabled: v })}
                    />

                    <RuleCard emoji="📢" title="Re-engage Inactive Customers" alwaysOn
                      description={`Reminds customers who haven't visited in a while. You can adjust how many days counts as "inactive" below.`}
                      checked onChange={() => {}}
                    >
                      <FieldRow label="Inactive after">
                        <input type="number" min={1} max={90} value={settings.inactivityDays} onChange={e => updateSettings({ ...settings, inactivityDays: +e.target.value })} className={`${inputCls} w-16`} />
                        <span className="text-[11px] text-gray-500">days</span>
                      </FieldRow>
                    </RuleCard>

                    <RuleCard emoji="⭐" title="VIP Loyalty Reward"
                      description="Sends a 'thank you' message with a complimentary starter offer to your most loyal customers (10+ visits)."
                      checked={settings.vipEnabled} onChange={v => updateSettings({ ...settings, vipEnabled: v })}
                    />

                    <RuleCard emoji="🔄" title="Win-Back Lapsed Customers" alwaysOn
                      description="Sends a 10% off offer to customers who haven't visited in over 30 days. Always active — pairs with Re-engage above."
                      checked onChange={() => {}}
                    />
                  </div>
                </div>

                {/* ── After Each Visit ── */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">After Each Visit</p>
                  <div className="space-y-2">
                    <RuleCard emoji="⭐" title="Ask for Feedback" badge="Server"
                      description="Sends a review request to the customer after they pay. Great for collecting ratings and identifying issues early."
                      checked={gc.feedbackEnabled} onChange={v => saveGc({ feedbackEnabled: v })}
                    >
                      <FieldRow label="Send after">
                        <input type="number" min={5} max={1440} value={gc.feedbackDelayMinutes} onChange={e => saveGc({ feedbackDelayMinutes: Math.max(5, +e.target.value) })} className={`${inputCls} w-20`} />
                        <span className="text-[11px] text-gray-500">minutes after payment</span>
                      </FieldRow>
                    </RuleCard>
                  </div>
                </div>

                {/* ── Daily Report ── */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Daily Report to Owner</p>
                  <div className="space-y-2">
                    <RuleCard emoji="📊" title="Daily Sales Summary" badge="Server"
                      description="Sends you a WhatsApp summary of today's revenue, orders, and top items at the end of each day."
                      checked={gc.dailyDigestEnabled} onChange={v => saveGc({ dailyDigestEnabled: v })}
                    >
                      <FieldRow label="Owner's phone">
                        <input type="tel" placeholder="919876543210" value={gc.ownerWhatsappPhone} onChange={e => saveGc({ ownerWhatsappPhone: e.target.value.replace(/\D/g, "") })} className={`${inputCls} w-40`} />
                      </FieldRow>
                      <FieldRow label="Send at">
                        <input type="number" min={0} max={23} value={gc.dailyDigestHour} onChange={e => saveGc({ dailyDigestHour: Math.max(0, Math.min(23, +e.target.value)) })} className={`${inputCls} w-16`} />
                        <span className="text-[11px] text-gray-500">:00 (24h)</span>
                      </FieldRow>
                    </RuleCard>
                  </div>
                </div>

                {/* Server badge explanation */}
                <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
                  <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-700 leading-relaxed">
                    Rules marked <span className="font-bold bg-[var(--info-bg)] text-[var(--ink-700)] px-1 rounded">Server</span> run automatically in the background — no manual action needed once enabled.
                    Other rules feed the <strong>Send tab queue</strong> for you to review and send manually (or automatically via API mode in Setup).
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MESSAGES TAB — template editor
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === "messages" && (
          <>
            <div>
              <p className="text-sm font-bold text-gray-800 mb-0.5">Message Templates</p>
              <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
                Edit the default message for each rule. Use tokens like{" "}
                <code className="bg-gray-100 px-1 rounded text-[9px]">{"{name}"}</code> — they are filled in with real customer data when sent.
                Changes save automatically and apply to all future messages of that type.
              </p>
            </div>
            <MessageTemplatesEditor
              templates={settings.messageTemplates ?? {}}
              onChange={tpls => updateSettings({ ...settings, messageTemplates: tpls })}
            />
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            HISTORY TAB — logs
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === "history" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800">Message History</p>
              {(runLog.length > 0 || sendLog.length > 0) && (
                <button type="button" onClick={() => { clearRunLog(); clearAutomationLog(); setLogVersion(v => v + 1); }} className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>

            {sendLog.length === 0 && runLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <History className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm font-semibold text-gray-600">No history yet</p>
                <p className="text-xs mt-1">Messages you send will appear here.</p>
              </div>
            ) : (
              <>
                {sendLog.length > 0 && (
                  <div className="space-y-1.5">
                    {sendLog.slice(0, 50).map((e, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-white border border-gray-100 rounded-xl text-xs">
                        <span className="text-sm">{TRIGGER_LABELS[e.trigger as TriggerType]?.emoji ?? "📨"}</span>
                        <span className="font-medium text-gray-800 flex-1 truncate">{e.customerName}</span>
                        <TriggerBadge trigger={e.trigger} />
                        <span className="text-[9px] text-gray-400 shrink-0">
                          {new Date(e.sentAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {runLog.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5 mt-3">Run Log</p>
                    <div className="space-y-1.5">
                      {runLog.slice(0, 30).map((entry, i) => <LogRow key={i} entry={entry} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SETUP TAB — WhatsApp connection + advanced settings
        ═══════════════════════════════════════════════════════════════════ */}
        {tab === "setup" && (
          <SetupTab settings={settings} onSettings={updateSettings} gc={gc} onGc={saveGc} gcLoading={gcLoading} />
        )}
      </div>
    </div>
  );
}

// ── Birthday run button (inside Rules tab) ────────────────────────────────────

function BirthdayRunButton() {
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setResult(null);
    try {
      const res  = await fetch(apiUrl("/api/automation/birthday/run"), { method: "POST", credentials: "include" });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(data?.error ?? "Scan failed");
      const sent = (data.birthdaysSent ?? 0) + (data.anniversariesSent ?? 0);
      const dry  = data.dryRun ?? 0;
      if (dry > 0 && sent === 0) setResult(`⚠️ Dry-run: ${dry} found but WhatsApp not configured. Go to Setup.`);
      else if (sent > 0) setResult(`✅ Sent ${sent} message${sent !== 1 ? "s" : ""}!`);
      else setResult(`ℹ️ No birthdays/anniversaries today (scanned ${data.scanned ?? 0} customers).`);
    } catch (e: any) {
      setResult(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <button type="button" onClick={run} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-pink-700 border border-pink-200 bg-pink-50 rounded-lg hover:bg-pink-100 transition-colors disabled:opacity-50">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cake className="w-3 h-3" />}
        Run scan now
      </button>
      {result && <p className="text-[10px] text-gray-600 leading-relaxed">{result}</p>}
    </div>
  );
}

// ── Setup tab ─────────────────────────────────────────────────────────────────

function SetupTab({
  settings, onSettings, gc, onGc, gcLoading,
}: {
  settings: AutomationSettings;
  onSettings: (s: AutomationSettings) => void;
  gc: GrowthConfig;
  onGc: (patch: Partial<GrowthConfig>) => Promise<void>;
  gcLoading: boolean;
}) {
  const set = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) =>
    onSettings({ ...settings, [k]: v });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [credSaving, setCredSaving]     = useState<"idle" | "saving" | "ok" | "error">("idle");

  const saveCreds = async () => {
    setCredSaving("saving");
    try {
      await onGc({
        watiApiKey:        gc.watiApiKey,
        watiEndpoint:      gc.watiEndpoint,
        metaPhoneNumberId: gc.metaPhoneNumberId,
        metaAccessToken:   gc.metaAccessToken,
      });
      setCredSaving("ok");
      setTimeout(() => setCredSaving("idle"), 3000);
    } catch {
      setCredSaving("error");
      setTimeout(() => setCredSaving("idle"), 4000);
    }
  };

  return (
    <div className="space-y-5">

      {/* ── Master toggle ── */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-green-500" /> Automation Engine
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">Master switch — turn off to pause all automation</p>
        </div>
        <Toggle value={settings.enabled} onChange={v => set("enabled", v)} />
      </div>

      {/* ── Automated WhatsApp driver (Baileys / Meta) + chatbot ── */}
      <WhatsAppConnectionCard />

      {/* ── WhatsApp connection ── */}
      <div>
        <p className="text-xs font-bold text-gray-700 mb-1">How to Send WhatsApp Messages</p>
        <p className="text-[10px] text-gray-400 mb-2.5">Choose how messages are delivered to customers.</p>
        <div className="space-y-2">
          {([
            { mode: "web",  icon: "🌐", title: "WhatsApp Web — Free",      desc: "Opens WhatsApp on your device. You review and confirm each message before it sends. Best for small teams." },
            { mode: "meta", icon: "🔵", title: "Meta API — Automatic",     desc: "Messages send automatically without clicking. Requires a Meta WhatsApp Business account." },
            { mode: "api",  icon: "🤖", title: "WATI API — Automatic",     desc: "Messages send automatically via WATI. Requires a WATI subscription." },
          ] as const).map(({ mode, icon, title, desc }) => (
            <button key={mode} type="button" onClick={() => set("whatsappMode", mode)}
              className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${settings.whatsappMode === mode ? "border-green-400 bg-green-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
            >
              <span className="text-xl shrink-0 mt-0.5">{icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                  {title}
                  {settings.whatsappMode === mode && <span className="text-[9px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">Active</span>}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Credentials (Meta) ── */}
      {settings.whatsappMode === "meta" && (
        <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5">🔵 Meta WhatsApp Credentials</p>
          <p className="text-[10px] text-blue-700 leading-relaxed">
            Get these from <strong>developers.facebook.com → Your App → WhatsApp → Getting Started</strong>.
          </p>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">Phone Number ID</label>
            <input type="text" placeholder="123456789012345" value={gc.metaPhoneNumberId} onChange={e => onGc({ metaPhoneNumberId: e.target.value })} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">Access Token</label>
            <input type="password" placeholder="EAAxxxxxxxx…" value={gc.metaAccessToken} onChange={e => onGc({ metaAccessToken: e.target.value })} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white" />
          </div>
          <CredSaveButton saving={credSaving} onSave={saveCreds} disabled={!gc.metaPhoneNumberId || !gc.metaAccessToken} />
        </div>
      )}

      {/* ── Credentials (WATI) ── */}
      {settings.whatsappMode === "api" && (
        <div className="border border-orange-200 bg-orange-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-orange-800 flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /> WATI API Credentials</p>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">API Endpoint</label>
            <input type="text" placeholder="https://live-mt-server.wati.io/YOUR_ID" value={gc.watiEndpoint} onChange={e => onGc({ watiEndpoint: e.target.value })} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">API Key</label>
            <input type="password" placeholder="Your WATI API key" value={gc.watiApiKey} onChange={e => onGc({ watiApiKey: e.target.value })} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
          </div>
          <CredSaveButton saving={credSaving} onSave={saveCreds} disabled={!gc.watiApiKey || !gc.watiEndpoint} color="orange" />
        </div>
      )}

      {/* ── Advanced settings (collapsed) ── */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button type="button" onClick={() => setShowAdvanced(a => !a)} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
          <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-400" /> Advanced Settings
          </p>
          {showAdvanced ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showAdvanced && (
          <div className="px-4 py-4 space-y-4 bg-white border-t border-gray-100">

            {/* Auto-off quiet hours */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Moon className="w-3.5 h-3.5 text-slate-400" /> Auto-Off During Quiet Hours</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Pause automation at night, resume in the morning</p>
              </div>
              <Toggle value={settings.autoOff} onChange={v => set("autoOff", v)} />
            </div>

            {/* Quiet hours */}
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">No messages sent between:</p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={23} value={settings.quietHours.start} onChange={e => set("quietHours", { ...settings.quietHours, start: +e.target.value })} className={`${inputCls} w-16`} />
                  <span className="text-[11px] text-gray-500">:00</span>
                </div>
                <span className="text-[11px] text-gray-400">to</span>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={23} value={settings.quietHours.end} onChange={e => set("quietHours", { ...settings.quietHours, end: +e.target.value })} className={`${inputCls} w-16`} />
                  <span className="text-[11px] text-gray-500">:00</span>
                </div>
              </div>
              {isInQuietHours(settings.quietHours) && <p className="text-[10px] text-orange-500 font-semibold mt-1">⚠ Quiet hours active right now</p>}
            </div>

            {/* Limits grid */}
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "maxPerRun",      label: "Max per run",     hint: "Messages per single run",       min: 1,   max: 200 },
                { key: "dailyLimit",     label: "Daily limit",     hint: "Max total messages per day",    min: 1,   max: 200 },
                { key: "cooldownHours",  label: "Cooldown (hours)",hint: "Min hours between msgs per customer", min: 1, max: 720 },
                { key: "inactivityDays", label: "Inactivity days", hint: "Days before 'At Risk' triggers",min: 1,   max: 90  },
              ] as const).map(({ key, label, hint, min, max }) => (
                <div key={key}>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">{label}</label>
                  <input type="number" min={min} max={max} value={settings[key] as number} onChange={e => set(key, +e.target.value)} className={`${inputCls} w-full`} />
                  <p className="text-[9px] text-gray-400 mt-0.5">{hint}</p>
                </div>
              ))}
            </div>

            {/* Template mode */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Bot className="w-3.5 h-3.5 text-purple-400" /> Template Mode</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{settings.templateMode ? "Using smart templates (always works)" : "Using Claude AI — requires Anthropic key on server"}</p>
              </div>
              <Toggle value={settings.templateMode} onChange={v => set("templateMode", v)} />
            </div>

            {/* Reset */}
            <button type="button" onClick={() => onSettings({ ...DEFAULT_SETTINGS })} className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Reset all settings to default
            </button>
          </div>
        )}
      </div>

      {/* ── Opt-out note ── */}
      <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
        <Bell className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-blue-700 leading-relaxed">
          <strong>Opt-out is always respected.</strong> Customers marked "Do Not Contact" or with notifications off are never messaged, regardless of any settings here.
        </p>
      </div>
    </div>
  );
}

function CredSaveButton({ saving, onSave, disabled, color = "blue" }: { saving: string; onSave: () => void; disabled: boolean; color?: string }) {
  const cls = color === "orange"
    ? "bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200"
    : "bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onSave} disabled={disabled || saving === "saving"} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors disabled:text-gray-400 ${cls}`}>
        {saving === "saving" ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : <><CheckCircle2 className="w-3 h-3" /> Save Credentials</>}
      </button>
      {saving === "ok" && <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Saved</span>}
      {saving === "error" && <span className="text-[10px] text-red-600 font-semibold">Save failed</span>}
    </div>
  );
}
