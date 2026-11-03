/**
 * Which manual-charge boxes the POS cart totals panel offers (pure — unit-tested by
 * scripts/verify-charge-boxes.ts):
 *   table session → Container Charge
 *   standalone dine-in → neither box
 *   standalone pickup  → Container Charge
 *   standalone delivery → Container Charge + Delivery Charge
 *
 * A table session is always dine-in (the top bar shows a single Dine-In pill — there is no
 * per-item Pickup/Delivery toggle any more), and staff may still need to add a container
 * charge to a table's bill (leftovers packed to go), so that box is always offered there.
 * A standalone order (pickup/delivery mode, or a new order with no table) reads its
 * order-type tab instead.
 *
 * Whatever the mode, a box holding a non-zero amount is always shown: the amount is inside
 * the total, and a charge nobody can see (or clear) is worse than an extra box.
 *
 * Section POS never reaches this — POS.tsx doesn't render the totals block there
 * (SectionActionBar has its own Container box), so there is no section flag.
 */
export interface ChargeBoxContext {
  /** Table/edit session (always dine-in). */
  isTableSession: boolean;
  /** The form's order-type tab — "dine-in" | "takeaway" | "delivery" (standalone orders). */
  orderType: string | undefined;
  containerCharge: number;
  deliveryCharge: number;
}

export function chargeBoxVisibility(ctx: ChargeBoxContext): { showContainer: boolean; showDelivery: boolean } {
  const deliveryApplies = !ctx.isTableSession && ctx.orderType === "delivery";
  const containerApplies = ctx.isTableSession || deliveryApplies || ctx.orderType === "takeaway";
  return {
    showContainer: containerApplies || ctx.containerCharge > 0,
    showDelivery: deliveryApplies || ctx.deliveryCharge > 0,
  };
}
