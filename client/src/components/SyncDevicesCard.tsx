import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiJson, getApiBaseUrl } from "@/lib/api";
import type { LocalModeStatus } from "@shared/electron/ipc";
import { apiRequest } from "@/lib/queryClient";

interface SyncDevice {
  id: number;
  name: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

const KEY = ["/api/sync/devices"];

function when(v: string | null): string {
  return v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "never";
}

/** Admin: create/revoke the per-device tokens the shop PC's local server syncs with. */
export default function SyncDevicesCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  // Desktop app only: this PC can run its own server + local copy (desktop/localMode.ts).
  const desktop = typeof window !== "undefined" ? window.electronAPI : undefined;
  const canSetUpLocal = !!desktop?.enableLocalMode;
  const [local, setLocal] = useState<LocalModeStatus | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  useEffect(() => {
    if (!desktop?.localStatus) return;
    desktop.localStatus().then(setLocal).catch(() => setLocal(null));
  }, [desktop]);

  const useOnThisPc = async () => {
    if (!fresh || !desktop?.enableLocalMode) return;
    setLocalBusy(true);
    try {
      // On the thin client the API base is the cloud URL; empty (same-origin) lets the app fill in the saved one.
      const res = await desktop.enableLocalMode({ cloudUrl: getApiBaseUrl(), deviceToken: fresh.token });
      if (res.ok) {
        toast({ title: "Local mode is on - the app is restarting" });
      } else {
        toast({ title: "Could not turn on local mode", description: res.error, variant: "destructive" });
        setLocalBusy(false);
      }
    } catch (err: any) {
      toast({ title: "Could not turn on local mode", description: err?.message, variant: "destructive" });
      setLocalBusy(false);
    }
  };

  const turnOffLocal = async () => {
    if (!desktop?.disableLocalMode) return;
    if (!window.confirm("Turn off local mode on this PC? The app restarts as the normal cloud client.")) return;
    setLocalBusy(true);
    try {
      const res = await desktop.disableLocalMode();
      if (res.ok) toast({ title: "Local mode is off - the app is restarting" });
      else {
        toast({ title: "Could not turn off local mode", description: res.error, variant: "destructive" });
        setLocalBusy(false);
      }
    } catch (err: any) {
      toast({ title: "Could not turn off local mode", description: err?.message, variant: "destructive" });
      setLocalBusy(false);
    }
  };

  const { data: devices = [], isLoading } = useQuery<SyncDevice[]>({
    queryKey: KEY,
    queryFn: () => apiJson<SyncDevice[]>("/api/sync/devices"),
  });

  const create = useMutation({
    mutationFn: async (n: string) => {
      const res = await apiRequest("POST", "/api/sync/devices", { name: n });
      return (await res.json()) as { id: number; name: string; token: string };
    },
    onSuccess: (d) => {
      setFresh({ name: d.name, token: d.token });
      setName("");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => toast({ title: "Could not create the device token", variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/sync/devices/${id}`),
    onSuccess: () => {
      toast({ title: "Device revoked" });
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => toast({ title: "Could not revoke the device", variant: "destructive" }),
  });

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      toast({ title: "Token copied" });
    } catch {
      toast({ title: "Copy failed - select the token and copy it by hand", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shop PC sync devices</CardTitle>
        <CardDescription>
          Each shop PC that keeps a local copy of the data signs in to the cloud with its own token.
          Revoke a token to cut that PC off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Device name, e.g. Shop PC"
            maxLength={80}
            aria-label="Device name"
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? "Creating..." : "Create"}
          </Button>
        </form>

        {fresh && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-sm font-medium text-amber-900">
              Token for "{fresh.name}" - shown once. Copy it now and put it in the shop PC's config.
            </p>
            <code className="block break-all rounded bg-white p-2 text-xs border">{fresh.token}</code>
            <div className="flex gap-2">
              <Button size="sm" onClick={copy}>Copy</Button>
              {canSetUpLocal && (
                <Button size="sm" variant="secondary" disabled={localBusy} onClick={useOnThisPc}>
                  {localBusy ? "Restarting..." : "Use on this PC"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setFresh(null)}>Done</Button>
            </div>
          </div>
        )}

        {canSetUpLocal && local && (local.active || local.configured) && (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {local.active ? "Local mode is active on this PC" : "Local mode is set up but not running"}
              </p>
              {local.reason && <p className="text-xs text-gray-500">{local.reason}</p>}
            </div>
            <Button size="sm" variant="outline" disabled={localBusy} onClick={turnOffLocal}>
              Turn off local mode on this PC
            </Button>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-gray-500">No devices yet.</p>
        ) : (
          <ul className="divide-y">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {d.name}
                    {d.revokedAt && <span className="ml-2 text-xs text-red-600">revoked</span>}
                  </p>
                  <p className="text-xs text-gray-500">Last seen: {when(d.lastSeenAt)}</p>
                </div>
                {!d.revokedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (window.confirm(`Revoke "${d.name}"? That PC will stop syncing.`)) revoke.mutate(d.id);
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
