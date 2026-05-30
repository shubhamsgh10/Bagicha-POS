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

let ps: ChildProcess | null = null;
let ready = false;
let initPromise: Promise<void> | null = null;
let stdoutBuf = "";
const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

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

    ps.stdout!.setEncoding("utf8");
    ps.stdout!.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      if (!ready && stdoutBuf.includes("PSREADY")) {
        ready = true;
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
      console.warn("[persistentPs] PowerShell session exited with code", code);
      // Reject any pending jobs
      const err = new Error("PowerShell session exited unexpectedly");
      for (const p of pending) p.reject(err);
      pending.length = 0;
      ps = null;
      ready = false;
      initPromise = null;
    });

    ps.on("error", (err) => {
      clearTimeout(deadline);
      reject(err);
      ps = null;
      ready = false;
      initPromise = null;
    });

    // Send C# type definition once; signal readiness with PSREADY
    const initCmd =
      `$ErrorActionPreference = 'Continue'\n` +
      `Add-Type -TypeDefinition @'\n${RAW_PRINTER_HELPER}\n'@\n` +
      `Write-Output "PSREADY"\n`;
    ps.stdin!.write(initCmd);
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

    const t = setTimeout(() => {
      const i = pending.findIndex((h) => h.resolve === resolveWrapper);
      if (i !== -1) pending.splice(i, 1);
      reject(new Error("Print job timed out (30s)"));
    }, 30_000);

    const resolveWrapper = () => { clearTimeout(t); resolve(); };
    const rejectWrapper  = (e: Error) => { clearTimeout(t); reject(e); };

    pending.push({ resolve: resolveWrapper, reject: rejectWrapper });
    if (!ps?.stdin) {
      pending.pop();
      clearTimeout(t);
      reject(new Error("PowerShell session not available"));
      return;
    }
    ps.stdin.write(cmd);
  });
}

export async function warmPrinterSession(): Promise<void> {
  if (process.platform !== "win32") return;
  try { await startSession(); } catch (e) {
    console.warn("[persistentPs] warm failed:", e);
  }
}

export function closePrinterSession(): void {
  const err = new Error("Printer session closed");
  for (const p of pending) p.reject(err);
  pending.length = 0;
  try { ps?.stdin?.end(); ps?.kill(); } catch {}
  ps = null;
  ready = false;
  initPromise = null;
}
