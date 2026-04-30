# DB Backups to R2 / S3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically back up all 27 PostgreSQL tables to Cloudflare R2 or AWS S3 as gzipped JSON daily at 2am, with a manual trigger and status view in Settings.

**Architecture:** `backupService.ts` handles dump + upload; `dailyScheduler.ts` calls it at 2am; two admin-only REST endpoints expose it; `BackupPanel.tsx` in Settings shows status and triggers manual backups.

**Tech Stack:** `@aws-sdk/client-s3` (already installed), Node built-in `zlib` for gzip, Drizzle ORM for table selects, React Query for the Settings UI.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/services/backupService.ts` | **Create** | S3 client factory, `isConfigured`, `runBackup`, `listBackups` |
| `server/services/dailyScheduler.ts` | **Modify** | Add daily backup tick at 2am |
| `server/routes.ts` | **Modify** | Add `GET` and `POST` `/api/admin/backups` |
| `client/src/components/BackupPanel.tsx` | **Create** | Settings panel: status, list, manual trigger |
| `client/src/pages/Settings.tsx` | **Modify** | Add `"backup"` modal ID, card, modal render |

---

## Task 1: Create `server/services/backupService.ts`

**Files:**
- Create: `server/services/backupService.ts`

- [ ] **Step 1: Create the file with full implementation**

```typescript
// server/services/backupService.ts
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { gzip } from "zlib";
import { promisify } from "util";
import { db } from "../db";
import * as T from "../../shared/schema";

const gzipAsync = promisify(gzip);
const MAX_RETAINED = 30;

function getBucket(): string {
  return process.env.R2_BUCKET_NAME ?? process.env.AWS_BUCKET_NAME ?? "";
}

function makeS3Client(): S3Client {
  if (process.env.R2_ACCOUNT_ID) {
    return new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export function isConfigured(): boolean {
  const b = getBucket();
  if (!b) return false;
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) return true;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return true;
  return false;
}

async function dumpAllTables() {
  const [
    users, categories, menuItems, inventory, orders, orderItems,
    kotTickets, tables, sales, deliveryIntegrations,
    customersMaster, customerProfiles, customerEvents, customerSegments,
    automationRules, automationJobs, customerMessages,
    coupons, couponRedemptions, loyaltyPoints, feedback,
    paymentTransactions, dailyDigests,
    attendanceRecords, attendanceSyncLog, staffMembers, auditLogs,
  ] = await Promise.all([
    db.select().from(T.users),
    db.select().from(T.categories),
    db.select().from(T.menuItems),
    db.select().from(T.inventory),
    db.select().from(T.orders),
    db.select().from(T.orderItems),
    db.select().from(T.kotTickets),
    db.select().from(T.tables),
    db.select().from(T.sales),
    db.select().from(T.deliveryIntegrations),
    db.select().from(T.customersMaster),
    db.select().from(T.customerProfiles),
    db.select().from(T.customerEvents),
    db.select().from(T.customerSegments),
    db.select().from(T.automationRules),
    db.select().from(T.automationJobs),
    db.select().from(T.customerMessages),
    db.select().from(T.coupons),
    db.select().from(T.couponRedemptions),
    db.select().from(T.loyaltyPoints),
    db.select().from(T.feedback),
    db.select().from(T.paymentTransactions),
    db.select().from(T.dailyDigests),
    db.select().from(T.attendanceRecords),
    db.select().from(T.attendanceSyncLog),
    db.select().from(T.staffMembers),
    db.select().from(T.auditLogs),
  ]);

  return {
    users, categories, menuItems, inventory, orders, orderItems,
    kotTickets, tables, sales, deliveryIntegrations,
    customersMaster, customerProfiles, customerEvents, customerSegments,
    automationRules, automationJobs, customerMessages,
    coupons, couponRedemptions, loyaltyPoints, feedback,
    paymentTransactions, dailyDigests,
    attendanceRecords, attendanceSyncLog, staffMembers, auditLogs,
  };
}

export async function runBackup(): Promise<{ key: string; sizeBytes: number; durationMs: number }> {
  if (!isConfigured()) throw new Error("Backup storage not configured");
  const start = Date.now();
  const s3 = makeS3Client();
  const bucket = getBucket();

  const tables = await dumpAllTables();
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), version: 1, tables });
  const compressed = await gzipAsync(Buffer.from(payload, "utf-8"));

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `bagicha-backup-${ts}.json.gz`;

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: compressed,
    ContentType: "application/gzip",
  }));

  // Prune oldest backups beyond MAX_RETAINED — best-effort
  try {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "bagicha-backup-" }));
    const sorted = (list.Contents ?? []).sort(
      (a, b) => (a.LastModified! < b.LastModified! ? -1 : 1)
    );
    for (const obj of sorted.slice(0, Math.max(0, sorted.length - MAX_RETAINED))) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key! }));
    }
  } catch {
    // never fail a backup over cleanup
  }

  return { key, sizeBytes: compressed.byteLength, durationMs: Date.now() - start };
}

