/**
 * browserPayload.ts — pure helpers for the browser-print fallback's wire shape.
 *
 * The server attaches the exact ESC/POS bytes of every ticket it could not send to a thermal
 * printer (`browserPayload` for a bill, `browserPayloads` for a KOT — category routing can split
 * one tap into several tickets). The client renders those bytes (escposInterpret.ts →
 * receiptRaster.ts) rather than building a layout of its own, so a fallback ticket is the same
 * ticket the printer would have printed.
 */
import type { BrowserPayload, PrintApiResponse } from "./types";
import { decodeBase64 } from "./escposInterpret";

/** Every ticket the browser fallback should print for this response, in print order. */
export function browserPayloadsOf(data: PrintApiResponse): BrowserPayload[] {
  if (data.browserPayloads && data.browserPayloads.length > 0) return data.browserPayloads;
  if (data.browserPayload?.data) return [data.browserPayload];
  return [];
}

/**
 * Splits an ESC/POS stream into its tickets: after every full cut (`GS V 65 0`, the cut shared/print/escpos.ts
 * ends each ticket with) a new ticket starts. The cut bytes stay with the ticket they end; a trailing empty
 * piece is dropped. A joined multi-station KOT job is several tickets in one stream, and the browser fallback
 * must print one page per ticket.
 *
 * Raster images (`GS v 0 m xL xH yL yH <data>`, the bitmap KOT) are skipped over by their declared length: raw
 * bitmap bytes can contain any sequence, including a look-alike cut. Text can't (UTF-8 never emits 0x1D).
 */
export function splitEscPosAtCuts(bytes: Uint8Array): Uint8Array[] {
  const n = bytes.length;
  const pieces: Uint8Array[] = [];
  let start = 0;
  let i = 0;
  while (i < n) {
    if (bytes[i] === 0x1d && i + 1 < n) {
      const cmd = bytes[i + 1];
      if (cmd === 0x76 && bytes[i + 2] === 0x30 && i + 7 < n) {
        // GS v 0 m xL xH yL yH <(xL + xH*256) bytes per row × (yL + yH*256) rows>
        const widthBytes = bytes[i + 4] + bytes[i + 5] * 256;
        const heightDots = bytes[i + 6] + bytes[i + 7] * 256;
        i += 8 + widthBytes * heightDots;
        continue;
      }
      if (cmd === 0x56 && bytes[i + 2] === 0x41 && bytes[i + 3] === 0x00) {
        i += 4;
        pieces.push(bytes.subarray(start, i));
        start = i;
        continue;
      }
    }
    i++;
  }
  if (start < n) pieces.push(bytes.subarray(start));
  return pieces;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
}

/**
 * One payload per ticket in a job's base64 ESC/POS data. A single-ticket job (the normal case) comes back as
 * exactly the payload it always was — same string, no re-encoding; undecodable data is left alone too.
 */
function payloadsOfJob(data: string, width: number): BrowserPayload[] {
  const whole: BrowserPayload = { encoding: "escpos-base64", data, width };
  let pieces: Uint8Array[];
  try {
    pieces = splitEscPosAtCuts(decodeBase64(data));
  } catch {
    return [whole];
  }
  if (pieces.length <= 1) return [whole];
  return pieces.map((p) => ({ encoding: "escpos-base64" as const, data: encodeBase64(p), width }));
}

/**
 * The same response with `browserPayloads` filled in from its ESC/POS print jobs, for when the
 * server attached none because the fallback was decided on the client (the Electron host failed to
 * enqueue the job, so the bytes only exist in `printJob(s)`). `widthOf` resolves a printer's column
 * count from the cached printer settings; unknown printers default to 48 columns.
 * A job that joins several tickets (one cut after each — kitchen stations) is lifted as one payload
 * per ticket, so the fallback prints them as separate pages.
 */
export function withBrowserPayloads(
  data: PrintApiResponse,
  widthOf: (printerId: string) => number | undefined,
): PrintApiResponse {
  if (browserPayloadsOf(data).length > 0) return data;
  const jobs = data.printJobs ?? (data.printJob ? [data.printJob] : []);
  const lifted: BrowserPayload[] = [];
  for (const j of jobs) {
    if (!j.data) continue;
    for (const p of payloadsOfJob(j.data, widthOf(j.printerId) ?? 48)) lifted.push(p);
  }
  return lifted.length > 0 ? { ...data, browserPayloads: lifted } : data;
}
