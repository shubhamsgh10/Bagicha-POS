/**
 * Verifies shared/print/escposInterpret.ts + shared/print/receiptLayout.ts — the "virtual
 * thermal printer" behind the browser-print fallback for bills.
 *
 * When no raw-capable printer can take a bill, the client prints the SAME ESC/POS bytes the
 * thermal printer would have received (rendered to an image), instead of a hand-built HTML
 * invoice that has its own fonts, columns, tax lines and totals. These checks lock that the
 * interpreter honours exactly the commands generateBillBuffer/generateKOTBuffer emit —
 * alignment, emphasized, double size, ESC ! overriding ESC E, cut/feed parameter bytes —
 * so the fallback can't silently drift from the real bill.
 *
 * Run: npx tsx scripts/verify-escpos-interpret.ts
 */
import * as E from "../shared/print/escpos";
import { generateBillBuffer, generateKOTBuffer, toBrowserPayload } from "../shared/print/generators";
import { interpretEscPos, decodeBase64, type EscPosLine, type EscPosDocument } from "../shared/print/escposInterpret";
import { browserPayloadsOf, withBrowserPayloads } from "../shared/print/browserPayload";
import { layoutReceipt, CELL_W, CELL_H, LINE_GAP } from "../shared/print/receiptLayout";
import type { BillPrintSettings, KOTPrintSettings } from "../shared/print/types";

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

const lines = (doc: EscPosDocument): EscPosLine[] => doc.items.filter((i): i is EscPosLine => i.type === "line");
const findLine = (doc: EscPosDocument, needle: string) => lines(doc).find((l) => l.text.includes(needle));
const allBold = (l: EscPosLine | undefined) => !!l && l.runs.filter((r) => r.text.trim()).every((r) => r.bold);
const noneBold = (l: EscPosLine | undefined) => !!l && l.runs.every((r) => !r.bold);

// ── Fixtures: the real configuration of this restaurant (RP3160, 48 cols, 5% GST) ─────────────
const billSettings: BillPrintSettings = {
  showLogo: true, showFssai: false, showAddons: true, taxDisplay: "none", showRoundOff: true,
  billPrinterId: "p1", itemPriceMode: "exclusive", showDuplicate: true, showNameField: true,
  showKotAsToken: false, showBackwardTax: true, showOrderBarcode: false, mergeDuplicateItems: true,
  showCustomerPayment: false, showQuantityBreakdown: false,
};
const restaurant = {
  restaurantName: "Bagicha Restaurant", businessName: "Salasar Trading",
  address: "Dhimrapur Road, Raigarh (CG), 496001", phone: "9770022221", gstNumber: "22BOQPR9570B1ZN",
  fssaiNumber: "", taxRate: 5, currencySymbol: "₹", footerNote: "Thank you for dining with us!",
};
const order = (billPrintCount: number) => ({
  orderNumber: "ORD0388", tableNumber: "3", customerName: null, orderType: "Dine In",
  totalAmount: "387.45", taxAmount: "18.45", discountAmount: "0.00", subtotalAmount: "369.00",
  containerCharge: "0.00", paymentMethod: null, billPrintCount, createdAt: new Date("2026-10-04T14:54:00Z"),
});
const items = [
  { name: "Mix Sauce Pasta", quantity: 1, price: "299" },
  { name: "Diet Coke", quantity: 1, price: "40" },
  { name: "Mineral Water", quantity: 1, price: "30" },
];
const bill = (billPrintCount = 0, over: Partial<BillPrintSettings> = {}) =>
  interpretEscPos(
    generateBillBuffer({
      order: order(billPrintCount), items, restaurant, billSettings: { ...billSettings, ...over },
      cashierName: "rajbhaghel", width: 48,
    }),
    48,
  );

