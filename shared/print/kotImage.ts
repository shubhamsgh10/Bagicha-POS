/**
 * kotImage.ts — the Petpooja-style KOT: a proportional sans-serif face on a roomy layout, drawn as a 1-bit
 * bitmap and sent to the printer as ESC/POS raster graphics (GS v 0).
 *
 * WHY an image: a thermal printer's own font is fixed-width and baked into its ROM (Font A 12×24, Font B), so
 * a Verdana-like proportional face — what the reference ticket uses — can only be had by drawing the pixels
 * ourselves. Everything here is pure (no DOM, no fs, no font library): glyph outlines come from the generated
 * table in kotGlyphs.ts, so it runs identically on Vercel, the Electron host's bundled server and in scripts.
 *
 * generateKOTBuffer (generators.ts) calls generateKOTImageBuffer when `kotSettings.kotStyle === "image"` and
 * falls back to the plain-text ticket if this returns null (a character the face lacks — e.g. Devanagari —
 * or an absurdly long ticket), so a ticket never fails to print because of its content.
 *
 * Tuning the look = editing KOT_IMAGE_STYLE below (sizes are in printer dots; 203 dpi ⇒ 8 dots = 1 mm).
 */
import * as E from "./escpos";
import { formatISTDateTime } from "./formatDate";
import { KOT_FACES, type KotFace } from "./kotGlyphs";
import type { KOTItem } from "./generators";
import type { KOTPrintSettings } from "./types";

/** Printer dots per text column — the same 12-dot cell the text tickets use (48 cols = 576 dots = 72 mm). */
const DOTS_PER_COL = 12;

export const KOT_IMAGE_STYLE = {
  /** Left/right paper margin. */
  marginX: 16,
  /** Em size (dots) of the big lines: "KOT - 1", "Dine In", "Table No: O1" and every item row. */
  big: 30,
  /** Em size of the small lines: date/time, the Item/Qty. header, notes, "now 3 (was 2)", footer. */
  small: 24,
  /** Em size of the DUPLICATE / MODIFIED KOT banners. */
  banner: 26,
  /** Line box height as a multiple of the em size. */
  lineHeight: 1.2,
  /** Extra air between two item rows. */
  itemGap: 18,
  /** Extra air between the wrapped lines of ONE item. */
  wrapGap: 4,
  /** Width reserved on the right for the Qty. column. */
  qtyColumn: 76,
  /** Gap between the name column and the Qty. column. */
  qtyGap: 12,
  /** Blank paper above the first line / below the last one. */
  padTop: 16,
  padBottom: 30,
  /** Dotted rule: dot size and pitch. */
  ruleDot: 2,
  rulePitch: 6,
  /** Space above and below a rule. */
  ruleGap: 12,
} as const;

/** Raster rows per GS v 0 command. Some printers choke on one huge command; consecutive bands print seamlessly. */
const BAND_ROWS = 240;
/** Above this many rows the ticket is not worth drawing as an image (≈ 1 MB of base64) — fall back to text. */
const MAX_ROWS = 12000;
/** A dot goes black when at least this much of it is covered. */
const BLACK_AT = 0.5;
/** Vertical sub-samples per dot row (horizontal coverage is computed exactly). */
const SSY = 4;
const CURVE_STEPS_Q = 6;
const CURVE_STEPS_C = 8;

type Weight = "regular" | "bold";
type Pt = [number, number];

const faceOf = (w: Weight): KotFace => KOT_FACES[w];

// ── Glyph outlines ───────────────────────────────────────────────────────────

const contourCache = new Map<string, Pt[][]>();

