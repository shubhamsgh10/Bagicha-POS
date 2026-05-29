import type { PrintJob } from "../print/types";

/** IPC channel names — keep in sync with desktop/preload.ts and desktop/main.ts */
export const IPC = {
  PRINT_EXECUTE: "print:execute",
  PRINT_TEST: "print:test",
  USB_SCAN: "usb:scan",
  APP_VERSION: "app:version",

  // ── Auto-update (main → renderer: notifications) ──────────────────────────
  UPDATE_STATUS:    "app:update-status",
  UPDATE_PROGRESS:  "app:update-progress",
  UPDATE_DOWNLOADED: "app:update-downloaded",
  // ── Auto-update (renderer → main: actions) ────────────────────────────────
  UPDATE_CHECK:    "app:update-check",
  UPDATE_INSTALL:  "app:update-install",
  SET_POS_ACTIVE:  "app:set-pos-active",
  REFRESH_PRINTERS: "printers:refresh",
  QUEUE_STATUS: "queue:status",
  PRINTER_HEALTH: "printer:health",
} as const;

// ── Update payload types ──────────────────────────────────────────────────────

export type UpdateStatus = "checking" | "available" | "current" | "error";

export interface UpdateStatusPayload {
  status: UpdateStatus;
  version?: string;
  error?: string;
}

export interface UpdateProgressPayload {
  percent: number;
  bytesPerSecond?: number;
}

export interface UpdateDownloadedPayload {
  version: string;
}

export interface UpdateInstallResult {
  ok: boolean;
  /** Why the install was blocked (only set when ok=false) */
  reason?: "not-downloaded" | "pos-active" | "dev-mode";
}

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  displayName?: string;
  isLikelyPrinter?: boolean;
  /** Windows printer queue name — save with printer config for USB printing. */
  windowsQueueName?: string;
}

export interface UsbScanResult {
  ok: boolean;
  devices?: UsbDeviceInfo[];
  error?: string;
}

export interface PrintExecuteResult {
  ok: boolean;
  error?: string;
}

export interface PrintTestPayload {
  printerId: string;
  /** Optional test page; if omitted, main builds a default test slip */
  printJob?: PrintJob;
}

export type { PrintJob };
