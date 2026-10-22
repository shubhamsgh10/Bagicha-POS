/**
 * Verifies shared/orderItemText.ts's buildSpecialInstructions — the fold that makes
 * addon selections survive into orderItems.specialInstructions. orderItems has no
 * addons column; the client sends addons as a separate {name,price}[] array, but the
 * only place that field's info can persist is this same free-text field the KOT ticket
 * and the bill's "showAddons" line both read — before this fix, both POST /api/orders
 * and PUT /api/orders/:id/items discarded item.addons entirely when persisting
 * specialInstructions, so no printed KOT or bill (first print, reprint, or delta print)
 * ever showed which addons a customer picked, even with "Show Addons" enabled.
 * Run: npx tsx scripts/verify-order-item-text.ts
 */
import {
  buildSpecialInstructions,
  composeCartInstructions,
  rehydrateSelections,
  splitPersistedInstructions,
  stripKitchenNotes,
} from "../shared/orderItemText";

const checks: Array<[string, boolean]> = [];

checks.push([
  "addons alone render as + name, comma-joined",
  buildSpecialInstructions(null, [{ name: "Extra Cheese" }, { name: "No Onion" }]) === "+ Extra Cheese, + No Onion",
]);

checks.push([
  "specialInstructions alone (no addons) passes through unchanged",
  buildSpecialInstructions("Chicken: Spicy", []) === "Chicken: Spicy",
]);

checks.push([
  "specialInstructions + addons join with a pipe, instructions first",
  buildSpecialInstructions("Chicken: Spicy", [{ name: "Extra Cheese" }]) === "Chicken: Spicy | + Extra Cheese",
]);

checks.push([
  "neither present -> empty string, not a stray pipe or literal 'null'",
  buildSpecialInstructions(null, null) === "",
]);

checks.push([
  "empty specialInstructions string + no addons -> empty string",
  buildSpecialInstructions("", undefined) === "",
]);

checks.push([
  "empty addons array (addon UI opened but nothing picked) behaves like no addons",
  buildSpecialInstructions("Note: less spicy", []) === "Note: less spicy",
]);

// stripKitchenNotes: the bill must never show the "Note: ..." segment (private kitchen
// prep instructions, prefixed by composeCartInstructions) — only the KOT should.
checks.push([
  "a bare kitchen note is stripped entirely for the bill",
  stripKitchenNotes("Note: Extra Cheese") === "",
]);

checks.push([
  "a note alongside a variant selection: variant survives, note is stripped",
  stripKitchenNotes("Chicken: Spicy | Note: less spicy") === "Chicken: Spicy",
]);

checks.push([
  "a note alongside an addon selection: addon survives, note is stripped",
  stripKitchenNotes("Note: no onion | + Extra Cheese") === "+ Extra Cheese",
]);

checks.push([
  "variant + note + addon together: only the note is stripped, order preserved",
  stripKitchenNotes("Chicken: Spicy | Note: less spicy | + Extra Cheese") === "Chicken: Spicy | + Extra Cheese",
]);

checks.push([
  "no note present -> unchanged",
  stripKitchenNotes("Chicken: Spicy | + Extra Cheese") === "Chicken: Spicy | + Extra Cheese",
]);

checks.push([
  "null/empty input -> empty string",
  stripKitchenNotes(null) === "" && stripKitchenNotes(undefined) === "" && stripKitchenNotes("") === "",
]);

// ── "Note: Note: Note: kulcha" regression ───────────────────────────────────────────
// The POS cart wraps a line's free-text note as "Note: <text>" when it saves, and used to
// reload the WHOLE saved string (variants + note + addons) back into `notes` when an order
// was re-hydrated from the DB (right after the first KOT/Bill, and on every reopen) — so
// the next save wrapped it again. composeCartInstructions / splitPersistedInstructions are
// now an inverse pair; these checks model the real save → reload → save cycle.

const sp = splitPersistedInstructions;

checks.push([
  "split: a saved note comes back as the bare text the user typed",
  JSON.stringify(sp("Note: kulcha")) === JSON.stringify({ notes: "kulcha", extras: "" }),
]);

checks.push([
  "split: null/empty -> nothing",
  JSON.stringify(sp(null)) === JSON.stringify({ notes: "", extras: "" })
    && JSON.stringify(sp("")) === JSON.stringify({ notes: "", extras: "" }),
]);

checks.push([
  "split: variant + note + addon -> note isolated, variant/addon kept verbatim as extras",
  JSON.stringify(sp("Chicken: Spicy | Note: less spicy | + Extra Cheese"))
    === JSON.stringify({ notes: "less spicy", extras: "Chicken: Spicy | + Extra Cheese" }),
]);

