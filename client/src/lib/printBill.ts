import type { BrowserPayload, PrintApiResponse } from "@shared/print/types";
import { browserPayloadsOf } from "@shared/print/browserPayload";
import { decodeBase64, interpretEscPos } from "@shared/print/escposInterpret";
import { renderReceiptToDataUrl } from "@/lib/receiptRaster";

/**
 * Render an HTML document to the printer.
 * Primary path: a popup window (desktop — gives a real print dialog).
 * Fallback: a hidden same-document iframe, used when the popup is blocked
 * (mobile browsers block window.open that runs after an await, since the
 * user-gesture context is lost). Returns true if printing was initiated.
 */
function openPrintDocument(html: string, delayMs: number): boolean {
  const win = window.open("", "_blank", "width=310,height=600");
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, delayMs);
    return true;
  }

  // Popup blocked (typical on mobile) — fall back to a hidden iframe.
  try {
    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, {
      position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0",
    });
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return false; }
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
      setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 1500);
    }, delayMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Browser-print fallback for a BILL or a KOT — used only when no raw-capable thermal printer can
 * take the ticket (none configured, an office printer, or the Electron host failed to enqueue).
 *
 * It does NOT build a ticket of its own. The server sends the exact ESC/POS bytes the thermal
 * printer would have received (`browserPayload` for a bill, `browserPayloads` for a KOT — category
 * routing can split one tap into several tickets); those are run through a virtual thermal printer
 * (shared/print/escposInterpret.ts) and painted on the printer's own 12×24-dot cell grid
 * (receiptRaster.ts), so the fallback has the same fonts, bold, double-size headers, alignment,
 * columns, tax lines, round-off and duplicate watermark as the real ticket — it can't drift, because
 * it is the same document. (Both used to be hand-built HTML tickets that did drift: wrong tax,
 * a different layout from the thermal bill/KOT.)
 *
 * Returns true if a print window was opened; false if there was nothing to render (old server that
 * sends no payload) or the popup/iframe was blocked — callers then show their in-page preview.
 */
function printTicketImages(payloads: BrowserPayload[], title: string): boolean {
  if (payloads.length === 0) return false;

  const tickets: Array<{ url: string; mm: number }> = [];
  let widestCols = 0;
  try {
    for (const payload of payloads) {
      const cols = payload.width > 0 ? payload.width : 48;
      widestCols = Math.max(widestCols, cols);
      tickets.push({
        url: renderReceiptToDataUrl(interpretEscPos(decodeBase64(payload.data), cols)),
        // 12 dots per column at 203 dpi = 1.5 mm per column: 48 cols = 72 mm printable on an 80 mm roll.
        mm: cols * 1.5,
      });
    }
  } catch (err) {
    console.error(`[print] could not render the fallback ${title}`, err);
    return false;
  }

  const pageMm = widestCols <= 32 ? 58 : 76;
  // One page per ticket, so a category-routed KOT still comes out as separate tickets.
  const images = tickets
    .map((t, i) => {
      const pageBreak = i < tickets.length - 1 ? ";break-after:page;page-break-after:always" : "";
      return `<img src="${t.url}" alt="${title}" style="width:${t.mm}mm${pageBreak}">`;
    })
    .join("");
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title>
<style>
  @page { size: ${pageMm}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${pageMm}mm; }
  img { display: block; margin: 0 auto; image-rendering: pixelated; }
</style>
</head><body>${images}</body></html>`;

  // The bitmaps are data: URLs, so they decode almost instantly; the delay mirrors the other print
  // paths and gives the thermal driver time to receive the page size before the dialog opens.
  return openPrintDocument(html, 800);
}

/** Bill fallback — see printTicketImages. */
export function printBillFallback(data: PrintApiResponse): boolean {
  return printTicketImages(browserPayloadsOf(data), "Bill");
}

/** KOT fallback — see printTicketImages. */
export function printKotFallback(data: PrintApiResponse): boolean {
  return printTicketImages(browserPayloadsOf(data), "KOT");
}

/**
 * Toast for a bill that went to the browser print dialog instead of a thermal printer. Honest on
 * purpose: this path used to announce "Bill sent to printer!" while a print dialog was open, which
 * hid the fact that the thermal printer had been bypassed.
 */
export const BROWSER_BILL_TOAST = {
  title: "Bill opened for printing",
  description: "It did not go to the thermal printer — choose the thermal printer in the print dialog and press Print.",
} as const;

/** Same, for a KOT that did not reach the kitchen printer. */
export const BROWSER_KOT_TOAST = {
  title: "KOT opened for printing",
  description: "It did not go to the kitchen printer — choose the thermal printer in the print dialog and press Print.",
} as const;
