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
export const CUT = Buffer.from([GS, 0x56, 0x41, 0x00]);
export function feed(n) {
    return Buffer.from([ESC, 0x64, Math.min(n, 255)]);
}
export function text(str) {
    return Buffer.from(str, "utf8");
}
export function line(str = "") {
    return Buffer.concat([Buffer.from(str, "utf8"), Buffer.from([LF_CODE])]);
}
export function divider(char = "-", width = 32) {
    return line(char.repeat(width));
}
export function twoColumns(left, right, width = 32) {
    const maxLeft = Math.max(1, width - right.length - 1);
    const l = left.substring(0, maxLeft).padEnd(maxLeft);
    return line(`${l} ${right}`);
}
export function centered(str, width = 32) {
    const pad = Math.max(0, Math.floor((width - str.length) / 2));
    return line(" ".repeat(pad) + str);
}
export function build(...parts) {
    return Buffer.concat(parts);
}
export function barcode128(data) {
    const content = `{B${data}`;
    return Buffer.concat([
        Buffer.from([0x1d, 0x68, 0x50]),
        Buffer.from([0x1d, 0x77, 0x02]),
        Buffer.from([0x1d, 0x48, 0x02]),
        Buffer.from([0x1d, 0x6b, 0x49, content.length]),
        Buffer.from(content, "ascii"),
    ]);
}