export async function listBackups(): Promise<{ key: string; size: number; lastModified: string }[]> {
  if (!isConfigured()) return [];
  const s3 = makeS3Client();
  const list = await s3.send(new ListObjectsV2Command({ Bucket: getBucket(), Prefix: "bagicha-backup-" }));
  return (list.Contents ?? [])
    .sort((a, b) => (a.LastModified! > b.LastModified! ? -1 : 1))
    .slice(0, 20)
    .map(o => ({ key: o.Key!, size: o.Size ?? 0, lastModified: o.LastModified!.toISOString() }));
}
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/backupService.ts
git commit -m "feat: add backupService — gzipped JSON export to R2/S3"
```

---

## Task 2: Wire backup into `dailyScheduler.ts`

**Files:**
- Modify: `server/services/dailyScheduler.ts`

- [ ] **Step 1: Add import at top of file** (after existing imports)

```typescript
import { runBackup, isConfigured as backupConfigured } from "./backupService";
```

- [ ] **Step 2: Add state variable** (after `let lastDigestDate: string | null = null;`)

```typescript
let lastBackupDate: string | null = null;
```

- [ ] **Step 3: Add backup job inside `tick()`** (after the daily digest block, before the closing brace)

```typescript
  // 4. Daily backup — once per day at 2am
  if (backupConfigured() && hour >= 2 && lastBackupDate !== today) {
    try {
      lastBackupDate = today;
      const result = await runBackup();
      console.log(`[DailyScheduler] backup complete: ${result.key} (${result.sizeBytes} bytes, ${result.durationMs}ms)`);
    } catch (err: any) {
      console.warn("[DailyScheduler] backup error:", err?.message ?? err);
    }
  }
```

- [ ] **Step 4: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/services/dailyScheduler.ts
git commit -m "feat: daily DB backup at 2am via scheduler"
```

---

## Task 3: Add admin endpoints to `server/routes.ts`

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: Add import** at the top of `routes.ts`, alongside other service imports

Find this line:
```typescript
import { logAudit, getAuditLogs } from "./services/auditService";
```

Add after it:
```typescript
import { runBackup, listBackups, isConfigured as backupConfigured } from "./services/backupService";
```

- [ ] **Step 2: Add the two endpoints** inside `registerRoutes`, after the audit-log endpoint block (`GET /api/admin/audit-logs`)

```typescript
  // ── DB Backup endpoints ────────────────────────────────────────────────────
  app.get("/api/admin/backups", requireAdmin, async (req, res) => {
    try {
      const backups = await listBackups();
      res.json({ configured: backupConfigured(), backups });
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to list backups" });
    }
  });

  app.post("/api/admin/backups", requireAdmin, async (req, res) => {
    try {
      if (!backupConfigured()) {
        return res.status(400).json({ message: "Backup storage not configured. Set R2_* or AWS_* env vars." });
      }
      const result = await runBackup();
      logAudit(req, "backup.manual", "system", undefined, { key: result.key, sizeBytes: result.sizeBytes });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Backup failed" });
    }
  });
```

- [ ] **Step 3: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add GET/POST /api/admin/backups endpoints"
```

---

## Task 4: Create `client/src/components/BackupPanel.tsx`

**Files:**
- Create: `client/src/components/BackupPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// client/src/components/BackupPanel.tsx
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Database, HardDrive, Loader2, CheckCircle2, AlertTriangle, RefreshCw,
} from "lucide-react";

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
  // "bagicha-backup-2026-04-30T02-00-00-000Z.json.gz" → "2026-04-30 02:00:00"
  const m = key.match(/bagicha-backup-(.+)\.json\.gz$/);
  if (!m) return key;
  return m[1].replace(/T/, " ").replace(/-(?=\d\d-\d\d-\d\d\d)/g, ":").slice(0, 19);
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
      {/* Header + status */}
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

      {/* Last backup summary */}
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

      {/* Manual trigger */}
      <Button onClick={triggerBackup} disabled={busy} className="w-full">
        {busy
          ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Backing up…</>
          : <><RefreshCw className="w-4 h-4 mr-2" />Back Up Now</>}
      </Button>

      {/* Recent backup list */}
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
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/BackupPanel.tsx
git commit -m "feat: add BackupPanel settings component"
```

---

## Task 5: Wire `BackupPanel` into `Settings.tsx`

**Files:**
- Modify: `client/src/pages/Settings.tsx`

- [ ] **Step 1: Add import** (alongside existing panel imports near line 24–25)

```typescript
import { BackupPanel } from "@/components/BackupPanel";
```

- [ ] **Step 2: Add `"backup"` to the `ModalId` union** (after `"two-factor"` around line 56)

```typescript
  | "backup"
```

- [ ] **Step 3: Add card to `ACTION_CARDS`** (after the `"two-factor"` entry)

```typescript
  {
    id: "backup",
    label: "DB",
    sublabel: "Backups",
    icon: Database,
  },
```

`Database` is already imported in Settings.tsx (line 17).

- [ ] **Step 4: Add modal render** (after the `{activeModal === "two-factor" && ...}` block near the bottom)

```tsx
      {/* Database Backups */}
      {activeModal === "backup" && (
        <Modal title="Database Backups" onClose={closeModal}>
          <BackupPanel />
        </Modal>
      )}
```

- [ ] **Step 5: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 6: Commit + push**

```bash
git add client/src/pages/Settings.tsx
git commit -m "feat: add Database Backups card to Settings"
git push
```

---

## Task 6: Manual Verification

- [ ] **Unconfigured state:** Start server without R2/S3 env vars → Settings → DB Backups → should show amber "not configured" panel with env var snippet. No errors in server console.

- [ ] **Configured state (with real R2/S3 creds):** Add env vars to `.env`, restart server → Settings → DB Backups → shows green "Configured" badge. Click "Back Up Now" → spinner → success toast with filename + size → file appears in R2/S3 dashboard.

- [ ] **List refreshes:** After manual backup, the "Recent backups" list updates with the new entry.

- [ ] **Non-admin blocked:** Log in as staff/manager → `POST /api/admin/backups` returns 403.

- [ ] **Audit log entry:** After manual backup, Settings → Audit Log shows a `backup.manual` entry.

- [ ] **Type-check clean:**

```bash
npm run check
```

Expected: no output (clean).