// ── 1. The real bill, interpreted ────────────────────────────────────────────────────────────
{
  const doc = bill();
  check("bill: interpreted with 48 columns", doc.cols === 48);
  check("bill: no printed line is wider than the paper", lines(doc).every((l) => l.cells <= 48));

  const name = findLine(doc, "Bagicha Restaurant");
  check("bill: restaurant name is centred", name?.align === "center");
  check("bill: restaurant name is emphasized (bold)", allBold(name));

  const biz = findLine(doc, "Salasar Trading");
  check("bill: business name is centred and NOT bold", biz?.align === "center" && noneBold(biz));
  check("bill: GST and phone lines are centred", findLine(doc, "GST -22BOQPR9570B1ZN")?.align === "center" && findLine(doc, "M - 9770022221")?.align === "center");

  check("bill: logo command produces exactly one logo marker (showLogo on)", doc.items.filter((i) => i.type === "logo").length === 1);
  check("bill: no logo marker when showLogo is off", bill(0, { showLogo: false }).items.every((i) => i.type !== "logo"));

  check("bill: Name field line is left aligned", findLine(doc, "Name:")?.align === "left");
  const cashier = findLine(doc, "Cashier: rajbhaghel");
  check("bill: cashier and bill number share one line", !!cashier && cashier.text.includes("Bill No.: ORD0388"));

  const head = findLine(doc, "Item");
  check("bill: column header row is emphasized", allBold(findLine(doc, "Qty")) && !!head);
  const row = findLine(doc, "Mix Sauce Pasta");
  check("bill: item rows are normal weight", noneBold(row) && !!row?.text.includes("299.00"));

  check("bill: CGST and SGST lines at half the 5% rate", !!findLine(doc, "CGST 2.5%") && !!findLine(doc, "SGST 2.5%"));
  check("bill: round-off line present", !!findLine(doc, "Round off"));
  const grand = findLine(doc, "Grand Total");
  check("bill: Grand Total is emphasized", allBold(grand));
  check("bill: Grand Total is the rounded amount in Rs.", !!grand?.text.includes("Rs.387.00"));
  check("bill: footer note is centred", findLine(doc, "Thank you for dining with us!")?.align === "center");

  const last = doc.items[doc.items.length - 1];
  const beforeLast = doc.items[doc.items.length - 2];
  check("bill: ends with a cut", last.type === "cut");
  check("bill: 3-line feed immediately before the cut", beforeLast.type === "feed" && (beforeLast as any).lines === 3);
  check("bill: cut's parameter byte is not printed as a stray character", !lines(doc).some((l) => l.text.includes("\u0000")));
}

// ── 2. Duplicate watermark follows billPrintCount exactly like the real printer ────────────────
{
  check("duplicate: absent on the first print", !findLine(bill(0), "DUPLICATE"));
  const dup = findLine(bill(1), "** DUPLICATE **");
  check("duplicate: present, centred and bold on a reprint", dup?.align === "center" && allBold(dup));
  check("duplicate: absent when showDuplicate is off", !findLine(bill(1, { showDuplicate: false }), "DUPLICATE"));
}

// ── 3. KOT sizes: double-size header, tall+bold rows, ESC ! vs ESC E precedence ───────────────
{
  const kotSettings = {
    enabled: true, printModifiedKOT: true, printModifiedItemsOnly: true, printCancelledKOT: true,
    printAddons: true, showDuplicateWatermark: true, printDeletedItems: true, printDeletedSeparate: false,
    printOnTableMove: false, kotPrinterId: "p1", autoKOTPrint: false, autoKOTDebounceMs: 0, kotNumbering: true,
  } as KOTPrintSettings;
  const doc = interpretEscPos(
    generateKOTBuffer({
      orderNumber: "ORD0388", tableNumber: "3", kotNumber: 12, isReprint: false, isDelta: false,
      newItems: [{ name: "Mix Sauce Pasta", quantity: 1 }], modifiedItems: [], cancelledItems: [], kotSettings, width: 48,
    }),
    48,
  );
  const header = findLine(doc, "TABLE - 3");
  check("kot: table header is double width and double height", header?.runs[0].widthMul === 2 && header?.runs[0].heightMul === 2);
  check("kot: table header is centred", header?.align === "center");
  check("kot: double-size header (ESC ! 0x30) is not emphasized", header?.runs[0].bold === false);
  const sub = findLine(doc, "KITCHEN ORDER");
  check("kot: sub header is bold at normal size", allBold(sub) && sub?.runs[0].heightMul === 1 && sub?.runs[0].widthMul === 1);
  const item = findLine(doc, "Mix Sauce Pasta");
  check("kot: item row is double-height + emphasized (ESC ! 0x18)", !!item && item.runs.every((r) => r.heightMul === 2 && r.widthMul === 1 && r.bold));
  const total = findLine(doc, "Total Items: 1");
  check("kot: Total Items returns to normal size, bold", allBold(total) && total?.runs[0].heightMul === 1);
}

