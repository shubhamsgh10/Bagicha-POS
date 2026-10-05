/**
 * escposInterpret.ts — a tiny "virtual thermal printer".
 *
 * Turns the raw ESC/POS bytes that generateBillBuffer / generateKOTBuffer emit into the lines
 * a real printer would print — with their alignment, emphasis and character size — so the
 * browser-print fallback can show the SAME bill the thermal printer would have printed, instead
 * of a second, hand-built HTML layout that drifts (different fonts, columns, tax lines…).
 *
 * Pure (no DOM, no Node-only APIs): runs on the client and in scripts/verify-escpos-interpret.ts.
 *
 * Fidelity notes, kept deliberately close to real hardware:
 *  - ESC a (alignment) only takes effect at the START of a line.
 *  - ESC ! and ESC E both drive "emphasized"; whichever comes last wins (so a tall run must be
 *    closed with ESC ! 0 and bold re-issued — see CLAUDE.md "KOT legibility").
 *  - Text wider than the paper wraps at the character boundary, like the print head's buffer.
 *  - Command parameter bytes (GS V 65 0, FS p 1 0, …) are consumed, never printed as text.
 *  - Unknown or truncated sequences are skipped; the interpreter never throws.
 * Not modelled (the generators never emit them): font B column counts, NV logo contents,
 * barcodes/QR/raster images — they are skipped safely.
 */

export type EscPosAlign = "left" | "center" | "right";

export interface EscPosRun {
  text: string;
  bold: boolean;
  underline: boolean;
  /** 1 = normal, 2 = double width (each glyph takes this many cells). */
  widthMul: number;
  /** 1 = normal, 2 = double height. */
  heightMul: number;
}

export interface EscPosLine {
  type: "line";
  align: EscPosAlign;
  runs: EscPosRun[];
  /** All run text joined — convenience for tests and logging. */
  text: string;
  /** Character cells used, with width multipliers and wide glyphs counted. */
  cells: number;
}
export interface EscPosFeed { type: "feed"; lines: number }
export interface EscPosMarker { type: "logo" | "cut" }
export type EscPosItem = EscPosLine | EscPosFeed | EscPosMarker;

export interface EscPosDocument {
  /** Normal-width character cells per line (48 for an 80 mm roll, 32 for 58 mm). */
  cols: number;
  items: EscPosItem[];
}

