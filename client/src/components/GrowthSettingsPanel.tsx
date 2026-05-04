/**
 * GrowthSettingsPanel.tsx
 *
 * One-stop config panel for the Phase 1 growth features:
 *   - Razorpay payment gateway
 *   - Owner WhatsApp + AI Daily Digest
 *   - Post-order Feedback NPS
 *   - Birthday & Anniversary automation
 *
 * Uses /api/automation/config for read/write — same backing store
 * as the existing AutomationPanel, just exposed in an admin-friendly UI.
 */

import { useEffect, useState } from "react";
import {
  Loader2, CheckCircle2, ShieldCheck, Star, MessageSquare, Cake,
  CreditCard, Send, AlertTriangle, Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GrowthConfig {
  razorpayKeyId:           string;
  razorpayKeySecret:       string;
  razorpayWebhookSecret:   string;
  ownerWhatsappPhone:      string;
  dailyDigestEnabled:      boolean;
  dailyDigestHour:         number;
  feedbackEnabled:         boolean;
  feedbackDelayMinutes:    number;
  feedbackBaseUrl:         string;
  birthdayEnabled:         boolean;
  birthdayHour:            number;
  trackingBaseUrl:         string;
  anthropicApiKey:         string;
  metaPhoneNumberId:       string;
  metaAccessToken:         string;
}

const DEFAULT: GrowthConfig = {
  razorpayKeyId:         "",
  razorpayKeySecret:     "",
  razorpayWebhookSecret: "",
  ownerWhatsappPhone:    "",
  dailyDigestEnabled:    false,
  dailyDigestHour:       23,
  feedbackEnabled:       false,
  feedbackDelayMinutes:  120,
  feedbackBaseUrl:       "",
  birthdayEnabled:       false,
  birthdayHour:          9,
  trackingBaseUrl:       "",
  anthropicApiKey:       "",
  metaPhoneNumberId:     "",
  metaAccessToken:       "",
};

const inputCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 w-full bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white transition-colors";

export function GrowthSettingsPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [config, setConfig]   = useState<GrowthConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [digestPreview, setDigestPreview] = useState<string | null>(null);

  // Load
  useEffect(() => {
    fetch("/api/automation/config", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setConfig(prev => ({ ...prev, ...d }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof GrowthConfig>(key: K, value: GrowthConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/automation/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      toast({ title: "Settings saved", description: "Growth config updated" });
      onClose();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function action(label: string, url: string, body?: any) {
    setBusyAction(label);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Action failed");
      toast({ title: `${label} OK`, description: JSON.stringify(data).slice(0, 90) });
      return data;
    } catch (e: any) {
      toast({ title: `${label} failed`, description: e?.message, variant: "destructive" });
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function previewDigest() {
    setBusyAction("preview");
    try {
      const res = await fetch("/api/digest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Preview failed");
      setDigestPreview(data.summary ?? "");
    } catch (e: any) {
      toast({ title: "Preview failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Razorpay ── */}
      <Section icon={<CreditCard className="w-4 h-4 text-blue-600" />} title="Razorpay Payment Gateway">
        <p className="text-[11px] text-gray-500 mb-3">
          Get keys from Razorpay Dashboard → Account → API Keys.
        </p>
        <Field label="Key ID (rzp_live_… or rzp_test_…)">
          <input
            value={config.razorpayKeyId}
            onChange={e => set("razorpayKeyId", e.target.value.trim())}
            placeholder="rzp_test_XXXXXXXXXXXX"
            className={inputCls}
          />
        </Field>
        <Field label="Key Secret">
          <input
            type="password"
            value={config.razorpayKeySecret}
            onChange={e => set("razorpayKeySecret", e.target.value.trim())}
            placeholder={config.razorpayKeySecret === "***configured***" ? "(saved — type to replace)" : "secret"}
            className={inputCls}
          />
        </Field>
        <Field label="Webhook Secret (optional)">
          <input
            type="password"
            value={config.razorpayWebhookSecret}
            onChange={e => set("razorpayWebhookSecret", e.target.value.trim())}
            placeholder={config.razorpayWebhookSecret === "***configured***" ? "(saved — type to replace)" : "for /api/razorpay/webhook"}
            className={inputCls}
          />
        </Field>
      </Section>

      {/* ── Daily AI Digest ── */}
      <Section icon={<Send className="w-4 h-4 text-emerald-600" />} title="AI Daily Digest to Owner">
        <Toggle
          label="Send daily WhatsApp digest"
          checked={config.dailyDigestEnabled}
          onChange={v => set("dailyDigestEnabled", v)}
        />
        <Field label="Owner WhatsApp number (with country code, e.g. 919876543210)">
          <input
            value={config.ownerWhatsappPhone}
            onChange={e => set("ownerWhatsappPhone", e.target.value.replace(/\D/g, ""))}
            placeholder="919876543210"
            className={inputCls}
          />
        </Field>
        <Field label={`Send hour (24h, default 23) — currently ${config.dailyDigestHour}:00`}>
          <input
            type="number"
            min={0}
            max={23}
            value={config.dailyDigestHour}
            onChange={e => set("dailyDigestHour", Math.max(0, Math.min(23, Number(e.target.value) || 23)))}
            className={inputCls}
          />
        </Field>
        <p className="text-[11px] text-gray-500 mt-1">
          Uses Anthropic Claude (if API key set) or a deterministic template as fallback.
          Requires WhatsApp provider (Meta or WATI) configured.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={previewDigest}
            disabled={busyAction === "preview"}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
          >
            {busyAction === "preview" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
            Preview today's digest
          </button>
          <button
            onClick={() => action("Send digest now", "/api/digest/run", { dryRun: false })}
            disabled={busyAction === "Send digest now"}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            {busyAction === "Send digest now" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Send now
          </button>
        </div>
        {digestPreview && (
          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs whitespace-pre-wrap font-mono text-gray-700 max-h-48 overflow-y-auto">
            {digestPreview}
          </div>
        )}
      </Section>

      {/* ── Feedback NPS ── */}
      <Section icon={<MessageSquare className="w-4 h-4 text-amber-600" />} title="Post-Order Feedback (NPS)">
        <Toggle
          label="Auto-send feedback request after payment"
          checked={config.feedbackEnabled}
          onChange={v => set("feedbackEnabled", v)}
        />
        <Field label="Delay after payment (minutes)">
          <input
            type="number"
            min={5}
            max={1440}
            value={config.feedbackDelayMinutes}
            onChange={e => set("feedbackDelayMinutes", Math.max(5, Math.min(1440, Number(e.target.value) || 120)))}
            className={inputCls}
          />
        </Field>
        <Field label="Public feedback base URL (e.g. https://yourpos.com)">
          <input
            value={config.feedbackBaseUrl}
            onChange={e => set("feedbackBaseUrl", e.target.value.trim())}
            placeholder="https://yourpos.com"
            className={inputCls}
          />
        </Field>
        <p className="text-[11px] text-gray-500 mt-1">
          Customers receive a token-gated link to <code>/feedback/:token</code>.
          Ratings ≤3 auto-issue a ₹100 recovery coupon.
        </p>
        <button
          onClick={() => action("Process pending", "/api/feedback/process-pending")}
          disabled={busyAction === "Process pending"}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
        >
          {busyAction === "Process pending" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Send pending feedback now
        </button>
      </Section>

      {/* ── Birthday automation ── */}
      <Section icon={<Cake className="w-4 h-4 text-pink-600" />} title="Birthday & Anniversary">
        <Toggle
          label="Enable daily birthday + anniversary scan"
          checked={config.birthdayEnabled}
          onChange={v => set("birthdayEnabled", v)}
        />
        <Field label={`Send hour (24h, default 9) — currently ${config.birthdayHour}:00`}>
          <input
            type="number"
            min={0}
            max={23}
            value={config.birthdayHour}
            onChange={e => set("birthdayHour", Math.max(0, Math.min(23, Number(e.target.value) || 9)))}
            className={inputCls}
          />
        </Field>
        <p className="text-[11px] text-gray-500 mt-1">
          Reads <code>customer_profiles.dob</code> & <code>anniversary</code> matching today's MM-DD.
          Auto-issues a coupon (15% off birthday / 20% off anniversary) and sends WhatsApp wish.
        </p>
        <button
          onClick={() => action("Run birthday scan", "/api/automation/birthday/run")}
          disabled={busyAction === "Run birthday scan"}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-pink-700 border border-pink-200 bg-pink-50 rounded-lg hover:bg-pink-100 transition-colors disabled:opacity-50"
        >
          {busyAction === "Run birthday scan" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cake className="w-3 h-3" />}
          Run scan now
        </button>
      </Section>

      {/* ── Save ── */}
      <button
        onClick={save}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        {saving ? "Saving..." : "Save Growth Settings"}
      </button>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-[11px] text-blue-700">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          WhatsApp sending requires Meta Cloud API or WATI credentials in the AutomationPanel
          (Customers tab). Without them, messages run in dry-run mode.
        </span>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5">
        {icon}
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</p>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-gray-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full p-2.5 rounded-lg border border-gray-200 bg-white hover:border-emerald-300 transition-colors"
    >
      <span className="text-sm text-gray-700">{label}</span>
      <span
        className={`relative w-10 h-6 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-gray-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </span>
    </button>
  );
}