// ── 4. Raw command semantics ─────────────────────────────────────────────────────────────────
{
  // ESC ! rewrites emphasized, so it REPLACES a prior ESC E (CLAUDE.md: "always re-issue BOLD_ON after a tall run").
  let doc = interpretEscPos(E.build(E.INIT, E.BOLD_ON, E.TALL_BOLD_OFF, E.line("after")), 48);
  check("ESC ! 0 after ESC E 1 turns bold OFF (last command wins)", noneBold(findLine(doc, "after")));

  doc = interpretEscPos(E.build(E.INIT, E.TALL_BOLD_ON, E.BOLD_OFF, E.line("tall-not-bold")), 48);
  const l = findLine(doc, "tall-not-bold");
  check("ESC E 0 after ESC ! 0x18 clears bold but keeps double height", l?.runs[0].bold === false && l?.runs[0].heightMul === 2);

  // ESC a only takes effect at the start of a line.
  doc = interpretEscPos(E.build(E.INIT, E.ALIGN_LEFT, E.text("ab"), E.ALIGN_CENTER, E.line("cd"), E.line("next")), 48);
  check("mid-line ESC a does not re-align the line already started", findLine(doc, "abcd")?.align === "left");
  check("…but applies to the next line", findLine(doc, "next")?.align === "center");

  // ESC @ resets everything.
  doc = interpretEscPos(E.build(E.ALIGN_CENTER, E.BOLD_ON, E.INIT, E.line("reset")), 48);
  const r = findLine(doc, "reset");
  check("ESC @ resets alignment and emphasis", r?.align === "left" && noneBold(r));

  // GS V 65 0: the 0 is a parameter, not text.
  doc = interpretEscPos(E.build(E.INIT, E.line("x"), E.CUT), 48);
  check("GS V 65 n swallows its parameter byte", doc.items.length === 2 && doc.items[1].type === "cut");

  // Auto-wrap at the paper width, like the printer.
  doc = interpretEscPos(E.build(E.INIT, E.line("x".repeat(100))), 48);
  check("text wider than the paper wraps onto the next line (48 + 48 + 4)", lines(doc).map((x) => x.cells).join(",") === "48,48,4");

  // Double width: each glyph takes two cells.
  doc = interpretEscPos(E.build(E.INIT, E.DOUBLE_SIZE_ON, E.line("x".repeat(30))), 48);
  check("double-width glyphs count two cells each (24 per line)", lines(doc).map((x) => x.cells).join(",") === "48,12");

  // Non-ASCII survives as ONE character (UTF-8 decoded, not byte-by-byte).
  doc = interpretEscPos(E.build(E.INIT, E.line("Rs ₹5")), 48);
  check("UTF-8 text decodes to single characters", findLine(doc, "₹5")?.cells === 5);

  // Robustness: truncated / unknown sequences must never throw or loop.
  let threw = false;
  try {
    interpretEscPos(Uint8Array.from([0x1b]), 48);
    interpretEscPos(Uint8Array.from([0x1b, 0x61]), 48);
    interpretEscPos(Uint8Array.from([0x1d, 0x56]), 48);
    interpretEscPos(Uint8Array.from([0x1b, 0x7e, 0x41, 0x0a]), 48);
    interpretEscPos(new Uint8Array(0), 48);
  } catch { threw = true; }
  check("truncated or unknown sequences never throw", !threw);

  // Data left in the line buffer when the stream ends is not lost.
  doc = interpretEscPos(E.build(E.INIT, E.text("no newline")), 48);
  check("trailing text without LF is flushed", !!findLine(doc, "no newline"));

  // Feed.
  doc = interpretEscPos(E.build(E.INIT, E.feed(3)), 48);
  check("ESC d n produces a feed of n lines", doc.items.some((i) => i.type === "feed" && (i as any).lines === 3));
}

