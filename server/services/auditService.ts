import type { Request } from "express";
import { db } from "../db";
import { auditLogs } from "../../shared/schema";
import { desc, eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import type { AuditLog } from "../../shared/schema";

function getActorFromReq(req: Request) {
  const user = (req as any).user;
  if (!user) return { actorId: "anonymous", actorName: "anonymous", actorRole: "none" };
  const rawId = user.id ?? user.staffId ?? "?";
  // `users` and `staffMembers` share the integer id space (CLAUDE.md's id-collision
  // gotcha) — every logAudit() call site (order.payment, order.cancel,
  // order.coupon_applied, order.loyalty_redeemed, etc — including manager-elevated
  // actions reachable from a staff-tier PIN/card session) used to write a bare numeric
  // actorId, so a staff-card session with sm.id=N was indistinguishable in the audit
  // trail from a `users` row with id=N. Prefixed with kind, same "u:"/"sm:" convention
  // shared/pageAccess.ts's personPageKey already uses elsewhere in the app.
  const actorId = user._isStaffMember ? `sm:${rawId}` : `u:${rawId}`;
  const name = user.username ?? user.name ?? String(rawId);
  const role = user.role ?? "staff";
  return { actorId, actorName: name, actorRole: role };
}

function getIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

export async function logAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string | number | null,
  metadata?: Record<string, unknown> | null,
): Promise<void> {
  try {
    const actor = getActorFromReq(req);
    await db.insert(auditLogs).values({
      ...actor,
      action,
      entityType,
      entityId: entityId != null ? String(entityId) : null,
      metadata: metadata ?? null,
      ip: getIp(req),
    });
  } catch {
    // never let audit failure break a real request
  }
}

export async function getAuditLogs(opts: {
  limit?: number;
  offset?: number;
  action?: string;
  entityType?: string;
}) {
  const { limit = 50, offset = 0, action, entityType } = opts;

  const conditions = [];
  if (action)     conditions.push(eq(auditLogs.action,     action));
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));

  const rows = await db
    .select()
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}
// KOT/Bill Activity summary — Reports.tsx's "KOT & Bill Activity" tab (Petpooja's
// "Leakage Alert"). Deliberately lives here, not in storage.ts — the whole audit
// subsystem (this file) intentionally sits outside the IStorage/DatabaseStorage
// repository pattern that owns every other table, and this aggregation is squarely
// audit_logs' own data, not an operational-table query.
const KOT_BILL_ACTIONS = [
  "order.cancel", "order.move_table", "order.write_off",
  "kot.reprint", "bill.reprint", "order.items_edit",
] as const;

export interface KotBillActivitySummary {
  kotCancelled: number;
  kotModified: number;
  kotShifted: number;
  billModified: number;
  billReprinted: number;
  billWaivedOff: number;
  recentEvents: Array<Pick<AuditLog, "id" | "createdAt" | "actorName" | "actorRole" | "action" | "entityId" | "metadata">>;
}

export async function getKotBillActivitySummary(startDate: Date, endDate: Date): Promise<KotBillActivitySummary> {
  const inRange = and(
    gte(auditLogs.createdAt, startDate),
    lte(auditLogs.createdAt, endDate),
    inArray(auditLogs.action, [...KOT_BILL_ACTIONS]),
  );

  // One round trip, six COUNT(*) FILTER columns — same idiom
  // server/storage.ts's getDashboardStats already uses for its coalesce(sum(...))
  // computed columns. No GROUP BY, so this returns exactly one row (a scalar aggregate
  // over the filtered set), same shape as that precedent.
  const [counts] = await db.select({
    kotCancelled: sql<number>`count(*) filter (where ${auditLogs.action} = 'order.cancel')`,
    kotShifted:   sql<number>`count(*) filter (where ${auditLogs.action} = 'order.move_table')`,
    billWaivedOff: sql<number>`count(*) filter (where ${auditLogs.action} = 'order.write_off')`,
    // Merged per the locked decision — matches the Petpooja reference's single
    // "Re-printed" tile under Bills. The drill-down list below still distinguishes
    // kot.reprint from bill.reprint per-row.
    billReprinted: sql<number>`count(*) filter (where ${auditLogs.action} in ('kot.reprint', 'bill.reprint'))`,
    // KOT-Modified / Bill-Modified are deliberately non-exclusive — a single
    // order.items_edit row (adding an item, say) routinely changes BOTH the ticket and
    // the bill, and can count toward both. This SQL is a second, independent expression
    // of the exact same rule already live in routes.ts's PUT /api/orders/:id/items
    // handler (its `diff.isEmpty` check, from shared/orderAudit.ts's diffOrderLines, and
    // its `moneyChanged` local) — see shared/orderAudit.ts's classifyItemsEditRow for the
    // pure-function twin of this pair of predicates. Keep all three in sync.
    //
    // order.discount_applied is deliberately excluded from both buckets — it's a strict
    // subset of an items_edit row's own moneyChanged flag (logged redundantly inside the
    // same edit request whenever discount changed), so counting it too would double-count
    // one user action.
    //
    // ⚠️ auditLogs.metadata is `json`, not `jsonb` (shared/schema.ts) — json_array_length,
    // not jsonb_array_length, or Postgres throws "function jsonb_array_length(json) does
    // not exist".
    kotModified: sql<number>`count(*) filter (where ${auditLogs.action} = 'order.items_edit' and (
      json_array_length(${auditLogs.metadata}->'added') > 0
      or json_array_length(${auditLogs.metadata}->'removed') > 0
      or json_array_length(${auditLogs.metadata}->'changed') > 0
    ))`,
    billModified: sql<number>`count(*) filter (where ${auditLogs.action} = 'order.items_edit' and (
      (${auditLogs.metadata}->>'totalBefore')::numeric is distinct from (${auditLogs.metadata}->>'totalAfter')::numeric
      or (${auditLogs.metadata}->>'discountBefore')::numeric is distinct from (${auditLogs.metadata}->>'discountAfter')::numeric
      or (${auditLogs.metadata}->>'containerBefore')::numeric is distinct from (${auditLogs.metadata}->>'containerAfter')::numeric
    ))`,
  }).from(auditLogs).where(inRange);

  // Bounded drill-down fetch for display — not fetch-everything-and-count-in-JS; the
  // counts above are already computed server-side by the query above.
  const recentEvents = await db.select({
    id: auditLogs.id,
    createdAt: auditLogs.createdAt,
    actorName: auditLogs.actorName,
    actorRole: auditLogs.actorRole,
    action: auditLogs.action,
    entityId: auditLogs.entityId,
    metadata: auditLogs.metadata,
  }).from(auditLogs).where(inRange).orderBy(desc(auditLogs.createdAt)).limit(20);

  return {
    kotCancelled: Number(counts?.kotCancelled ?? 0),
    kotModified: Number(counts?.kotModified ?? 0),
    kotShifted: Number(counts?.kotShifted ?? 0),
    billModified: Number(counts?.billModified ?? 0),
    billReprinted: Number(counts?.billReprinted ?? 0),
    billWaivedOff: Number(counts?.billWaivedOff ?? 0),
    recentEvents,
  };
}
