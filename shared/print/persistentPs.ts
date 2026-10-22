import { spawn } from "child_process";
import type { ChildProcess } from "child_process";

// Copied verbatim from windowsRawPrint.ts — must stay in sync
const RAW_PRINTER_HELPER = `
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);
  [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "Bagicha POS";
    di.pDataType = "RAW";
    if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
    if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
  IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
    int written = 0;
    bool ok = WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written);
    Marshal.FreeCoTaskMem(pUnmanaged);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return ok && written == bytes.Length;
  }
}
`;

/**
 * The one command that readies the session: compile the C# helper, then print PSREADY.
 *
 * It MUST be a single line. This used to be `Add-Type -TypeDefinition @'` … `'@` — a multi-line
 * here-string — piped to `powershell -Command -`. While stdin stays open PowerShell never executes a
 * here-string sent that way (it keeps waiting for more input; reproduced on Windows PowerShell 5.1), so
 * PSREADY never arrived, init timed out (60 s here; "30–40 s first-print wait" per the git history) and every
 * ticket silently used the slow per-job fallback (new PowerShell + C# compile each time, ~1–3 s).
 * Single-line commands are executed immediately, so the C# source is shipped as base64 and decoded in-process.
 * Verified by scripts/verify-ps-session-init.ts (pure) and its --live mode (real PowerShell).
 */
export function buildSessionInitCommand(): string {
  const b64 = Buffer.from(RAW_PRINTER_HELPER, "utf8").toString("base64");
  return (
    `$ErrorActionPreference = 'Continue'; ` +
    `$src = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}')); ` +
    `Add-Type -TypeDefinition $src; ` +
    `Write-Output "PSREADY"\n`
  );
}

let ps: ChildProcess | null = null;
let ready = false;
let initPromise: Promise<void> | null = null;
let stdoutBuf = "";
const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

// Auto-restart. If the PowerShell session dies (crash, killed by antivirus, init timeout) nothing used to
// bring it back until a print arrived: that print fell back to sendRawLegacy — a brand-new PowerShell plus a
// C# Add-Type compile, ~2–3 s — while the session re-warmed in the background. Restarting proactively (with
// backoff, so a machine where PowerShell can't start doesn't spin) means the next ticket finds it warm.
// `closing` is set by closePrinterSession() (app quit) so a deliberate shutdown never restarts.
let closing = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let restartDelayMs = 1_000;
const RESTART_MAX_DELAY_MS = 60_000;

function scheduleRestart() {
  if (closing || process.platform !== "win32" || restartTimer) return;
  const delay = restartDelayMs;
  restartDelayMs = Math.min(restartDelayMs * 2, RESTART_MAX_DELAY_MS);
  console.warn(`[persistentPs] restarting PowerShell print session in ${delay}ms`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (closing) return;
    startSession().catch((e) => console.warn("[persistentPs] restart failed:", e?.message ?? e));
  }, delay);
  restartTimer.unref?.();
}

/** True when the warm PowerShell session can take a print right now (the ~15 ms fast path). */
export function isPrinterSessionReady(): boolean {
  return ready && !!ps;
}

function drainResponses() {
  while (pending.length > 0) {
    if (stdoutBuf.includes("PRINT_OK")) {
      stdoutBuf = stdoutBuf.replace(/PRINT_OK\r?\n?/, "");
      pending.shift()!.resolve();
    } else if (/PRINT_FAIL:/.test(stdoutBuf)) {
      const m = stdoutBuf.match(/PRINT_FAIL:([^\r\n]*)/);
      stdoutBuf = stdoutBuf.replace(/PRINT_FAIL:[^\r\n]*\r?\n?/, "");
      pending.shift()!.reject(new Error(m?.[1]?.trim() ?? "WritePrinter failed"));
    } else {
      break;
    }
  }
}

