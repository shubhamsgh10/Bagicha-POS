// Middleware for the replay list on the shop PC: the route runs normally against the local database
// (so every money / KOT rule applies offline); when it answers 2xx the request is appended to the
// outbox BEFORE the answer is sent, so an action the person saw succeed can never be missing from it.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PGlite } from "@electric-sql/pglite";
import { isValidIdempotencyKey } from "../../shared/requestKeys";
import { freshPinApprover } from "../elevation";
import {
  appendOutbox, getOrderBase, hasPendingFor, localRowBase, newIdemKey, orderIdOfPath, requestCtx,
  type RequestNumbers,
} from "./outbox";

export interface OutboxCaptureOptions {
  client: PGlite;
  /** Wake the sync/replay worker after an append. */
  wake(): void;
}

function actorRef(req: Request): string | null {
  const u = (req as any).user;
  if (!u || u.id === undefined || u.id === null) return null;
  return u._isStaffMember ? `sm:${u.id}` : `u:${u.id}`;
}

/** Orders touched by routes whose path doesn't name one: a KOT ticket's order, a shifted table's current order. */
async function resolveOrderId(client: PGlite, req: Request, path: string): Promise<number | null> {
  const direct = orderIdOfPath(path, req.body);
  if (direct !== null) return direct;
  let m = /^\/api\/kot\/(\d+)$/.exec(path);
  if (m) return (await client.query<{ o: number }>(`SELECT order_id AS o FROM kot_tickets WHERE id = $1`, [Number(m[1])])).rows[0]?.o ?? null;
  m = /^\/api\/tables\/(\d+)\/shift$/.exec(path);
  if (m) return (await client.query<{ o: number | null }>(`SELECT current_order_id AS o FROM tables WHERE id = $1`, [Number(m[1])])).rows[0]?.o ?? null;
  return null;
}

export function createOutboxCapture(opts: OutboxCaptureOptions): RequestHandler {
  const { client } = opts;
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = req.originalUrl.split("?")[0].replace(/\/+$/, "");
      let orderId = await resolveOrderId(client, req, path);
      // The cloud version this edit is based on — read BEFORE the handler changes the local row.
      // Only for the first unreplayed edit of an order: later ones take it from the previous
      // entry's acknowledgement (the replayer fills it in).
      let base: string | null = null;
      if (orderId !== null && !(await hasPendingFor(client, orderId))) {
        base = (await getOrderBase(client, orderId)) ?? (await localRowBase(client, orderId));
      }
      const numbers: RequestNumbers = { kotNos: [] };
      const headerKey = req.get("Idempotency-Key");
      const idemKey = headerKey && isValidIdempotencyKey(headerKey) ? headerKey : newIdemKey();

      const send = res.json.bind(res);
      res.json = ((body: unknown) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300 && res.getHeader("Idempotent-Replayed") !== "true";
        const actor = actorRef(req);
        if (!ok || !actor) { send(body); return res; }
        void (async () => {
          try {
            if (orderId === null && req.method === "POST" && path === "/api/orders") {
              const id = Number((body as any)?.id);
              orderId = Number.isInteger(id) ? id : null;
            }
            await appendOutbox(client, {
              orderId, method: req.method, path, body: req.body, idemKey, actor,
              approver: freshPinApprover(req)?.id ?? null, base,
              numbers: numbers.id !== undefined || numbers.billNo !== undefined || numbers.kotNos.length ? numbers : null,
            });
            opts.wake();
          } catch (err) {
            // Never lose the action silently: the person must know it was not queued.
            console.error("[local-outbox] FAILED to queue an action for the cloud:", err);
            res.status(500);
            send({ message: "Saved on this PC but could not be queued for the cloud — tell the owner", code: "OUTBOX_FAILED" });
            return;
          }
          send(body);
        })();
        return res;
      }) as Response["json"];

      requestCtx.run({ numbers }, () => next());
    } catch (err) {
      next(err);
    }
  };
}
