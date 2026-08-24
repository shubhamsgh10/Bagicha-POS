export interface PrinterConfig {
  id: string;
  name: string;
  type: "network" | "usb";
  ip?: string;
  port?: number;
  vendorId?: number;
  productId?: number;
  /** Windows spooler queue name (from PnP); required for USB print on Windows. */
  windowsQueueName?: string;
  width?: number;
}

export interface KOTPrintSettings {
  enabled: boolean;
  printModifiedKOT: boolean;
  printModifiedItemsOnly: boolean;
  printCancelledKOT: boolean;
  printAddons: boolean;
  showDuplicateWatermark: boolean;
  printDeletedItems: boolean;
  printDeletedSeparate: boolean;
  printOnTableMove: boolean;
  kotPrinterId: string | null;
  autoKOTPrint: boolean;
  autoKOTDebounceMs: number;
  kotNumbering: boolean;
  /** categoryId (stringified) -> printerId; absent/null = fall back to kotPrinterId. */
  categoryPrinterOverrides?: Record<string, string | null>;
}

/** A quick-POS section (e.g. "South Indian"): filtered menu + optional dedicated bill printer. */
export interface PosSection {
  id: string;
  name: string;
  categoryIds: number[];
  /** Bill printer for orders made entirely of this section's items; null/absent = global billPrinterId. */
  billPrinterId?: string | null;
}

export interface BillPrintSettings {
  taxDisplay: "none" | "category-wise";
  itemPriceMode: "exclusive" | "inclusive";
  showBackwardTax: boolean;
  showDuplicate: boolean;
  showCustomerPayment: boolean;
  showKotAsToken: boolean;
  showAddons: boolean;
  mergeDuplicateItems: boolean;
  showOrderBarcode: boolean;
  showQuantityBreakdown: boolean;
  billPrinterId: string | null;
  showLogo: boolean;
  showFssai: boolean;
  showRoundOff: boolean;
  showNameField: boolean;
}

export interface PrintConfigSettings {
  printers: PrinterConfig[];
  kot: KOTPrintSettings;
  bill: BillPrintSettings;
}

/** Payload returned by API for local/Electron print execution. */
export interface PrintJob {
  printerId: string;
  encoding: "escpos-base64";
  data: string;
  /** Present when the Electron queue should ack after successful print. */
  orderId?: number;
  ackType?: "kot" | "bill";
  /** Present when this job was also persisted as a print_jobs row for remote (PRINT_JOB broadcast) dispatch. */
  jobId?: number;
}

export interface PrintApiResponse {
  printed?: boolean;
  printJob?: PrintJob;
  /** All jobs produced by this print (one per routed printer). `printJob` stays = first element for compat. */
  printJobs?: PrintJob[];
  browserPrint?: boolean;
  reason?: string;
  isDelta?: boolean;
  reprint?: boolean;
  orderNumber?: string;
  tableNumber?: string | null;
  items?: Array<{ name: string; quantity: number; size?: string | null }>;
  message?: string;
  /** True when the job was broadcast via PRINT_JOB for remote desktop printing (no local electronAPI). */
  dispatched?: boolean;
}
