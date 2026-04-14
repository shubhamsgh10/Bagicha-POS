/**
 * AutomationPanel.tsx
 *
 * Client-side AI Customer Follow-Up Automation.
 * ALL core functionality runs in the browser — no server dependency.
 *
 * Settings  → localStorage ("bagicha_automation_settings")
 * Run log   → localStorage ("bagicha_automation_logs")
 * Send log  → localStorage ("bagicha_automation_log")
 * WhatsApp  → wa.me links (web mode) or WATI API (configured in server settings)
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, CheckCircle, Zap, MessageSquare, ChevronDown, ChevronUp,
  RotateCcw, Phone, History, Settings, BarChart2,
  Play, Wifi, WifiOff, Bot, AlertTriangle, Loader2,
  Moon, Clock, Shield, Bell, Sliders,
} from "lucide-react";
import { type CustomerProfile } from "@/hooks/useCustomerIntelligence";
import { sendViaWhatsAppWeb } from "@/utils/whatsapp";
import {
  buildFollowUpQueue,
  logMessageSent,
  loadAutomationLog,
  clearAutomationLog,
  TRIGGER_LABELS,
  type FollowUpItem,
  type TriggerType,
  getAutomationSettings,
  saveAutomationSettings,
  type AutomationSettings,
  DEFAULT_SETTINGS,
  loadRunLog,
  clearRunLog,
  type RunLogEntry,
  runAutomationClientSide,
  type RunResult,
} from "@/lib/automationEngine";

// ── Props ──────────────────────────────────────────────────────────────────────

interface CustomerExtra {
  doNotSendUpdate: boolean;
  notificationEnabled: boolean;
}

interface Props {
  customers: CustomerProfile[];
  extras: Record<string, CustomerExtra>;
  isLoading: boolean;
}

// ── Panel tabs ────────────────────────────────────────────────────────────────

type PanelTab = "overview" | "queue" | "log" | "settings";

// ── Trigger display metadata ──────────────────────────────────────────────────

const TRIGGER_META: Record<string, { label: string; emoji: string; color: string }> = {
  WIN_BACK:     { label: "Win-Back",    emoji: "🎁", color: "text-red-600 bg-red-50 border-red-200" },
  AT_RISK:      { label: "At Risk",     emoji: "⚠️",  color: "text-orange-600 bg-orange-50 border-orange-200" },
  VIP_REWARD:   { label: "VIP Reward",  emoji: "⭐",  color: "text-amber-600 bg-amber-50 border-amber-200" },
  WELCOME:      { label: "Welcome",     emoji: "🎉",  color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  FAVORITE_ITEM:{ label: "Fav Item",    emoji: "😋",  color: "text-purple-600 bg-purple-50 border-purple-200" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function TriggerBadge({ trigger }: { trigger: string }) {
  const meta = TRIGGER_META[trigger] ?? { label: trigger, emoji: "📨", color: "text-gray-600 bg-gray-50 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${meta.color}`}>
      {meta.emoji} {meta.label}
    </span>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex flex-col gap-0.5 ${color}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-xl font-bold leading-none">{value}</span>
      {sub && <span className="text-[9px] opacity-60">{sub}</span>}
    </div>
  );
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${value ? "bg-green-500" : "bg-gray-300"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// ── Queue card ────────────────────────────────────────────────────────────────

function QueueCard({ item, onSent }: { item: FollowUpItem; onSent: (item: FollowUpItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editedMsg, setEditedMsg] = useState(item.message);
  const [sent, setSent] = useState(false);

  const handleSend = useCallback(() => {
    const result = sendViaWhatsAppWeb(
      item.customer.phone,
      item.trigger === "VIP_REWARD" ? "vip_reward" :
      item.trigger === "WIN_BACK"   ? "inactive_offer" : "thank_you",
      item.customer.name
    );
    if (result.success) {
      logMessageSent(item.customer.key, item.customer.name, item.trigger as TriggerType, editedMsg);
      setSent(true);
      setTimeout(() => onSent(item), 700);
    }
  }, [item, editedMsg, onSent]);

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 1, height: "auto" }}
        animate={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.35 }}
        className="overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-medium">
          <CheckCircle className="w-4 h-4" /> WhatsApp opened for {item.customer.name}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center shrink-0 text-sm font-bold text-indigo-600">
          {item.customer.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{item.customer.name}</span>
            <TriggerBadge trigger={item.trigger} />
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
            <Phone className="w-2.5 h-2.5" /> {item.customer.phone || "No phone"} · {item.customer.daysSinceLastVisit}d ago · {item.customer.totalVisits} visits
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!item.customer.phone}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Send className="w-3 h-3" /> Send
          </button>
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-t border-gray-100">
            <div className="px-4 py-3 bg-gray-50">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Edit message before sending</p>
              <textarea value={editedMsg} onChange={e => setEditedMsg(e.target.value)} rows={4}
                className="w-full text-xs text-gray-800 bg-white border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-green-400" />
              <p className="text-[9px] text-gray-400 mt-1">Opens WhatsApp with this message pre-filled. You confirm before it sends.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Run log row ────────────────────────────────────────────────────────────────

function RunLogRow({ entry }: { entry: RunLogEntry }) {
  const [show, setShow] = useState(false);
  const meta = entry.trigger ? (TRIGGER_META[entry.trigger] ?? { emoji: "📨", label: entry.trigger }) : null;
  const time = new Date(entry.timestamp).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50" onClick={() => setShow(s => !s)}>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
          entry.type === "success" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
        }`}>
          {entry.type === "success" ? "✓" : "✗"}
        </span>
        <div className="flex-1 min-w-0">
          {entry.type === "success" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-gray-800 truncate">{entry.customerName}</span>
              {meta && <TriggerBadge trigger={entry.trigger!} />}
            </div>
          ) : (
            <span className="text-xs text-red-600 truncate">{entry.errorMessage}</span>
          )}
        </div>
        <span className="text-[9px] text-gray-400 shrink-0">{time}</span>
        {show ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
      </div>
      {show && entry.message && (
        <div className="px-3 pb-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-600">{entry.message}</div>
      )}
    </div>
  );
}

// ── Settings panel ─────────────────────────────────────────────────────────────

function SettingsPanel({ settings, onChange }: {
  settings: AutomationSettings;
  onChange: (s: AutomationSettings) => void;
}) {
  const set = <K extends keyof AutomationSettings>(key: K, val: AutomationSettings[K]) =>
    onChange({ ...settings, [key]: val });

  return (
    <div className="space-y-5">
      {/* Master toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-green-500" /> Automation Engine
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">Master switch — when OFF, Run button is blocked</p>
        </div>
        <Toggle value={settings.enabled} onChange={v => set("enabled", v)} />
      </div>

      {/* WhatsApp mode */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-green-500" /> WhatsApp Mode
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(["web", "api"] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => set("whatsappMode", mode)}
              className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all text-left ${
                settings.whatsappMode === mode
                  ? "bg-green-50 border-green-400 text-green-700"
                  : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              {mode === "web" ? "🌐 WhatsApp Web" : "🤖 WATI API"}
              <p className="text-[9px] font-normal mt-0.5 opacity-70">
                {mode === "web" ? "Opens wa.me — no API key needed" : "Sends automatically via WATI"}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Template mode */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-purple-500" /> Template Mode
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {settings.templateMode
              ? "Using smart templates (always works, no API needed)"
              : "Using Claude AI — requires Anthropic key on server"}
          </p>
        </div>
        <Toggle value={settings.templateMode} onChange={v => set("templateMode", v)} />
      </div>

      {/* Daily limit + inactivity threshold */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">
            <Shield className="w-3 h-3" /> Daily Limit
          </label>
          <input
            type="number" min={1} max={200} value={settings.dailyLimit}
            onChange={e => set("dailyLimit", +e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <p className="text-[9px] text-gray-400 mt-1">Max messages per run</p>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">
            <Clock className="w-3 h-3" /> Inactivity Days
          </label>
          <input
            type="number" min={1} max={90} value={settings.inactivityDays}
            onChange={e => set("inactivityDays", +e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <p className="text-[9px] text-gray-400 mt-1">Days before "At Risk" triggers</p>
        </div>
      </div>

      {/* Quiet hours */}
      <div>
        <label className="block text-[10px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">
          <Moon className="w-3 h-3" /> Quiet Hours (no messages sent during this window)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-gray-500 mb-1">Start (hour, 0–23)</p>
            <input
              type="number" min={0} max={23} value={settings.quietHours.start}
              onChange={e => set("quietHours", { ...settings.quietHours, start: +e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 mb-1">End (hour, 0–23)</p>
            <input
              type="number" min={0} max={23} value={settings.quietHours.end}
              onChange={e => set("quietHours", { ...settings.quietHours, end: +e.target.value })}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
        </div>
        <p className="text-[9px] text-gray-400 mt-1">
          Currently: no messages between {settings.quietHours.start}:00 – {settings.quietHours.end}:00
        </p>
      </div>

      {/* Opt-out rules reminder */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <Bell className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          <span className="font-semibold">Opt-out rules are always respected</span> — customers with
          "Do Not Send Updates" or notifications disabled in Customer Listing are automatically skipped,
          regardless of these settings.
        </p>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AutomationPanel({ customers, extras, isLoading }: Props) {
  const [panelTab, setPanelTab]     = useState<PanelTab>("overview");
  const [sentKeys, setSentKeys]     = useState<Set<string>>(new Set());
  const [logVersion, setLogVersion] = useState(0);

  // Client-side settings — load from localStorage on mount
  const [settings, setSettingsState] = useState<AutomationSettings>(() => getAutomationSettings());

  // Run state
  const [running, setRunning]       = useState(false);
  const [runResult, setRunResult]   = useState<RunResult | null>(null);
  const [runError, setRunError]     = useState<string | null>(null);

  // Settings save feedback
  const [saveFeedback, setSaveFeedback] = useState<"ok" | null>(null);

  // Update settings: save to localStorage immediately
  const updateSettings = useCallback((newSettings: AutomationSettings) => {
    setSettingsState(newSettings);
    saveAutomationSettings(newSettings);
    setSaveFeedback("ok");
    setTimeout(() => setSaveFeedback(null), 2500);
  }, []);

  // Queue (client-side, always works)
  const queue = useMemo(
    () => buildFollowUpQueue(customers, extras).filter(i => !sentKeys.has(i.customer.key)),
    [customers, extras, sentKeys]
  );

  const handleSent = useCallback((item: FollowUpItem) => {
    setSentKeys(prev => { const s = new Set(prev); s.add(item.customer.key); return s; });
    setLogVersion(v => v + 1);
  }, []);

  // Logs
  const runLog  = useMemo(() => loadRunLog(), [logVersion]);
  const sendLog = useMemo(() => loadAutomationLog().slice().reverse(), [logVersion]);

  // Stats
  const today      = new Date().toDateString();
  const sentToday  = sendLog.filter(e => new Date(e.sentAt).toDateString() === today).length;
  const atRisk     = customers.filter(c => c.tag === "At Risk").length;
  const vip        = customers.filter(c => c.tag === "VIP").length;

  // ── Run handler ──────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (running) return;

    setRunning(true);
    setRunResult(null);
    setRunError(null);

    try {
      const result = await runAutomationClientSide(customers, extras, settings);
      setRunResult(result);
      setLogVersion(v => v + 1);
    } catch (err: any) {
      const msg = err?.message ?? "Automation failed — check Settings";
      setRunError(msg);
      setLogVersion(v => v + 1);
    } finally {
      setRunning(false);
    }
  }, [running, customers, extras, settings]);

  const TABS: { key: PanelTab; label: string; icon: any }[] = [
    { key: "overview",  label: "Overview",              icon: BarChart2 },
    { key: "queue",     label: `Queue (${queue.length})`, icon: MessageSquare },
    { key: "log",       label: `Log (${runLog.length})`, icon: History },
    { key: "settings",  label: "Settings",              icon: Settings },
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
      {/* Sub-tabs */}
      <div className="shrink-0 flex gap-0 border-b border-gray-100 bg-gray-50">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setPanelTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
              panelTab === t.key
                ? "border-indigo-600 text-indigo-700 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <t.icon className="w-3 h-3" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        {panelTab === "overview" && (
          <>
            {/* Status badges — click to open Settings */}
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={() => setPanelTab("settings")}
                title="Click to change in Settings"
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-opacity hover:opacity-80 ${
                  settings.enabled
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-100 text-gray-500 border-gray-200"
                }`}
              >
                {settings.enabled
                  ? <><Wifi className="w-3 h-3" /> Auto ON</>
                  : <><WifiOff className="w-3 h-3" /> Auto OFF</>}
              </button>
              <button
                type="button"
                onClick={() => setPanelTab("settings")}
                title="Click to change in Settings"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-orange-50 text-orange-600 border-orange-200 hover:opacity-80"
              >
                {settings.whatsappMode === "web" ? "🌐 WhatsApp Web Mode" : "🤖 WATI API Mode"}
              </button>
              <button
                type="button"
                onClick={() => setPanelTab("settings")}
                title="Click to change in Settings"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-gray-100 text-gray-500 border-gray-200 hover:opacity-80"
              >
                <Bot className="w-3 h-3" /> {settings.templateMode ? "Template Mode" : "Claude AI Mode"}
              </button>
              <span className="text-[9px] text-gray-400 italic">↑ click any badge to change</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatCard label="Queue Today"  value={queue.length}  sub="need follow-up"  color="bg-indigo-50 border-indigo-200 text-indigo-700" />
              <StatCard label="Sent Today"   value={sentToday}     sub="messages opened" color="bg-emerald-50 border-emerald-200 text-emerald-700" />
              <StatCard label="At-Risk"      value={atRisk}        sub="need attention"  color="bg-red-50 border-red-200 text-red-700" />
              <StatCard label="VIP"          value={vip}           sub="loyalty"         color="bg-amber-50 border-amber-200 text-amber-700" />
            </div>

            {/* Run Now card */}
            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">Run Now</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {settings.enabled
                      ? `Evaluates all ${customers.length} customers, opens WhatsApp for each eligible one`
                      : "Automation is OFF — enable it in Settings first"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={running || !settings.enabled}
                  className={`flex items-center gap-1.5 px-4 py-2 text-white text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                    !settings.enabled
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                      : running
                      ? "bg-indigo-400 cursor-wait"
                      : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {running
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
                    : <><Play className="w-3.5 h-3.5" /> Run</>}
                </button>
              </div>

              {/* Run result */}
              {runError && (
                <div className="border-t border-red-100 px-4 py-3 bg-red-50 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 font-medium">{runError}</p>
                </div>
              )}
              {runResult && !runError && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Run Complete</p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold text-gray-800">{runResult.processed}</p>
                      <p className="text-[9px] text-gray-500">Evaluated</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-emerald-600">{runResult.sent}</p>
                      <p className="text-[9px] text-gray-500">Opened</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-gray-400">{runResult.skipped}</p>
                      <p className="text-[9px] text-gray-500">Skipped</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-red-500">{runResult.errors}</p>
                      <p className="text-[9px] text-gray-500">Errors</p>
                    </div>
                  </div>
                  {runResult.blockedByQuietHours && (
                    <p className="text-[10px] text-orange-600 mt-2 flex items-center gap-1">
                      <Moon className="w-3 h-3" /> Quiet hours active — adjust in Settings to send now
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* How it works */}
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <Zap className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-blue-700 leading-relaxed space-y-1">
                <p><span className="font-semibold">How it works:</span> Click <strong>Run</strong> to evaluate all customers. Eligible customers appear in the Queue.</p>
                <p>In <strong>WhatsApp Web Mode</strong>, clicking Send (or Run) opens WhatsApp with a personalised message pre-filled. You confirm before it sends.</p>
                <p>Settings control quiet hours, daily limits, and opt-out rules. Customer opt-outs from Customer Listing are always respected.</p>
              </div>
            </div>
          </>
        )}

        {/* ── Queue ────────────────────────────────────────────────────────── */}
        {panelTab === "queue" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-indigo-500" /> Follow-Up Queue
                {queue.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[9px] font-bold rounded-full">{queue.length}</span>
                )}
              </h2>
              <span className="text-[10px] text-gray-400">Opens WhatsApp — confirm before sending</span>
            </div>

            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400">
                <CheckCircle className="w-10 h-10 mb-3 text-emerald-400" />
                <p className="text-sm font-semibold text-gray-600">All caught up!</p>
                <p className="text-xs mt-1">No follow-ups pending today. Check back tomorrow.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {queue.map(item => (
                    <QueueCard key={item.customer.key} item={item} onSent={handleSent} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}

        {/* ── Log ──────────────────────────────────────────────────────────── */}
        {panelTab === "log" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800">Run Log ({runLog.length})</p>
              {runLog.length > 0 && (
                <button
                  type="button"
                  onClick={() => { clearRunLog(); setLogVersion(v => v + 1); }}
                  className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {runLog.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">
                No run logs yet. Click <strong>Run</strong> on the Overview tab to start.
              </p>
            ) : (
              <div className="space-y-1.5">
                {runLog.map((entry, i) => (
                  <RunLogRow key={i} entry={entry} />
                ))}
              </div>
            )}

            {/* Send log */}
            {sendLog.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-gray-700">Send History ({sendLog.length})</p>
                  <button
                    type="button"
                    onClick={() => { clearAutomationLog(); setLogVersion(v => v + 1); }}
                    className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Clear
                  </button>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {sendLog.slice(0, 50).map((e, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg">
                      <span className="text-xs">{TRIGGER_META[e.trigger]?.emoji ?? "📨"}</span>
                      <span className="text-xs font-medium text-gray-700 flex-1">{e.customerName}</span>
                      <TriggerBadge trigger={e.trigger} />
                      <span className="text-[9px] text-gray-400 shrink-0">
                        {new Date(e.sentAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Settings ─────────────────────────────────────────────────────── */}
        {panelTab === "settings" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-indigo-500" /> Automation Settings
              </p>
              <div className="flex items-center gap-2">
                {saveFeedback === "ok" && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
                    <CheckCircle className="w-3 h-3" /> Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => updateSettings({ ...DEFAULT_SETTINGS })}
                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Reset defaults
                </button>
              </div>
            </div>

            <SettingsPanel settings={settings} onChange={updateSettings} />
          </>
        )}
      </div>
    </div>
  );
}
