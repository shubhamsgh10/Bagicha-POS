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
  printOnBill: boolean;
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
}

export interface PrintApiResponse {
  printed?: boolean;
  printJob?: PrintJob;
  browserPrint?: boolean;
  reason?: string;
  isDelta?: boolean;
  reprint?: boolean;
  orderNumber?: string;
  tableNumber?: string | null;
  items?: Array<{ name: string; quantity: number; size?: string | null }>;
  message?: string;
}
