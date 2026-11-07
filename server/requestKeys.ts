import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "./db";
import { requestKeys as requestKeysTable } from "@shared/schema";
import { actorIdOf } from "./services/auditService";
import {
  IDEMPOTENCY_HEADER,
  REPLAYED_HEADER,
  REPLAY_WAIT_MS,
  REPLAY_POLL_MS,
  KEY_TTL_MS,
  PRUNE_EVERY_MS,
  IN_PROGRESS_MESSAGE,
  REPLAY_UNAVAILABLE_MESSAGE,
  MISMATCH_MESSAGE,
  isValidIdempotencyKey,
  decideRepeat,
  bodyHashInput,
  keyPath,
  storableBody,
  isMissingTableError,
  type KeyFingerprint,
} from "@shared/requestKeys";

/**
 * One-time request keys — mount AFTER requireAuth on the hot write routes:
 *   POST /api/orders, PUT /api/orders/:id/items, POST /api/orders/:id/payment,
 *   POST /api/print/kot, POST /api/print/bill, POST /api/print/jobs/:id/claim.
 *
 * With an `Idempotency-Key` header the route runs at most once per (key, user): the first request
 * claims the key (INSERT … ON CONFLICT DO NOTHING — exactly one wins, across Vercel instances), its
 * JSON answer is stored BEFORE it is sent, and any repeat gets that stored answer (header
 * `Idempotent-Replayed: true`). Without the header nothing changes. Rules: shared/requestKeys.ts.
 * Spec: docs/superpowers/specs/2026-11-07-network-stall-breaker-design.md
 */

let missingTableLogged = false;
let lastPruneAt = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function requestKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.get(IDEMPOTENCY_HEADER);
  if (key === undefined) return next();
  if (!isValidIdempotencyKey(key)) {
    res.status(400).json({ message: "Invalid Idempotency-Key header.", code: "bad_idempotency_key" });
    return;
  }
  const fp: KeyFingerprint = {
    actorId: actorIdOf(req),
    method: req.method,
    path: keyPath(req.originalUrl),
    bodyHash: crypto.createHash("sha256").update(bodyHashInput(req.body)).digest("hex"),
  };

  let claimed: boolean;
  try {
    const rows = await db
      .insert(requestKeysTable)
      .values({ key, ...fp, state: "processing" })
      .onConflictDoNothing()
      .returning({ key: requestKeysTable.key });
    claimed = rows.length > 0;
  } catch (err) {
    if (isMissingTableError(err)) {
      // Deploy-order safety net: never block a tap because the migration hasn't been run.
      if (!missingTableLogged) {
        missingTableLogged = true;
        console.error("[request-keys] table request_keys is missing — run scripts/migrate-request-keys.mjs. Keyed requests run WITHOUT replay protection until then.");
      }
      return next();
    }
    console.error("[request-keys] could not claim the key:", err);
    res.status(503).json({ message: "Could not start the request safely — try again.", code: "request_keys_unavailable" });
    return;
  }

  if (claimed) {
    storeAnswerBeforeSending(key, res);
    res.on("finish", maybePrune);
    return next();
  }
  await answerRepeat(key, fp, res);
}

/** Wraps res.json so the route's final status + body land in the key's row before the answer is sent. */
function storeAnswerBeforeSending(key: string, res: Response): void {
  const send = res.json.bind(res);
  res.json = ((body: unknown) => {
    const status = res.statusCode;
    void (async () => {
      try {
        await db
          .update(requestKeysTable)
          .set({ state: "done", responseStatus: status, responseBody: storableBody(body), completedAt: new Date() })
          .where(eq(requestKeysTable.key, key));
      } catch (err) {
        // The row stays "processing": a repeat gets request_in_progress (and refreshes) — never a re-run.
        console.error("[request-keys] could not store the answer:", err);
      } finally {
        send(body);
      }
    })();
    return res;
  }) as Response["json"];
}

/** A repeat of a claimed key: replay, wait for the first run, or refuse. */
async function answerRepeat(key: string, fp: KeyFingerprint, res: Response): Promise<void> {
  const deadline = Date.now() + REPLAY_WAIT_MS;
  try {
    for (;;) {
      const [row] = await db.select().from(requestKeysTable).where(eq(requestKeysTable.key, key));
      if (!row) {
        res.status(409).json({ message: IN_PROGRESS_MESSAGE, code: "request_in_progress" });
        return;
      }
      const d = decideRepeat(row, fp);
      if (d.kind === "mismatch") {
        res.status(422).json({ message: MISMATCH_MESSAGE, code: "idempotency_key_mismatch" });
        return;
      }
      if (d.kind === "replay") {
        res.setHeader(REPLAYED_HEADER, "true");
        res.status(d.status).json(d.body);
        return;
      }
      if (d.kind === "replay_unavailable") {
        res.status(409).json({ message: REPLAY_UNAVAILABLE_MESSAGE, code: "replay_unavailable" });
        return;
      }
      if (Date.now() >= deadline) {
        res.status(409).json({ message: IN_PROGRESS_MESSAGE, code: "request_in_progress" });
        return;
      }
      await sleep(REPLAY_POLL_MS);
    }
  } catch (err) {
    console.error("[request-keys] could not read the key:", err);
    if (!res.headersSent) {
      res.status(503).json({ message: "Could not check the earlier attempt — refresh before trying again.", code: "request_keys_unavailable" });
    }
  }
}

/** Best effort (Vercel has no schedulers): drop keys older than 24 h, at most every 10 min per instance. */
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
  void (async () => {
    try {
      await db.delete(requestKeysTable).where(lt(requestKeysTable.createdAt, new Date(now - KEY_TTL_MS)));
    } catch (err) {
      console.error("[request-keys] prune failed:", err);
    }
  })();
}
