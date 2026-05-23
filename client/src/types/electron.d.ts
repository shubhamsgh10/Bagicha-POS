import type {
  PrintExecuteResult,
  PrintJob,
  PrintTestPayload,
  UsbScanResult,
} from "@shared/electron/ipc";

export interface ElectronAPI {
  readonly isElectron: true;
  print: (job: PrintJob) => Promise<PrintExecuteResult>;
  printTest: (payload: PrintTestPayload) => Promise<PrintExecuteResult>;
  scanUsbDevices: () => Promise<UsbScanResult>;
  getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
