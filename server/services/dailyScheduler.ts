/**
 * dailyScheduler.ts
 *
 * Single ticker that fires:
 *   - Pending feedback dispatch (every minute)
 *   - Birthday + anniversary scan (once per day, at config.birthdayHour)
 *   - Daily AI digest to owner (once per day, at config.dailyDigestHour)
 *
 * The scheduler is in-memory / process-local.  If the process restarts after
 * the configured hour but before the next, we still detect that today's job
 * hasn't run (via the `dailyDigests` and `automationJobs` tables) and trigger it.
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import { dailyDigests } from "../../shared/schema";
import { istCalendarDate, istHour } from "../../shared/businessDay";
import { getAutomationConfig } from "./automationStore";
import { processPendingFeedback } from "./feedbackService";
import { runBirthdayAutomation } from "./birthdayService";
import { generateAndSendDailyDigest } from "./dailyDigestService";
import { runBackup, isConfigured as backupConfigured } from "./backupService";
import { runAutomationServerSide } from "./crm/automationRuleEngine";

// ── State ─────────────────────────────────────────────────────────────────────

let tickerTimer: ReturnType<typeof setInterval> | null = null;
let lastBirthdayDate:    string | null = null;   // YYYY-MM-DD
let lastDigestDate:      string | null = null;
let lastBackupDate:      string | null = null;
let lastRuleEngineDate:  string | null = null;

const TICK_INTERVAL_MS = 60 * 1000; // every minute

// ── Tick ──────────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const config = getAutomationConfig();
  const now    = new Date();
  // Both from the SAME IST-pinned source — these used to be `today` in UTC
  // (toISOString) but `hour` in the server's LOCAL time, which disagree for part of
  // every day on any non-UTC-and-non-IST host (and even on an IST host, since
  // toISOString() is always UTC): the gate could pass with a stale-looking `today`
  // that was actually still yesterday in UTC, letting lastXDate !== today fire twice
  // for the same real IST day once UTC caught up. See shared/businessDay.ts.
  const today  = istCalendarDate(now);
  const hour   = istHour(now);

  // 1. Feedback dispatch — runs every tick
  if (config.feedbackEnabled) {
    try {
      await processPendingFeedback();
    } catch (err: any) {
      console.warn("[DailyScheduler] feedback error:", err?.message ?? err);
    }
  }

  // 2. Birthday automation — once per day at configured hour
  if (config.birthdayEnabled && hour >= (config.birthdayHour ?? 9) && lastBirthdayDate !== today) {
    try {
      lastBirthdayDate = today;
      await runBirthdayAutomation();
    } catch (err: any) {
      console.warn("[DailyScheduler] birthday error:", err?.message ?? err);
    }
  }

  // 3. Daily digest — once per day at configured hour
  if (config.dailyDigestEnabled && hour >= (config.dailyDigestHour ?? 23) && lastDigestDate !== today) {
    // Verify this hasn't been sent already (covers process restarts)
    let alreadySentToday = false;
    try {
      const rows = await db.select({ id: dailyDigests.id, sentAt: dailyDigests.sentAt })
        .from(dailyDigests).where(eq(dailyDigests.digestDate, today)).limit(1);
      if (rows[0]?.sentAt) alreadySentToday = true;
    } catch {}

    if (!alreadySentToday) {
      try {
        lastDigestDate = today;
        await generateAndSendDailyDigest();
      } catch (err: any) {
        console.warn("[DailyScheduler] digest error:", err?.message ?? err);
      }
    } else {
      lastDigestDate = today;
    }
  }

  // 4. Server automation rules engine — once per day at configured hour (default 10am)
  if (config.enabled && hour >= (config.serverAutomationHour ?? 10) && lastRuleEngineDate !== today) {
    try {
      lastRuleEngineDate = today;
      await runAutomationServerSide();
    } catch (err: any) {
      console.warn("[DailyScheduler] automation rules error:", err?.message ?? err);
    }
  }

  // 5. Daily backup — once per day at 2am
  if (backupConfigured() && hour >= 2 && lastBackupDate !== today) {
    try {
      lastBackupDate = today;
      const result = await runBackup();
      console.log(`[DailyScheduler] backup complete: ${result.key} (${result.sizeBytes} bytes, ${result.durationMs}ms)`);
    } catch (err: any) {
      console.warn("[DailyScheduler] backup error:", err?.message ?? err);
    }
  }
}

// ── Public ────────────────────────────────────────────────────────────────────

export function startDailyScheduler(): void {
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(() => {
    tick().catch(err => console.error("[DailyScheduler] tick error:", err));
  }, TICK_INTERVAL_MS);
  console.log("[DailyScheduler] started (1-min ticker)");
}

export function stopDailyScheduler(): void {
  if (tickerTimer) {
    clearInterval(tickerTimer);
    tickerTimer = null;
  }
}
