// Raw ESC/POS byte generation — no external dependencies, no I/O.

const ESC = 0x1b;
const GS = 0x1d;
const LF_CODE = 0x0a;

export const INIT = Buffer.from([ESC, 0x40]);
export const LF = Buffer.from([LF_CODE]);
export const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
export const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
export const ALIGN_RIGHT = Buffer.from([ESC, 0x61, 0x02]);
export const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
export const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
export const DOUBLE_SIZE_ON  = Buffer.from([0x1B, 0x21, 0x30]); // ESC ! 0x30 — double-width + double-height
export const DOUBLE_SIZE_OFF = Buffer.from([0x1B, 0x21, 0x00]); // ESC ! 0x00 — back to normal
export const LOGO_NV_FLASH   = Buffer.from([0x1C, 0x70, 0x01, 0x00]); // FS p 1 0 — print NV bitmap slot 1
export const CUT = Buffer.from([GS, 0x56, 0x41, 0x00]);

export function feed(n: number): Buffer {
  return Buffer.from([ESC, 0x64, Math.min(n, 255)]);
}

export function text(str: string): Buffer {
  return Buffer.from(str, "utf8");
}

export function line(str = ""): Buffer {
  return Buffer.concat([Buffer.from(str, "utf8"), Buffer.from([LF_CODE])]);
}

export function divider(char = "-", width = 32): Buffer {
  return line(char.repeat(width));
}

export function twoColumns(left: string, right: string, width = 32): Buffer {
  const maxLeft = Math.max(1, width - right.length - 1);
  const l = left.substring(0, maxLeft).padEnd(maxLeft);
  return line(`${l} ${right}`);
}

export function centered(str: string, width = 32): Buffer {
  const pad = Math.max(0, Math.floor((width - str.length) / 2));
  return line(" ".repeat(pad) + str);
}

/**
 * Greedy word-wrap into lines no wider than `width`. Breaks at spaces so a
 * trailing "(Small)"-style suffix never gets orphaned mid-word onto its own
 * line; a single word longer than `width` (no spaces to break at) falls back
 * to a hard character break so it can never overflow the column.
 */
export function wrapWords(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let rest = word;
      while (rest.length > width) {
        lines.push(rest.substring(0, width));
        rest = rest.substring(width);
      }
      current = rest;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function build(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

export function barcode128(data: string): Buffer {
  const content = `{B${data}`;
  return Buffer.concat([
    Buffer.from([0x1d, 0x68, 0x50]),
    Buffer.from([0x1d, 0x77, 0x02]),
    Buffer.from([0x1d, 0x48, 0x02]),
    Buffer.from([0x1d, 0x6b, 0x49, content.length]),
    Buffer.from(content, "ascii"),
  ]);
}
