/**
 * WhatsAppConnectionCard.tsx — Setup-tab card for the automated WhatsApp driver.
 *
 * Pairs the Baileys driver via QR, switches drivers (Baileys / Meta Cloud / Off),
 * and exposes the auto-send + chatbot settings. Self-contained: reads and saves
 * automation-config fields directly via /api/automation/config.
 */

import { apiUrl } from "@/lib/api";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle, Loader2, LogOut, RefreshCw, Bot, Zap, ShieldAlert, QrCode,
} from "lucide-react";
import { useWhatsAppStatus } from "@/hooks/useConversations";

type DriverName = "baileys" | "meta" | "none";

interface WaConfig {
  whatsappAutoSend: boolean;
  botEnabled: boolean;
  botReturnMinutes: number;
  maxPerDay: number;
  botHoursText: string;
  menuUrl: string;
  menuText: string;
}

const DEFAULT_WA_CONFIG: WaConfig = {
  whatsappAutoSend: false,
  botEnabled: true,
  botReturnMinutes: 30,
  maxPerDay: 100,
  botHoursText: "",
  menuUrl: "",
  menuText: "",
};

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${value ? "bg-green-500" : "bg-gray-300"}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

const STATE_LABELS: Record<string, { label: string; cls: string }> = {
  connected:    { label: "Connected",        cls: "bg-green-100 text-green-700" },
  connecting:   { label: "Connecting…",      cls: "bg-blue-100 text-blue-600" },
  qr_pending:   { label: "Scan QR to pair",  cls: "bg-amber-100 text-amber-700" },
  disconnected: { label: "Disconnected",     cls: "bg-gray-100 text-gray-500" },
};

