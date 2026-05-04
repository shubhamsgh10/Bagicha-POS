import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Database, HardDrive, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

type BackupEntry = { key: string; size: number; lastModified: string };
type BackupStatus = { configured: boolean; backups: BackupEntry[] };

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function keyToLabel(key: string): string {
  const m = key.match(/bagicha-backup-(.+)\.json\.gz$/);
  if (!m) return key;
  return m[1].replace("T", " ").slice(0, 19).replace(/-(\d\d)-(\d\d)-\d{3}Z$/, ":$1:$2");
}

export function BackupPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery<BackupStatus>({
    queryKey: ["/api/admin/backups"],
    queryFn: async () => {
      const r = await fetch("/api/admin/backups", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load backup status");
      return r.json();
    },
  });

  async function triggerBackup() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/backups", { method: "POST", credentials: "include" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? "Backup failed");
      toast({
        title: "Backup complete",
        description: `${json.key} — ${fmtBytes(json.sizeBytes)} in ${json.durationMs}ms`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/backups"] });
    } catch (err: any) {
      toast({ title: "Backup failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
      </div>
    );
  }

  if (!data?.configured) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold">Backup Storage Not Configured</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Set the following environment variables and restart the server:
        </p>
        <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto leading-relaxed">{`# Cloudflare R2 (preferred)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_key_id
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=bagicha-backups

# OR AWS S3
AWS_ACCESS_KEY_ID=your_key_id
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_BUCKET_NAME=bagicha-backups`}</pre>
        <p className="text-xs text-muted-foreground">
          Once configured, backups run automatically every day at 2am and can be triggered manually here.
        </p>
      </div>
    );
  }

  const latest = data.backups[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        <h3 className="font-semibold">Database Backups</h3>
        <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
          Configured
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        All 27 tables are backed up as gzipped JSON. Backups run automatically at 2am daily and the last 30 are retained.
      </p>

      {latest ? (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <HardDrive className="w-4 h-4 text-muted-foreground" />
            Last backup
          </div>
          <div className="text-muted-foreground">{fmtDate(latest.lastModified)}</div>
          <div className="text-muted-foreground">{fmtBytes(latest.size)}</div>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          No backups yet. Click "Back Up Now" to create the first one.
        </div>
      )}

      <Button onClick={triggerBackup} disabled={busy} className="w-full">
        {busy
          ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Backing up…</>
          : <><RefreshCw className="w-4 h-4 mr-2" />Back Up Now</>}
      </Button>

      {data.backups.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent backups</p>
          <div className="divide-y rounded-lg border overflow-hidden">
            {data.backups.map(b => (
              <div key={b.key} className="flex items-center justify-between px-3 py-2 text-xs bg-background">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="font-mono truncate text-muted-foreground">{keyToLabel(b.key)}</span>
                </div>
                <span className="shrink-0 ml-2 text-muted-foreground">{fmtBytes(b.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