/** SVG-style path data → closed polylines in font units (curves flattened). */
function parsePath(d: string): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0;
  let cy = 0;
  const re = /([MLQCZ])([^MLQCZ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const op = m[1];
    const body = m[2].trim();
    const n = body ? body.split(/\s+/).map(Number) : [];
    if (op === "M") {
      if (cur.length) out.push(cur);
      cur = [[n[0], n[1]]];
      cx = n[0]; cy = n[1];
    } else if (op === "L") {
      cur.push([n[0], n[1]]);
      cx = n[0]; cy = n[1];
    } else if (op === "Q") {
      for (let s = 1; s <= CURVE_STEPS_Q; s++) {
        const t = s / CURVE_STEPS_Q, u = 1 - t;
        cur.push([u * u * cx + 2 * u * t * n[0] + t * t * n[2], u * u * cy + 2 * u * t * n[1] + t * t * n[3]]);
      }
      cx = n[2]; cy = n[3];
    } else if (op === "C") {
      for (let s = 1; s <= CURVE_STEPS_C; s++) {
        const t = s / CURVE_STEPS_C, u = 1 - t;
        cur.push([
          u * u * u * cx + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4],
          u * u * u * cy + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5],
        ]);
      }
      cx = n[4]; cy = n[5];
    } else if (op === "Z") {
      if (cur.length) out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function contoursOf(weight: Weight, ch: string): Pt[][] {
  const key = weight + ch;
  let c = contourCache.get(key);
  if (!c) {
    const g = faceOf(weight).glyphs[ch];
    c = g && g[1] ? parsePath(g[1]) : [];
    contourCache.set(key, c);
  }
  return c;
}

/** True if every character of `text` exists in both faces (so it can be drawn). */
export function canDraw(text: string): boolean {
  for (const ch of Array.from(text)) {
    if (!KOT_FACES.regular.glyphs[ch] || !KOT_FACES.bold.glyphs[ch]) return false;
  }
  return true;
}

/** Width of `text` in dots at em size `size`. */
export function measure(text: string, weight: Weight, size: number): number {
  const face = faceOf(weight);
  let units = 0;
  for (const ch of Array.from(text)) units += face.glyphs[ch]?.[0] ?? 0;
  return (units * size) / face.upm;
}

/** Greedy word wrap by measured width; a single over-long word breaks at the character. */
export function wrapText(text: string, weight: Weight, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  const push = () => { if (cur) { lines.push(cur); cur = ""; } };
  for (const word of words) {
    if (measure(word, weight, size) > maxWidth) {
      push();
      let piece = "";
      for (const ch of Array.from(word)) {
        if (piece && measure(piece + ch, weight, size) > maxWidth) { lines.push(piece); piece = ""; }
        piece += ch;
      }
      cur = piece;
      continue;
    }
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && measure(candidate, weight, size) > maxWidth) { push(); cur = word; } else cur = candidate;
  }
  push();
  return lines;
}

// ── Coverage bitmap ──────────────────────────────────────────────────────────

