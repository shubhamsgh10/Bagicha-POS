import type {
  PrintExecuteResult,
  PrintJob,
  PrintTestPayload,
  UsbScanResult,
  UpdateStatusPayload,
  UpdateProgressPayload,
  UpdateDownloadedPayload,
  UpdateInstallResult,
} from "@shared/electron/ipc";

export interface ElectronAPI {
  readonly isElectron: true;

  // ── Printing ──────────────────────────────────────────────────────────────
  print: (job: PrintJob) => Promise<PrintExecuteResult>;
  printTest: (payload: PrintTestPayload) => Promise<PrintExecuteResult>;
  scanUsbDevices: () => Promise<UsbScanResult>;
  getVersion: () => Promise<string>;

  refreshPrinters: () => Promise<{ ok: boolean; error?: string }>;

  getQueueStatus: () => Promise<Array<{
    id: string;
    type: string;
    status: string;
    retries: number;
    createdAt: number;
    lastError?: string;
  }>>;

  getPrintLogs: (n?: number) => Promise<Array<{
    timestamp: number;
    type: string;
    printerId: string;
    printerName?: string;
    status: string;
    orderId?: number;
    error?: string;
  }>>;

  // ── Auto-update actions ───────────────────────────────────────────────────
  setPosActive: (active: boolean) => Promise<void>;
  checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate: () => Promise<UpdateInstallResult>;

  // ── Auto-update notifications ─────────────────────────────────────────────
  onUpdateStatus:    (cb: (p: UpdateStatusPayload)    => void) => () => void;
  onUpdateProgress:  (cb: (p: UpdateProgressPayload)  => void) => () => void;
  onUpdateDownloaded:(cb: (p: UpdateDownloadedPayload)=> void) => () => void;

  // ── Printer health notifications ──────────────────────────────────────────
  onPrinterHealthWarning: (
    cb: (p: { printerId: string; printerName: string; online: boolean; message: string }) => void
  ) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
