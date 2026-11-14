// Pure: how the shop PC's local server treats each /api request (phase 4: everything local that can
// be). The local copy holds the full order history and 21 business tables, so EVERY GET is answered
// locally except a short list of things the PC has no data for (WhatsApp, automation, CRM, Razorpay,
// feedback, digests, 2FA, backups, coupon redemptions) or that only mean something at the cloud
// (device management, Pusher/realtime config). Writes: the replay list runs locally and is queued for
// the cloud; print plumbing runs locally; everything else needs the internet.
import { isReplayable } from "../../shared/replayRules";

/** GET prefixes the PC cannot answer: proxied while online, "Needs internet" (503 ONLINE_ONLY) offline. */
export const CLOUD_ONLY_GET_PREFIXES = [
  "/api/whatsapp", "/api/automation", "/api/crm", "/api/razorpay", "/api/feedback", "/api/digest",
  "/api/sync/", "/api/pusher", "/api/realtime", "/api/auth/2fa", "/api/admin/backups", "/api/coupons/redemptions",
] as const;

function norm(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function isCloudOnlyGet(path: string): boolean {
  const p = norm(path);
  return CLOUD_ONLY_GET_PREFIXES.some((x) => (x.endsWith("/") ? p.startsWith(x) : p === x || p.startsWith(x + "/")));
}

/** GET /api/auth/context: the cloud's answer (it sees the shop's public address) while online, the local one offline. */
export function isCloudFirstGet(path: string): boolean {
  return norm(path) === "/api/auth/context";
}

/** Is this request answered by the local routes from the local database? (GET only.) */
export function isLocalRead(method: string, path: string, _query: Record<string, unknown> = {}, _coverageStart?: Date | null): boolean {
  if (method.toUpperCase() !== "GET") return false;
  return !isCloudOnlyGet(path) && !isCloudFirstGet(path);
}

/** The local server's own endpoints (never proxied). */
export function isLocalOnly(path: string): boolean {
  return path === "/api/local" || path.startsWith("/api/local/");
}

export type WriteClass =
  | "login"        // cloud first (online), local verification when offline
  | "verify-pin"   // always local (also tells the cloud, best effort, while online)
  | "logout"       // always through the proxy: it signs out locally even when the cloud is unreachable
  | "replay"       // runs locally and is appended to the outbox
  | "local"        // runs locally, not replayed (print plumbing)
  | "quiet"        // telemetry: dropped quietly when offline, forwarded when online
  | "online-only"; // forwarded while online, 503 ONLINE_ONLY offline

export function classifyWrite(method: string, path: string): WriteClass {
  const m = method.toUpperCase();
  const p = norm(path);
  if (m === "POST" && (p === "/api/auth/login" || p === "/api/auth/card-login" || p === "/api/auth/staff-pin-login")) return "login";
  if (m === "POST" && p === "/api/auth/verify-pin") return "verify-pin";
  if (m === "POST" && p === "/api/auth/logout") return "logout";
  if (isReplayable(m, p)) return "replay";
  if (p.startsWith("/api/print/")) return "local";
  if (p.startsWith("/api/perf/")) return "quiet";
  return "online-only";
}