export function WhatsAppConnectionCard() {
  const { status } = useWhatsAppStatus();
  const queryClient = useQueryClient();

  const [config, setConfig] = useState<WaConfig>(DEFAULT_WA_CONFIG);
  const [busy, setBusy] = useState<"connect" | "logout" | "driver" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/automation/config"), { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return;
        setConfig({
          whatsappAutoSend: d.whatsappAutoSend ?? false,
          botEnabled:       d.botEnabled ?? true,
          botReturnMinutes: d.botReturnMinutes ?? 30,
          maxPerDay:        d.maxPerDay ?? 100,
          botHoursText:     d.botHoursText ?? "",
          menuUrl:          d.menuUrl ?? "",
          menuText:         d.menuText ?? "",
        });
      })
      .catch(() => {});
  }, []);

  const saveConfig = (patch: Partial<WaConfig>) => {
    const updated = { ...config, ...patch };
    setConfig(updated);
    fetch(apiUrl("/api/automation/config"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  };

  const post = async (path: string, body?: unknown, busyKey?: typeof busy) => {
    if (busyKey) setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(apiUrl(path), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? `Request failed (${res.status})`);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
    } catch (e: any) {
      setError(e?.message ?? "Request failed");
    } finally {
      setBusy(null);
    }
  };

  const driver = status?.driver ?? "none";
  const state = status?.state ?? "disconnected";
  const stateInfo = STATE_LABELS[state] ?? STATE_LABELS.disconnected;

  return (
    <div className="border border-green-200 bg-green-50/50 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <MessageCircle className="w-4 h-4 text-green-600" /> WhatsApp Connection (Automated)
        </p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${stateInfo.cls}`}>
          {stateInfo.label}
        </span>
      </div>
      <p className="text-[10px] text-gray-500 leading-relaxed -mt-2">
        Powers fully automatic sending, the FAQ chatbot, and the Conversations inbox.
        Baileys pairs with your existing WhatsApp number via QR — no Meta account needed.
      </p>

      {/* Driver selector */}
      <div className="flex gap-2">
        {([
          { key: "none",    label: "Off" },
          { key: "baileys", label: "Baileys (QR pairing)" },
          { key: "meta",    label: "Meta Cloud API" },
        ] as { key: DriverName; label: string }[]).map(d => (
          <button
            key={d.key}
            type="button"
            disabled={busy !== null}
            onClick={() => post("/api/whatsapp/driver", { driver: d.key }, "driver")}
            className={`flex-1 px-2 py-2 rounded-lg border text-[11px] font-semibold transition-all ${
              driver === d.key
                ? "border-green-400 bg-green-100 text-green-800"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
            }`}
          >
            {busy === "driver" ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : d.label}
          </button>
        ))}
      </div>

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {/* QR pairing */}
      {driver === "baileys" && state === "qr_pending" && status?.qrDataUrl && (
        <div className="flex flex-col items-center gap-2 p-3 bg-white rounded-xl border border-gray-200">
          <p className="text-[10px] font-semibold text-gray-600 flex items-center gap-1">
            <QrCode className="w-3 h-3" /> Open WhatsApp → Linked devices → Link a device
          </p>
          <img src={status.qrDataUrl} alt="WhatsApp pairing QR" className="w-56 h-56" />
          <p className="text-[9px] text-gray-400">QR refreshes automatically. Keep this page open while scanning.</p>
        </div>
      )}

      {/* Connect / Logout */}
      {driver !== "none" && (
        <div className="flex gap-2">
          {state === "disconnected" && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post("/api/whatsapp/connect", undefined, "connect")}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {busy === "connect" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Connect
            </button>
          )}
          {(state === "connected" || state === "qr_pending") && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post("/api/whatsapp/logout", undefined, "logout")}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {busy === "logout" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
              Unpair / Logout
            </button>
          )}
        </div>
      )}

      {/* Auto-send + bot settings */}
      <div className="space-y-3 pt-1 border-t border-green-100">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-gray-700 flex items-center gap-1"><Zap className="w-3 h-3 text-purple-500" /> Auto-send follow-ups</p>
            <p className="text-[9px] text-gray-400">Automation messages send by themselves through this connection. Off = manual Send tab.</p>
          </div>
          <Toggle value={config.whatsappAutoSend} onChange={v => saveConfig({ whatsappAutoSend: v })} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-gray-700 flex items-center gap-1"><Bot className="w-3 h-3 text-blue-500" /> FAQ chatbot</p>
            <p className="text-[9px] text-gray-400">Auto-replies to hours / menu / location questions; hands off to staff on request.</p>
          </div>
          <Toggle value={config.botEnabled} onChange={v => saveConfig({ botEnabled: v })} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">Return to bot after (min)</label>
            <input
              type="number" min={5} max={720} value={config.botReturnMinutes}
              onChange={e => saveConfig({ botReturnMinutes: Math.max(5, Number(e.target.value) || 30) })}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-green-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">Max messages / day</label>
            <input
              type="number" min={1} max={1000} value={config.maxPerDay}
              onChange={e => saveConfig({ maxPerDay: Math.max(1, Number(e.target.value) || 100) })}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-green-400"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-gray-600 mb-1">Opening hours (bot answer)</label>
          <input
            type="text" placeholder="e.g. 12pm – 11pm, all days" value={config.botHoursText}
            onChange={e => setConfig(c => ({ ...c, botHoursText: e.target.value }))}
            onBlur={e => saveConfig({ botHoursText: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-green-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-600 mb-1">Menu link (sent by bot)</label>
          <input
            type="text" placeholder="https://… (PDF / website / Google Drive)" value={config.menuUrl}
            onChange={e => setConfig(c => ({ ...c, menuUrl: e.target.value }))}
            onBlur={e => saveConfig({ menuUrl: e.target.value })}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-green-400"
          />
        </div>
      </div>

      {/* Ban-avoidance notice */}
      <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-[9px] text-amber-700 leading-relaxed">
          Baileys is an unofficial integration — WhatsApp can ban numbers that spam.
          Keep the daily cap low (start ~20/day for a fresh number and increase slowly over 2 weeks),
          only message customers who have ordered from you, and the STOP keyword is always honored automatically.
        </p>
      </div>
    </div>
  );
}
