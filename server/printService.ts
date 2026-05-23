import net from "net";
import type { PrinterConfig } from "./settingsStore";
export { generateKOTBuffer, generateBillBuffer, toPrintJob } from "@shared/print/generators";
export type { KOTItem } from "@shared/print/generators";

export async function sendToNetworkPrinter(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port }, () => {
      socket.write(data, (err) => {
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        socket.end();
        resolve();
      });
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`Printer at ${ip}:${port} did not respond within 5 seconds`));
    });
    socket.on("error", reject);
  });
}

export async function sendToUsbPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (process.platform === "win32") {
    const { sendRawToWindowsQueue } = await import("@shared/print/windowsRawPrint");
    const { resolveWindowsQueueForPrinter, windowsPrinterQueueExists } = await import(
      "@shared/print/windowsPrinters",
    );

    const savedQueue = printer.windowsQueueName?.trim();
    if (savedQueue && (await windowsPrinterQueueExists(savedQueue))) {
      await sendRawToWindowsQueue(savedQueue, data);
      return;
    }

    if (!printer.vendorId || !printer.productId) {
      throw new Error(
        `USB printer "${printer.name}" needs a Windows queue name. Printer Setup → USB → Scan → pick your printer → Save.`,
      );
    }

    const queue = await resolveWindowsQueueForPrinter(
      printer.vendorId,
      printer.productId,
      printer.windowsQueueName,
    );
    if (!queue) {
      throw new Error(
        `No Windows print queue found. In Settings → Printer Setup → USB → Scan, select your installed printer ` +
          `(e.g. HP LaserJet Professional M1136 MFP) and save. ` +
          `VID:0x${printer.vendorId.toString(16).padStart(4, "0")} PID:0x${printer.productId.toString(16).padStart(4, "0")} may not match USBPRINT drivers.`,
      );
    }
    await sendRawToWindowsQueue(queue, data);
    return;
  }

  if (!printer.vendorId || !printer.productId) {
    throw new Error(`USB printer "${printer.name}" is missing vendorId or productId`);
  }

  let usbModule: any;
  try {
    usbModule = await import("usb");
  } catch {
    throw new Error('USB printing requires the "usb" package. Run: npm install usb');
  }

  const device = usbModule.findByIds(printer.vendorId, printer.productId);
  if (!device) {
    throw new Error(
      `USB printer not found (VID:0x${printer.vendorId.toString(16).padStart(4, "0")} ` +
        `PID:0x${printer.productId.toString(16).padStart(4, "0")}). Ensure the printer is connected.`,
    );
  }

  device.open();
  const iface = device.interfaces?.[0];
  if (!iface) {
    device.close();
    throw new Error("No USB interface found on printer");
  }
  if (process.platform === "linux" && iface.isKernelDriverActive?.()) iface.detachKernelDriver();
  iface.claim();
  const endpoint = iface.endpoints.find((e: any) => e.direction === "out");
  if (!endpoint) {
    iface.release(true, () => device.close());
    throw new Error("No OUT endpoint found on USB printer interface");
  }
  await new Promise<void>((resolve, reject) => {
    endpoint.transfer(data, (err: Error | null) => {
      iface.release(true, () => device.close());
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function sendToPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (printer.type === "network") {
    if (!printer.ip) throw new Error(`Network printer "${printer.name}" has no IP configured`);
    await sendToNetworkPrinter(printer.ip, printer.port ?? 9100, data);
  } else {
    await sendToUsbPrinter(printer, data);
  }
}

/** True when the Node server may send bytes directly (local dev), not on Vercel. */
export function canExecutePrintOnServer(): boolean {
  return !process.env.VERCEL && process.env.PRINT_EXECUTE_SERVER !== "false";
}
