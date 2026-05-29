import { sendRawFast } from "./persistentPs.js";

/** Send raw ESC/POS bytes to a Windows printer queue via persistent PowerShell session. */
export async function sendRawToWindowsQueue(queueName: string, data: Buffer): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Windows raw printing is only available on Windows");
  }
  return sendRawFast(queueName, data);
}