function startSession(): Promise<void> {
  if (ready && ps) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error("PowerShell session init timed out (60s)"));
      ps?.kill();
      ps = null;
      ready = false;
      initPromise = null;
    }, 60_000);

    ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const proc = ps;

    ps.stdout!.setEncoding("utf8");
    ps.stdout!.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      if (!ready && stdoutBuf.includes("PSREADY")) {
        ready = true;
        restartDelayMs = 1_000; // healthy again — the next failure starts the backoff from scratch
        stdoutBuf = stdoutBuf.replace("PSREADY", "");
        clearTimeout(deadline);
        resolve();
        return;
      }
      if (ready) drainResponses();
    });

    ps.stderr!.on("data", (chunk: string) => {
      console.warn("[persistentPs] stderr:", chunk.trim());
    });

    ps.on("exit", (code) => {
      // A LATE exit from an old process (e.g. the one the init deadline killed) must not wipe the state
      // of a newer session that has since started: only act when no other session has taken over.
      if (ps && ps !== proc) return;
      console.warn("[persistentPs] PowerShell session exited with code", code);
      // Reject any pending jobs
      const err = new Error("PowerShell session exited unexpectedly");
      for (const p of pending) p.reject(err);
      pending.length = 0;
      ps = null;
      ready = false;
      initPromise = null;
      scheduleRestart();
    });

    ps.on("error", (err) => {
      clearTimeout(deadline);
      reject(err);
      ps = null;
      ready = false;
      initPromise = null;
      scheduleRestart();
    });

    // Send C# type definition once; signal readiness with PSREADY
    ps.stdin!.write(buildSessionInitCommand());
  });

  return initPromise;
}

export async function sendRawFast(queueName: string, data: Buffer): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("sendRawFast is Windows-only");
  }
  // Fail fast if session isn't warm yet — caller falls back to sendRawLegacy immediately.
  // Warm-up continues in background; subsequent prints use the fast path (~15ms).
  if (!ready || !ps) {
    if (!initPromise) startSession().catch(() => {});
    throw new Error("PowerShell session not ready yet");
  }
  return new Promise<void>((resolve, reject) => {
    const b64 = data.toString("base64");
    const esc = queueName.replace(/'/g, "''");
    const cmd =
      `$b=[System.Convert]::FromBase64String('${b64}');` +
      `if([RawPrinterHelper]::SendBytesToPrinter('${esc}',$b)){Write-Output "PRINT_OK"}` +
      `else{Write-Output "PRINT_FAIL:WritePrinter returned false"}\n`;

    if (!ps?.stdin) {
      reject(new Error("PowerShell session not available"));
      return;
    }

    // drainResponses() matches stdout output to pending jobs strictly FIFO — this is
    // one PowerShell process executing commands one at a time in the order they were
    // written to stdin, so that's a valid matching strategy AS LONG AS every entry
    // this function ever pushes stays in `pending` in its original position until its
    // own response consumes it. The timeout below used to splice its entry OUT of
    // `pending` on fire — if PowerShell's real response for this job then arrived late
    // (after the 30s timeout already rejected the caller), drainResponses() would shift
    // the NEXT, unrelated pending job off the front instead and resolve/reject IT with
    // this job's actual outcome. Keep the slot in place and make it inert instead, so a
    // late response is consumed (and discarded) in its correct spot.
    const entry: { resolve: () => void; reject: (e: Error) => void } = {
      resolve: () => {},
      reject: () => {},
    };
    const t = setTimeout(() => {
      entry.resolve = () => {};
      entry.reject = () => {};
      reject(new Error("Print job timed out (30s)"));
    }, 30_000);
    entry.resolve = () => { clearTimeout(t); resolve(); };
    entry.reject = (e: Error) => { clearTimeout(t); reject(e); };

    pending.push(entry);
    ps.stdin.write(cmd);
  });
}

export async function warmPrinterSession(): Promise<void> {
  if (process.platform !== "win32") return;
  closing = false; // allows re-opening after an earlier closePrinterSession()
  try { await startSession(); } catch (e) {
    console.warn("[persistentPs] warm failed:", e);
  }
}

export function closePrinterSession(): void {
  closing = true; // a deliberate shutdown must not trigger the auto-restart in the exit handler
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  const err = new Error("Printer session closed");
  for (const p of pending) p.reject(err);
  pending.length = 0;
  try { ps?.stdin?.end(); ps?.kill(); } catch {}
  ps = null;
  ready = false;
  initPromise = null;
}
