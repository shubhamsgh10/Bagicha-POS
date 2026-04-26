// Raw ESC/POS byte generation — no external dependencies, no I/O.
// Supports 58mm (32 chars) and 80mm (48 chars) paper widths.

const ESC = 0x1B;
const GS  = 0x1D;
const LF_CODE = 0x0A;

export const INIT         = Buffer.from([ESC, 0x40]);
export const LF           = Buffer.from([LF_CODE]);
export const ALIGN_LEFT   = Buffer.from([ESC, 0x61, 0x00]);
export const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
export const ALIGN_RIGHT  = Buffer.from([ESC, 0x61, 0x02]);
export const BOLD_ON      = Buffer.from([ESC, 0x45, 0x01]);
export const BOLD_OFF     = Buffer.from([ESC, 0x45, 0x00]);
export const CUT          = Buffer.from([GS,  0x56, 0x41, 0x00]);

export function feed(n: number): Buffer {
  return Buffer.from([ESC, 0x64, Math.min(n, 255)]);
}

export function text(str: string): Buffer {
  return Buffer.from(str, 'utf8');
}

export function line(str = ''): Buffer {
  return Buffer.concat([Buffer.from(str, 'utf8'), Buffer.from([LF_CODE])]);
}

export function divider(char = '-', width = 32): Buffer {
  return line(char.repeat(width));
}

export function twoColumns(left: string, right: string, width = 32): Buffer {
  const maxLeft = Math.max(1, width - right.length - 1);
  const l = left.substring(0, maxLeft).padEnd(maxLeft);
  return line(`${l} ${right}`);
}

export function centered(str: string, width = 32): Buffer {
  const pad = Math.max(0, Math.floor((width - str.length) / 2));
  return line(' '.repeat(pad) + str);
}

export function build(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}
