/**
 * Verifies the image-style KOT (shared/print/kotImage.ts): the bitmap geometry, the GS v 0 wire format, the
 * text fallback for anything the face can't draw, the virtual-printer round trip the browser fallback relies
 * on, and the oversized-broadcast rule. Pure — no printer, no DB, no network.
 * Run: npx tsx scripts/verify-kot-image.ts
 */
import { generateKOTBuffer } from "../shared/print/generators";
import { generateKOTImageBuffer, renderKotBitmap, wrapText, measure, canDraw, KOT_IMAGE_STYLE, type KotImageParams } from "../shared/print/kotImage";
import { interpretEscPos } from "../shared/print/escposInterpret";
import { layoutReceipt } from "../shared/print/receiptLayout";
import { broadcastPayload, MAX_BROADCAST_PAYLOAD_CHARS } from "../shared/printJobBroadcast";
import * as E from "../shared/print/escpos";

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

const settings = {
  enabled: true, printModifiedKOT: true, printModifiedItemsOnly: true, printCancelledKOT: true, printAddons: true,
  showDuplicateWatermark: true, kotNumbering: true, kotStyle: "image",
} as any;
const NOW = new Date("2026-10-24T07:30:00Z");
const base: KotImageParams = {
  orderNumber: "1", tableNumber: "O1", kotNumber: 1, isReprint: false, isDelta: false,
  newItems: [
    { name: "Bagicha Special", size: "Medium", quantity: 1, serviceMode: "dinein" },
    { name: "Mineral Water", quantity: 1, serviceMode: "dinein" },
  ],
  modifiedItems: [], cancelledItems: [], kotSettings: settings, width: 48, now: NOW,
};

