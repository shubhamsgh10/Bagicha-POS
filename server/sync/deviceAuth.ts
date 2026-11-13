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

/** `Authorization: Bearer <token>`; 401 unless it matches a non-revoked device. */
export async function requireDeviceToken(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(req.headers.authorization ?? "");
  if (!m) return res.status(401).json({ message: "Device token required" });
  try {
    const { rows } = await cloudPool().query(
      `SELECT id, last_seen_at FROM sync_devices WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(m[1])],
    );
    if (rows.length === 0) return res.status(401).json({ message: "Invalid or revoked device token" });
    (req as any).syncDevice = { id: rows[0].id, lastSeenAt: rows[0].last_seen_at } as SyncDevice;
    // At most once a minute; awaited so a pull right after the snapshot sees it, never fails the request.
    await cloudPool()
      .query(
        `UPDATE sync_devices SET last_seen_at = now()
          WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
        [rows[0].id],
      )
      .catch(() => {});
    next();
  } catch (err) {
    console.error("[sync] device auth failed:", err);
    res.status(503).json({ message: "Sync unavailable" });
  }
}