class Coverage {
  readonly cov: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.cov = new Float32Array(w * h);
  }

  /** Axis-aligned filled rectangle (integer dots). sign −1 knocks it out of what is already there. */
  rect(x: number, y: number, rw: number, rh: number, sign: 1 | -1 = 1): void {
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(this.w, Math.round(x + rw));
    const y0 = Math.max(0, Math.round(y)), y1 = Math.min(this.h, Math.round(y + rh));
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.w;
      for (let xx = x0; xx < x1; xx++) this.cov[row + xx] += sign;
    }
  }

  private addSpan(row: number, xa: number, xb: number, weight: number): void {
    if (row < 0 || row >= this.h) return;
    xa = Math.max(0, xa);
    xb = Math.min(this.w, xb);
    if (xb <= xa) return;
    const base = row * this.w;
    const ia = Math.floor(xa);
    const ib = Math.floor(xb);
    if (ia === ib) { this.cov[base + ia] += (xb - xa) * weight; return; }
    this.cov[base + ia] += (ia + 1 - xa) * weight;
    for (let i = ia + 1; i < ib; i++) this.cov[base + i] += weight;
    if (ib < this.w) this.cov[base + ib] += (xb - ib) * weight;
  }

  /** Non-zero-winding fill of closed polygons given in dot coordinates. */
  fill(polys: Pt[][], sign: 1 | -1 = 1): void {
    const ex0: number[] = [], ey0: number[] = [], ex1: number[] = [], ey1: number[] = [], dir: number[] = [];
    let minY = Infinity, maxY = -Infinity;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (a[1] < minY) minY = a[1];
        if (a[1] > maxY) maxY = a[1];
        if (a[1] === b[1]) continue;
        if (a[1] < b[1]) { ex0.push(a[0]); ey0.push(a[1]); ex1.push(b[0]); ey1.push(b[1]); dir.push(1); }
        else { ex0.push(b[0]); ey0.push(b[1]); ex1.push(a[0]); ey1.push(a[1]); dir.push(-1); }
      }
    }
    if (!isFinite(minY)) return;
    const k0 = Math.max(0, Math.floor(minY * SSY));
    const k1 = Math.min(this.h * SSY, Math.ceil(maxY * SSY));
    const wgt = sign / SSY;
    for (let k = k0; k < k1; k++) {
      const ys = (k + 0.5) / SSY;
      const hits: Array<[number, number]> = [];
      for (let e = 0; e < dir.length; e++) {
        if (ey0[e] <= ys && ys < ey1[e]) {
          hits.push([ex0[e] + ((ys - ey0[e]) * (ex1[e] - ex0[e])) / (ey1[e] - ey0[e]), dir[e]]);
        }
      }
      if (hits.length < 2) continue;
      hits.sort((p, q) => p[0] - q[0]);
      let winding = 0;
      for (let h = 0; h < hits.length - 1; h++) {
        winding += hits[h][1];
        if (winding !== 0) this.addSpan(Math.floor(ys), hits[h][0], hits[h + 1][0], wgt);
      }
    }
  }

  /** Draws `text` with its left edge at x and its baseline at y. Returns the drawn width. */
  text(text: string, x: number, baseline: number, weight: Weight, size: number, sign: 1 | -1 = 1): number {
    const face = faceOf(weight);
    const scale = size / face.upm;
    let pen = x;
    for (const ch of Array.from(text)) {
      const g = face.glyphs[ch];
      if (!g) continue;
      const contours = contoursOf(weight, ch);
      if (contours.length) {
        const ox = pen;
        this.fill(contours.map((c) => c.map(([px, py]): Pt => [ox + px * scale, baseline - py * scale])), sign);
      }
      pen += g[0] * scale;
    }
    return pen - x;
  }

  /** 1-bit rows, MSB-first, `ceil(w/8)` bytes per row — the layout GS v 0 expects. */
  toBits(): Uint8Array {
    const wb = Math.ceil(this.w / 8);
    const out = new Uint8Array(wb * this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.cov[y * this.w + x] >= BLACK_AT) out[y * wb + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return out;
  }
}

// ── Ticket layout ────────────────────────────────────────────────────────────

export interface KotImageParams {
  orderNumber: string;
  tableNumber: string | null;
  kotNumber?: string | number;
  isReprint: boolean;
  isDelta: boolean;
  newItems: KOTItem[];
  modifiedItems: Array<KOTItem & { previousQty: number }>;
  cancelledItems: Array<{ name: string; quantity: number; size?: string | null }>;
  kotSettings: KOTPrintSettings;
  width?: number;
  /** The printed timestamp; defaults to now. Only tests pass it. */
  now?: Date;
}

type Op =
  | { k: "text"; text: string; x: number; y: number; weight: Weight; size: number; sign: 1 | -1 }
  | { k: "rect"; x: number; y: number; w: number; h: number; sign: 1 | -1 };

export interface KotBitmap {
  widthDots: number;
  heightDots: number;
  /** ceil(widthDots / 8) bytes per row, MSB first. */
  bits: Uint8Array;
}

const labelOf = (name: string, size?: string | null) => (size ? `${name} (${size})` : name);
const qtyText = (n: number) => String(n);

/** Every string the ticket will draw — used to decide up front whether the face can render it. */
function allStrings(p: KotImageParams): string[] {
  const s: string[] = [String(p.tableNumber ?? ""), String(p.kotNumber ?? "")];
  for (const i of [...p.newItems, ...p.modifiedItems]) s.push(labelOf(i.name, i.size), i.instructions ?? "");
  for (const i of p.cancelledItems) s.push(labelOf(i.name, i.size));
  return s;
}

/**
 * Lays the ticket out and paints it. Returns null when it cannot be drawn as an image (a character the
 * face lacks, or a ticket too tall) — the caller prints the plain-text KOT instead.
 */
