import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Fingerprint, Wifi, Save, Loader2, CheckCircle2, XCircle, Info, Activity,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AttendanceStatus, AttendanceTestResult } from "@shared/electron/ipc";

interface DeviceCfg {
  enabled: boolean;
  ip: string;
  port: number;
  commKey: number;
  standardHours: number;
  syncIntervalSec: number;
}

const DEFAULTS: DeviceCfg = { enabled: false, ip: "", port: 4370, commKey: 0, standardHours: 8, syncIntervalSec: 60 };

const glass: React.CSSProperties = {
  background: "var(--paper-0)",
  backdropFilter: "blur(20px) saturate(1.6)",
  WebkitBackdropFilter: "blur(20px) saturate(1.6)",
  border: "1px solid var(--line)",
  boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
};

const isElectron = typeof window !== "undefined" && !!window.electronAPI;

export function BiometricDevicePanel() {
  const { toast } = useToast();
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"], staleTime: 30_000 });
  const [form, setForm] = useState<DeviceCfg>(DEFAULTS);
  const [seeded, setSeeded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<AttendanceTestResult | null>(null);
  const [status, setStatus] = useState<AttendanceStatus | null>(null);

  // Seed the form once from saved settings
  useEffect(() => {
    if (seeded || !settings) return;
    setForm({ ...DEFAULTS, ...(settings.attendanceDevice ?? {}) });
    setSeeded(true);
  }, [settings, seeded]);

  // Poll the live agent status (desktop app only)
  const statusTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!isElectron) return;
    const tick = () => window.electronAPI!.attendance.status().then(setStatus).catch(() => {});
    tick();
    statusTimer.current = setInterval(tick, 4000);
    return () => { if (statusTimer.current) clearInterval(statusTimer.current); };
  }, []);

  const set = <K extends keyof DeviceCfg>(k: K, v: DeviceCfg[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings", { attendanceDevice: form });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      if (isElectron) await window.electronAPI!.attendance.refresh().catch(() => {});
      toast({ title: "Device settings saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!isElectron) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await window.electronAPI!.attendance.test(form);
      setTestResult(r);
      toast({
        title: r.ok ? "Device connected" : "Connection failed",
        description: r.ok ? `${r.info?.users ?? 0} users · ${r.info?.logs ?? 0} logs` : r.error,
        variant: r.ok ? "default" : "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ ...glass, borderRadius: 20, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(13,148,136,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Fingerprint size={18} color="#0d9488" />
        </div>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Fingerprint Device (K30 Pro)</h3>
          <p style={{ fontSize: 12, color: "#6b7280" }}>Punches sync automatically into attendance &amp; payroll.</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <StatusBadge status={status} enabled={form.enabled} isElectron={isElectron} />
        </div>
      </div>

      {/* config grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" style={{ marginTop: 14 }}>
        <Field label="Device IP" hint="static LAN IP">
          <Input value={form.ip} placeholder="192.168.1.150" onChange={(e) => set("ip", e.target.value.trim())} className="h-9" />
        </Field>
        <Field label="Port"><Input type="number" value={form.port} onChange={(e) => set("port", Number(e.target.value) || 4370)} className="h-9" /></Field>
        <Field label="Comm Key" hint="0 = none"><Input type="number" value={form.commKey} onChange={(e) => set("commKey", Number(e.target.value) || 0)} className="h-9" /></Field>
        <Field label="Std hours/day" hint="before overtime"><Input type="number" value={form.standardHours} onChange={(e) => set("standardHours", Number(e.target.value) || 8)} className="h-9" /></Field>
        <Field label="Sync interval (s)"><Input type="number" value={form.syncIntervalSec} onChange={(e) => set("syncIntervalSec", Number(e.target.value) || 60)} className="h-9" /></Field>
        <Field label="Enabled">
          <button onClick={() => set("enabled", !form.enabled)}
            style={{
              height: 36, borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "white",
              background: form.enabled ? "linear-gradient(135deg,#10b981,#059669)" : "#9ca3af",
            }}>
            {form.enabled ? "On" : "Off"}
          </button>
        </Field>
      </div>

      {/* actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <Button onClick={save} disabled={saving} className="h-9" style={{ background: "linear-gradient(135deg,#0d9488,#0ea5e9)" }}>
          {saving ? <Loader2 size={15} className="animate-spin mr-1.5" /> : <Save size={15} className="mr-1.5" />}
          Save
        </Button>
        {isElectron ? (
          <Button onClick={test} disabled={testing || !form.ip} variant="outline" className="h-9">
            {testing ? <Loader2 size={15} className="animate-spin mr-1.5" /> : <Wifi size={15} className="mr-1.5" />}
            Test connection
          </Button>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280" }}>
            <Info size={14} /> Connection test &amp; live sync run in the desktop POS app.
          </span>
        )}
        {testResult && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: testResult.ok ? "#059669" : "#dc2626" }}>
            {testResult.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {testResult.ok ? `OK — ${testResult.info?.users ?? 0} users, ${testResult.info?.logs ?? 0} logs` : testResult.error}
          </span>
        )}
      </div>

      {/* live agent status (desktop) */}
      {isElectron && status && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.05)", fontSize: 12 }}>
          <Stat icon={<Activity size={13} color={status.connected ? "#10b981" : "#9ca3af"} />} label="Agent" value={status.connected ? "Connected" : status.enabled ? "Connecting…" : "Idle"} />
          <Stat label="Buffered" value={`${status.buffered} punch${status.buffered === 1 ? "" : "es"}`} />
          <Stat label="Last sync" value={status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : "—"} />
          {status.lastError && <Stat label="Last error" value={typeof status.lastError === "string" ? status.lastError : ((status.lastError as any)?.message ?? JSON.stringify(status.lastError))} danger />}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 12 }}>
        Enroll each staff member on the device, note their <strong>User ID</strong>, then set it as their
        <strong> Biometric ID</strong> in the Payroll tab. That number is the only link the POS needs.
      </p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>
        {label}{hint && <span style={{ color: "#cbd5e1", fontWeight: 500 }}> · {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function Stat({ icon, label, value, danger }: { icon?: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {icon}
      <span style={{ color: "#9ca3af", fontWeight: 600 }}>{label}:</span>
      <span style={{ color: danger ? "#dc2626" : "#374151", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status, enabled, isElectron }: { status: AttendanceStatus | null; enabled: boolean; isElectron: boolean }) {
  let color = "#9ca3af", bg = "rgba(148,163,184,0.14)", text = "Idle";
  if (!isElectron) { text = "Web"; }
  else if (status?.connected) { color = "#059669"; bg = "rgba(16,185,129,0.14)"; text = "Live"; }
  else if (enabled) { color = "#d97706"; bg = "rgba(245,158,11,0.14)"; text = "Connecting"; }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, background: bg, color, fontSize: 11.5, fontWeight: 700 }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
      {text}
    </span>
  );
}
