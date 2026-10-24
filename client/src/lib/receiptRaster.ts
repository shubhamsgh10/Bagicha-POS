/**
 * receiptRaster.ts — paints an interpreted ESC/POS document as a 1-bit image, the way the
 * thermal printer's own head would: native 203 dpi dot grid (48 columns × 12 dots = 576 dots =
 * 72 mm), every character in a fixed 12×24 cell, pure black on white.
 *
 * Used by the browser-print fallback for bills (printBill.ts → printBillFallback). The geometry —
 * alignment, double-width/height, line spacing — comes from shared/print/receiptLayout.ts (unit
 * tested); this file only draws it. Each character is placed at its exact cell, so columns line
 * up identically to the real bill even though the glyph shapes come from a system monospace font
 * rather than the printer's built-in Font A.
 */
import { charCells, type EscPosDocument } from "@shared/print/escposInterpret";
import { layoutReceipt, CELL_W, CELL_H } from "@shared/print/receiptLayout";

const FONT_STACK = `Consolas, "Lucida Console", "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace`;

/** Supersampling factor: draw at 2× with grayscale anti-aliasing, then threshold down to 1 bit. */
const SS = 2;
/** The printer's Font A is tall and narrow (12×24); a monospace font fitted to a 12-dot advance is
 *  shorter than that, so stretch glyphs vertically to fill the cell like the real font does. */
const V_STRETCH = 1.22;
/** Baseline position inside the 24-dot cell (leaves room for descenders). */
const BASELINE = 18.5;
/** A 1-bit pixel turns black when at least this much of it is covered (slight dot gain, as on paper). */
const DARK_BELOW = 150;

/**
 * Font size, in printer DOTS, at which the font's advance width equals one printer cell. (Dots,
 * not canvas pixels: every draw happens under a SS× transform, which supplies the supersampling.)
 */
function fittedFontSize(ctx: CanvasRenderingContext2D): number {
  ctx.font = `100px ${FONT_STACK}`;
  const advancePer100 = ctx.measureText("M").width || 55;
  return (CELL_W / advancePer100) * 100;
}

/** Renders the document and returns it as a PNG data URL (pure black/white, `widthDots` wide). */
export function renderReceiptToDataUrl(doc: EscPosDocument): string {
  const layout = layoutReceipt(doc);
  const wDots = layout.widthDots;
  const hDots = Math.max(1, layout.heightDots + CELL_H); // small tail so the last line isn't cut off

  const big = document.createElement("canvas");
  big.width = wDots * SS;
  big.height = hDots * SS;
  const ctx = big.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, big.width, big.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  const fontPx = fittedFontSize(ctx);
  ctx.font = `${fontPx}px ${FONT_STACK}`;

  for (let r = 0; r < layout.runs.length; r++) {
    const run = layout.runs[r];
    const chars = Array.from(run.text);
    let cellX = 0;
    for (let c = 0; c < chars.length; c++) {
      const ch = chars[c];
      const cells = charCells(ch);
      if (ch !== " ") {
        ctx.save();
        // Work in cell coordinates (dots): origin = top-left of this character's glyph box.
        ctx.setTransform(SS, 0, 0, SS, 0, 0);
        ctx.translate(run.x + cellX * CELL_W * run.widthMul, run.y);
        ctx.scale(run.widthMul, run.heightMul * V_STRETCH);
        const cx = (cells * CELL_W) / 2;
        const by = BASELINE / V_STRETCH;
        ctx.fillText(ch, cx, by);
        // "Emphasized" on a thermal head is a double strike shifted by one dot.
        if (run.bold) ctx.fillText(ch, cx + 1, by);
        if (run.underline) ctx.fillRect(0, 22.5 / V_STRETCH, cells * CELL_W, 1.2);
        ctx.restore();
      }
      cellX += cells;
    }
  }

  // Downsample to the real dot grid and threshold: a thermal head only has black and white.
  const src = ctx.getImageData(0, 0, big.width, big.height).data;
  const out = document.createElement("canvas");
  out.width = wDots;
  out.height = hDots;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("Canvas 2D context unavailable");
  const img = octx.createImageData(wDots, hDots);
  const px = img.data;
  for (let y = 0; y < hDots; y++) {
    for (let x = 0; x < wDots; x++) {
      let sum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          sum += src[((y * SS + sy) * big.width + (x * SS + sx)) * 4]; // R of black-on-white
        }
      }
      const v = sum / (SS * SS) < DARK_BELOW ? 0 : 255;
      const o = (y * wDots + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = v;
      px[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out.toDataURL("image/png");
}
