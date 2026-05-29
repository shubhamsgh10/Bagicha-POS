import net from "net";
import type { PrintJob, PrinterConfig } from "../types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [0, 2_000, 5_000];
  let last: unknown;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) {
      console.warn(`[print] retry ${i}/${delays.length - 1} for ${label}`);
      await sleep(delays[i]);
    }
    try { return await fn(); } catch (e) { last = e; }
  }
  throw last;
}

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

import { sendToUsbPrinter } from "./usbSend.js";

export async function sendToPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (printer.type === "network") {
    if (!printer.ip) throw new Error(`Network printer "${printer.name}" has no IP configured`);
    await sendToNetworkPrinter(printer.ip, printer.port ?? 9100, data);
  } else {
    await sendToUsbPrinter(printer, data);
  }
}

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
  await withRetry(`printer:${printer.id}`, () => sendToPrinter(printer, buffer));
}
