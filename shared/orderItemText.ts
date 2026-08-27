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

/**
 * The customer-facing bill must never show kitchen-only prep notes. The combined
 * `specialInstructions` string (built above, plus POS.tsx's own "Note: <text>" segment for
 * free-text notes typed at order time) has no separate column per concern — variant
 * selections, addon selections, and private kitchen notes are all pipe-joined into one
 * field, because the KOT ticket legitimately wants all of it. The bill should only ever
 * show what's visible/billable to the customer (variant + addon segments), so this strips
 * any "Note: ..." segment before the bill renders the line — call this at BILL render time
 * only, never at persist time and never for the KOT, which must keep showing the full text.
 */
export function stripKitchenNotes(specialInstructions: string | null | undefined): string {
  if (!specialInstructions) return "";
  return specialInstructions
    .split(" | ")
    .filter((part) => !part.startsWith("Note: "))
    .join(" | ");
}