const bm = renderKotBitmap(base)!;
const wb = bm ? Math.ceil(bm.widthDots / 8) : 0;
const inkAt = (b: NonNullable<typeof bm>, x: number, y: number) => (b.bits[y * Math.ceil(b.widthDots / 8) + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
const rowInk = (b: NonNullable<typeof bm>, y: number, x0 = 0, x1 = b.widthDots) => { let n = 0; for (let x = x0; x < x1; x++) if (inkAt(b, x, y)) n++; return n; };

// ── Geometry ──────────────────────────────────────────────────────────────────
check("renders (the face covers the text)", !!bm);
check("48 columns = 576 dots wide (72 mm)", bm.widthDots === 576);
check("32 columns = 384 dots wide (58 mm)", renderKotBitmap({ ...base, width: 32 })!.widthDots === 384);
check("bit buffer is ceil(w/8) bytes × h rows", bm.bits.length === wb * bm.heightDots);
check("the ticket has ink", bm.bits.some((b) => b !== 0));
check("the paper margins stay white on every row (nothing drawn into the left/right margin)", (() => {
  for (let y = 0; y < bm.heightDots; y++) {
    if (rowInk(bm, y, 0, KOT_IMAGE_STYLE.marginX - 2) > 0) return false;
    if (rowInk(bm, y, bm.widthDots - KOT_IMAGE_STYLE.marginX + 2) > 0) return false;
  }
  return true;
})());
check("deterministic: same input → identical bytes", Buffer.from(renderKotBitmap(base)!.bits).equals(Buffer.from(bm.bits)));
check("more items → taller ticket", renderKotBitmap({ ...base, newItems: [...base.newItems, ...base.newItems, ...base.newItems] })!.heightDots > bm.heightDots);
check("no KOT number/date → shorter ticket", renderKotBitmap({ ...base, kotSettings: { ...settings, kotNumbering: false } })!.heightDots < bm.heightDots);
check("a note line makes the ticket taller", renderKotBitmap({ ...base, newItems: [{ ...base.newItems[0], instructions: "no onion" }, base.newItems[1]] })!.heightDots > bm.heightDots);
check("a note is dropped when printAddons is off", renderKotBitmap({ ...base, kotSettings: { ...settings, printAddons: false }, newItems: [{ ...base.newItems[0], instructions: "no onion" }, base.newItems[1]] })!.heightDots === bm.heightDots);
check("takeaway (no table) drops the Table No line", renderKotBitmap({ ...base, tableNumber: null })!.heightDots < bm.heightDots);
check("a reprint adds the DUPLICATE banner", renderKotBitmap({ ...base, isReprint: true })!.heightDots > bm.heightDots);
check("…unless the watermark setting is off", renderKotBitmap({ ...base, isReprint: true, kotSettings: { ...settings, showDuplicateWatermark: false } })!.heightDots === bm.heightDots);

// The MODIFIED KOT banner is a white-on-black bar: some row is mostly ink across the paper, and it still has white (the text).
const hasBar = (b: NonNullable<typeof bm>) => {
  const mx = KOT_IMAGE_STYLE.marginX;
  for (let y = 0; y < b.heightDots; y++) {
    const ink = rowInk(b, y, mx, b.widthDots - mx);
    if (ink > (b.widthDots - 2 * mx) * 0.97) return true;
  }
  return false;
};
const delta = renderKotBitmap({ ...base, isDelta: true, newItems: [{ name: "Cold Coffee", size: "Large", quantity: 1, previousQty: 2, serviceMode: "dinein" }] })!;
check("MODIFIED KOT draws a solid bar", hasBar(delta) || (() => {
  // the bar's text rows break up the solid line, so accept "mostly ink" too
  const mx = KOT_IMAGE_STYLE.marginX;
  for (let y = 0; y < delta.heightDots; y++) if (rowInk(delta, y, mx, delta.widthDots - mx) > (delta.widthDots - 2 * mx) * 0.6) return true;
  return false;
})());
check("a plain ticket has no bar", !hasBar(bm));

// ── Mixed service modes / cancelled / wrapping ──
const mixed = renderKotBitmap({ ...base, newItems: [{ name: "Masala Dosa", quantity: 2, serviceMode: "dinein" }, { name: "Idli Sambar", quantity: 1, serviceMode: "pickup" }] })!;
check("mixed dine-in + parcel adds group bars (taller than the same two items unmixed)", mixed.heightDots > renderKotBitmap({ ...base, newItems: [{ name: "Masala Dosa", quantity: 2, serviceMode: "dinein" }, { name: "Idli Sambar", quantity: 1, serviceMode: "dinein" }] })!.heightDots);
check("cancelled items add a CANCELLED section", renderKotBitmap({ ...base, cancelledItems: [{ name: "Veg Spring Roll", quantity: 1 }] })!.heightDots > bm.heightDots);
check("…unless cancelled printing is off", renderKotBitmap({ ...base, cancelledItems: [{ name: "Veg Spring Roll", quantity: 1 }], kotSettings: { ...settings, printCancelledKOT: false } })!.heightDots === bm.heightDots);

const maxW = 300;
const wrapped = wrapText("Schezwan Hakka Noodles with Extra Veggies and Paneer (Full)", "bold", 30, maxW);
check("a long name wraps onto several lines", wrapped.length >= 3);
check("no wrapped line is wider than the column", wrapped.every((l) => measure(l, "bold", 30) <= maxW));
check("wrapping keeps every word (nothing lost)", wrapped.join(" ") === "Schezwan Hakka Noodles with Extra Veggies and Paneer (Full)");
const brokenWord = wrapText("Supercalifragilisticexpialidocious", "bold", 30, 200);
check("a single over-long word breaks at the character and still fits", brokenWord.length >= 2 && brokenWord.every((l) => measure(l, "bold", 30) <= 200) && brokenWord.join("") === "Supercalifragilisticexpialidocious");
check("an over-long name never overflows the ticket (still renders, margins white)", (() => {
  const b = renderKotBitmap({ ...base, newItems: [{ name: "Supercalifragilisticexpialidocious Noodles Special Platter", quantity: 12, serviceMode: "dinein" }] })!;
  for (let y = 0; y < b.heightDots; y++) if (rowInk(b, y, 0, KOT_IMAGE_STYLE.marginX - 2) > 0 || rowInk(b, y, b.widthDots - KOT_IMAGE_STYLE.marginX + 2) > 0) return false;
  return true;
})());

// ── Wire format ───────────────────────────────────────────────────────────────
const tall = renderKotBitmap({ ...base, newItems: Array.from({ length: 22 }, (_, i) => ({ name: `Item number ${i + 1}`, quantity: 1, serviceMode: "dinein" })) })!;
check("a long ticket is taller than one 240-row band", tall.heightDots > 240);
const buf = generateKOTImageBuffer({ ...base, newItems: Array.from({ length: 22 }, (_, i) => ({ name: `Item number ${i + 1}`, quantity: 1, serviceMode: "dinein" })) })!;
check("starts with ESC @ (initialise)", buf.subarray(0, 2).equals(E.INIT));
check("ends with the cut command", buf.subarray(-E.CUT.length).equals(E.CUT));
{
  let i = E.INIT.length;
  let rows = 0, bands = 0, ok = true, maxBand = 0;
  const collected: Buffer[] = [];
  while (i < buf.length - E.CUT.length) {
    if (!(buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30 && buf[i + 3] === 0x00)) { ok = false; break; }
    const w = buf[i + 4] + buf[i + 5] * 256, h = buf[i + 6] + buf[i + 7] * 256;
    if (w !== 72) ok = false;
    collected.push(buf.subarray(i + 8, i + 8 + w * h));
    rows += h; bands++; maxBand = Math.max(maxBand, h);
    i += 8 + w * h;
  }
  check("every band is a well-formed GS v 0 (m=0, 72 bytes wide) and the stream ends exactly at the cut", ok && i === buf.length - E.CUT.length);
  check("the bands add up to the whole bitmap", rows === tall.heightDots && bands === Math.ceil(tall.heightDots / 240));
  check("no band is taller than 240 rows", maxBand <= 240);
  const sameAsBitmap = Buffer.concat(collected).equals(Buffer.from(tall.bits));
  check("the bytes on the wire are exactly the bitmap", sameAsBitmap);
}

// ── Fallback to the plain-text ticket ─────────────────────────────────────────
const hindi = { ...base, newItems: [{ name: "पनीर टिक्का", quantity: 1, serviceMode: "dinein" }] };
check("canDraw: ASCII yes, Devanagari no", canDraw("Paneer Tikka (Full) x2 - 5") && !canDraw("पनीर"));
check("an undrawable character → generateKOTImageBuffer returns null", generateKOTImageBuffer(hindi) === null);
const hindiTicket = generateKOTBuffer(hindi);
check("generateKOTBuffer then prints that ticket as plain text (no raster command)", hindiTicket.indexOf(Buffer.from([0x1d, 0x76, 0x30])) < 0 && hindiTicket.includes("पनीर"));
check("kotStyle 'image' → generateKOTBuffer yields the raster ticket", generateKOTBuffer(base).indexOf(Buffer.from([0x1d, 0x76, 0x30, 0x00])) >= 0);
check("kotStyle 'text' → the classic text ticket, untouched", generateKOTBuffer({ ...base, kotSettings: { ...settings, kotStyle: "text" } }).indexOf(Buffer.from([0x1d, 0x76, 0x30])) < 0);
check("kotStyle missing → the classic text ticket (old saved settings / tests keep working)", generateKOTBuffer({ ...base, kotSettings: { ...settings, kotStyle: undefined } }).indexOf(Buffer.from([0x1d, 0x76, 0x30])) < 0);
check("an absurdly long ticket falls back to text instead of a megabyte image", generateKOTImageBuffer({ ...base, newItems: Array.from({ length: 400 }, (_, i) => ({ name: `Item number ${i + 1}`, quantity: 1, serviceMode: "dinein" })) }) === null);

// ── Virtual-printer round trip (what the browser-print fallback shows) ────────
{
  const doc = interpretEscPos(new Uint8Array(buf), 48);
  const rasters = doc.items.filter((i) => i.type === "raster") as any[];
  check("the interpreter turns every GS v 0 band into a raster item", rasters.length === Math.ceil(tall.heightDots / 240));
  check("…without printing any of the image bytes as text", doc.items.every((i) => i.type !== "line" || i.text.trim() === ""));
  check("…and the cut is still recognised after the image", doc.items[doc.items.length - 1].type === "cut");
  const layout = layoutReceipt(doc);
  check("the layout stacks the bands with no gap", layout.rasters.every((r, k) => k === 0 || r.y === layout.rasters[k - 1].y + layout.rasters[k - 1].heightDots));
  check("the layout is exactly as tall as the bitmap", layout.heightDots === tall.heightDots);
  const joined = Buffer.concat(layout.rasters.map((r) => Buffer.from(r.data)));
  check("the browser sees the printer's exact bitmap", joined.equals(Buffer.from(tall.bits)));
  const cutShort = interpretEscPos(new Uint8Array(buf.subarray(0, 8 + 1000)), 48);
  check("a truncated image never throws and never leaks bytes as text", cutShort.items.every((i) => i.type !== "line" || i.text.trim() === ""));
}

// ── Oversized realtime broadcast ──────────────────────────────────────────────
check("a text-sized payload still rides the broadcast", broadcastPayload("A".repeat(3000)) === "A".repeat(3000));
check("the limit itself is allowed", broadcastPayload("A".repeat(MAX_BROADCAST_PAYLOAD_CHARS))?.length === MAX_BROADCAST_PAYLOAD_CHARS);
check("one char over the limit is left out (station reads it from the claim)", broadcastPayload("A".repeat(MAX_BROADCAST_PAYLOAD_CHARS + 1)) === undefined);
check("an image KOT (tens of KB) is left out of the broadcast", broadcastPayload(buf.toString("base64")) === undefined);
check("the limit leaves headroom under Pusher's 10,240-byte event cap", MAX_BROADCAST_PAYLOAD_CHARS + 600 < 10240);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
