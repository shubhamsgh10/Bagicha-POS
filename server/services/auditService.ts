import type { Request } from "express";
import { db } from "../db";
import { auditLogs } from "../../shared/schema";
import { desc, eq, and } from "drizzle-orm";

function getActorFromReq(req: Request) {
  const user = (req as any).user;
  if (!user) return { actorId: "anonymous", actorName: "anonymous", actorRole: "none" };
  const id = user.id ?? user.staffId ?? "?";
  const name = user.username ?? user.name ?? String(id);
  const role = user.role ?? "staff";
  return { actorId: String(id), actorName: name, actorRole: role };
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