/** Cells one character occupies at normal width: East-Asian wide glyphs and emoji take two. */
export function charCells(ch: string): number {
  if (ch.length > 1) return 2; // astral plane (emoji, rare CJK extensions)
  const c = ch.charCodeAt(0);
  if (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

/** Cells a piece of text occupies at the given width multiplier. */
export function textCells(text: string, widthMul = 1): number {
  const chars = Array.from(text);
  let n = 0;
  for (let i = 0; i < chars.length; i++) n += charCells(chars[i]) * widthMul;
  return n;
}

/** base64 → bytes, on both the client and Node ≥ 16 (global atob). */
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const DLE = 0x10;
const LF = 0x0a;

export function interpretEscPos(bytes: Uint8Array, cols = 48): EscPosDocument {
  const items: EscPosItem[] = [];
  const decoder = new TextDecoder("utf-8");

  // Printer mode (what ESC @ resets).
  let bold = false;
  let underline = false;
  let widthMul = 1;
  let heightMul = 1;
  let align: EscPosAlign = "left";

  // The line currently being assembled in the print buffer.
  let runs: EscPosRun[] = [];
  let cells = 0;
  let lineAlign: EscPosAlign = "left";

  const bufferEmpty = () => runs.length === 0;

  const flushLine = () => {
    items.push({ type: "line", align: bufferEmpty() ? align : lineAlign, runs, text: runs.map((r) => r.text).join(""), cells });
    runs = [];
    cells = 0;
  };

  const appendText = (text: string) => {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const w = charCells(ch) * widthMul;
      if (cells > 0 && cells + w > cols) flushLine(); // auto-wrap at the character boundary
      if (bufferEmpty()) lineAlign = align; // alignment is latched at the start of a line
      const last = runs[runs.length - 1];
      if (last && last.bold === bold && last.underline === underline && last.widthMul === widthMul && last.heightMul === heightMul) {
        last.text += ch;
      } else {
        runs.push({ text: ch, bold, underline, widthMul, heightMul });
      }
      cells += w;
    }
  };

  let textStart = -1;
  const flushPendingText = (end: number) => {
    if (textStart >= 0) {
      appendText(decoder.decode(bytes.subarray(textStart, end)));
      textStart = -1;
    }
  };

  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i];

    // Plain data bytes accumulate and are decoded together, so a multi-byte UTF-8 character is
    // never split.
    const isControl = b < 0x20; // ESC/GS/FS/DLE/LF/CR/NUL…
    if (!isControl) {
      if (textStart < 0) textStart = i;
      i++;
      continue;
    }
    flushPendingText(i);

    if (b === LF) {
      flushLine();
      i++;
      continue;
    }

    if (b === ESC) {
      const cmd = bytes[i + 1];
      if (cmd === undefined) break; // truncated
      i += 2;
      switch (cmd) {
        case 0x40: // ESC @ — initialize. Buffered data is printed, never silently dropped.
          if (!bufferEmpty()) flushLine();
          bold = false; underline = false; widthMul = 1; heightMul = 1; align = "left";
          break;
        case 0x61: { // ESC a n — alignment
          const p = bytes[i]; i++;
          if (p === undefined) break;
          const v = p >= 48 ? p - 48 : p;
          align = v === 1 ? "center" : v === 2 ? "right" : "left";
          break;
        }
        case 0x45: // ESC E n — emphasized
        case 0x47: { // ESC G n — double-strike (renders the same)
          const p = bytes[i]; i++;
          if (p !== undefined) bold = (p & 1) === 1;
          break;
        }
        case 0x21: { // ESC ! n — print mode: bit3 emphasized, bit4 double height, bit5 double width, bit7 underline
          const p = bytes[i]; i++;
          if (p === undefined) break;
          bold = (p & 0x08) !== 0;
          heightMul = (p & 0x10) !== 0 ? 2 : 1;
          widthMul = (p & 0x20) !== 0 ? 2 : 1;
          underline = (p & 0x80) !== 0;
          break;
        }
        case 0x2d: { // ESC - n — underline
          const p = bytes[i]; i++;
          if (p !== undefined) underline = p === 1 || p === 2 || p === 49 || p === 50;
          break;
        }
        case 0x64: { // ESC d n — print and feed n lines
          const p = bytes[i]; i++;
          if (p === undefined) break;
          if (!bufferEmpty()) flushLine();
          if (p > 0) items.push({ type: "feed", lines: p });
          break;
        }
        // One-parameter commands the layout doesn't model: consume the parameter.
        case 0x33: case 0x4d: case 0x74: case 0x52: case 0x4a: case 0x20: case 0x56: case 0x7b:
        case 0x3d: case 0x63:
          i += 1;
          break;
        case 0x24: case 0x5c: // ESC $ / ESC \ — absolute / relative position (2 params)
          i += 2;
          break;
        case 0x70: // ESC p — drawer pulse (3 params)
          i += 3;
          break;
        default:
          break; // ESC 2, ESC =, and anything unknown: no parameters we can be sure of
      }
      if (i > n) i = n;
      continue;
    }

    if (b === GS) {
      const cmd = bytes[i + 1];
      if (cmd === undefined) break;
      i += 2;
      switch (cmd) {
        case 0x21: { // GS ! n — character size: high nibble width−1, low nibble height−1
          const p = bytes[i]; i++;
          if (p === undefined) break;
          widthMul = ((p >> 4) & 7) + 1;
          heightMul = (p & 7) + 1;
          break;
        }
        case 0x56: { // GS V — cut. Function B/C/D variants carry one extra parameter byte.
          const m = bytes[i]; i++;
          if (m === undefined) break;
          if (m === 65 || m === 66 || m === 67 || m === 68 || m === 71 || m === 72 || m === 103 || m === 104) i += 1;
          if (!bufferEmpty()) flushLine();
          items.push({ type: "cut" });
          break;
        }
        case 0x6b: { // GS k — barcode: not rendered, but its data must not print as text
          const m = bytes[i]; i++;
          if (m === undefined) break;
          if (m <= 6) {
            while (i < n && bytes[i] !== 0) i++;
            i++; // the NUL terminator
          } else {
            const len = bytes[i]; i++;
            i += len ?? 0;
          }
          break;
        }
        case 0x68: case 0x77: case 0x48: case 0x66: case 0x42: case 0x61: case 0x72: // 1 param
          i += 1;
          break;
        case 0x4c: case 0x57: // GS L / GS W — 2 params
          i += 2;
          break;
        case 0x28: { // GS ( x pL pH <data> — QR/other extended functions
          const pL = bytes[i + 1];
          const pH = bytes[i + 2];
          if (pL === undefined || pH === undefined) { i = n; break; }
          i += 3 + (pL + pH * 256);
          break;
        }
        case 0x76: { // GS v 0 m xL xH yL yH <raster data>
          const xL = bytes[i + 2], xH = bytes[i + 3], yL = bytes[i + 4], yH = bytes[i + 5];
          if (xL === undefined || xH === undefined || yL === undefined || yH === undefined) { i = n; break; }
          i += 6 + (xL + xH * 256) * (yL + yH * 256);
          break;
        }
        default:
          break;
      }
      if (i > n) i = n;
      continue;
    }

    if (b === FS) {
      const cmd = bytes[i + 1];
      if (cmd === undefined) break;
      i += 2;
      if (cmd === 0x70) { // FS p n m — print NV bit image (the logo stored in the printer)
        i += 2;
        if (!bufferEmpty()) flushLine();
        items.push({ type: "logo" });
      }
      if (i > n) i = n;
      continue;
    }

    if (b === DLE) { // DLE EOT n / DLE ENQ n — real-time status requests
      i += 3;
      if (i > n) i = n;
      continue;
    }

    i++; // CR, NUL, HT and any other stray control byte: not printable
  }

  flushPendingText(n);
  if (!bufferEmpty()) flushLine();
  return { cols, items };
}
