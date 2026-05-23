export {
  getWindowsUsbPrinterQueues,
  windowsPrinterQueueExists,
  pickWindowsQueueForVidPid,
  resolveWindowsQueueForPrinter,
  type WindowsPrinterQueue,
} from "../../shared/print/windowsPrinters.js";

/** @deprecated */
export async function getWindowsUsbFriendlyNames(): Promise<Map<string, string>> {
  const { getWindowsUsbPrinterQueues } = await import("../../shared/print/windowsPrinters.js");
  const queues = await getWindowsUsbPrinterQueues();
  const map = new Map<string, string>();
  for (const q of queues) {
    const key = `${q.vendorId}:${q.productId}`;
    if (!map.has(key)) map.set(key, q.queueName);
  }
  return map;
}
