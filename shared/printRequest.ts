/**
 * Pure helpers for the "one request per print tap" contract. Everything here is DB-free so
 * scripts/verify-print-request.ts can lock it in test:pure.
 */
export type PrintMode = "kot" | "bill";
/**
 * When the server flips a table to "billed" after a bill print:
 *  - "always"  — POS Bill button: any request that got past dispatch (today's POS behaviour);
 *  - "on_send" — Tables-card print: only when something was actually sent (printed or dispatched).
 */
export type MarkBilled = "always" | "on_send";

const parseMarkBilled = (v: unknown): MarkBilled | null =>
  v === "always" || v === "on_send" ? v : null;

const asRecord = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" ? (body as Record<string, unknown>) : {};

/** Flags on POST /api/print/bill. */
export function parseBillRequestFlags(body: unknown): { withKotCatchUp: boolean; markBilled: MarkBilled | null } {
  const b = asRecord(body);
  return { withKotCatchUp: b.withKotCatchUp === true, markBilled: parseMarkBilled(b.markBilled) };
}

/** `print` fields on POST /api/orders and PUT /api/orders/:id/items (Phase 2). */
export function parseSavePrintRequest(body: unknown): { mode: PrintMode | null; auto: boolean; markBilled: MarkBilled | null } {
  const b = asRecord(body);
  const mode: PrintMode | null = b.print === "kot" || b.print === "bill" ? b.print : null;
  return {
    mode,
    auto: mode === "kot" && b.auto === true,
    markBilled: mode === "bill" ? parseMarkBilled(b.markBilled) : null,
  };
}

export function shouldMarkBilled(
  rule: MarkBilled | null,
  body: { printed?: boolean; dispatched?: boolean },
): boolean {
  if (rule === "always") return true;
  if (rule === "on_send") return body.printed === true || body.dispatched === true;
  return false;
}

/** The `print` fields POS.tsx adds to a save, derived from which button was pressed. */
export function printFieldsForSubmitMode(mode: string): { print?: PrintMode; markBilled?: MarkBilled } {
  if (mode === "kot-print") return { print: "kot" };
  if (mode === "save-print") return { print: "bill" };
  if (mode === "bill-print") return { print: "bill", markBilled: "always" };
  return {};
}

/** A KOT result that has nothing to tell the user (no new items / KOT disabled). */
export function isSkippableKotResult(body: { reason?: unknown }): boolean {
  return body.reason === "no_delta" || body.reason === "kot_disabled";
}

export type PrintRunResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Runs the print half of a save-with-print. NEVER rejects: a print failure is returned as
 * `{ error }` so it can ride on the save response without turning a committed save into a 5xx.
 */
export async function executePrintStep(
  mode: PrintMode,
  run: { kot: () => Promise<PrintRunResult>; bill: () => Promise<PrintRunResult> },
  onError: (err: unknown) => void = () => {},
): Promise<Record<string, unknown>> {
  try {
    const r = await (mode === "kot" ? run.kot() : run.bill());
    return r.ok ? r.body : { error: r.message };
  } catch (err: any) {
    onError(err);
    // A bill that threw AFTER its KOT catch-up committed still carries the catch-up result
    // (runBillPrint attaches it) — surface it so those items never silently miss the kitchen.
    return { error: err?.message || "Print failed", ...(err?.kotCatchUp ? { kotCatchUp: err.kotCatchUp } : {}) };
  }
}
