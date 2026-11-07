/**
 * "At most `max` events per `windowMs`" — used to cap diagnostic reports (perf.slow_request,
 * perf.stall_reset) so a bad network can't flood the audit log, while the log can never go silent
 * for the rest of a session (the old 200-per-session cap went silent from ~20:00 on 6 Nov 2026).
 */
export interface RollingBudget {
  /** True (and counts it) if another event fits in the window ending at `now`. */
  tryTake(now: number): boolean;
}

export function createRollingBudget(max: number, windowMs: number): RollingBudget {
  let stamps: number[] = [];
  return {
    tryTake(now: number): boolean {
      stamps = stamps.filter((t) => now - t < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(now);
      return true;
    },
  };
}
