import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldOff, Loader2, ScanLine } from "lucide-react";

type Status = { totpEnabled: boolean };

export function TwoFactorPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery<Status>({
    queryKey: ["/api/auth/2fa/status"],
    queryFn: async () => {
      const r = await fetch("/api/auth/2fa/status", { credentials: "include" });
      return r.json();
    },
  });

  const [phase, setPhase] = useState<"idle" | "setup" | "disable">("idle");
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setBusy(true);
    try {
      const r = await fetch("/api/auth/2fa/setup", { method: "POST", credentials: "include" });
      const text = await r.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(`Server returned non-JSON (${r.status}): ${text.slice(0, 120)}`); }
      if (!r.ok) throw new Error(data.message ?? `Server error ${r.status}`);
      if (!data.qrDataURL) throw new Error("No QR code in response");
      setQrDataURL(data.qrDataURL);
      setPhase("setup");
      setToken("");
    } catch (err: any) {
      toast({ title: "Failed to start 2FA setup", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    if (token.length !== 6) return;
    setBusy(true);
    try {
      const r = await fetch("/api/auth/2fa/verify-setup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        const d = await r.json();
        toast({ title: d.message ?? "Invalid code", variant: "destructive" });
        return;
      }
      toast({ title: "2FA enabled!", description: "Your account is now protected." });
      setPhase("idle");
      setQrDataURL(null);
      setToken("");
      qc.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
    } catch {
      toast({ title: "Failed to verify code", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (token.length !== 6) return;
    setBusy(true);
    try {
      const r = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        const d = await r.json();
        toast({ title: d.message ?? "Invalid code", variant: "destructive" });
        return;
      }
      toast({ title: "2FA disabled." });
      setPhase("idle");
      setToken("");
      qc.invalidateQueries({ queryKey: ["/api/auth/2fa/status"] });
    } catch {
      toast({ title: "Failed to disable 2FA", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <div className="py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;

  const enabled = status?.totpEnabled;

  /* ── Setup flow ── */
  if (phase === "setup") return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ScanLine className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Set up Two-Factor Authentication</h3>
      </div>
      <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
        <li>Install <strong className="text-foreground">Google Authenticator</strong> or <strong className="text-foreground">Authy</strong> on your phone</li>
        <li>Tap <strong className="text-foreground">+</strong> → <strong className="text-foreground">Scan QR code</strong></li>
        <li>Point your camera at the code below</li>
      </ol>
      {qrDataURL && (
        <div className="flex justify-center">
          <div className="border rounded-xl p-3 bg-white shadow-sm">
            <img src={qrDataURL} alt="2FA QR Code" className="w-48 h-48" />
          </div>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">Enter the 6-digit code shown in your app to confirm:</p>
        <Input
          value={token}
          onChange={e => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="text-center text-xl font-mono tracking-[0.4em] h-12"
          maxLength={6}
        />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => { setPhase("idle"); setToken(""); }}>Cancel</Button>
        <Button onClick={confirmSetup} disabled={busy || token.length !== 6} className="flex-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
          Enable 2FA
        </Button>
      </div>
    </div>
  );

  /* ── Disable flow ── */
  if (phase === "disable") return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ShieldOff className="h-5 w-5 text-orange-500" />
        <h3 className="font-semibold">Disable Two-Factor Authentication</h3>
      </div>
      <p className="text-sm text-muted-foreground">Enter your current authenticator code to confirm removal.</p>
      <Input
        value={token}
        onChange={e => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        inputMode="numeric"
        autoComplete="one-time-code"
        className="text-center text-xl font-mono tracking-[0.4em] h-12"
        maxLength={6}
      />
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => { setPhase("idle"); setToken(""); }}>Cancel</Button>
        <Button variant="destructive" onClick={disable} disabled={busy || token.length !== 6} className="flex-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldOff className="w-4 h-4 mr-2" />}
          Disable 2FA
        </Button>
      </div>
    </div>
  );

  /* ── Status view ── */
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className={`h-5 w-5 ${enabled ? "text-emerald-500" : "text-muted-foreground"}`} />
        <h3 className="font-semibold">Two-Factor Authentication</h3>
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        {enabled
          ? "Your admin account requires a 6-digit code from Google Authenticator on every login. Even if your password is stolen, attackers cannot log in."
          : "Add a second layer of security. After enabling, every admin login requires a 6-digit code from your authenticator app in addition to your password."}
      </p>

      {enabled ? (
        <Button variant="outline" className="w-full border-orange-200 text-orange-700 hover:bg-orange-50"
          onClick={() => { setPhase("disable"); setToken(""); }}>
          <ShieldOff className="w-4 h-4 mr-2" />
          Disable 2FA
        </Button>
      ) : (
        <Button onClick={startSetup} disabled={busy} className="w-full">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
          Enable 2FA
        </Button>
      )}
    </div>
  );
}
