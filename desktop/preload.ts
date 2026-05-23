import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type PrintExecuteResult,
  type PrintJob,
  type PrintTestPayload,
  type UsbScanResult,
} from "../shared/electron/ipc.js";

const electronAPI = {
  isElectron: true as const,

  print: (job: PrintJob): Promise<PrintExecuteResult> =>
    ipcRenderer.invoke(IPC.PRINT_EXECUTE, job),

  printTest: (payload: PrintTestPayload): Promise<PrintExecuteResult> =>
    ipcRenderer.invoke(IPC.PRINT_TEST, payload),

  scanUsbDevices: (): Promise<UsbScanResult> => ipcRenderer.invoke(IPC.USB_SCAN),

  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_VERSION),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
