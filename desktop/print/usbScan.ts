import { promisify } from "util";
import type { Device } from "usb";
import { getWindowsUsbPrinterQueues } from "../../shared/print/windowsPrinters.js";

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  displayName?: string;
  isLikelyPrinter?: boolean;
  windowsQueueName?: string;
}

async function readUsbString(device: Device, index: number): Promise<string | undefined> {
  if (!index) return undefined;
  try {
    const getStringDescriptor = promisify(device.getStringDescriptor.bind(device));
    const value = (await getStringDescriptor(index)) as string | undefined;
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function isPrinterClass(classCode: number | undefined): boolean {
  return classCode === 7;
}

function looksLikeThermalPrinter(name: string): boolean {
  const n = name.toLowerCase();
  return /epson|star|bixolon|citizen|pos|thermal|receipt|tm-|tsp|xp-|laserjet|hp /.test(n);
}

function looksLikeNonPrinter(name: string): boolean {
  const n = name.toLowerCase();
  return /scanner|fax|camera|composite|bluetooth|hub|keyboard|mouse|audio|pdf|onenote/.test(n);
}

async function readDescriptorNames(device: Device): Promise<{
  productName?: string;
  manufacturerName?: string;
  isLikelyPrinter: boolean;
}> {
  const desc = device.deviceDescriptor;
  let isLikelyPrinter = isPrinterClass(desc.bDeviceClass);
  let productName: string | undefined;
  let manufacturerName: string | undefined;

  try {
    device.open();
    productName = await readUsbString(device, desc.iProduct);
    manufacturerName = await readUsbString(device, desc.iManufacturer);

    const config = device.configDescriptor;
    if (config?.interfaces) {
      for (const ifaceGroup of config.interfaces) {
        for (const alt of ifaceGroup) {
          if (isPrinterClass(alt.bInterfaceClass)) isLikelyPrinter = true;
          if (!productName && alt.iInterface) {
            const ifaceName = await readUsbString(device, alt.iInterface);
            if (ifaceName) productName = ifaceName;
          }
        }
      }
    }
  } catch {
    /* ignore */
  } finally {
    try {
      device.close();
    } catch {
      /* ignore */
    }
  }

  return { productName, manufacturerName, isLikelyPrinter };
}

function buildDisplayName(info: {
  productName?: string;
  manufacturerName?: string;
  vendorId: number;
  productId: number;
}): string {
  if (info.manufacturerName && info.productName) {
    const m = info.manufacturerName.toLowerCase();
    const p = info.productName.toLowerCase();
    if (p.includes(m)) return info.productName;
    return `${info.manufacturerName} ${info.productName}`;
  }
  if (info.productName) return info.productName;
  if (info.manufacturerName) return info.manufacturerName;
  const vid = info.vendorId.toString(16).padStart(4, "0");
  const pid = info.productId.toString(16).padStart(4, "0");
  return `USB device 0x${vid}:0x${pid}`;
}

async function listUsbDevicesWindows(): Promise<UsbDeviceInfo[]> {
  const queues = await getWindowsUsbPrinterQueues();
  return queues.map((q) => ({
    vendorId: q.vendorId ?? 0,
    productId: q.productId ?? 0,
    productName: q.displayName,
    displayName: q.displayName,
    windowsQueueName: q.queueName,
    isLikelyPrinter:
      looksLikeThermalPrinter(q.queueName) ||
      (q.portName?.toUpperCase().startsWith("USB") ?? false),
  })).sort((a, b) => {
    if (a.isLikelyPrinter !== b.isLikelyPrinter) return a.isLikelyPrinter ? -1 : 1;
    if (looksLikeNonPrinter(a.displayName ?? "") !== looksLikeNonPrinter(b.displayName ?? "")) {
      return looksLikeNonPrinter(a.displayName ?? "") ? 1 : -1;
    }
    return (a.displayName ?? "").localeCompare(b.displayName ?? "", undefined, {
      sensitivity: "base",
    });
  });
}

/** List USB / installed printers for setup UI. */
export async function listUsbDevices(): Promise<UsbDeviceInfo[]> {
  if (process.platform === "win32") {
    return listUsbDevicesWindows();
  }

  const usbModule = await import("usb");
  const rawDevices = usbModule.getDeviceList();
  const byKey = new Map<string, UsbDeviceInfo>();

  for (const device of rawDevices) {
    const { idVendor, idProduct } = device.deviceDescriptor;
    const key = `${idVendor}:${idProduct}`;
    if (byKey.has(key)) continue;

    const { productName, manufacturerName, isLikelyPrinter } = await readDescriptorNames(device);

    byKey.set(key, {
      vendorId: idVendor,
      productId: idProduct,
      productName,
      manufacturerName,
      displayName: buildDisplayName({
        productName,
        manufacturerName,
        vendorId: idVendor,
        productId: idProduct,
      }),
      isLikelyPrinter,
    });
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.isLikelyPrinter !== b.isLikelyPrinter) return a.isLikelyPrinter ? -1 : 1;
    return (a.displayName ?? "").localeCompare(b.displayName ?? "", undefined, {
      sensitivity: "base",
    });
  });
}
