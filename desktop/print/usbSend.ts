import type { PrinterConfig } from "../types.js";
import {
  resolveWindowsQueueForPrinter,
  windowsPrinterQueueExists,
} from "./usbNamesWindows.js";
import { sendViaLibusb } from "./usbLibusb.js";
import { sendRawToWindowsQueue } from "../../shared/print/windowsRawPrint.js";

async function resolveWindowsQueueName(printer: PrinterConfig): Promise<string | undefined> {
  if (printer.vendorId == null || printer.productId == null) {
    const saved = printer.windowsQueueName?.trim();
    if (saved && (await windowsPrinterQueueExists(saved))) return saved;
    return undefined;
  }
  return resolveWindowsQueueForPrinter(
    printer.vendorId,
    printer.productId,
    printer.windowsQueueName,
  );
}

/**
 * USB ESC/POS: on Windows use the installed printer queue (usbprint driver).
 * libusb cannot claim devices that use the standard Windows USB print driver.
 */
export async function sendToUsbPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (process.platform === "win32") {
    const savedQueue = printer.windowsQueueName?.trim();
    if (savedQueue && (await windowsPrinterQueueExists(savedQueue))) {
      await sendRawToWindowsQueue(savedQueue, data);
      return;
    }

    const queueName = await resolveWindowsQueueName(printer);
    if (!queueName) {
      throw new Error(
        `No Windows print queue found. In Printer Setup → USB → Scan, select ` +
          `"HP LaserJet Professional M1136 MFP" (or your receipt printer), save, and try again. ` +
          printer.vendorId != null && printer.productId != null
            ? `(Configured VID:0x${printer.vendorId!.toString(16).padStart(4, "0")} PID:0x${printer.productId!.toString(16).padStart(4, "0")} may not match the installed queue.)`
            : `(Set windowsQueueName by scanning and saving the printer.)`,
      );
    }
    try {
      await sendRawToWindowsQueue(queueName, data);
      return;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      throw new Error(`Windows print to "${queueName}" failed: ${msg}`);
    }
  }

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
