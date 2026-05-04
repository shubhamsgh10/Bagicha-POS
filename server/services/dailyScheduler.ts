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
import { getAutomationConfig } from "./automationStore";
import { processPendingFeedback } from "./feedbackService";
import { runBirthdayAutomation } from "./birthdayService";
import { generateAndSendDailyDigest } from "./dailyDigestService";
import { runBackup, isConfigured as backupConfigured } from "./backupService";

// ── State ─────────────────────────────────────────────────────────────────────

let tickerTimer: ReturnType<typeof setInterval> | null = null;
let lastBirthdayDate: string | null = null;   // YYYY-MM-DD
let lastDigestDate:   string | null = null;
let lastBackupDate:   string | null = null;

const TICK_INTERVAL_MS = 60 * 1000; // every minute

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Tick ──────────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const config = getAutomationConfig();
  const now    = new Date();
  const today  = todayDateStr();
  const hour   = now.getHours();

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
