/**
 * Verifies shared/print/persistentPs.ts — the long-lived PowerShell session the desktop host uses to send
 * raw ESC/POS bytes to the Windows printer queue in ~15 ms instead of spawning a new PowerShell + compiling
 * the C# helper for every ticket (~1–3 s).
 *
 * THE BUG THIS LOCKS IN: the session was initialised by piping a multi-line here-string
 * (`Add-Type -TypeDefinition @'` … `'@`) to `powershell -Command -`. While stdin stays open PowerShell
 * NEVER executes a here-string sent that way (it keeps waiting for more input), so "PSREADY" never came, init
 * timed out (60 s; historically "30–40 s first-print wait"), and every print silently fell back to the slow
 * per-job path. Single-line commands work fine, so the init is now ONE line (the C# source is base64).
 *
 * Pure checks always run. `--live` additionally drives a real PowerShell on Windows (never a printer — it
 * only talks to a queue that does not exist): init readiness, a fast-path round trip, auto-restart after the
 * process is killed, and no restart after a deliberate close.
 *   npx tsx scripts/verify-ps-session-init.ts            (pure — part of test:pure)
 *   npx tsx scripts/verify-ps-session-init.ts --live     (Windows only, ~15 s)
 */
import { execFileSync } from "child_process";
import {
  buildSessionInitCommand, warmPrinterSession, closePrinterSession, isPrinterSessionReady, sendRawFast,
} from "../shared/print/persistentPs";

const checks: Array<[string, boolean, string?]> = [];
const add = (name: string, ok: boolean, detail?: string) => checks.push([name, ok, detail]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── pure ────────────────────────────────────────────────────────────────────────
const cmd = buildSessionInitCommand();
const body = cmd.replace(/\n$/, "");
add("init command is exactly ONE line (a here-string over stdin never runs)", !body.includes("\n") && !body.includes("\r") && cmd.endsWith("\n"));
add("init command contains no here-string", !cmd.includes("@'") && !cmd.includes("'@"));
const m = cmd.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/);
const decoded = m ? Buffer.from(m[1], "base64").toString("utf8") : "";
add("the C# helper travels as base64 and decodes back intact", decoded.includes("public class RawPrinterHelper") && decoded.includes("SendBytesToPrinter") && decoded.includes("WritePrinter"));
add("it compiles the decoded source and then signals PSREADY", /Add-Type -TypeDefinition \$src/.test(cmd) && /Write-Output "PSREADY"/.test(cmd));
add("init line is a sane size for a stdin line (< 8 KB)", cmd.length < 8192);

// ── live (Windows, opt-in) ──────────────────────────────────────────────────────
async function live() {
  if (process.platform !== "win32") { add("(live) skipped — Windows only", true); return; }
  const waitReady = async (want: boolean, ms: number) => {
    const t0 = Date.now();
    while (isPrinterSessionReady() !== want) { if (Date.now() - t0 > ms) return null; await sleep(100); }
    return Date.now() - t0;
  };
  const sessionPids = (): number[] =>
    execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} AND Name='powershell.exe'" | Where-Object { $_.CommandLine -match '-NonInteractive -Command -[ ]*$' } | ForEach-Object { $_.ProcessId }`],
      { encoding: "utf8" }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map(Number);

  const t0 = Date.now();
  await warmPrinterSession();
  add("(live) session becomes ready at start", isPrinterSessionReady(), `${Date.now() - t0} ms (was: timed out after 60 s)`);
  add("(live) ready quickly (< 15 s)", isPrinterSessionReady() && Date.now() - t0 < 15_000);

  // Fast-path round trip with NO printer involved: a queue that doesn't exist makes WritePrinter's
  // OpenPrinter fail, which the helper reports as PRINT_FAIL — proves the C# helper compiled and the
  // PRINT_OK/PRINT_FAIL protocol works end to end.
  const r0 = Date.now();
  let msg = "";
  try { await sendRawFast("__bagicha_no_such_queue__", Buffer.from("x")); } catch (e: any) { msg = e?.message ?? ""; }
  add("(live) fast path answers (helper compiled; fake queue refused)", /WritePrinter returned false/.test(msg), `${Date.now() - r0} ms: ${msg}`);

  const pids = sessionPids();
  add("(live) exactly one session process", pids.length === 1, JSON.stringify(pids));
  if (pids.length === 1) {
    execFileSync("taskkill", ["/PID", String(pids[0]), "/F"], { stdio: "ignore" }); // like antivirus / a crash
    add("(live) killing it marks the session down", (await waitReady(false, 3000)) !== null);
    const back = await waitReady(true, 30_000);
    add("(live) it restarts BY ITSELF (no print needed)", back !== null, back === null ? "never came back" : `ready again after ${back} ms`);
    add("(live) as a single new process", sessionPids().length === 1);
  }
  closePrinterSession();
  await sleep(4000);
  add("(live) stays down after a deliberate close (no restart at shutdown)", !isPrinterSessionReady() && sessionPids().length === 0);
  await warmPrinterSession();
  add("(live) can be opened again afterwards", isPrinterSessionReady());
  closePrinterSession();
}

(async () => {
  if (process.argv.includes("--live")) await live();
  let failed = 0;
  for (const [name, ok, d] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); if (!ok) failed++; }
  console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
