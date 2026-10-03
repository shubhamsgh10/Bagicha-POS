/**
 * Verifies generateKOTBuffer's legibility styling: item rows, their notes and VOID lines print tall + bold
 * (ESC ! 0x18) and the style is closed afterwards; over-long names/notes wrap at a word boundary with a
 * hanging indent instead of breaking mid-word; no dead feed sits before the cut. Pure — no printer, no DB.
 * Run: npx tsx scripts/verify-kot-style.ts
 */
import { generateKOTBuffer } from "../shared/print/generators";
import * as E from "../shared/print/escpos";

const checks: Array<[string, boolean]> = [];
const W = 48;
const settings = { printAddons: true, printModifiedItemsOnly: true, printCancelledKOT: true, showDuplicateWatermark: true, kotNumbering: true } as any;
const base = { orderNumber: "1", tableNumber: "O1", kotNumber: 414, isReprint: false, isDelta: false, modifiedItems: [], cancelledItems: [], kotSettings: settings, width: W };
const has = (b: Buffer, s: string | Buffer) => b.indexOf(s) >= 0;
const textOf = (b: Buffer) => b.toString("latin1");

checks.push(["TALL_BOLD_ON is ESC ! 0x18 (double-height + emphasized, NOT double-width)", E.TALL_BOLD_ON.equals(Buffer.from([0x1b, 0x21, 0x18]))]);

// ── Ordinary ticket ───────────────────────────────────────────────────────────
const t = generateKOTBuffer({
  ...base,
  newItems: [
    { name: "Hakka Noodles", quantity: 1, serviceMode: "dinein" },
    { name: "Bagicha Special", size: "Medium", quantity: 2, serviceMode: "dinein", instructions: "no onion" },
  ],
});
const row = (s: string) => Buffer.concat([E.TALL_BOLD_ON, Buffer.from(s)]);
checks.push(["item row is sent tall + bold", has(t, row(" [ 01 ]  Hakka Noodles\n"))]);
checks.push(["size label stays on the row", has(t, Buffer.from("[ 02 ]  Bagicha Special (Medium)\n"))]);
checks.push(["note sits inside the tall run", has(t, Buffer.from("       >> no onion\n"))]);
checks.push(["tall run is closed after the item", has(t, Buffer.concat([Buffer.from("       >> no onion\n"), E.TALL_BOLD_OFF]))]);
checks.push(["KOT# line is bold", has(t, Buffer.concat([E.BOLD_ON, Buffer.from(" KOT#: 414")]))]);
checks.push(["headers/footer are not tall (only ESC ! 0x30 table header + item runs)", t.indexOf(Buffer.from("Total Items")) > t.lastIndexOf(E.TALL_BOLD_OFF)]);
checks.push(["no dead feed before the cut", !has(t, Buffer.concat([E.feed(3), E.CUT])) && t.subarray(-E.CUT.length).equals(E.CUT)]);

// ── Word-aware wrapping of over-long rows ─────────────────────────────────────
const long = generateKOTBuffer({
  ...base,
  newItems: [{ name: "Schezwan Hakka Noodles with Extra Veggies and Paneer", size: "Full", quantity: 1, serviceMode: "dinein", instructions: "no onion no garlic, extra spicy, serve hot please" }],
});
const lines = textOf(long).split("\n");
const names = lines.map((l) => l.replace(/\x1b!./g, "")).filter((l) => /Schezwan|Veggies|Paneer \(Full\)/.test(l));
checks.push(["long name is split across lines", names.length >= 2]);
checks.push(["no line exceeds the column count", lines.every((l) => l.replace(/\x1b[!E][\x00-\x7f]|\x1d\x56..|\x1b@|\x1ba./g, "").length <= W)]);
checks.push(["wrap breaks at a word (no 'Veggi' / 'es' split)", !/Veggi\n\s*es\b/.test(textOf(long).replace(/\x1b!./g, "")) && textOf(long).includes("Veggies")]);
checks.push(["continuation hangs under the name (margin 1 + 8)", textOf(long).replace(/\x1b!./g, "").split("\n").some((l) => /^ {9}\S/.test(l) && /Paneer|\(Full\)|and/.test(l))]);
checks.push(["long note also wraps, hanging under the text after '>> ' (margin 1 + 10)", textOf(long).replace(/\x1b!./g, "").split("\n").some((l) => /^ {11}\S/.test(l))]);

// ── Modified KOT: increment, changed row, void ────────────────────────────────
const m = generateKOTBuffer({
  ...base, isDelta: true,
  newItems: [{ name: "Cold Coffee", size: "Large", quantity: 1, previousQty: 2, serviceMode: "dinein" }],
  modifiedItems: [{ name: "Hakka Noodles", quantity: 2, previousQty: 3, serviceMode: "dinein" }],
  cancelledItems: [{ name: "Veg Spring Roll", quantity: 1 }],
});
checks.push(["increment row is tall + bold with its +N tag", has(m, row(" [+1]  Cold Coffee (Large)\n"))]);
checks.push(["increment keeps its 'now N (was M)' line", has(m, Buffer.from("       now 3 (was 2)\n"))]);
checks.push(["modified row is tall + bold and shows 'was N'", has(m, Buffer.concat([E.TALL_BOLD_ON, Buffer.from(" [ 02 ]  Hakka Noodles")])) && has(m, Buffer.from("was 3\n"))]);
checks.push(["void row is tall + bold", has(m, row(" ** VOID **  [ 01 ]  Veg Spring Roll\n"))]);
checks.push(["modified KOT: same as a new order — no dead feed, ends straight on the cut", !has(m, Buffer.concat([E.feed(3), E.CUT])) && m.subarray(-E.CUT.length).equals(E.CUT)]);
checks.push(["modified KOT: bottom divider is the last thing printed before the cut", m.subarray(-(E.CUT.length + 49), -E.CUT.length).equals(Buffer.from("=".repeat(48) + "\n"))]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