checks.push([
  "split: no note present -> everything is extras, notes empty",
  JSON.stringify(sp("Chicken: Spicy | + Extra Cheese"))
    === JSON.stringify({ notes: "", extras: "Chicken: Spicy | + Extra Cheese" }),
]);

checks.push([
  "split: a note that itself contains ' | ' stays one note (only trailing '+ ' addons are peeled off)",
  JSON.stringify(sp("Note: no onion | less oil | + Extra Cheese"))
    === JSON.stringify({ notes: "no onion | less oil", extras: "+ Extra Cheese" }),
]);

checks.push([
  "split: already-corrupted rows (order #1965: 'Note: Note: Note: Note: kulcha') heal to the bare text",
  JSON.stringify(sp("Note: Note: Note: Note: kulcha")) === JSON.stringify({ notes: "kulcha", extras: "" }),
]);

checks.push([
  "compose: variants, carried extras, note — pipe-joined, each segment once, empties skipped",
  composeCartInstructions({ variants: { Bread: "Naan" }, extras: "+ Extra Butter", notes: "kulcha" })
    === "Bread: Naan | + Extra Butter | Note: kulcha"
    && composeCartInstructions({ variants: {}, extras: "", notes: "" }) === ""
    && composeCartInstructions({ variants: {}, notes: "kulcha" }) === "Note: kulcha",
]);

// The bug itself: save → (reload from DB) → save → (reload) → … must be a fixed point.
{
  // First save of a fresh cart line: user typed note "kulcha", picked a variant + an addon.
  let persisted = buildSpecialInstructions(
    composeCartInstructions({ variants: { Bread: "Naan" }, notes: "kulcha" }),
    [{ name: "Extra Butter" }],
  );
  const firstSave = persisted;
  const history: string[] = [persisted];
  for (let cycle = 0; cycle < 5; cycle++) {
    const loaded = sp(persisted); // cart re-hydrated from DB: variants {} / addons [] (as POS.tsx does)
    persisted = buildSpecialInstructions(
      composeCartInstructions({ variants: {}, extras: loaded.extras, notes: loaded.notes }),
      [],
    );
    history.push(persisted);
  }
  checks.push([
    "cycle: 5 reload→save rounds never stack 'Note:' — exactly one, note text intact",
    history.every((h) => (h.match(/Note:/g) ?? []).length === 1 && h.includes("Note: kulcha")),
  ]);
  checks.push([
    "cycle: variant and addon survive every reload→save round exactly once (not folded into the note)",
    history.every((h) => h.split("Bread: Naan").length === 2 && h.split("+ Extra Butter").length === 2),
  ]);
  checks.push([
    "cycle: after the first reload the saved text is a fixed point (no drift on further rounds)",
    history.slice(1).every((h) => h === history[1]),
  ]);
  checks.push([
    "cycle: the bill still shows the variant + addon and hides the note after reloads",
    stripKitchenNotes(history[5]) === "Bread: Naan | + Extra Butter" && firstSave.includes("Note: kulcha"),
  ]);
}

// ── Edit-after-reload repricing regression ──────────────────────────────────────────
// A saved line's price includes its addons/variants, but a line re-hydrated from the DB had
// addons [] / variants {} — so opening Edit and confirming (even for a quantity-only change)
// recomputed base + 0 + 0 and silently dropped the surcharge (₹250 → ₹200 per unit), while
// the kitchen text still said "+ Extra Cheese". rehydrateSelections rebuilds the picks from
// the menu item's own definitions so the edit window starts with the real selections.

const pizza = {
  price: 200,
  addons: [{ name: "Extra Cheese", price: 30 }, { name: "Olives", price: 15 }, { name: "Extra Cheese Large", price: 50 }],
  variants: [
    { group: "Crust", options: [{ name: "Thin", price: 20 }, { name: "Pan", price: 0 }] },
    { group: "Size, Pick", options: [{ name: "Reg, Plus", price: 5 }] },
  ],
};
// Same formula as POS.tsx confirmModal: base + Σ addons + Σ chosen variant surcharges.
const unitPrice = (
  addons: Array<{ price: number }>,
  variants: Record<string, string>,
) =>
  pizza.price
  + addons.reduce((s, a) => s + Number(a.price), 0)
  + pizza.variants.reduce((s, g) => s + Number(g.options.find((o) => o.name === variants[g.group])?.price ?? 0), 0);

