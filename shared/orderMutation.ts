import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { orders } from "./schema";

/**
 * Fields a client may PUT onto an existing order via PUT /api/orders/:id.
 *
 * This used to be `insertOrderSchema.partial()` — every column on `orders`, including
 * `totalAmount`, `taxAmount`, `discountAmount`, `paidAmount`, `paymentStatus`, and
 * `changeAmount`. Any authenticated session (bare staff PIN included) could PUT an
 * arbitrary total or flip an order to "paid" with no server recompute and no elevation
 * check — the exact thing the "server recomputes all money" invariant exists to prevent.
 *
 * Money/payment state must only ever change through a path that recomputes it server-side:
 * POST /api/orders, PUT /api/orders/:id/items (both go through shared/orderPricing.ts),
 * POST /api/orders/:id/payment (settlement), or the elevation-gated cancel/hold/recall/
 * move-table/merge/split endpoints. This allowlist is deliberately narrow — the only
 * confirmed client caller (client/src/pages/Orders.tsx) sends `{status}` alone. Extend it
 * only for genuinely non-money, non-identity fields.
 */
export const orderUpdateAllowlist = createInsertSchema(orders)
  .pick({ status: true, notes: true, customerName: true, customerPhone: true })
  .partial();

export type OrderUpdateInput = z.infer<typeof orderUpdateAllowlist>;

/** Fields POST /api/orders must never take from the client body — always server-decided at creation. */
export const ORDER_CREATE_FORCED_DEFAULTS = {
  paymentStatus: "pending" as const,
  paidAmount: null,
  changeAmount: "0",
  paymentMethod: null,
  paymentBreakdown: null,
};
