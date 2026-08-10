import type { Request } from "express";
import { db } from "../db";
import { auditLogs } from "../../shared/schema";
import { desc, eq, and } from "drizzle-orm";

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
