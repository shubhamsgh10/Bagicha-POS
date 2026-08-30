import type {
  PrintExecuteResult,
  PrintJob,
  PrintTestPayload,
  UsbScanResult,
  UpdateStatusPayload,
  UpdateProgressPayload,
  UpdateDownloadedPayload,
  UpdateInstallResult,
  AttendanceDeviceConfig,
  AttendanceTestResult,
  AttendanceStatus,
  PrintStationConfig,
} from "@shared/electron/ipc";

export interface ElectronAPI {
  readonly isElectron: true;
  readonly platform: string;

  // ── Printing ──────────────────────────────────────────────────────────────
  print: (job: PrintJob) => Promise<PrintExecuteResult>;
  printTest: (payload: PrintTestPayload) => Promise<PrintExecuteResult>;
  scanUsbDevices: () => Promise<UsbScanResult>;
  getVersion: () => Promise<string>;

  // ── Print Station config (durable file, not localStorage) ────────────────
  getPrintStationConfig: () => Promise<PrintStationConfig | null>;
  setPrintStationConfig: (cfg: PrintStationConfig) => Promise<boolean>;

  refreshPrinters: () => Promise<{ ok: boolean; error?: string }>;
  checkPrinterQueueExists: (queueName: string) => Promise<boolean>;

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

  // ── Biometric attendance device (K30 Pro) ─────────────────────────────────
  attendance: {
    test: (cfg: AttendanceDeviceConfig) => Promise<AttendanceTestResult>;
    status: () => Promise<AttendanceStatus>;
    refresh: () => Promise<{ ok: boolean }>;
  };

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
