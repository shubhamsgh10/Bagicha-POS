/**
 * When to send the connection keep-warm ping (GET /api/ping) — pure, no DOM or timers, so
 * scripts/verify-connection-keepalive.ts can drive it with a fake clock.
 *
 * Why this exists (measured, Oct–Nov 2026): the shop PC reaches Vercel through a mobile carrier's
 * NAT (Jio, public IPs 49.47.9.x). A connection that sits idle for a minute or two on the POS screen
 * — which makes no requests of its own while staff add items, or wait for the customer after the
 * bill — is sometimes dropped by the network WITHOUT a close reaching the PC. Chromium (Electron)
 * keeps sending on the dead HTTP/2 connection and only notices after its 10 s ping timeout
 * (net/spdy/spdy_session.cc: kHungIntervalSeconds = 10), then retries on a new connection. So the
 * next tap — KOT, Bill, Settle — takes ~10.3 s (+3 s / +9 s when the reconnect's SYN is lost too),
 * while the server itself answers in ~0.2 s. Every `perf.slow_settle` audit row has that shape,
 * and it reproduces exactly in Chrome behind a proxy that silently drops an idle connection.
 *
 * Traffic every ~15 s keeps the connection from ever going idle long enough to be dropped, and if
 * it dies anyway, the ping rather than a staff tap usually pays the 10 s detection.
 */

/** The connection never goes quieter than this before a ping is sent. */
export const KEEPALIVE_IDLE_MS = 15_000;
/** How often the client checks; the worst-case quiet period is KEEPALIVE_IDLE_MS + this. */
export const KEEPALIVE_TICK_MS = 5_000;
/** A wake-up (window shown/focused, network back) pings unless the connection carried a response this recently. */
export const KEEPALIVE_WAKE_GRACE_MS = 3_000;

export interface KeepAliveState {
  /** When the last API response finished (any request, the ping included), on the caller's clock; null = none yet. */
  lastResponseAt: number | null;
  /** When the last ping was sent; null = never. */
  lastPingAt: number | null;
}

export function shouldPing(
  state: KeepAliveState,
  now: number,
  reason: "tick" | "wake",
  active: boolean,
): boolean {
  if (!active) return false;
  const quietSince = Math.max(state.lastResponseAt ?? -Infinity, state.lastPingAt ?? -Infinity);
  const quietFor = now - quietSince;
  return quietFor >= (reason === "wake" ? KEEPALIVE_WAKE_GRACE_MS : KEEPALIVE_IDLE_MS);
}

/** True for a Resource Timing entry that is a request to our API (it keeps the same connection warm). */
export function isApiResourceUrl(url: string, apiOrigin: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === apiOrigin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}
