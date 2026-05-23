import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIST_SCRIPT = path.join(__dirname, "scripts", "list-windows-printers.ps1");

export interface WindowsPrinterQueue {
  vendorId?: number;
  productId?: number;
  /** Exact name for Get-Printer / RawPrinterHelper. */
  queueName: string;
  displayName: string;
  portName?: string;
}

type QueueRow = {
  vid?: string | null;
  pid?: string | null;
  queueName: string;
  portName?: string | null;
};

function isVirtualQueue(name: string): boolean {
  const n = name.toLowerCase();
  return /pdf|onenote|xps|fax|microsoft print|send to/.test(n);
}

/** Installed Windows print queues (USB and others); VID/PID when discoverable. */
export async function getWindowsUsbPrinterQueues(): Promise<WindowsPrinterQueue[]> {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LIST_SCRIPT],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "[]") return [];

    const parsed = JSON.parse(trimmed) as QueueRow | QueueRow[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const result: WindowsPrinterQueue[] = [];

    for (const row of rows) {
      if (!row?.queueName?.trim()) continue;
      const queueName = row.queueName.trim();
      if (isVirtualQueue(queueName)) continue;

      let vendorId: number | undefined;
      let productId: number | undefined;
      if (row.vid && row.pid) {
        const v = parseInt(String(row.vid), 16);
        const p = parseInt(String(row.pid), 16);
        if (!Number.isNaN(v) && !Number.isNaN(p)) {
          vendorId = v;
          productId = p;
        }
      }

      result.push({
        vendorId,
        productId,
        queueName,
        displayName: queueName,
        portName: row.portName?.trim() ?? undefined,
      });
    }
    return result;
  } catch (err) {
    console.warn("[usb] Windows printer queue lookup failed:", err);
    return [];
  }
}

export async function windowsPrinterQueueExists(queueName: string): Promise<boolean> {
  if (process.platform !== "win32" || !queueName.trim()) return false;
  const escaped = queueName.replace(/'/g, "''");
  const script = `if (Get-Printer -Name '${escaped}' -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 10_000 },
    );
    return stdout.trim().toLowerCase() === "yes";
  } catch {
    return false;
  }
}

function scoreQueue(q: WindowsPrinterQueue): number {
  const n = q.queueName.toLowerCase();
  const port = (q.portName ?? "").toLowerCase();
  let score = 0;
  if (port.startsWith("usb")) score += 40;
  if (/epson|star|bixolon|citizen|pos|thermal|receipt|tm-|tsp|xp-/.test(n)) score += 50;
  if (/laserjet|hp /.test(n)) score += 25;
  if (/scanner|fax|camera|composite|bluetooth|hub/.test(n)) score -= 30;
  if (/microsoft|pdf|onenote|xps/.test(n)) score -= 100;
  return score;
}

export function pickWindowsQueueForVidPid(
  queues: WindowsPrinterQueue[],
  vendorId: number,
  productId: number,
): WindowsPrinterQueue | undefined {
  const exact = queues.filter(
    (q) => q.vendorId === vendorId && q.productId === productId,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    return [...exact].sort((a, b) => scoreQueue(b) - scoreQueue(a))[0];
  }

  // Same vendor, different PID (common for HP USBPRINT vs composite interface)
  const sameVendor = queues.filter((q) => q.vendorId === vendorId);
  if (sameVendor.length > 0) {
    return [...sameVendor].sort((a, b) => scoreQueue(b) - scoreQueue(a))[0];
  }

  return undefined;
}

function pickUsbQueueFallback(queues: WindowsPrinterQueue[]): WindowsPrinterQueue | undefined {
  const usb = queues.filter((q) => (q.portName ?? "").toUpperCase().startsWith("USB"));
  if (usb.length === 0) return undefined;
  if (usb.length === 1) return usb[0];
  return [...usb].sort((a, b) => scoreQueue(b) - scoreQueue(a))[0];
}

/** Resolve spooler queue name; queue name wins over VID/PID on Windows. */
export async function resolveWindowsQueueForPrinter(
  vendorId: number,
  productId: number,
  savedQueueName?: string,
): Promise<string | undefined> {
  const saved = savedQueueName?.trim();
  if (saved && (await windowsPrinterQueueExists(saved))) {
    return saved;
  }

  const queues = await getWindowsUsbPrinterQueues();
  if (queues.length === 0) return undefined;

  const byVid = pickWindowsQueueForVidPid(queues, vendorId, productId);
  if (byVid) return byVid.queueName;

  // HP / USB: configured VID/PID may be a composite interface, not USBPRINT
  const byUsb = pickUsbQueueFallback(queues);
  if (byUsb) return byUsb.queueName;

  return queues[0]?.queueName;
}
