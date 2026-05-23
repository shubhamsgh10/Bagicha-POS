import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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

/** Send raw ESC/POS bytes to a Windows printer queue (spooler). */
export async function sendRawToWindowsQueue(queueName: string, data: Buffer): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Windows raw printing is only available on Windows");
  }

  const tmpPath = join(tmpdir(), `bagicha-print-${randomBytes(8).toString("hex")}.bin`);
  await writeFile(tmpPath, data);

  const escapedPath = tmpPath.replace(/'/g, "''");
  const escapedName = queueName.replace(/'/g, "''");

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `if (-not (Get-Printer -Name '${escapedName}' -ErrorAction SilentlyContinue)) {`,
    `  throw "Printer queue not found: ${escapedName}"`,
    "}",
    `Add-Type -TypeDefinition @'`,
    RAW_PRINTER_HELPER,
    "'@",
    `$bytes = [System.IO.File]::ReadAllBytes('${escapedPath}')`,
    `if (-not [RawPrinterHelper]::SendBytesToPrinter('${escapedName}', $bytes)) {`,
    "  throw 'WritePrinter failed (is the printer online?)'",
    "}",
  ].join("\n");

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}
