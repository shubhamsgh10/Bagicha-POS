/**
 * AutomationPanel.tsx
 *
 * Client-side AI Customer Follow-Up Automation.
 * ALL core functionality runs in the browser — no server dependency for web mode.
 *
 * Settings  → localStorage ("bagicha_automation_settings") + server sync for API mode
 * Run log   → localStorage ("bagicha_automation_logs")
 * Send log  → localStorage ("bagicha_automation_log")
 * WhatsApp  → wa.me links (web mode) or WATI API via server (api mode)
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, CheckCircle, Zap, MessageSquare, ChevronDown, ChevronUp,
  RotateCcw, Phone, History, Settings, BarChart2,
  Play, Wifi, WifiOff, Bot, AlertTriangle, Loader2,
  Moon, Clock, Shield, Bell, Sliders, Key, Globe,
  Star, UserPlus, RefreshCw, Info,
} from "lucide-react";
import { type CustomerProfile } from "@/hooks/useCustomerIntelligence";
import {
  buildFollowUpQueue,
  logMessageSent,
  loadAutomationLog,
  clearAutomationLog,
  TRIGGER_LABELS,
  type FollowUpItem,
  type TriggerType,
  loadAutomationSettings,
  getAutomationSettings,
  saveAutomationSettings,
  type AutomationSettings,
  DEFAULT_SETTINGS,
  loadRunLog,
  clearRunLog,
  type RunLogEntry,
  runCustomerAutomation,
  type RunResult,
  getAutomationProvider,
  isInQuietHours,
  syncSettingsToServer,
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

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: number | string; sub?: string; color: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex flex-col gap-0.5 ${color}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-xl font-bold leading-none">{value}</span>
      {sub && <span className="text-[9px] opacity-60">{sub}</span>}
    </div>
  );
}

function Toggle({
  value, onChange, disabled,
}: {
  value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${value ? "bg-green-500" : "bg-gray-300"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          value ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ── Queue card ────────────────────────────────────────────────────────────────

function QueueCard({
  item, onSent,
}: {
  item: FollowUpItem; onSent: (item: FollowUpItem) => void;
}) {
  const [expanded, setExpanded]   = useState(false);
  const [editedMsg, setEditedMsg] = useState(item.message);
  const [sent, setSent]           = useState(false);

  const handleSend = useCallback(() => {
    if (!item.customer.phone) return;
    const digits = item.customer.phone.replace(/\D/g, "");
    const phone  = digits.startsWith("91") ? digits : `91${digits}`;
    if (phone.length < 12) return;

    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(editedMsg)}`,
      "_blank",
      "noopener,noreferrer"
    );
    logMessageSent(item.customer.key, item.customer.name, item.trigger as TriggerType, editedMsg, "web");
    setSent(true);
    setTimeout(() => onSent(item), 700);
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
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
              {item.channel === "meta" ? "🔵 Meta" : item.channel === "wati" ? "🤖 WATI" : "🌐 Web"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
            <Phone className="w-2.5 h-2.5" />
            {item.customer.phone || "No phone"} · {item.customer.daysSinceLastVisit}d ago · {item.customer.totalVisits} visits
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
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
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-gray-100"
          >
            <div className="px-4 py-3 bg-gray-50">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Edit message before sending
              </p>
              <textarea
                value={editedMsg}
                onChange={e => setEditedMsg(e.target.value)}
                rows={4}
                className="w-full text-xs text-gray-800 bg-white border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-green-400"
              />
              <p className="text-[9px] text-gray-400 mt-1">
                Opens WhatsApp with this message pre-filled. You confirm before it sends.
              </p>
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
  const time = new Date(entry.timestamp).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50"
        onClick={() => setShow(s => !s)}
      >
        <span
          className={`text-xs font-bold px-1.5 py-0.5 rounded ${
            entry.type === "success"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-red-100 text-red-600"
          }`}
        >
          {entry.type === "success" ? "✓" : "✗"}
        </span>
        <div className="flex-1 min-w-0">
          {entry.type === "success" ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium text-gray-800 truncate">{entry.customerName}</span>
              {meta && <TriggerBadge trigger={entry.trigger!} />}
              {entry.provider && (
                <span className="text-[9px] text-gray-400">
                  {entry.provider === "wati" ? "🤖 WATI" : "🌐 Web"}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-red-600 truncate">{entry.errorMessage}</span>
          )}
        </div>
        <span className="text-[9px] text-gray-400 shrink-0">{time}</span>
        {show ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
      </div>
      {show && entry.message && (
        <div className="px-3 pb-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-600">
          {entry.message}
        </div>
      )}
    </div>
  );
}

// ── Server log row (from /api/automation/logs) ────────────────────────────────

interface ServerLog {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  trigger: string;
  message: string;
  sentAt: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

function ServerLogRow({ entry }: { entry: ServerLog }) {
  const [show, setShow] = useState(false);
  const meta = TRIGGER_META[entry.trigger] ?? { emoji: "📨", label: entry.trigger };
  const time = new Date(entry.sentAt).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50"
        onClick={() => setShow(s => !s)}
      >
        <span
          className={`text-xs font-bold px-1.5 py-0.5 rounded ${
            entry.status === "sent"
              ? "bg-emerald-100 text-emerald-700"
              : entry.status === "failed"
              ? "bg-red-100 text-red-600"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {entry.status === "sent" ? "✓" : entry.status === "failed" ? "✗" : "—"}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-gray-800 truncate">{entry.customerName}</span>
          <TriggerBadge trigger={entry.trigger} />
          <span className="text-[9px] text-gray-400">🤖 WATI</span>
        </div>
        <span className="text-[9px] text-gray-400 shrink-0">{time}</span>
        {show ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
      </div>
      {show && (
        <div className="px-3 pb-2 bg-gray-50 border-t border-gray-100 space-y-1">
          {entry.message && (
            <p className="text-[10px] text-gray-600">{entry.message}</p>
          )}
          {entry.error && (
            <p className="text-[10px] text-red-600">Error: {entry.error}</p>
          )}
          <p className="text-[9px] text-gray-400">📞 {entry.phone}</p>
        </div>
      )}
    </div>
  );
}

// ── Settings panel ─────────────────────────────────────────────────────────────

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: AutomationSettings;
  onChange: (s: AutomationSettings) => void;
}) {
  const set = <K extends keyof AutomationSettings>(key: K, val: AutomationSettings[K]) =>
    onChange({ ...settings, [key]: val });

  const [watiSyncStatus, setWatiSyncStatus] = useState<"idle" | "syncing" | "ok" | "error">("idle");

  const handleWatiSync = async () => {
    // Guard: ensure the active mode's credentials are present
    if (settings.whatsappMode === "meta") {
      if (!settings.metaPhoneNumberId || !settings.metaAccessToken) return;
    } else {
      if (!settings.watiApiKey || !settings.watiEndpoint) return;
    }
    setWatiSyncStatus("syncing");
    try {
      await syncSettingsToServer(settings);
      setWatiSyncStatus("ok");
      setTimeout(() => setWatiSyncStatus("idle"), 3000);
    } catch (e: any) {
      setWatiSyncStatus("error");
      setTimeout(() => setWatiSyncStatus("idle"), 4000);
    }
  };

  return (
    <div className="space-y-5">

      {/* ── Master toggle ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-green-500" /> Automation Engine
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            Master switch — when OFF, Run button is blocked
          </p>
        </div>
        <Toggle value={settings.enabled} onChange={v => set("enabled", v)} />
      </div>

      {/* ── Auto-off toggle ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <Moon className="w-4 h-4 text-slate-500" /> Auto-Off During Quiet Hours
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            Automatically disable automation during quiet hours and re-enable after
          </p>
        </div>
        <Toggle value={settings.autoOff} onChange={v => set("autoOff", v)} />
      </div>

      {/* ── WhatsApp mode ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-green-500" /> WhatsApp Mode
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(["web", "meta", "api"] as const).map(mode => (
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
              {mode === "web"  ? "🌐 WhatsApp Web" :
               mode === "meta" ? "🔵 Meta API"      : "🤖 WATI API"}
              <p className="text-[9px] font-normal mt-0.5 opacity-70">
                {mode === "web"  ? "Opens wa.me — free, no key needed" :
                 mode === "meta" ? "Direct Meta Cloud API — your App ID" :
                                   "Sends via WATI — third party"}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Meta WhatsApp Cloud API configuration ───────────────────────── */}
      {settings.whatsappMode === "meta" && (
        <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
            🔵 Meta WhatsApp Cloud API
          </p>
          <div className="text-[10px] text-blue-700 bg-blue-100 rounded-lg px-3 py-2 leading-relaxed space-y-1">
            <p><strong>Where to find these values:</strong></p>
            <p>1. Go to <strong>developers.facebook.com → Your App → WhatsApp → Getting Started</strong></p>
            <p>2. <strong>Phone Number ID</strong> — shown under "From" phone number</p>
            <p>3. <strong>Access Token</strong> — temporary token shown on that page, or generate a permanent System User token from Meta Business Suite</p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Phone Number ID
            </label>
            <input
              type="text"
              placeholder="e.g. 123456789012345"
              value={settings.metaPhoneNumberId}
              onChange={e => set("metaPhoneNumberId", e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white font-mono"
            />
            <p className="text-[9px] text-gray-400 mt-0.5">
              Found in Meta Developer Console → WhatsApp → Getting Started
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Key className="w-3 h-3" /> Access Token
            </label>
            <input
              type="password"
              placeholder="EAAxxxxxxxxxxxxxxxxxxxxx…"
              value={settings.metaAccessToken}
              onChange={e => set("metaAccessToken", e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            />
            <p className="text-[9px] text-gray-400 mt-0.5">
              Temporary token (expires in ~24h) or permanent System User token
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleWatiSync}
              disabled={!settings.metaPhoneNumberId || !settings.metaAccessToken || watiSyncStatus === "syncing"}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {watiSyncStatus === "syncing"
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                : <><RefreshCw className="w-3 h-3" /> Save to Server</>}
            </button>
            {watiSyncStatus === "ok" && (
              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Saved
              </span>
            )}
            {watiSyncStatus === "error" && (
              <span className="text-[10px] text-red-600 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Save failed — check server
              </span>
            )}
          </div>
          <div className="text-[10px] text-blue-700 flex items-start gap-1.5 bg-blue-100 rounded-lg px-3 py-2">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              <strong>Important:</strong> Meta only allows free-form text messages within 24 hours of
              the customer last messaging you. For cold outreach you need a{" "}
              <strong>Meta-approved template message</strong>. Enable Template Mode above to use templates.
            </span>
          </div>
          {(!settings.metaPhoneNumberId || !settings.metaAccessToken) && (
            <p className="text-[10px] text-blue-700 flex items-start gap-1.5">
              <Info className="w-3 h-3 shrink-0 mt-0.5" />
              Both Phone Number ID and Access Token are required.
            </p>
          )}
        </div>
      )}

      {/* ── WATI API configuration (shown when api mode is active) ──────── */}
      {settings.whatsappMode === "api" && (
        <div className="border border-orange-200 bg-orange-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-orange-800 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5" /> WATI API Configuration
          </p>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Globe className="w-3 h-3" /> API Endpoint
            </label>
            <input
              type="text"
              placeholder="https://live-mt-server.wati.io/YOUR_ACCOUNT_ID"
              value={settings.watiEndpoint}
              onChange={e => set("watiEndpoint", e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Key className="w-3 h-3" /> API Key (Bearer Token)
            </label>
            <input
              type="password"
              placeholder="Your WATI API key"
              value={settings.watiApiKey}
              onChange={e => set("watiApiKey", e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleWatiSync}
              disabled={!settings.watiApiKey || !settings.watiEndpoint || watiSyncStatus === "syncing"}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {watiSyncStatus === "syncing"
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Syncing…</>
                : <><RefreshCw className="w-3 h-3" /> Sync to Server</>}
            </button>
            {watiSyncStatus === "ok" && (
              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Synced
              </span>
            )}
            {watiSyncStatus === "error" && (
              <span className="text-[10px] text-red-600 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Sync failed — check server
              </span>
            )}
          </div>
          {(!settings.watiApiKey || !settings.watiEndpoint) && (
            <p className="text-[10px] text-orange-700 flex items-start gap-1.5">
              <Info className="w-3 h-3 shrink-0 mt-0.5" />
              Both fields are required for API mode to send messages.
            </p>
          )}
        </div>
      )}

      {/* ── Template / AI mode ────────────────────────────────────────── */}
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

      {/* ── Trigger toggles ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-indigo-500" /> Trigger Controls
        </p>
        <div className="space-y-2">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
            <div className="flex items-center gap-2">
              <Star className="w-3.5 h-3.5 text-amber-500" />
              <div>
                <p className="text-xs font-semibold text-gray-700">VIP Reward Trigger</p>
                <p className="text-[9px] text-gray-400">Send loyalty rewards to VIP customers</p>
              </div>
            </div>
            <Toggle value={settings.vipEnabled} onChange={v => set("vipEnabled", v)} />
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
            <div className="flex items-center gap-2">
              <UserPlus className="w-3.5 h-3.5 text-emerald-500" />
              <div>
                <p className="text-xs font-semibold text-gray-700">Welcome Message</p>
                <p className="text-[9px] text-gray-400">Send welcome offer to new customers after 1st visit</p>
              </div>
            </div>
            <Toggle value={settings.welcomeEnabled} onChange={v => set("welcomeEnabled", v)} />
          </div>
        </div>
      </div>

      {/* ── Numeric settings grid ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">
            <Shield className="w-3 h-3" /> Max Per Run
          </label>
          <input
            type="number" min={1} max={200} value={settings.maxPerRun}
            onChange={e => set("maxPerRun", +e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <p className="text-[9px] text-gray-400 mt-1">Messages per single run</p>
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
        <div>
          <label className="block text-[10px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Cooldown (hours)
          </label>
          <input
            type="number" min={1} max={720} value={settings.cooldownHours}
            onChange={e => set("cooldownHours", +e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <p className="text-[9px] text-gray-400 mt-1">Min hours between msgs per customer</p>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">
            <Shield className="w-3 h-3" /> Daily Limit
          </label>
          <input
            type="number" min={1} max={200} value={settings.dailyLimit}
            onChange={e => set("dailyLimit", +e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <p className="text-[9px] text-gray-400 mt-1">Max total messages per day</p>
        </div>
      </div>

      {/* ── Quiet hours ────────────────────────────────────────────────── */}
      <div>
        <label className="block text-[10px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide flex items-center gap-1">
          <Moon className="w-3 h-3" /> Quiet Hours (no messages sent in this window)
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
          {isInQuietHours(settings.quietHours) && (
            <span className="ml-1 text-orange-500 font-semibold">⚠ ACTIVE NOW</span>
          )}
        </p>
      </div>

      {/* ── Opt-out reminder ───────────────────────────────────────────── */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <Bell className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-700 leading-relaxed">
          <span className="font-semibold">Opt-out rules are always enforced</span> — customers
          with "Do Not Send Updates" or notifications disabled in Customer Listing are
          automatically skipped, regardless of these settings.
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
  const [settings, setSettingsState] = useState<AutomationSettings>(
    () => loadAutomationSettings()
  );

  // Run state
  const [running, setRunning]     = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError]   = useState<string | null>(null);
  const runningRef                = useRef(false);

  // Settings save feedback
  const [saveFeedback, setSaveFeedback] = useState<"ok" | null>(null);

  // Server logs (API mode only)
  const [serverLogs, setServerLogs]         = useState<ServerLog[]>([]);
  const [serverLogsLoading, setServerLogsLoading] = useState(false);

  // Update settings: save to localStorage immediately
  const updateSettings = useCallback((newSettings: AutomationSettings) => {
    setSettingsState(newSettings);
    saveAutomationSettings(newSettings);
    setSaveFeedback("ok");
    setTimeout(() => setSaveFeedback(null), 2500);
  }, []);

  // Queue (client-side, always works)
  const queue = useMemo(
    () =>
      buildFollowUpQueue(customers, extras, undefined, settings).filter(
        i => !sentKeys.has(i.customer.key)
      ),
    [customers, extras, sentKeys, settings]
  );

  const handleSent = useCallback((item: FollowUpItem) => {
    setSentKeys(prev => { const s = new Set(prev); s.add(item.customer.key); return s; });
    setLogVersion(v => v + 1);
  }, []);

  // Local logs (always shown)
  const runLog  = useMemo(() => loadRunLog(),                          [logVersion]);
  const sendLog = useMemo(() => loadAutomationLog().slice().reverse(), [logVersion]);

  // Load server logs when in API mode and Log tab is open
  const fetchServerLogs = useCallback(async () => {
    if (settings.whatsappMode !== "api" && settings.whatsappMode !== "meta") return;
    setServerLogsLoading(true);
    try {
      const resp = await fetch("/api/automation/logs?limit=100", { credentials: "include" });
      if (resp.ok) {
        const data = await resp.json() as { logs?: ServerLog[] };
        setServerLogs(data.logs ?? []);
      }
    } catch {
      // silent — server logs are supplemental
    } finally {
      setServerLogsLoading(false);
    }
  }, [settings.whatsappMode]);

  useEffect(() => {
    if (panelTab === "log" && (settings.whatsappMode === "api" || settings.whatsappMode === "meta")) {
      fetchServerLogs();
    }
  }, [panelTab, settings.whatsappMode, fetchServerLogs, logVersion]);

  // Stats
  const today     = new Date().toDateString();
  const sentToday = sendLog.filter(e => new Date(e.sentAt).toDateString() === today).length;
  const atRisk    = customers.filter(c => c.tag === "At Risk").length;
  const vip       = customers.filter(c => c.tag === "VIP").length;

  // Provider status
  const provider         = getAutomationProvider(settings);
  const quietHoursActive = isInQuietHours(settings.quietHours);

  // ── Run handler ──────────────────────────────────────────────────────────────

  const handleRunAutomation = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setRunResult(null);
    setRunError(null);

    try {
      const result = await runCustomerAutomation(customers, extras, settings);
      setRunResult(result);
      setLogVersion(v => v + 1);
      // Refresh server logs if in API mode
      if (settings.whatsappMode === "api") {
        fetchServerLogs();
      }
    } catch (err: any) {
      const msg = err?.message ?? "Automation failed — check Settings";
      setRunError(msg);
      setLogVersion(v => v + 1);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [customers, extras, settings, fetchServerLogs]);

  const TABS: { key: PanelTab; label: string; icon: any }[] = [
    { key: "overview",  label: "Overview",               icon: BarChart2 },
    { key: "queue",     label: `Queue (${queue.length})`, icon: MessageSquare },
    { key: "log",       label: `Log (${runLog.length})`,  icon: History },
    { key: "settings",  label: "Settings",               icon: Settings },
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

        {/* ── Overview ─────────────────────────────────────────────────── */}
        {panelTab === "overview" && (
          <>
            {/* Status badges */}
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
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border hover:opacity-80 ${
                  provider === "unconfigured"
                    ? "bg-red-50 text-red-600 border-red-200"
                    : settings.whatsappMode === "meta"
                    ? "bg-blue-50 text-blue-600 border-blue-200"
                    : "bg-orange-50 text-orange-600 border-orange-200"
                }`}
              >
                {settings.whatsappMode === "web"
                  ? "🌐 WhatsApp Web Mode"
                  : settings.whatsappMode === "meta"
                  ? provider === "unconfigured" ? "⚠️ Meta Not Configured" : "🔵 Meta Cloud API"
                  : provider === "unconfigured" ? "⚠️ WATI Not Configured" : "🤖 WATI API Mode"}
              </button>
              <button
                type="button"
                onClick={() => setPanelTab("settings")}
                title="Click to change in Settings"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-gray-100 text-gray-500 border-gray-200 hover:opacity-80"
              >
                <Bot className="w-3 h-3" />
                {settings.templateMode ? "Template Mode" : "Claude AI Mode"}
              </button>
              {quietHoursActive && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-orange-50 text-orange-600 border-orange-200">
                  <Moon className="w-3 h-3" /> Quiet Hours Active
                </span>
              )}
              <span className="text-[9px] text-gray-400 italic">↑ click any badge to change</span>
            </div>

            {/* Provider warning when unconfigured */}
            {provider === "unconfigured" && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="text-[11px] text-red-700 leading-relaxed">
                  {settings.whatsappMode === "meta" ? (
                    <>
                      <span className="font-semibold">Meta API credentials missing.</span> Go to{" "}
                      <button type="button" className="underline font-semibold" onClick={() => setPanelTab("settings")}>
                        Settings → Meta WhatsApp Cloud API
                      </button>{" "}
                      to add your Phone Number ID and Access Token.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">WATI API credentials missing.</span> Go to{" "}
                      <button type="button" className="underline font-semibold" onClick={() => setPanelTab("settings")}>
                        Settings → WATI API Configuration
                      </button>{" "}
                      to add them, or switch to WhatsApp Web mode.
                    </>
                  )}
                </div>
              </div>
            )}

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
                    {!settings.enabled
                      ? "Automation is OFF — enable it in Settings first"
                      : provider === "unconfigured"
                      ? `⚠️ Configure ${settings.whatsappMode === "meta" ? "Meta API" : "WATI"} credentials in Settings before running`
                      : quietHoursActive
                      ? `Quiet hours active (${settings.quietHours.start}:00 – ${settings.quietHours.end}:00)`
                      : `Evaluates all ${customers.length} customers · ${
                          settings.whatsappMode === "meta" ? "Sends via Meta WhatsApp Cloud API" :
                          settings.whatsappMode === "api"  ? "Sends via WATI API" :
                                                             "Opens WhatsApp for each eligible one"
                        }`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunAutomation}
                  disabled={
                    running ||
                    !settings.enabled ||
                    (settings.whatsappMode === "api" && provider === "unconfigured")
                  }
                  className={`flex items-center gap-1.5 px-4 py-2 text-white text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                    !settings.enabled ||
                    (settings.whatsappMode === "api" && provider === "unconfigured")
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

              {/* Run error */}
              {runError && (
                <div className="border-t border-red-100 px-4 py-3 bg-red-50 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 font-medium">{runError}</p>
                </div>
              )}

              {/* Run result */}
              {runResult && !runError && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Run Complete {runResult.mode === "api" ? "· WATI API" : "· WhatsApp Web"}
                  </p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold text-gray-800">{runResult.scanned}</p>
                      <p className="text-[9px] text-gray-500">Scanned</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-blue-600">{runResult.eligible}</p>
                      <p className="text-[9px] text-gray-500">Eligible</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-emerald-600">{runResult.sent}</p>
                      <p className="text-[9px] text-gray-500">Sent</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-red-500">{runResult.failed}</p>
                      <p className="text-[9px] text-gray-500">Failed</p>
                    </div>
                  </div>
                  {runResult.skipped > 0 && (
                    <p className="text-[10px] text-gray-400 mt-2">
                      {runResult.skipped} customer{runResult.skipped !== 1 ? "s" : ""} skipped
                      (no phone / opted out / cooldown)
                    </p>
                  )}
                  {runResult.dryRun !== undefined && runResult.dryRun > 0 && (
                    <p className="text-[10px] text-orange-600 mt-1">
                      ⚠ {runResult.dryRun} sent as dry-run (WATI not fully configured on server)
                    </p>
                  )}
                  {runResult.blockedByQuietHours && (
                    <p className="text-[10px] text-orange-600 mt-2 flex items-center gap-1">
                      <Moon className="w-3 h-3" /> Quiet hours active — adjust in Settings to send now
                    </p>
                  )}
                  {runResult.failures.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[10px] text-red-600 cursor-pointer">
                        {runResult.failures.length} failure{runResult.failures.length !== 1 ? "s" : ""} — click to expand
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {runResult.failures.map((f, i) => (
                          <li key={i} className="text-[10px] text-red-600">
                            • {f.name}: {f.error}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* How it works */}
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <Zap className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-blue-700 leading-relaxed space-y-1">
                <p>
                  <span className="font-semibold">How it works:</span> Click{" "}
                  <strong>Run</strong> to evaluate all customers. Eligible customers
                  appear in the Queue tab.
                </p>
                <p>
                  In <strong>WhatsApp Web Mode</strong>, clicking Run opens WhatsApp
                  with a personalised message pre-filled. You confirm before it sends.
                </p>
                <p>
                  In <strong>WATI API Mode</strong>, messages are sent automatically
                  via the server. Add your WATI credentials in Settings.
                </p>
              </div>
            </div>
          </>
        )}

        {/* ── Queue ────────────────────────────────────────────────────── */}
        {panelTab === "queue" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-indigo-500" /> Follow-Up Queue
                {queue.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[9px] font-bold rounded-full">
                    {queue.length}
                  </span>
                )}
              </h2>
              <span className="text-[10px] text-gray-400">
                {settings.whatsappMode === "api"
                  ? "API mode — run from Overview to send via WATI"
                  : "Opens WhatsApp — confirm before sending"}
              </span>
            </div>

            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400">
                <CheckCircle className="w-10 h-10 mb-3 text-emerald-400" />
                <p className="text-sm font-semibold text-gray-600">All caught up!</p>
                <p className="text-xs mt-1">
                  No follow-ups pending today. Check cooldown settings if you expect customers here.
                </p>
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

        {/* ── Log ──────────────────────────────────────────────────────── */}
        {panelTab === "log" && (
          <>
            {/* Run log */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800">Run Log ({runLog.length})</p>
              <div className="flex items-center gap-2">
                {(settings.whatsappMode === "api" || settings.whatsappMode === "meta") && (
                  <button
                    type="button"
                    onClick={fetchServerLogs}
                    disabled={serverLogsLoading}
                    className="text-[10px] text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
                  >
                    {serverLogsLoading
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                      : <><RefreshCw className="w-3 h-3" /> Refresh server logs</>}
                  </button>
                )}
                {runLog.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { clearRunLog(); setLogVersion(v => v + 1); }}
                    className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Clear local
                  </button>
                )}
              </div>
            </div>

            {runLog.length === 0 && serverLogs.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">
                No run logs yet. Click <strong>Run</strong> on the Overview tab to start.
              </p>
            ) : (
              <div className="space-y-1.5">
                {runLog.map((entry, i) => (
                  <RunLogRow key={`local-${i}`} entry={entry} />
                ))}
              </div>
            )}

            {/* Server logs (API mode) */}
            {(settings.whatsappMode === "api" || settings.whatsappMode === "meta") && serverLogs.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                  {settings.whatsappMode === "meta" ? "🔵" : "🤖"} Server Automation Log ({serverLogs.length})
                  <span className="text-[9px] font-normal text-gray-400">
                    from {settings.whatsappMode === "meta" ? "Meta Cloud API" : "WATI"} runs
                  </span>
                </p>
                <div className="space-y-1.5">
                  {serverLogs.map(entry => (
                    <ServerLogRow key={entry.id} entry={entry} />
                  ))}
                </div>
              </div>
            )}

            {/* Send history */}
            {sendLog.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-gray-700">
                    Send History ({sendLog.length})
                  </p>
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
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg"
                    >
                      <span className="text-xs">{TRIGGER_META[e.trigger]?.emoji ?? "📨"}</span>
                      <span className="text-xs font-medium text-gray-700 flex-1">{e.customerName}</span>
                      <TriggerBadge trigger={e.trigger} />
                      {e.channel && (
                        <span className="text-[9px] text-gray-400">
                          {e.channel === "meta" ? "🔵" : e.channel === "wati" ? "🤖" : "🌐"}
                        </span>
                      )}
                      <span className="text-[9px] text-gray-400 shrink-0">
                        {new Date(e.sentAt).toLocaleString("en-IN", {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Settings ─────────────────────────────────────────────────── */}
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
