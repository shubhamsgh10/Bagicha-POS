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
import { buildSpecialInstructions, stripKitchenNotes } from "../shared/orderItemText";

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
// prep instructions, prefixed by POS.tsx's buildInstructions) — only the KOT should.
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

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
