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

/** Every ticket the browser fallback should print for this response, in print order. */
export function browserPayloadsOf(data: PrintApiResponse): BrowserPayload[] {
  if (data.browserPayloads && data.browserPayloads.length > 0) return data.browserPayloads;
  if (data.browserPayload?.data) return [data.browserPayload];
  return [];
}

/**
 * The same response with `browserPayloads` filled in from its ESC/POS print jobs, for when the
 * server attached none because the fallback was decided on the client (the Electron host failed to
 * enqueue the job, so the bytes only exist in `printJob(s)`). `widthOf` resolves a printer's column
 * count from the cached printer settings; unknown printers default to 48 columns.
 */
export function withBrowserPayloads(
  data: PrintApiResponse,
  widthOf: (printerId: string) => number | undefined,
): PrintApiResponse {
  if (browserPayloadsOf(data).length > 0) return data;
  const jobs = data.printJobs ?? (data.printJob ? [data.printJob] : []);
  const lifted: BrowserPayload[] = jobs
    .filter((j) => !!j.data)
    .map((j) => ({ encoding: "escpos-base64" as const, data: j.data, width: widthOf(j.printerId) ?? 48 }));
  return lifted.length > 0 ? { ...data, browserPayloads: lifted } : data;
}
