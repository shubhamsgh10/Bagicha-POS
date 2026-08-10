/**
 * orderItems has no dedicated addons column (see shared/schema.ts) — the client sends a
 * cart item's selected addons as a separate `addons: [{name, price}]` array, but the only
 * place that survives persistence is the free-text `specialInstructions` field, which
 * already carries variant selections and notes. Every consumer of "what does this line
 * actually include" (the KOT ticket, and the bill's `billSettings.showAddons` line — see
 * printRoutes.ts/generators.ts) reads `orderItems.specialInstructions` and nothing else,
 * so addon names MUST be folded into it at persist time or they vanish permanently: this
 * exact merge used to be computed only for the KOT route's own local, un-read
 * `kotTickets.items` JSON blob (never the actual `orderItems.specialInstructions` column),
 * so no real KOT or bill print — first print, reprint, or delta print — ever showed which
 * addons a customer picked, even with "Show Addons" enabled in bill settings.
 */
export function buildSpecialInstructions(
  specialInstructions: string | null | undefined,
  addons: Array<{ name: string }> | null | undefined,
): string {
  const addonLines = Array.isArray(addons) && addons.length > 0
    ? addons.map((a) => `+ ${a.name}`).join(", ")
    : "";
  return [specialInstructions, addonLines].filter(Boolean).join(" | ");
}
