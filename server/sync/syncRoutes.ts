// Cloud side of local-first sync: snapshot + pull for the shop PC (device-token auth), device
// management for admins, and the SYNC_NUDGE publisher. SQL lives in changeLogSql.ts (proved on
// PGlite by scripts/verify-change-log.ts). Cloud-only: everything here needs the pg pool.
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "../db";
import { publishRealtime } from "../realtime/publisher";
import { logAudit } from "../services/auditService";
import { SYNC_TABLES, PULL_RESET_THRESHOLD, CHANGE_LOG_RETENTION_DAYS } from "../../shared/syncTables";
import {
  CURRENT_SNAPSHOT_SQL, PULL_SQL, snapshotSelectSql, fetchRowsSql, collapseChanges,
} from "./changeLogSql";
import { createDeviceToken, listDevices, revokeDevice, requireDeviceToken, type SyncDevice } from "./deviceAuth";

const SYNC_TABLE_SET = new Set<string>(SYNC_TABLES);
/** A pg_snapshot text: xmin:xmax:xip1,xip2 */
const SNAPSHOT_RE = /^\d+:\d+:(\d+(,\d+)*)?$/;
/** Retention is 7 days; a device unseen for longer than this may have missed pruned rows. */
const STALE_AFTER_MS = (CHANGE_LOG_RETENTION_DAYS - 1) * 24 * 3600 * 1000;

let lastPruneAt = 0;
function maybePrune() {
  const now = Date.now();
  if (!pool || now - lastPruneAt < 3600_000) return;
  lastPruneAt = now;
  pool
    .query(`DELETE FROM change_log WHERE changed_at < now() - ($1 || ' days')::interval`, [String(CHANGE_LOG_RETENTION_DAYS)])
    .catch((err) => console.error("[sync] prune failed:", err?.message ?? err));
}

/**
 * Nudge the shop PC after a write to a table that has no order/table/KOT event of its own.
 * Attached as middleware: fires once the response finished with a 2xx.
 */
export const syncNudgeOnWrite: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) void publishRealtime({ type: "SYNC_NUDGE" });
    });
  }
  next();
};

export function registerSyncRoutes(app: Express, requireAdmin: RequestHandler) {
  // Menu, categories, tables, settings (incl. print settings) and accounts have no realtime event
  // of their own — nudge the shop PC to pull. Orders/KOTs/table status already publish events.
  app.use(["/api/menu", "/api/categories", "/api/tables", "/api/settings", "/api/users", "/api/staff-members"], syncNudgeOnWrite);

  // ── Device management (admin) ──
  app.post("/api/sync/devices", requireAdmin, async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
      if (!name) return res.status(400).json({ message: "Device name is required" });
      const { id, token } = await createDeviceToken(name);
      await logAudit(req, "sync.device_create", "sync_device", id, { name });
      res.json({ id, name, token }); // the only time the token is ever returned
    } catch (err) {
      console.error("[sync] create device failed:", err);
      res.status(500).json({ message: "Failed to create device" });
    }
  });

  app.get("/api/sync/devices", requireAdmin, async (_req, res) => {
    try {
      const rows = await listDevices();
      res.json(rows.map((r) => ({
        id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at,
      })));
    } catch (err) {
      console.error("[sync] list devices failed:", err);
      res.status(500).json({ message: "Failed to list devices" });
    }
  });

  app.delete("/api/sync/devices/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
      const ok = await revokeDevice(id);
      if (!ok) return res.status(404).json({ message: "Device not found or already revoked" });
      await logAudit(req, "sync.device_revoke", "sync_device", id);
      res.json({ ok: true });
    } catch (err) {
      console.error("[sync] revoke device failed:", err);
      res.status(500).json({ message: "Failed to revoke device" });
    }
  });

  // ── Snapshot: every table + the cursor, from one moment ──
  app.get("/api/sync/snapshot", requireDeviceToken, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) return res.status(503).json({ message: "Sync unavailable" });
    // One dedicated client + one explicit transaction. No session-level SET: DATABASE_URL is a
    // transaction pooler and a SET would leak to the next client (CLAUDE.md, Database).
    const client = await pool.connect();
    let failed: unknown = null;
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const cursor = (await client.query(CURRENT_SNAPSHOT_SQL)).rows[0].snap as string; // first: fixes the snapshot
      const tables: Record<string, unknown[]> = {};
      for (const t of SYNC_TABLES) {
        tables[t] = (await client.query(snapshotSelectSql(t))).rows.map((r) => r.j);
      }
      await client.query("COMMIT");
      res.json({ cursor, tables });
    } catch (err) {
      failed = err;
      await client.query("ROLLBACK").catch(() => {});
      console.error("[sync] snapshot failed:", err);
      if (!res.headersSent) res.status(500).json({ message: "Snapshot failed" });
    } finally {
      client.release(failed ? (failed as Error) : undefined);
    }
  });

  // ── Pull: what changed since the device's snapshot cursor ──
  app.get("/api/sync/pull", requireDeviceToken, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) return res.status(503).json({ message: "Sync unavailable" });
    const prev = typeof req.query.cursor === "string" ? req.query.cursor : "";
    if (!SNAPSHOT_RE.test(prev)) return res.status(400).json({ message: "Invalid cursor" });
    try {
      const device = (req as any).syncDevice as SyncDevice;
      // A device unseen for ~the retention window may have missed pruned rows: start over.
      if (!device.lastSeenAt || Date.now() - new Date(device.lastSeenAt).getTime() > STALE_AFTER_MS) {
        return res.json({ reset: true });
      }
      const cur = (await pool.query(CURRENT_SNAPSHOT_SQL)).rows[0].snap as string; // first, per design
      const log = (await pool.query(PULL_SQL, [prev, cur])).rows;
      if (log.length > PULL_RESET_THRESHOLD) return res.json({ reset: true });

      const collapsed = collapseChanges(log).filter((c) => SYNC_TABLE_SET.has(c.table));
      const idsByTable = new Map<string, number[]>();
      for (const c of collapsed) {
        const list = idsByTable.get(c.table) ?? [];
        list.push(c.id);
        idsByTable.set(c.table, list);
      }
      const rowsByKey = new Map<string, unknown>();
      await Promise.all(Array.from(idsByTable.entries()).map(async ([table, ids]) => {
        const { rows } = await pool!.query(fetchRowsSql(table), [ids]);
        for (const r of rows) rowsByKey.set(`${table}:${r.id}`, r.j);
      }));
      const changes = collapsed.map((c) => ({ table: c.table, id: c.id, row: rowsByKey.get(`${c.table}:${c.id}`) ?? null }));
      res.json({ cursor: cur, changes });
      maybePrune();
    } catch (err) {
      console.error("[sync] pull failed:", err);
      if (!res.headersSent) res.status(500).json({ message: "Pull failed" });
    }
  });
}
