import net from "net";
import type { PrintJob, PrinterConfig } from "../types.js";

export async function sendToNetworkPrinter(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port }, () => {
      socket.write(data, (err) => {
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        // Disarm the idle watchdog now that the write succeeded — previously this timer
        // stayed armed and fired 5s later regardless, forcibly destroying the socket via
        // .destroy() even after a successful send. A slower downstream hop (e.g. a phone
        // bridging these bytes on to a Bluetooth printer) can take longer than 5s to finish
        // draining the connection, so the late destroy() could cut that off mid-relay even
        // though our own write had already completed cleanly.
        socket.setTimeout(0);
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

import { sendToUsbPrinter } from "./usbSend.js";

export async function sendToPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (printer.type === "network") {
    if (!printer.ip) throw new Error(`Network printer "${printer.name}" has no IP configured`);
    await sendToNetworkPrinter(printer.ip, printer.port ?? 9100, data);
  } else {
    await sendToUsbPrinter(printer, data);
  }
}

/**
 * Execute one print job. Single attempt — PrintQueue handles retries at the job level.
 * (Previously had withRetry which caused 3 Windows queue entries per failure.)
 */
export async function executePrintJob(
  job: PrintJob,
  printers: PrinterConfig[],
): Promise<void> {
  if (job.encoding !== "escpos-base64") {
    throw new Error(`Unsupported print encoding: ${job.encoding}`);
  }
  const printer = printers.find((p) => p.id === job.printerId);
  if (!printer) {
    throw new Error(`Printer "${job.printerId}" not found in settings`);
  }
  const buffer = Buffer.from(job.data, "base64");
  await sendToPrinter(printer, buffer);
}
