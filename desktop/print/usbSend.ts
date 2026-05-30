import type { PrinterConfig } from "../types.js";
import { resolveWindowsQueueForPrinter } from "./usbNamesWindows.js";
import { sendViaLibusb } from "./usbLibusb.js";
import { sendRawToWindowsQueue } from "../../shared/print/windowsRawPrint.js";

/**
 * Send ESC/POS bytes to a USB printer.
 *
 * Windows: uses winspool WritePrinter via PowerShell persistent session.
 *   - Uses saved queue name directly (no WMI check per print — saves 100-300ms).
 *   - Falls back to VID/PID resolution if no queue name saved.
 *
 * Linux/Mac: uses libusb (unchanged).
 */
export async function sendToUsbPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (process.platform === "win32") {
    const savedQueue = printer.windowsQueueName?.trim();
    if (savedQueue) {
      await sendRawToWindowsQueue(savedQueue, data);
      return;
    }

    // No saved queue name — try to resolve from VID/PID
    if (printer.vendorId != null && printer.productId != null) {
      const queueName = await resolveWindowsQueueForPrinter(
        printer.vendorId,
        printer.productId,
        undefined,
      );
      if (!queueName) {
        throw new Error(
          `No Windows print queue found for printer "${printer.name}". ` +
            `Go to Settings → Printer Setup → Detect Installed Printers, ` +
            `select your printer and Save.`,
        );
      }
      await sendRawToWindowsQueue(queueName, data);
      return;
    }

    throw new Error(
      `USB printer "${printer.name}" has no Windows queue name configured. ` +
        `Go to Settings → Printer Setup → Detect Installed Printers, select your printer and Save.`,
    );
  }

  // Linux / Mac — use libusb (unchanged)
  if (!printer.vendorId || !printer.productId) {
    throw new Error(`USB printer "${printer.name}" is missing vendorId or productId`);
  }
  try {
    await sendViaLibusb(printer.vendorId, printer.productId, data);
  } catch (err: any) {
    const raw = err?.message ?? String(err);
    if (raw.includes("LIBUSB")) {
      throw new Error(
        `USB print failed (${raw}). On Windows, use the Bagicha desktop app with the printer installed in Settings.`,
      );
    }
    throw err;
  }
}