{
  const savedText = "Crust: Thin | + Extra Cheese, + Olives";
  const r = rehydrateSelections(savedText, pizza);
  checks.push([
    "rehydrate: variant + addons rebuilt as real picks, nothing left over",
    JSON.stringify(r.variants) === JSON.stringify({ Crust: "Thin" })
      && r.addons.map((a) => a.name).join(",") === "Extra Cheese,Olives"
      && r.extras === "",
  ]);
  checks.push([
    "reprice: edit-after-reload recomputes the SAME unit price the line was saved at (not base-only)",
    unitPrice(r.addons, r.variants) === 200 + 20 + 30 + 15
      && unitPrice(r.addons, r.variants) !== unitPrice([], {}),
  ]);
}

checks.push([
  "rehydrate: an addon whose name is a prefix of another only matches the exact one",
  (() => {
    const r = rehydrateSelections("+ Extra Cheese Large", pizza);
    return r.addons.map((a) => a.name).join(",") === "Extra Cheese Large" && r.extras === "";
  })(),
]);

checks.push([
  "rehydrate: group/option/addon names containing ', ' still match",
  (() => {
    const r = rehydrateSelections("Size, Pick: Reg, Plus", pizza);
    return JSON.stringify(r.variants) === JSON.stringify({ "Size, Pick": "Reg, Plus" }) && r.extras === "";
  })(),
]);

checks.push([
  "rehydrate: addons come back in the order they were saved, not menu order",
  rehydrateSelections("+ Olives, + Extra Cheese", pizza).addons.map((a) => a.name).join(",") === "Olives,Extra Cheese",
]);

checks.push([
  "rehydrate: segments the menu no longer defines stay verbatim in extras (text is never lost)",
  (() => {
    const r = rehydrateSelections("Crust: Stuffed | + Extra Cheese, + Discontinued", pizza);
    return r.addons.map((a) => a.name).join(",") === "Extra Cheese"
      && Object.keys(r.variants).length === 0
      && r.extras === "Crust: Stuffed | + Discontinued";
  })(),
]);

checks.push([
  "rehydrate: addons switched off for the item -> addon text stays in extras, no addon picks",
  (() => {
    const r = rehydrateSelections("+ Extra Cheese", { variants: pizza.variants, addons: [] });
    return r.addons.length === 0 && r.extras === "+ Extra Cheese";
  })(),
]);

checks.push([
  "rehydrate: empty/null extras and missing definitions are harmless",
  (() => {
    const a = rehydrateSelections("", pizza);
    const b = rehydrateSelections(null, pizza);
    const c = rehydrateSelections("Crust: Thin", {});
    return a.addons.length === 0 && a.extras === "" && b.extras === "" && c.extras === "Crust: Thin";
  })(),
]);

// Full-fidelity cycle: with rehydration, reload→save reproduces the ORIGINAL text exactly
// (same order, nothing moved), every round.
{
  const original = buildSpecialInstructions(
    composeCartInstructions({ variants: { Crust: "Thin" }, notes: "kulcha" }),
    [{ name: "Extra Cheese" }, { name: "Olives" }],
  );
  let persisted = original;
  const rounds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { notes, extras } = splitPersistedInstructions(persisted);
    const picked = rehydrateSelections(extras, pizza);
    persisted = buildSpecialInstructions(
      composeCartInstructions({ variants: picked.variants, extras: picked.extras, notes }),
      picked.addons,
    );
    rounds.push(persisted);
  }
  checks.push([
    "cycle (rehydrated): 4 reload→save rounds reproduce the original saved text byte-for-byte",
    original === "Crust: Thin | Note: kulcha | + Extra Cheese, + Olives" && rounds.every((r) => r === original),
  ]);
}

// Server-side defence in depth: a client that has not been updated yet (an Electron thin
// client ahead of / behind the API) still sends the stacked prefix; the persisted value
// must come out collapsed rather than carrying the damage forward.
checks.push([
  "buildSpecialInstructions collapses a stacked 'Note: Note: …' prefix from an old client",
  buildSpecialInstructions("Note: Note: Note: kulcha", []) === "Note: kulcha"
    && buildSpecialInstructions("Bread: Naan | Note: Note: kulcha", [{ name: "Extra Butter" }])
      === "Bread: Naan | Note: kulcha | + Extra Butter",
]);

checks.push([
  "buildSpecialInstructions leaves a single, normal 'Note:' alone",
  buildSpecialInstructions("Note: less spicy", []) === "Note: less spicy",
]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
