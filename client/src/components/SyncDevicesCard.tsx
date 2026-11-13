import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/api";
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
              <Button size="sm" variant="outline" onClick={() => setFresh(null)}>Done</Button>
            </div>
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