// ── 5. Layout geometry (what the rasterizer paints) ──────────────────────────────────────────
{
  const doc = bill();
  const lay = layoutReceipt(doc);
  check("layout: 48 columns × 12 dots = 576 dots (72 mm @ 203 dpi)", lay.widthDots === 48 * CELL_W && lay.widthDots === 576);
  check("layout: no run overflows the right edge", lay.runs.every((r) => r.x >= 0 && r.x + r.text.length * CELL_W * r.widthMul <= lay.widthDots));

  const name = lay.runs.find((r) => r.text === "Bagicha Restaurant");
  check("layout: centred line starts at (576 − 18×12) / 2 = 180 dots", name?.x === 180);

  // Height is exactly the sum of line heights (+ feeds) — nothing added, nothing lost.
  let expected = 0;
  for (const it of doc.items) {
    if (it.type === "line") expected += CELL_H * Math.max(1, ...it.runs.map((r) => r.heightMul)) + LINE_GAP;
    else if (it.type === "feed") expected += it.lines * (CELL_H + LINE_GAP);
  }
  check("layout: total height equals the sum of line heights and feeds", lay.heightDots === expected);

  // Mixed heights on one line are bottom aligned (baseline shared), like the print head.
  const mixed = interpretEscPos(E.build(E.INIT, E.text("ab"), E.TALL_BOLD_ON, E.text("CD"), E.TALL_BOLD_OFF, E.LF), 48);
  const ml = layoutReceipt(mixed);
  const ab = ml.runs.find((r) => r.text === "ab")!;
  const cd = ml.runs.find((r) => r.text === "CD")!;
  check("layout: line height follows the tallest glyph", ml.heightDots === CELL_H * 2 + LINE_GAP);
  check("layout: normal-height text sits on the baseline of the tall text", ab.y === CELL_H && cd.y === 0);

  // KOT double-size header: width 9 × 24 = 216 → x = 180; and the next line is pushed down by 48 + gap.
  const kot = layoutReceipt(interpretEscPos(E.build(E.INIT, E.ALIGN_CENTER, E.DOUBLE_SIZE_ON, E.line("TABLE - 3"), E.DOUBLE_SIZE_OFF, E.line("after")), 48));
  const hdr = kot.runs.find((r) => r.text === "TABLE - 3")!;
  const aft = kot.runs.find((r) => r.text === "after")!;
  check("layout: double-width header is centred using its doubled width", hdr.x === (576 - 9 * 24) / 2);
  check("layout: line after a double-height line is offset by 48 + gap", aft.y === CELL_H * 2 + LINE_GAP);
}

