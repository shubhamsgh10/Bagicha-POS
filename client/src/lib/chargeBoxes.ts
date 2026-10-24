/**
 * Which manual-charge boxes the POS cart totals panel offers (pure — unit-tested by
 * scripts/verify-charge-boxes.ts):
 *   dine-in  → neither box
 *   pickup   → Container Charge
 *   delivery → Container Charge + Delivery Charge
 *
 * A table session tracks service mode per item: new items take the "Adding as" toggle
 * (activeItemMode), and a saved/added line keeps its own serviceMode. So a box applies when
 * EITHER the toggle or any line already in the cart is pickup/delivery — flipping the toggle
 * back to Dine-In must not hide the Container box of a cart that still holds parcel items.
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
  /** Table/edit session: items carry their own serviceMode, set by the "Adding as" strip. */
  isTableSession: boolean;
  /** "Adding as" mode for NEW items — "dinein" | "pickup" | "delivery" (table sessions). */
  activeItemMode: string;
  /** The form's order-type tab — "dine-in" | "takeaway" | "delivery" (standalone orders). */
  orderType: string | undefined;
  /** serviceMode of every line currently in the cart (missing = dine-in). */
  cartModes: ReadonlyArray<string | null | undefined>;
  containerCharge: number;
  deliveryCharge: number;
}

export function chargeBoxVisibility(ctx: ChargeBoxContext): { showContainer: boolean; showDelivery: boolean } {
  let deliveryApplies: boolean;
  let containerApplies: boolean;
  if (ctx.isTableSession) {
    deliveryApplies = ctx.activeItemMode === "delivery" || ctx.cartModes.some((m) => m === "delivery");
    containerApplies = deliveryApplies || ctx.activeItemMode === "pickup" || ctx.cartModes.some((m) => m === "pickup");
  } else {
    deliveryApplies = ctx.orderType === "delivery";
    containerApplies = deliveryApplies || ctx.orderType === "takeaway";
  }
  return {
    showContainer: containerApplies || ctx.containerCharge > 0,
    showDelivery: deliveryApplies || ctx.deliveryCharge > 0,
  };
}
