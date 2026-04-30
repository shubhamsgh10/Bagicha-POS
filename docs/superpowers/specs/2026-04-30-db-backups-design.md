# DB Backups to S3 / Cloudflare R2 — Design Spec

**Date:** 2026-04-30
**Status:** Approved

---

## Problem

The Bagicha POS database (Neon PostgreSQL) has no automated off-site backup. A database incident, accidental deletion, or provider outage would result in permanent data loss for orders, customers, loyalty points, and audit logs.

---

## Scope

- **In scope:** Automated daily backup, manual trigger, list of recent backups, Settings UI.
- **Out of scope:** In-app restore (restores are rare; manual re-import from JSON is acceptable). `pg_dump` binary backup.

---

## Architecture

### Storage Provider (env-var driven)

A single `makeS3Client()` factory checks environment variables at call time:

| Env var set | Provider |
|---|---|
| `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET_NAME` | Cloudflare R2 |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_BUCKET_NAME` | AWS S3 |
| Neither | Backup silently skipped; endpoints return `{ configured: false }` |

R2 uses the AWS S3 SDK pointed at `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` with `region: "auto"`.

### Backup Format

```json
{
  "timestamp": "2026-04-30T02:00:00.000Z",
  "version": 1,
  "tables": {
    "users": [...],
    "orders": [...],
    "orderItems": [...],
    ...all 24 tables...
  }
}
```

Serialized to UTF-8 JSON, then **gzipped** with Node's built-in `zlib`. Filename pattern:

```
bagicha-backup-2026-04-30T02-00-00-000Z.json.gz
```

Retention: last **30** backups kept. Older files deleted automatically after each successful upload.

### Tables Backed Up

All 27 tables from `shared/schema.ts`:
`users`, `categories`, `menuItems`, `inventory`, `orders`, `orderItems`, `kotTickets`, `tables`, `sales`, `deliveryIntegrations`, `customersMaster`, `customerProfiles`, `customerEvents`, `customerSegments`, `automationRules`, `automationJobs`, `customerMessages`, `coupons`, `couponRedemptions`, `loyaltyPoints`, `feedback`, `paymentTransactions`, `dailyDigests`, `attendanceRecords`, `attendanceSyncLog`, `staffMembers`, `auditLogs`

Schema is excluded — it is fully reproducible via `npm run db:push`.

---

## Components

### `server/services/backupService.ts` (new)

```
isConfigured() → boolean
runBackup()    → Promise<{ key, sizeBytes, durationMs }>
listBackups()  → Promise<{ key, size, lastModified }[]>
```

`runBackup()` flow:
1. SELECT all rows from all tables in parallel (`Promise.all`)
2. `JSON.stringify` the payload
3. `zlib.gzip` the buffer
4. `PutObjectCommand` to R2/S3
5. `ListObjectsV2Command` → delete oldest if count > 30
6. Return metadata

### `server/services/dailyScheduler.ts` (modified)

Add a 4th tick job: **daily backup at 2am** (`backupHour = 2`). Uses the same "last run date" guard pattern already used for birthday and digest jobs (`lastBackupDate` string). Backup is skipped if `!isConfigured()`.

### `server/routes.ts` (modified)

Two new endpoints, both `requireAdmin`:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/backups` | Returns `{ configured, backups: [...] }` |
| `POST` | `/api/admin/backups` | Triggers immediate backup, returns `{ key, sizeBytes, durationMs }` |

`POST` is protected by the existing `loginLimiter` (reused) to prevent accidental spam.

### `client/src/components/BackupPanel.tsx` (new)

Three states:

1. **Not configured** — grey shield icon, explanation of required env vars, copy-paste snippet for `.env`.
2. **Configured, idle** — shows last backup (key + size + date), "Back Up Now" button, scrollable list of last 10 backups.
3. **Backing up** — spinner on button, disabled.

Mutations via direct `fetch` (not `apiRequest`) so raw response can be checked before JSON parsing.

### `client/src/pages/Settings.tsx` (modified)

Add "Database Backups" card to `ACTION_CARDS` with a database/shield icon. Opens `BackupPanel` in the existing modal pattern.

---

## Error Handling

- If `runBackup()` throws, the daily scheduler logs a warning and continues — it does not crash the tick.
- The `POST /api/admin/backups` endpoint returns `{ message }` with appropriate HTTP status on failure.
- `BackupPanel` shows the server error message in a destructive toast on failure.
- Tables that fail to SELECT (shouldn't happen, but defensive) are caught per-table and logged; backup still proceeds with available data.

---

## Environment Variables (new)

```env
# Cloudflare R2 (preferred)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_key_id
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=bagicha-backups

# OR AWS S3
AWS_ACCESS_KEY_ID=your_key_id
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_BUCKET_NAME=bagicha-backups
```

---

## Verification

1. Set R2/S3 env vars → restart server → click "Back Up Now" in Settings → see new file in R2/S3 dashboard.
2. Trigger two more manual backups → oldest is retained (only 30 max, not exceeded yet).
3. Clear env vars → restart → Settings shows "not configured" state, no errors.
4. Wait until 2am (or temporarily set `backupHour = 0` and wait for next tick) → automatic backup fires.
5. Non-admin user cannot call `POST /api/admin/backups` → 403.
