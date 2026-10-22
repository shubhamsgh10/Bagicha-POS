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
  return [collapseStackedNotePrefix(specialInstructions), addonLines].filter(Boolean).join(" | ");
}

const NOTE_PREFIX = "Note: ";
const SEGMENT_SEP = " | ";
/** One or more leading "Note:" markers (stacked ones are the corruption described below). */
const LEADING_NOTE_MARKERS = /^(?:Note:\s*)+/;

/**
 * Collapses "Note: Note: Note: x" to "Note: x", segment by segment. The POS cart used to
 * stack one more prefix on every save→reload round (see splitPersistedInstructions), and a
 * client that hasn't updated yet still does — so the server normalises on the way in rather
 * than persisting the damage. A single, normal "Note: x" is returned untouched.
 */
export function collapseStackedNotePrefix(specialInstructions: string | null | undefined): string {
  if (!specialInstructions) return "";
  return specialInstructions
    .split(SEGMENT_SEP)
    .map((part) => part.replace(/^(?:Note:\s*){2,}/, NOTE_PREFIX))
    .join(SEGMENT_SEP);
}

/**
 * The cart's side of the fold: variants ("Group: Option, …"), then whatever non-note
 * segments the line already carried from the DB (`extras`), then the user's free-text note
 * wrapped as "Note: <text>". `notes` must be the bare text the user typed — never a
 * previously-saved composite string, or it gets wrapped a second time. (Addons are not
 * folded here; the server appends them from the separate `addons` array via
 * buildSpecialInstructions.)
 */
export function composeCartInstructions(parts: {
  variants: Record<string, string>;
  extras?: string | null;
  notes?: string | null;
}): string {
  const variantText = Object.entries(parts.variants)
    .map(([group, option]) => `${group}: ${option}`)
    .join(", ");
  const note = parts.notes ? `${NOTE_PREFIX}${parts.notes}` : "";
  return [variantText, parts.extras, note].filter(Boolean).join(SEGMENT_SEP);
}

/**
 * Inverse of the fold, for re-hydrating a saved order line into the POS cart. The cart
 * cannot rebuild structured `variants`/`addons` from the free-text column (addon prices
 * aren't stored in it), so the saved string is split into:
 *   - `notes`  — only what the user typed, WITHOUT the "Note: " wrapper, ready to be wrapped
 *                again on the next save; and
 *   - `extras` — every other segment (variant selections, `+ addon`s), kept verbatim so a
 *                re-save doesn't lose them.
 * This used to be a single `notes: item.specialInstructions`, which made every
 * save→reload→save round wrap the whole saved string again: "Note: Note: Note: kulcha"
 * (and variant/addon text ended up inside a "Note:" segment, which the bill then stripped).
 * A note containing " | " stays one note: only a trailing run of "+ " segments after the
 * note is treated as addons. Already-stacked rows heal to the bare text.
 */
export function splitPersistedInstructions(
  specialInstructions: string | null | undefined,
): { notes: string; extras: string } {
  if (!specialInstructions) return { notes: "", extras: "" };
  const segments = specialInstructions.split(SEGMENT_SEP);
  const noteStart = segments.findIndex((s) => s.startsWith("Note:"));
  if (noteStart === -1) return { notes: "", extras: specialInstructions };

  let noteEnd = segments.length; // exclusive; trailing "+ addon" segments aren't part of the note
  while (noteEnd - 1 > noteStart && segments[noteEnd - 1].startsWith("+ ")) noteEnd--;

  const notes = segments
    .slice(noteStart, noteEnd)
    .map((s) => s.replace(LEADING_NOTE_MARKERS, ""))
    .join(SEGMENT_SEP);
  const extras = [...segments.slice(0, noteStart), ...segments.slice(noteEnd)].join(SEGMENT_SEP);
  return { notes, extras };
}

/**
 * Rebuilds a re-hydrated cart line's structured variant/addon picks from the `extras` that
 * splitPersistedInstructions leaves behind, by matching the text against the menu item's own
 * definitions. Without this a reloaded line has `addons: []` / `variants: {}`, so opening Edit
 * (even to change only the quantity) starts from "nothing picked" and recomputes the unit
 * price as base + 0 + 0 — silently dropping the addon/variant surcharge the line was saved
 * with (₹250 → ₹200) while the kitchen text still lists the addon.
 *
 * Matching is exact and ", "-delimited, so "Extra Cheese" never matches inside "Extra Cheese
 * Large" and names that themselves contain ", " still match. Anything the menu no longer
 * defines (renamed/removed option, addons switched off — pass `addons: []`) is NOT guessed at:
 * it stays verbatim in the returned `extras`, so text is never lost. Matched addons come back
 * in the order they were saved, as the menu's own objects (so the caller keeps their price).
 */
export function rehydrateSelections<A extends { name: string }>(
  extras: string | null | undefined,
  defs: {
    variants?: Array<{ group: string; options: Array<{ name: string }> }> | null;
    addons?: A[] | null;
  },
): { variants: Record<string, string>; addons: A[]; extras: string } {
  const variantCandidates: Array<{ text: string; group: string; option: string }> = [];
  for (const g of defs.variants ?? []) {
    for (const o of g.options ?? []) variantCandidates.push({ text: `${g.group}: ${o.name}`, group: g.group, option: o.name });
  }
  const addonCandidates = (defs.addons ?? []).map((addon) => ({ text: `+ ${addon.name}`, addon }));
  // Longest first, so a longer name wins over any shorter one it happens to contain.
  variantCandidates.sort((a, b) => b.text.length - a.text.length);
  addonCandidates.sort((a, b) => b.text.length - a.text.length);

  const variants: Record<string, string> = {};
  const addons: A[] = [];
  const leftovers: string[] = [];

  for (const segment of (extras ?? "").split(SEGMENT_SEP)) {
    if (!segment) continue;
    const original = `, ${segment}, `;
    let rest = original;
    // Removes one ", <text>, " element from `rest` (keeping the shared delimiter) and reports
    // where it sat in the ORIGINAL segment, for ordering. -1 when it isn't there.
    const consume = (text: string): number => {
      const needle = `, ${text}, `;
      const at = rest.indexOf(needle);
      if (at === -1) return -1;
      rest = rest.slice(0, at) + ", " + rest.slice(at + needle.length);
      return original.indexOf(needle);
    };

    for (const c of variantCandidates) {
      if (consume(c.text) !== -1) variants[c.group] = c.option;
    }
    const pickedAddons: Array<{ pos: number; addon: A }> = [];
    for (const c of addonCandidates) {
      const pos = consume(c.text);
      if (pos !== -1 && !addons.some((a) => a.name === c.addon.name)) pickedAddons.push({ pos, addon: c.addon });
    }
    pickedAddons.sort((a, b) => a.pos - b.pos).forEach((p) => addons.push(p.addon));

    const left = rest.replace(/^, /, "").replace(/, $/, "");
    if (left) leftovers.push(left);
  }

  return { variants, addons, extras: leftovers.join(SEGMENT_SEP) };
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
