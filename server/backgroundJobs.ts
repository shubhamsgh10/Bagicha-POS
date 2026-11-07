/**
 * backgroundJobs.ts — should this server process run the background jobs?
 *
 * The jobs are: the hourly customer automation, the hourly CRM segmentation, the
 * daily scheduler (birthday scan, daily digest, server rules engine, feedback
 * dispatch, backup), the WhatsApp driver and the outbound WhatsApp queue. Only a
 * persistent server (`server/index.ts`) can run them; Vercel never does.
 *
 * They are OFF unless asked for with BACKGROUND_JOBS=on. A developer's
 * `npm run dev` points at the one shared production database, so with the jobs on
 * by default every laptop start after 10 am ran the rules engine against live
 * customers (7 Nov 2026: 14 automated "re-engagement" messages recorded as sent —
 * dry runs, since no WhatsApp was connected, but they counted as sent and blocked
 * real messages to those customers for 30 days). The Electron host build — the
 * one machine meant to be the always-on WhatsApp host — sets BACKGROUND_JOBS=on
 * for its embedded server (`desktop/main.ts`), unless its environment says otherwise.
 */

export interface BackgroundJobsDecision {
  on: boolean;
  /** Why, for the startup log line. */
  reason: string;
}

const ON = ["on", "1", "true", "yes"];
const OFF = ["off", "0", "false", "no"];

export function backgroundJobsDecision(env: Record<string, string | undefined>): BackgroundJobsDecision {
  const raw = (env.BACKGROUND_JOBS ?? "").trim().toLowerCase();
  if (ON.indexOf(raw) >= 0) return { on: true, reason: `BACKGROUND_JOBS=${raw}` };
  if (OFF.indexOf(raw) >= 0) return { on: false, reason: `BACKGROUND_JOBS=${raw}` };
  if (raw) return { on: false, reason: `BACKGROUND_JOBS=${raw} is not on/off, treated as off` };
  return { on: false, reason: "BACKGROUND_JOBS is not set" };
}
