// Per-device bearer tokens for the shop PC's sync worker. Only the sha256 of a token is stored;
// the token itself is shown once, at creation. Cloud-only (needs the pg pool).
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cloudPool() {
  if (!pool) throw new Error("Sync endpoints need the cloud (pg) database");
  return pool;
}

export async function createDeviceToken(name: string): Promise<{ id: number; token: string }> {
  const token = crypto.randomBytes(32).toString("hex");
  const { rows } = await cloudPool().query(
    `INSERT INTO sync_devices (name, token_hash) VALUES ($1, $2) RETURNING id`,
    [name, hashToken(token)],
  );
  return { id: rows[0].id, token };
}

export async function listDevices() {
  const { rows } = await cloudPool().query(
    `SELECT id, name, created_at, last_seen_at, revoked_at FROM sync_devices ORDER BY id DESC`,
  );
  return rows;
}

export async function revokeDevice(id: number): Promise<boolean> {
  const { rowCount } = await cloudPool().query(
    `UPDATE sync_devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export interface SyncDevice { id: number; lastSeenAt: Date | null }

/** Not 401: the database could not be asked, so callers answer 503 and the device retries. */
export class DeviceAuthUnavailable extends Error {}

const BEARER_RE = /^Bearer\s+([0-9a-f]{64})$/i;

/**
 * The non-revoked device a `Authorization: Bearer <64 hex>` header belongs to, or null. The token is
 * looked up by its sha256 (a unique-indexed column), so no secret is compared byte by byte in JS; the
 * stored hash is also re-compared with timingSafeEqual. Throws DeviceAuthUnavailable on a DB error.
 * Shared by requireDeviceToken and the replay middleware, so the two can never accept different things.
 */
export async function authenticateDevice(authorization: string | undefined): Promise<SyncDevice | null> {
  const m = BEARER_RE.exec(authorization ?? "");
  if (!m) return null;
  const hash = hashToken(m[1].toLowerCase());
  try {
    const { rows } = await cloudPool().query(
      `SELECT id, last_seen_at, token_hash FROM sync_devices WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hash],
    );
    if (rows.length === 0) return null;
    const stored = Buffer.from(String(rows[0].token_hash), "utf8");
    const given = Buffer.from(hash, "utf8");
    if (stored.length !== given.length || !crypto.timingSafeEqual(stored, given)) return null;
    // At most once a minute; awaited so a pull right after the snapshot sees it, never fails the request.
    await cloudPool()
      .query(
        `UPDATE sync_devices SET last_seen_at = now()
          WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
        [rows[0].id],
      )
      .catch(() => {});
    return { id: rows[0].id, lastSeenAt: rows[0].last_seen_at };
  } catch (err) {
    console.error("[sync] device auth failed:", err);
    throw new DeviceAuthUnavailable("Sync unavailable");
  }
}

/** `Authorization: Bearer <token>`; 401 unless it matches a non-revoked device. */
export async function requireDeviceToken(req: Request, res: Response, next: NextFunction) {
  if (!BEARER_RE.test(req.headers.authorization ?? "")) return res.status(401).json({ message: "Device token required" });
  try {
    const device = await authenticateDevice(req.headers.authorization);
    if (!device) return res.status(401).json({ message: "Invalid or revoked device token" });
    (req as any).syncDevice = device;
    next();
  } catch {
    res.status(503).json({ message: "Sync unavailable" });
  }
}
