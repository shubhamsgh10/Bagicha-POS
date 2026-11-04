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
import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

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

// EVERY table shared/schema.ts defines, discovered from its exports. The hand-kept list this
// replaced had drifted: no restaurant_settings (tax rate, printers, counters — the single source
// of truth), staff_profiles, attendance, leaves, shifts, conversations or print_jobs. Four at a
// time so a backup never holds more than four pool connections.
async function dumpAllTables() {
  const entries = Object.entries(T).filter(([, v]) => is(v as any, PgTable)) as Array<[string, PgTable]>;
  const out: Record<string, unknown[]> = {};
  for (let i = 0; i < entries.length; i += 4) {
    const batch = entries.slice(i, i + 4);
    const rows = await Promise.all(batch.map(([, t]) => db.select().from(t as any)));
    batch.forEach(([name], j) => { out[name] = rows[j]; });
  }
  return out;
}

export async function runBackup(): Promise<{ key: string; sizeBytes: number; durationMs: number }> {
  if (!isConfigured()) throw new Error("Backup storage not configured");
  const start = Date.now();
  const s3 = makeS3Client();
  const bucket = getBucket();

  const tables = await dumpAllTables();
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), version: 2, tables });
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
