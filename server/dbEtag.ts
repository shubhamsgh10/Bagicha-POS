import type { Request, Response } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { ifNoneMatchHits } from "./httpConditional";

/**
 * Conditional GET for small, rarely-changing tables (menu, categories) without shipping the rows
 * out of Postgres when nothing changed.
 *
 * The ETag is an md5 computed IN the database over every row of the table, so checking freshness
 * costs one 32-byte result instead of the whole list. When the client's If-None-Match matches, the
 * response is a bodiless 304 and the rows are never read; otherwise the rows are loaded and sent
 * with the new ETag. Any change to any row (even one the endpoint filters out) changes the tag —
 * that only ever costs an unnecessary full response, never a stale one.
 *
 * `Cache-Control: private, no-cache` (overriding the global /api `no-store`) lets the browser /
 * Electron keep the body but forces a revalidation on every use, so it can never serve a stale
 * menu — the reason the global no-store exists. `private` keeps shared caches (Vercel's edge) out.
 */
export function tableFingerprint(tableName: string): SQL {
  const t = sql.identifier(tableName);
  return sql`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS h FROM ${t} t`;
}

export async function sendWithDbEtag(
  req: Request,
  res: Response,
  tag: string,
  fingerprint: SQL,
  load: () => Promise<unknown>,
): Promise<void> {
  const result: any = await db.execute(fingerprint);
  const hash = String(result?.rows?.[0]?.h ?? "none");
  const etag = `W/"${tag}-${hash}"`;
  if (ifNoneMatchHits(req.headers["if-none-match"], etag)) {
    res.set("Cache-Control", "private, no-cache").set("ETag", etag).status(304).end();
    return;
  }
  const body = await load(); // a throw here leaves the error response without cache headers
  res.set("Cache-Control", "private, no-cache").set("ETag", etag).json(body);
}
