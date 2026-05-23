import type { PrintJob } from "../print/types";

/** IPC channel names — keep in sync with desktop/preload.ts and desktop/main.ts */
export const IPC = {
  PRINT_EXECUTE: "print:execute",
  PRINT_TEST: "print:test",
  USB_SCAN: "usb:scan",
  APP_VERSION: "app:version",
} as const;

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
