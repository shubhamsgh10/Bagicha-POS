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
