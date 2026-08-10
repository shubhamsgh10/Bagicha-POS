/**
 * outboundQueue.ts — durable, rate-limited automated WhatsApp sending.
 *
 * Automation triggers enqueue into the automation_jobs table; a single worker
 * drains it through the active driver with sendDelayMs + jitter pacing and a
 * maxPerDay cap (ban avoidance for Baileys). Jobs wait while the driver is
 * offline and survive restarts. Suppression (opt-out) is re-checked at send
 * time, not enqueue time.
 */

import { db } from "../../db";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  automationJobs,
  conversations,
  customerMessages,
  customerProfiles,
  customersMaster,
} from "../../../shared/schema";
import { getAutomationConfig, appendLog, isOptedOut, type TriggerType } from "../automationStore";
import { logMessageSentEvent } from "../crm/eventService";
import { publishRealtime } from "../../realtime/publisher";
import { getDriver } from "./driverManager";
import { getOrCreateConversation, recordMessage } from "./conversationStore";
import { normalizeWaPhone, isValidWaPhone } from "./types";
import { istCalendarDate, istCalendarDayRange } from "../../../shared/businessDay";

const MAX_ATTEMPTS = 3;
const IDLE_POLL_MS = 10_000;

export interface EnqueueInput {
  customerId: string;            // customers_master uuid
  phone: string;
  message: string;
  trigger: string;
  ruleId?: number | null;
}

export async function enqueueWhatsApp(input: EnqueueInput): Promise<void> {
  // Dedup so no path double-sends the same template to a customer in a day:
  //  - any pending/sending job for this customer + trigger (offline driver can't
  //    let hourly runs stack), OR
  //  - a job already SENT today for the same customer + trigger (cross-path guard
  //    — e.g. settlement already sent WELCOME, so the scheduler must not resend).
  // IST midnight, not server-local (see shared/businessDay.ts). Also checks
  // `executedAt` (when it actually sent), not `scheduledAt` (set once, at enqueue
  // time) — a job enqueued late one day but deferred (offline driver, maxPerDay cap)
  // until it actually sends the next day used to still read as "sent today" by its
  // stale scheduledAt, so a later same-day trigger for the same customer+trigger
  // didn't see it as already-sent and enqueued a real duplicate message.
  const { start: todayStart } = istCalendarDayRange(istCalendarDate());
  const existing = await db.select({ id: automationJobs.id })
    .from(automationJobs)
    .where(and(
      eq(automationJobs.customerId, input.customerId),
      eq(automationJobs.triggerType, input.trigger),
      or(
        inArray(automationJobs.status, ["pending", "sending"]),
        and(eq(automationJobs.status, "sent"), gte(automationJobs.executedAt, todayStart)),
      ),
    ))
    .limit(1);
  if (existing[0]) return;

  await db.insert(automationJobs).values({
    customerId:  input.customerId,
    ruleId:      input.ruleId ?? null,
    triggerType: input.trigger,
    status:      "pending",
    message:     input.message,
    phone:       normalizeWaPhone(input.phone),
  });
}

/** Sent count since IST midnight — enforces the maxPerDay ban guard. */
async function sentToday(): Promise<number> {
  const { start: startOfDay } = istCalendarDayRange(istCalendarDate());
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(automationJobs)
    .where(and(eq(automationJobs.status, "sent"), gte(automationJobs.executedAt, startOfDay)));
  return Number(row?.count ?? 0);
}

async function isSuppressed(job: { customerId: string; phone: string | null }): Promise<boolean> {
  if (!job.phone) return false;
  const conv = await db.select({ optedOut: conversations.optedOut })
    .from(conversations).where(eq(conversations.phone, job.phone)).limit(1);
  if (conv[0]?.optedOut) return true;

  const profile = await db.select({ doNotSendUpdate: customerProfiles.doNotSendUpdate })
    .from(customerProfiles).where(eq(customerProfiles.customerId, job.customerId)).limit(1);
  if (profile[0]?.doNotSendUpdate) return true;

  const master = await db.select({ key: customersMaster.key })
    .from(customersMaster).where(eq(customersMaster.id, job.customerId)).limit(1);
  if (master[0] && isOptedOut(master[0].key)) return true;

  return false;
}

