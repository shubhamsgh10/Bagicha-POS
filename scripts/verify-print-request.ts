/**
 * Verifies shared/printRequest.ts — the pure helpers behind "one request per print tap":
 * request-flag parsing, the bill-requested rule, the submit-mode → print mapping, the KOT
 * catch-up "nothing to say" test, and executePrintStep's never-throws contract.
 * Run: npx tsx scripts/verify-print-request.ts
 */
import {
  parseBillRequestFlags,
  parseSavePrintRequest,
  shouldMarkBilled,
  printFieldsForSubmitMode,
  isSkippableKotResult,
  executePrintStep,
} from "../shared/printRequest";

const checks: Array<[string, boolean]> = [];
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── parseBillRequestFlags ──
checks.push(["bill flags: empty body", eq(parseBillRequestFlags({}), { withKotCatchUp: false, markBilled: null })]);
checks.push(["bill flags: null body", eq(parseBillRequestFlags(null), { withKotCatchUp: false, markBilled: null })]);
checks.push([
  "bill flags: both set",
  eq(parseBillRequestFlags({ withKotCatchUp: true, markBilled: "always" }), { withKotCatchUp: true, markBilled: "always" }),
]);
checks.push(["bill flags: on_send accepted", parseBillRequestFlags({ markBilled: "on_send" }).markBilled === "on_send"]);
checks.push(["bill flags: bogus markBilled → null", parseBillRequestFlags({ markBilled: "yes" }).markBilled === null]);
checks.push(["bill flags: withKotCatchUp must be a real boolean", parseBillRequestFlags({ withKotCatchUp: "true" }).withKotCatchUp === false]);

// ── parseSavePrintRequest ──
checks.push(["save print: kot + auto", eq(parseSavePrintRequest({ print: "kot", auto: true }), { mode: "kot", auto: true, markBilled: null })]);
checks.push(["save print: auto ignored for bill", parseSavePrintRequest({ print: "bill", auto: true }).auto === false]);
checks.push([
  "save print: bill + markBilled",
  eq(parseSavePrintRequest({ print: "bill", markBilled: "always" }), { mode: "bill", auto: false, markBilled: "always" }),
]);
checks.push(["save print: markBilled ignored for kot", parseSavePrintRequest({ print: "kot", markBilled: "always" }).markBilled === null]);
checks.push(["save print: unknown mode → null", parseSavePrintRequest({ print: "x" }).mode === null]);
checks.push(["save print: no body", parseSavePrintRequest(undefined).mode === null]);

// ── shouldMarkBilled ──
checks.push(["markBilled null never flips", shouldMarkBilled(null, { printed: true, dispatched: true }) === false]);
checks.push(["always flips even for a browser fallback", shouldMarkBilled("always", {}) === true]);
checks.push(["on_send flips when printed", shouldMarkBilled("on_send", { printed: true }) === true]);
checks.push(["on_send flips when dispatched", shouldMarkBilled("on_send", { dispatched: true }) === true]);
checks.push(["on_send does not flip for a browser fallback", shouldMarkBilled("on_send", { browserPrint: true } as any) === false]);

// ── printFieldsForSubmitMode ──
checks.push(["mode kot-print", eq(printFieldsForSubmitMode("kot-print"), { print: "kot" })]);
checks.push(["mode save-print", eq(printFieldsForSubmitMode("save-print"), { print: "bill" })]);
checks.push(["mode bill-print", eq(printFieldsForSubmitMode("bill-print"), { print: "bill", markBilled: "always" })]);
checks.push(["mode save → nothing", eq(printFieldsForSubmitMode("save"), {})]);
checks.push(["mode settle → nothing", eq(printFieldsForSubmitMode("settle"), {})]);

// ── isSkippableKotResult ──
checks.push(["skippable: no_delta", isSkippableKotResult({ reason: "no_delta" }) === true]);
checks.push(["skippable: kot_disabled", isSkippableKotResult({ reason: "kot_disabled" }) === true]);
checks.push(["not skippable: a real dispatch", isSkippableKotResult({ dispatched: true }) === false]);
checks.push(["not skippable: browser preview", isSkippableKotResult({ browserPrint: true }) === false]);

async function main() {
  // ── executePrintStep ──
  let kotCalls = 0;
  let billCalls = 0;
  const run = {
    kot: async () => { kotCalls++; return { ok: true as const, body: { printed: true } }; },
    bill: async () => { billCalls++; return { ok: true as const, body: { dispatched: true } }; },
  };
  const k = await executePrintStep("kot", run);
  checks.push(["step kot: body passes through", eq(k, { printed: true })]);
  checks.push(["step kot: only the kot runner ran", kotCalls === 1 && billCalls === 0]);
  const b = await executePrintStep("bill", run);
  checks.push(["step bill: body passes through", eq(b, { dispatched: true }) && billCalls === 1]);

  const notOk = await executePrintStep("kot", { ...run, kot: async () => ({ ok: false as const, message: "Order not found" }) });
  checks.push(["step: ok:false becomes {error}", eq(notOk, { error: "Order not found" })]);

  let reported: unknown = null;
  const thrown = await executePrintStep(
    "bill",
    { ...run, bill: async () => { throw new Error("Printer error: offline"); } },
    (e) => { reported = e; },
  );
  checks.push(["step: a throw becomes {error} (never rejects)", eq(thrown, { error: "Printer error: offline" })]);
  checks.push(["step: onError is told about the throw", reported instanceof Error]);

  // A bill that throws AFTER the KOT catch-up committed must still surface the catch-up result.
  const withCatchUp = await executePrintStep("bill", {
    ...run,
    bill: async () => {
      const e: any = new Error("Printer error: offline");
      e.kotCatchUp = { dispatched: true };
      throw e;
    },
  });
  checks.push([
    "step: a throw carrying kotCatchUp yields {error, kotCatchUp}",
    eq(withCatchUp, { error: "Printer error: offline", kotCatchUp: { dispatched: true } }),
  ]);
  checks.push([
    "step: a throw without kotCatchUp yields exactly {error} (no kotCatchUp key)",
    eq(thrown, { error: "Printer error: offline" }) && !("kotCatchUp" in thrown),
  ]);

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
