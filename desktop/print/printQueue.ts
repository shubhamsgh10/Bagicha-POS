import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { executePrintJob } from "./executor.js";
import type { PrintJob, PrinterConfig } from "../types.js";
import type { PrintLog } from "./printLog.js";

export interface QueuedJob {
  id: string;
  printJob: PrintJob;
  type: "kot" | "bill" | "test";
  orderId?: number;
  ackType?: "kot" | "bill";
  createdAt: number;
  status: "pending" | "processing" | "success" | "failed" | "retrying";
  retries: number;
  lastError?: string;
}

type GetPrinters = () => Promise<PrinterConfig[]>;
type GetCookieHeader = () => Promise<string>;
type GetApiBase = () => string;

const RETRY_DELAYS = [0, 2_000, 5_000, 10_000];
const MAX_RETRIES = 3;

export class PrintQueue {
  private queue: QueuedJob[] = [];
  private processing = false;
  private queueFile: string;
  private getPrinters: GetPrinters;
  private getCookieHeader: GetCookieHeader;
  private getApiBase: GetApiBase;
  private printLog: PrintLog | null = null;

  constructor(
    userDataPath: string,
    getPrinters: GetPrinters,
    getCookieHeader: GetCookieHeader,
    getApiBase: GetApiBase,
    printLog?: PrintLog,
  ) {
    this.queueFile = path.join(userDataPath, "print-queue.json");
    this.getPrinters = getPrinters;
    this.getCookieHeader = getCookieHeader;
    this.getApiBase = getApiBase;
    this.printLog = printLog ?? null;
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.queueFile, "utf8");
      const saved: QueuedJob[] = JSON.parse(raw);
      // Re-enqueue only jobs that were not yet completed
      const STALE_MS = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      this.queue = saved
        .filter((j) => j.status === "pending" || j.status === "retrying" || j.status === "processing")
        .filter((j) => now - j.createdAt < STALE_MS);
      // Reset processing jobs back to pending (they were interrupted mid-job)
      for (const j of this.queue) {
        if (j.status === "processing") j.status = "pending";
      }
      if (this.queue.length > 0) {
        console.log(`[printQueue] Resumed ${this.queue.length} pending job(s) from disk`);
        setTimeout(() => this.processNext(), 1_000);
      }
    } catch {
      // No saved queue or invalid JSON — start fresh
    }
  }

  private persist(): void {
    const toSave = this.queue.filter((j) => j.status !== "success");
    try {
      fs.writeFileSync(this.queueFile, JSON.stringify(toSave, null, 2), "utf8");
    } catch (e) {
      console.warn("[printQueue] persist failed:", e);
    }
  }

  enqueue(spec: Omit<QueuedJob, "id" | "createdAt" | "status" | "retries">): string {
    // Dedup: skip only if the SAME ticket — same order + type + TARGET PRINTER — is already
    // in-flight. Keying on printerId is essential for category routing: one order's KOT can
    // split into several tickets for DIFFERENT printers (e.g. South Indian → counter printer,
    // everything else → kitchen), and those must NOT be collapsed into one — doing so silently
    // dropped the second printer's ticket. A genuine double-tap / auto-KOT race still dedups,
    // since it repeats the same order+type+printer.
    if (spec.orderId && spec.ackType) {
      const printerId = spec.printJob?.printerId;
      const duplicate = this.queue.find(
        (j) =>
          j.orderId === spec.orderId &&
          j.ackType === spec.ackType &&
          j.printJob.printerId === printerId &&
          (j.status === "pending" || j.status === "processing" || j.status === "retrying"),
      );
      if (duplicate) {
        console.log(
          `[printQueue] Dedup: job for order ${spec.orderId}/${spec.ackType} printer ${printerId} already queued (${duplicate.id})`,
        );
        return duplicate.id;
      }
    }

    const job: QueuedJob = {
      ...spec,
      id: randomBytes(8).toString("hex"),
      createdAt: Date.now(),
      status: "pending",
      retries: 0,
    };
    this.queue.push(job);
    this.persist();
    setImmediate(() => this.processNext());
    return job.id;
  }

  getStatus(): QueuedJob[] {
    return [...this.queue];
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    const job = this.queue.find((j) => j.status === "pending");
    if (!job) return;

    this.processing = true;
    job.status = "processing";
    this.persist();
    this.printLog?.append({
      type: job.type,
      printerId: job.printJob.printerId,
      status: "sent",
      orderId: job.orderId,
    });

    try {
      const printers = await this.getPrinters();
      await executePrintJob(job.printJob, printers);
      // Ack if needed
      if (job.orderId && job.ackType) {
        await this.ack(job.orderId, job.ackType, job.printJob.jobId).catch((e) =>
          console.warn(`[printQueue] ack failed for job ${job.id}:`, e),
        );
      }
      console.log(`[printQueue] Job ${job.id} (${job.type}) succeeded`);
      this.printLog?.append({
        type: job.type,
        printerId: job.printJob.printerId,
        status: "success",
        orderId: job.orderId,
      });
      this.queue = this.queue.filter((j) => j !== job);
    } catch (err: any) {
      job.lastError = err?.message ?? String(err);
      if (job.retries < MAX_RETRIES) {
        job.retries++;
        job.status = "retrying";
        const delay = RETRY_DELAYS[job.retries] ?? 10_000;
        console.warn(`[printQueue] Job ${job.id} failed, retry ${job.retries}/${MAX_RETRIES} in ${delay}ms:`, err?.message);
        this.printLog?.append({
          type: job.type,
          printerId: job.printJob.printerId,
          status: "retry",
          orderId: job.orderId,
          error: job.lastError,
        });
        this.persist();
        this.processing = false;
        setTimeout(() => {
          job.status = "pending";
          this.persist();
          this.processNext();
        }, delay);
        return;
      } else {
        job.status = "failed";
        console.error(`[printQueue] Job ${job.id} permanently failed after ${MAX_RETRIES} retries:`, err?.message);
        this.printLog?.append({
          type: job.type,
          printerId: job.printJob.printerId,
          status: "failed",
          orderId: job.orderId,
          error: job.lastError,
        });
        // Give the durable job back to the pending pool so another station can rescue it.
        if (job.printJob.jobId) {
          this.release(job.printJob.jobId, job.lastError).catch((e) =>
            console.warn(`[printQueue] release failed for job ${job.id}:`, e),
          );
        }
      }
    }

    this.persist();
    this.processing = false;
    // Process next job if any
    const hasMore = this.queue.some((j) => j.status === "pending");
    if (hasMore) setImmediate(() => this.processNext());
  }

  private async release(jobId: number, error?: string): Promise<void> {
    const base = this.getApiBase();
    const cookieHeader = await this.getCookieHeader();
    const res = await fetch(`${base}/api/print/jobs/${jobId}/release`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({ error }),
    });
    if (!res.ok) throw new Error(`Release failed: ${res.status}`);
  }

  private async ack(orderId: number, type: "kot" | "bill", jobId?: number): Promise<void> {
    const base = this.getApiBase();
    const cookieHeader = await this.getCookieHeader();
    const res = await fetch(`${base}/api/print/ack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({ orderId, type, jobId }),
    });
    if (!res.ok) throw new Error(`Ack failed: ${res.status}`);
  }
}
