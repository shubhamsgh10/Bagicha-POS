/**
 * receiptLayout.ts — pure geometry for the fallback bill image.
 *
 * Takes the interpreted ESC/POS document and decides WHERE every run of text sits, in printer
 * dots: the 12×24-dot Font-A cell grid of a 203 dpi thermal head (48 columns × 12 dots = 576 dots
 * = 72 mm). The canvas rasterizer (client/src/lib/receiptRaster.ts) only has to paint these
 * placements, so alignment, double-size lines and line spacing are testable here without a DOM.
 */
import { textCells, type EscPosDocument, type EscPosRun } from "./escposInterpret";

/** Font A glyph cell, in dots. */
export const CELL_W = 12;
export const CELL_H = 24;
/** Default inter-line gap (ESC/POS default line spacing is ≈ 30 dots for a 24-dot glyph). */
export const LINE_GAP = 6;

export interface PlacedRun extends EscPosRun {
  /** Left edge in dots. */
  x: number;
  /** Top edge of the run's glyph box in dots. */
  y: number;
}

export interface ReceiptLayout {
  widthDots: number;
  heightDots: number;
  runs: PlacedRun[];
}

export function layoutReceipt(doc: EscPosDocument): ReceiptLayout {
  const widthDots = doc.cols * CELL_W;
  const runs: PlacedRun[] = [];
  let y = 0;

  for (let i = 0; i < doc.items.length; i++) {
    const item = doc.items[i];
    if (item.type === "line") {
      let lineMul = 1;
      for (let k = 0; k < item.runs.length; k++) lineMul = Math.max(lineMul, item.runs[k].heightMul);
      const lineH = CELL_H * lineMul;
      const textW = item.cells * CELL_W;
      const x0 =
        item.align === "center" ? Math.floor((widthDots - textW) / 2) :
        item.align === "right" ? widthDots - textW :
        0;
      let x = x0;
      for (let k = 0; k < item.runs.length; k++) {
        const r = item.runs[k];
        // Mixed heights share a baseline: shorter glyphs sit at the bottom of the line.
        runs.push({ ...r, x, y: y + lineH - CELL_H * r.heightMul });
        x += textCells(r.text, r.widthMul) * CELL_W;
      }
      y += lineH + LINE_GAP;
    } else if (item.type === "feed") {
      y += item.lines * (CELL_H + LINE_GAP);
    }
    // "logo" and "cut" take no vertical space here: the printer's NV logo can't be read back
    // (and real bills from this restaurant print none), and a cut is just the end of the roll.
  }

  return { widthDots, heightDots: y, runs };
}