export function renderKotBitmap(p: KotImageParams): KotBitmap | null {
  if (!allStrings(p).every(canDraw)) return null;

  const S = KOT_IMAGE_STYLE;
  const widthDots = (p.width ?? 48) * DOTS_PER_COL;
  const mx = S.marginX;
  const rightEdge = widthDots - mx;
  const ops: Op[] = [];
  let y: number = S.padTop;

  const lineBox = (size: number) => Math.round(size * S.lineHeight);
  const baselineIn = (top: number, size: number) => top + Math.round(size * 0.93);

  /** Places one line of text; `align` positions it inside [mx, rightEdge]. Advances nothing. */
  const put = (text: string, weight: Weight, size: number, align: "left" | "center" | "right", top = y, xOverride?: number) => {
    const w = measure(text, weight, size);
    const x =
      xOverride !== undefined ? xOverride :
      align === "center" ? Math.round((widthDots - w) / 2) :
      align === "right" ? Math.round(rightEdge - w) : mx;
    ops.push({ k: "text", text, x, y: baselineIn(top, size), weight, size, sign: 1 });
    return { x, w };
  };
  const line = (text: string, weight: Weight, size: number, align: "left" | "center" | "right", gap = 0) => {
    put(text, weight, size, align);
    y += lineBox(size) + gap;
  };
  const rule = () => {
    y += S.ruleGap;
    for (let x = mx; x + S.ruleDot <= rightEdge; x += S.rulePitch) {
      ops.push({ k: "rect", x, y, w: S.ruleDot, h: S.ruleDot, sign: 1 });
    }
    y += S.ruleDot + S.ruleGap;
  };
  /** White-on-black full-width bar — for the lines the kitchen must not miss (MODIFIED KOT, PARCEL …). */
  const bar = (label: string, size: number) => {
    const h = lineBox(size) + 8;
    ops.push({ k: "rect", x: mx, y, w: rightEdge - mx, h, sign: 1 });
    const w = measure(label, "bold", size);
    ops.push({ k: "text", text: label, x: Math.round((widthDots - w) / 2), y: baselineIn(y + 4, size), weight: "bold", size, sign: -1 });
    y += h + 8;
  };

  // ── Header ──
  if (p.isReprint && p.kotSettings.showDuplicateWatermark) {
    line("** DUPLICATE **", "bold", S.banner, "center", 2);
    rule();
  }
  if (p.kotSettings.kotNumbering !== false) {
    const { dateStr, timeStr } = formatISTDateTime(p.now ?? new Date());
    line(`${dateStr} ${timeStr}`, "regular", S.small, "center", 2);
    line(`KOT - ${p.kotNumber ?? 1}`, "regular", S.big, "center", 4);
  }
  line(p.tableNumber ? "Dine In" : "Take Away", "bold", S.big, "center", 4);
  if (p.tableNumber) line(`Table No: ${p.tableNumber}`, "bold", S.big, "center", 4);
  if (p.isDelta) {
    y += 6;
    bar("MODIFIED KOT", S.banner);
  }
  rule();

  // ── Column header ──
  {
    const top = y;
    put("Item", "regular", S.small, "left", top);
    put("Qty.", "regular", S.small, "right", top);
    y += lineBox(S.small) + 6;
  }

  // ── Item rows ──
  const nameMaxW = rightEdge - mx - S.qtyColumn - S.qtyGap;
  const noteX = mx + 14;
  const noteMaxW = rightEdge - noteX - 8;

  const itemRow = (it: { name: string; quantity: number; size?: string | null; instructions?: string | null; previousQty?: number }, mode: "new" | "modified" | "void") => {
    const weight: Weight = mode === "void" ? "regular" : "bold";
    const lines = wrapText(labelOf(it.name, it.size), weight, S.big, nameMaxW);
    const qty = mode === "new" && it.previousQty != null ? `+${qtyText(it.quantity)}` : qtyText(it.quantity);
    lines.forEach((text, i) => {
      const top = y;
      const { x, w } = put(text, weight, S.big, "left", top);
      if (i === 0) {
        const q = put(qty, "bold", S.big, "right", top);
        if (mode === "void") {
          // Struck through: the kitchen must see at a glance that this line is cancelled.
          const sy = baselineIn(top, S.big) - Math.round(S.big * 0.3);
          ops.push({ k: "rect", x: x - 2, y: sy, w: w + 4, h: 3, sign: 1 });
          ops.push({ k: "rect", x: q.x - 2, y: sy, w: q.w + 4, h: 3, sign: 1 });
        }
      } else if (mode === "void") {
        const sy = baselineIn(top, S.big) - Math.round(S.big * 0.3);
        ops.push({ k: "rect", x: x - 2, y: sy, w: w + 4, h: 3, sign: 1 });
      }
      y += lineBox(S.big) + (i < lines.length - 1 ? S.wrapGap : 0);
    });
    const sub = (text: string) => {
      put(text, "regular", S.small, "left", y, noteX);
      y += lineBox(S.small);
    };
    if (mode === "new" && it.previousQty != null) sub(`now ${it.previousQty + it.quantity} (was ${it.previousQty})`);
    if (mode === "modified" && it.previousQty != null) sub(`was ${it.previousQty}`);
    if (mode !== "void" && p.kotSettings.printAddons && it.instructions) {
      wrapText(it.instructions, "regular", S.small, noteMaxW - measure("» ", "regular", S.small)).forEach((text, i) =>
        sub(i === 0 ? `» ${text}` : `   ${text}`),
      );
    }
    y += S.itemGap;
  };

  const modeLabels: Record<string, string> = { dinein: "DINE-IN", pickup: "PICKUP", delivery: "DELIVERY" };
  const hasMixed = p.newItems.some((i) => i.serviceMode && i.serviceMode !== "dinein");
  if (hasMixed) {
    for (const mode of ["dinein", "pickup", "delivery"]) {
      const group = p.newItems.filter((i) => (i.serviceMode ?? "dinein") === mode);
      if (group.length === 0) continue;
      bar(modeLabels[mode] ?? mode.toUpperCase(), S.small);
      group.forEach((i) => itemRow(i, "new"));
    }
  } else {
    p.newItems.forEach((i) => itemRow(i, "new"));
  }

  if (p.kotSettings.printModifiedItemsOnly && p.modifiedItems.length > 0) {
    p.modifiedItems.forEach((i) => itemRow(i, "modified"));
  }

  if (p.kotSettings.printCancelledKOT && p.cancelledItems.length > 0) {
    rule();
    line("CANCELLED", "bold", S.banner, "center", 4);
    p.cancelledItems.forEach((i) => itemRow(i, "void"));
  }

  // ── Footer ──
  const totalItems = p.newItems.reduce((s, i) => s + i.quantity, 0);
  rule();
  line(`Total Items: ${totalItems}`, "bold", S.banner, "center");
  y += S.padBottom;

  const heightDots = y;
  if (heightDots > MAX_ROWS) return null;

  const cov = new Coverage(widthDots, heightDots);
  for (const op of ops) {
    if (op.k === "rect") cov.rect(op.x, op.y, op.w, op.h, op.sign);
    else cov.text(op.text, op.x, op.y, op.weight, op.size, op.sign);
  }
  return { widthDots, heightDots, bits: cov.toBits() };
}

/** GS v 0 raster command(s) for a bitmap, split into bands. */
export function rasterCommands(bm: KotBitmap): Buffer[] {
  const wb = Math.ceil(bm.widthDots / 8);
  const out: Buffer[] = [];
  for (let row = 0; row < bm.heightDots; row += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, bm.heightDots - row);
    out.push(
      Buffer.from([0x1d, 0x76, 0x30, 0x00, wb & 0xff, wb >> 8, rows & 0xff, rows >> 8]),
      Buffer.from(bm.bits.subarray(row * wb, (row + rows) * wb)),
    );
  }
  return out;
}

/** The complete ESC/POS job for an image-style KOT, or null if it cannot be drawn (caller prints text). */
export function generateKOTImageBuffer(p: KotImageParams): Buffer | null {
  const bm = renderKotBitmap(p);
  if (!bm) return null;
  // CUT is GS V 65 0, which already feeds the paper to the cutter — the bottom padding is in the image.
  return E.build(E.INIT, ...rasterCommands(bm), E.CUT);
}
