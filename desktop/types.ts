export interface PrinterConfig {
  id: string;
  name: string;
  type: "network" | "usb";
  ip?: string;
  port?: number;
  vendorId?: number;
  productId?: number;
  windowsQueueName?: string;
  width?: number;
}

export interface PrintJob {
  printerId: string;
  encoding: "escpos-base64";
  data: string;
  orderId?: number;
  ackType?: "kot" | "bill";
  jobId?: number;
}