// ── 6. Wire shape: server bytes → browserPayload → client interpreter (bill AND KOT) ─────────
{
  const kotSettings = {
    enabled: true, printModifiedKOT: true, printModifiedItemsOnly: true, printCancelledKOT: true,
    printAddons: true, showDuplicateWatermark: true, printDeletedItems: true, printDeletedSeparate: false,
    printOnTableMove: false, kotPrinterId: "p1", autoKOTPrint: false, autoKOTDebounceMs: 0, kotNumbering: true,
  } as KOTPrintSettings;
  const kotBuf = generateKOTBuffer({
    orderNumber: "ORD0388", tableNumber: "3", kotNumber: "007", isReprint: false, isDelta: true,
    newItems: [{ name: "Mix Sauce Pasta", quantity: 2, instructions: "less spicy" }, { name: "Mineral Water", quantity: 1, previousQty: 1 }],
    modifiedItems: [{ name: "Diet Coke", quantity: 3, previousQty: 2 }],
    cancelledItems: [{ name: "Fries", quantity: 1 }],
    kotSettings, width: 48,
  });

  const payload = toBrowserPayload(kotBuf, 48);
  check("payload: carries the width and the ESC/POS encoding tag", payload.width === 48 && payload.encoding === "escpos-base64");
  const round = interpretEscPos(decodeBase64(payload.data), payload.width);
  check("payload: base64 round-trips to the identical KOT lines", JSON.stringify(round) === JSON.stringify(interpretEscPos(kotBuf, 48)));

  const hdr = findLine(round, "MODIFIED KOT");
  check("kot fallback: delta tickets say MODIFIED KOT (bold, centred)", allBold(hdr) && hdr?.align === "center");
  const row = findLine(round, "Mix Sauce Pasta");
  check("kot fallback: new item row is tall + bold", !!row && row.runs.every((r) => r.heightMul === 2 && r.bold));
  check("kot fallback: kitchen note line (>>) is present and tall", !!findLine(round, ">> less spicy")?.runs.every((r) => r.heightMul === 2));
  check("kot fallback: quantity increase renders as [+n] with the 'now/was' line", !!findLine(round, "[+1]") && !!findLine(round, "now 2 (was 1)"));
  check("kot fallback: modified item shows 'was N'", !!findLine(round, "was 2"));
  check("kot fallback: cancelled item is a VOID line", !!findLine(round, "** VOID **"));
  check("kot fallback: KOT# line carries the real KOT number", !!findLine(round, "KOT#: 007"));
  check("kot fallback: ends with a cut and no stray parameter text", round.items[round.items.length - 1].type === "cut" && !lines(round).some((l) => l.text.includes("\u0000")));

  // Normalising a response into the images to print.
  const one = { browserPrint: true, browserPayload: payload };
  const many = { browserPrint: true, browserPayloads: [payload, toBrowserPayload(kotBuf, 32)] };
  check("payloads: a single browserPayload becomes one ticket", browserPayloadsOf(one).length === 1);
  check("payloads: browserPayloads wins and keeps print order", browserPayloadsOf({ ...many, browserPayload: payload }).length === 2 && browserPayloadsOf(many)[1].width === 32);
  check("payloads: nothing attached → nothing to print (old server)", browserPayloadsOf({ browserPrint: true }).length === 0);
  check("payloads: an empty payload string is ignored", browserPayloadsOf({ browserPayload: { ...payload, data: "" } }).length === 0);

  // Electron decided to fall back itself: bytes live in printJob(s), width comes from the printer config.
  const job = { printerId: "p1", encoding: "escpos-base64" as const, data: payload.data };
  const lifted = withBrowserPayloads({ printJob: job }, (id) => (id === "p1" ? 32 : undefined));
  check("lift: printJob bytes become a payload with the configured printer width", browserPayloadsOf(lifted).length === 1 && browserPayloadsOf(lifted)[0].width === 32);
  check("lift: unknown printer width defaults to 48 columns", browserPayloadsOf(withBrowserPayloads({ printJob: job }, () => undefined))[0].width === 48);
  const liftedMany = withBrowserPayloads({ printJobs: [job, { ...job, printerId: "p2" }] }, () => 48);
  check("lift: category-routed KOTs lift every ticket, not just the first", browserPayloadsOf(liftedMany).length === 2);
  check("lift: a server-attached payload is left untouched", withBrowserPayloads(one, () => 32) === one);
  check("lift: no payload and no jobs → unchanged", browserPayloadsOf(withBrowserPayloads({ browserPrint: true }, () => 48)).length === 0);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