async function processOneJob(): Promise<"sent" | "empty" | "waiting"> {
  const driver = getDriver();
  if (!driver || driver.getState() !== "connected") return "waiting";

  const config = getAutomationConfig();
  if (await sentToday() >= config.maxPerDay) return "waiting";

  const now = new Date();
  const jobs = await db.select().from(automationJobs)
    .where(and(
      eq(automationJobs.status, "pending"),
      or(isNull(automationJobs.nextAttemptAt), lte(automationJobs.nextAttemptAt, now)),
    ))
    .orderBy(asc(automationJobs.scheduledAt))
    .limit(1);
  const job = jobs[0];
  if (!job) return "empty";

  // Claim (single-process deployment — a status flip is sufficient)
  await db.update(automationJobs).set({ status: "sending" }).where(eq(automationJobs.id, job.id));

  const masterRows = await db.select().from(customersMaster)
    .where(eq(customersMaster.id, job.customerId)).limit(1);
  const master = masterRows[0];
  const customerName = master?.name ?? "Guest";
  const customerKey = master?.key ?? job.phone ?? "";

  if (!job.phone || !isValidWaPhone(job.phone) || !job.message) {
    await db.update(automationJobs)
      .set({ status: "skipped", executedAt: new Date(), error: "Missing/invalid phone or message" })
      .where(eq(automationJobs.id, job.id));
    return "sent"; // continue draining
  }

  if (await isSuppressed(job)) {
    await db.update(automationJobs)
      .set({ status: "skipped", executedAt: new Date(), error: "Customer opted out" })
      .where(eq(automationJobs.id, job.id));
    return "sent";
  }

  const result = await driver.sendText(job.phone, job.message);

  if (result.success) {
    await db.update(automationJobs)
      .set({ status: "sent", executedAt: new Date(), error: null })
      .where(eq(automationJobs.id, job.id));

    // Thread view
    const conversation = await getOrCreateConversation(job.phone);
    const msg = await recordMessage({
      conversationId: conversation.id,
      direction: "out",
      sender: "automation",
      body: job.message,
      waMessageId: result.waMessageId ?? null,
      status: "sent",
      trigger: job.triggerType,
    });

    // Campaign History (customer_messages) + CRM event + legacy JSON log
    await db.insert(customerMessages).values({
      customerId:  job.customerId,
      channel:     "whatsapp",
      message:     job.message,
      status:      "sent",
      trigger:     job.triggerType,
      waMessageId: result.waMessageId ?? null,
      sentAt:      new Date(),
    });
    logMessageSentEvent(customerKey, customerName, "whatsapp", job.triggerType, job.message)
      .catch(() => {});
    appendLog({
      customerId:   customerKey,
      customerName,
      phone:        job.phone,
      trigger:      job.triggerType as TriggerType,
      message:      job.message,
      sentAt:       new Date().toISOString(),
      status:       "sent",
      campaign:     job.triggerType,
    });

    void publishRealtime({ type: "WA_MESSAGE", conversationId: conversation.id, message: msg });
    console.log(`[WhatsApp][Queue] ✓ ${customerName} (${job.triggerType})`);
    return "sent";
  }

  // Failure — retry with exponential backoff, then give up
  const attempts = (job.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.update(automationJobs)
      .set({ status: "failed", attempts, executedAt: new Date(), error: result.error ?? "Send failed" })
      .where(eq(automationJobs.id, job.id));
    appendLog({
      customerId:   customerKey,
      customerName,
      phone:        job.phone,
      trigger:      job.triggerType as TriggerType,
      message:      job.message,
      sentAt:       new Date().toISOString(),
      status:       "failed",
      error:        result.error,
      campaign:     job.triggerType,
    });
    console.warn(`[WhatsApp][Queue] ✗ ${customerName} — ${result.error}`);
  } else {
    const backoffMs = Math.pow(2, attempts) * 60_000; // 2min, 4min, …
    await db.update(automationJobs)
      .set({
        status: "pending",
        attempts,
        nextAttemptAt: new Date(Date.now() + backoffMs),
        error: result.error ?? "Send failed",
      })
      .where(eq(automationJobs.id, job.id));
  }
  return "sent"; // keep draining (pacing still applies)
}

// ── Worker loop ───────────────────────────────────────────────────────────────

let workerTimer: ReturnType<typeof setTimeout> | null = null;
let workerRunning = false;

function nextDelay(outcome: "sent" | "empty" | "waiting"): number {
  if (outcome === "sent") {
    const { sendDelayMs } = getAutomationConfig();
    const base = Math.max(sendDelayMs || 3000, 1000);
    const jitter = 0.5 + Math.random(); // 0.5x – 1.5x
    return Math.round(base * jitter);
  }
  return IDLE_POLL_MS;
}

async function tick(): Promise<void> {
  let outcome: "sent" | "empty" | "waiting" = "empty";
  try {
    outcome = await processOneJob();
  } catch (err) {
    console.error("[WhatsApp][Queue] worker error:", err);
  }
  workerTimer = setTimeout(() => void tick(), nextDelay(outcome));
}

export function startOutboundWorker(): void {
  if (workerRunning) return;
  workerRunning = true;

  // Recover jobs stuck in "sending" from a previous crash. A job in this state was
  // claimed and driver.sendText() may or may not have actually reached WhatsApp before
  // the crash — there's no idempotency token to safely tell the difference or retry
  // against. Mark it "failed" for manual review instead of resetting to "pending" and
  // auto-resending: a false failure just costs a manual resend, but a false auto-resend
  // risks a real duplicate message landing on a customer's phone (worse — send volume is
  // also a number-ban risk, see CLAUDE.md's WhatsApp Automation section).
  db.update(automationJobs)
    .set({ status: "failed", error: "Interrupted mid-send by a server restart — verify before resending" })
    .where(eq(automationJobs.status, "sending"))
    .then(() => {})
    .catch(err => console.warn("[WhatsApp][Queue] sending-state recovery failed:", err));

  workerTimer = setTimeout(() => void tick(), 5_000);
  console.log("[WhatsApp][Queue] Outbound worker started");
}

export function stopOutboundWorker(): void {
  if (workerTimer) { clearTimeout(workerTimer); workerTimer = null; }
  workerRunning = false;
}
