// Cloud side of local-first sync: snapshot + pull for the shop PC (device-token auth), device
// management for admins, and the SYNC_NUDGE publisher. SQL lives in changeLogSql.ts (proved on
// PGlite by scripts/verify-change-log.ts). Cloud-only: everything here needs the pg pool.
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "../db";
import { publishRealtime } from "../realtime/publisher";
import { logAudit } from "../services/auditService";
import {
  SYNC_TABLES, SYNC_TABLES_V2, UUID_ID_TABLES, PULL_RESET_THRESHOLD, CHANGE_LOG_RETENTION_DAYS,
  SNAPSHOT_PAGE_SIZE, SNAPSHOT_PAGE_MAX, LEASE_DEFAULT_SIZE,
} from "../../shared/syncTables";
import {
  CURRENT_SNAPSHOT_SQL, PULL_SQL, snapshotSelectSql, snapshotPageSql, fetchRowsSql, collapseChanges, rowJsonSql,
} from "./changeLogSql";
import { attachAuth } from "./authBlob";
import { issueLease, isLeaseKind, clampLeaseSize, LeaseError } from "./leases";
import { noteCounterAdvanced } from "../settingsStore";
import { createDeviceToken, listDevices, revokeDevice, requireDeviceToken, type SyncDevice } from "./deviceAuth";

const SYNC_TABLE_SET = new Set<string>(SYNC_TABLES);
const SYNC_TABLE_SET_V2 = new Set<string>(SYNC_TABLES_V2);
const UUID_SET = new Set<string>(UUID_ID_TABLES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  app.get("/api/sync/snapshot", requireDeviceToken, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) return res.status(503).json({ message: "Sync unavailable" });

    // Protocol v2 (phase 4): full history, paged by id so no response nears Vercel's 4.5 MB cap.
    //   ?v=2&begin=1                      → { cursor, tables, pageSize }   (take the cursor FIRST)
    //   ?v=2&table=T[&after=ID][&limit=N] → { table, rows, next }         (next = last id, null when done)
    // The pages are plain reads; the device then pulls from the begin-cursor, which re-sends anything
    // that changed while it was paging (and tombstones deletions), so no single transaction is needed.
    if (req.query.v === "2") {
      try {
        if (req.query.begin === "1") {
          const cursor = (await pool.query(CURRENT_SNAPSHOT_SQL)).rows[0].snap as string;
          return res.json({ cursor, tables: Array.from(SYNC_TABLES_V2), pageSize: SNAPSHOT_PAGE_SIZE });
        }
        const table = typeof req.query.table === "string" ? req.query.table : "";
        if (!SYNC_TABLE_SET_V2.has(table)) return res.status(400).json({ message: "Unknown table" });
        const afterRaw = typeof req.query.after === "string" && req.query.after !== "" ? req.query.after : null;
        if (afterRaw !== null && !(UUID_SET.has(table) ? UUID_RE.test(afterRaw) : /^\d{1,10}$/.test(afterRaw))) {
          return res.status(400).json({ message: "Invalid after" });
        }
        const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? SNAPSHOT_PAGE_SIZE), 10) || SNAPSHOT_PAGE_SIZE, 1), SNAPSHOT_PAGE_MAX);
        const got = (await pool.query(snapshotPageSql(table), [afterRaw, limit])).rows;
        const rows = got.map((r) => r.j as Record<string, any>);
        await attachAuth(pool as any, table, rows);
        const next = got.length === limit ? String(got[got.length - 1].id) : null;
        return res.json({ table, rows, next });
      } catch (err) {
        console.error("[sync] v2 snapshot failed:", err);
        return res.status(500).json({ message: "Snapshot failed" });
      }
    }

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

      // Phase-3 PCs (no v=2) only know the 9 original tables and refuse the rest.
      const v2 = req.query.v === "2";
      const known = v2 ? SYNC_TABLE_SET_V2 : SYNC_TABLE_SET;
      const collapsed = collapseChanges(log).filter((c) => known.has(c.table));
      const idsByTable = new Map<string, Array<number | string>>();
      for (const c of collapsed) {
        const list = idsByTable.get(c.table) ?? [];
        list.push(c.id);
        idsByTable.set(c.table, list);
      }
      const rowsByKey = new Map<string, unknown>();
      await Promise.all(Array.from(idsByTable.entries()).map(async ([table, ids]) => {
        const { rows } = await pool!.query(fetchRowsSql(table), [ids]);
        // v2 devices verify logins offline: users / staff_members rows carry `_auth` (see authBlob.ts).
        if (v2) await attachAuth(pool as any, table, rows.map((r) => r.j));
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
  // ── Leases: blocks of order ids / bill numbers / KOT numbers for offline work ──
  // POST { kind: "order_id" | "bill_counter" | "kot_counter", size? } → { kind, start, end } (inclusive).
  // See server/sync/leases.ts for how cloud inserts are kept out of an issued block.
  app.post("/api/sync/lease", requireDeviceToken, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const kind = req.body?.kind;
      if (!isLeaseKind(kind)) return res.status(400).json({ message: "Unknown lease kind", code: "bad_kind" });
      const device = (req as any).syncDevice as SyncDevice;
      const lease = await issueLease(device.id, kind, clampLeaseSize(req.body?.size ?? LEASE_DEFAULT_SIZE));
      if (kind !== "order_id") noteCounterAdvanced(kind === "bill_counter" ? "billCounter" : "kotCounter", lease.end);
      res.json({ kind: lease.kind, start: lease.start, end: lease.end });
    } catch (err) {
      if (err instanceof LeaseError) return res.status(err.status).json({ message: err.message, code: err.code });
      console.error("[sync] lease failed:", err);
      res.status(500).json({ message: "Lease failed" });
    }
  });

  // ── One order's cloud rows (the acknowledgement refresh) ──
  // { order, items, kotTickets } in the same JSON shape as pull rows (secrets stripped), or { deleted: true }.
  app.get("/api/sync/order/:id", requireDeviceToken, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) return res.status(503).json({ message: "Sync unavailable" });
    const id = /^\d{1,10}$/.test(req.params.id) ? Number(req.params.id) : NaN;
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
    const client = await pool.connect();
    let failed: unknown = null;
    try {
      // One snapshot for the three reads, so the order, its items and its tickets agree.
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const order = (await client.query(`SELECT ${rowJsonSql("orders")} AS j FROM orders t WHERE t.id = $1`, [id])).rows[0]?.j;
      if (!order) {
        await client.query("COMMIT");
        return res.json({ deleted: true });
      }
      const items = (await client.query(`SELECT ${rowJsonSql("order_items")} AS j FROM order_items t WHERE t.order_id = $1 ORDER BY t.id`, [id])).rows.map((r) => r.j);
      const kotTickets = (await client.query(`SELECT ${rowJsonSql("kot_tickets")} AS j FROM kot_tickets t WHERE t.order_id = $1 ORDER BY t.id`, [id])).rows.map((r) => r.j);
      await client.query("COMMIT");
      res.json({ order, items, kotTickets });
    } catch (err) {
      failed = err;
      await client.query("ROLLBACK").catch(() => {});
      console.error("[sync] order refresh failed:", err);
      if (!res.headersSent) res.status(500).json({ message: "Order refresh failed" });
    } finally {
      client.release(failed ? (failed as Error) : undefined);
    }
  });
}
