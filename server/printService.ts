import net from 'net';
import type { PrinterConfig, KOTPrintSettings, BillPrintSettings, RestaurantSettings } from './settingsStore';
import type { SnapshotItem } from './kotDelta';
import * as E from './escpos';

// ── Transport ─────────────────────────────────────────────────────────────────

export async function sendToNetworkPrinter(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port }, () => {
      socket.write(data, (err) => {
        if (err) { socket.destroy(); reject(err); return; }
        socket.end();
        resolve();
      });
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`Printer at ${ip}:${port} did not respond within 5 seconds`));
    });
    socket.on('error', reject);
  });
}

export async function sendToUsbPrinter(vendorId: number, productId: number, data: Buffer): Promise<void> {
  let usbModule: any;
  try {
    usbModule = await import('usb');
  } catch {
    throw new Error('USB printing requires the "usb" package (npm install usb) and Zadig WinUSB driver setup on Windows.');
  }
  const device = usbModule.findByIds(vendorId, productId);
  if (!device) {
    throw new Error(
      `USB printer not found (VID:0x${vendorId.toString(16).padStart(4, '0')} PID:0x${productId.toString(16).padStart(4, '0')}). ` +
      `Ensure the printer is connected and Zadig WinUSB driver is installed.`
    );
  }
  device.open();
  const iface = device.interfaces[0];
  if (iface.isKernelDriverActive?.()) iface.detachKernelDriver();
  iface.claim();
  const endpoint = iface.endpoints.find((e: any) => e.direction === 'out');
  if (!endpoint) {
    iface.release(true, () => device.close());
    throw new Error('No OUT endpoint found on USB printer interface');
  }
  await new Promise<void>((resolve, reject) => {
    endpoint.transfer(data, (err: Error | null) => {
      iface.release(true, () => device.close());
      if (err) reject(err); else resolve();
    });
  });
}

export async function sendToPrinter(printer: PrinterConfig, data: Buffer): Promise<void> {
  if (printer.type === 'network') {
    if (!printer.ip) throw new Error(`Network printer "${printer.name}" has no IP configured`);
    await sendToNetworkPrinter(printer.ip, printer.port ?? 9100, data);
  } else {
    if (!printer.vendorId || !printer.productId) {
      throw new Error(`USB printer "${printer.name}" is missing vendorId or productId`);
    }
    await sendToUsbPrinter(printer.vendorId, printer.productId, data);
  }
}

// ── KOT Document ──────────────────────────────────────────────────────────────

export interface KOTItem {
  name: string;
  quantity: number;
  size?: string | null;
  instructions?: string | null;
}

export function generateKOTBuffer(params: {
  orderNumber: string;
  tableNumber: string | null;
  kotNumber?: string;
  isReprint: boolean;
  isDelta: boolean;
  newItems: KOTItem[];
  modifiedItems: Array<KOTItem & { previousQty: number }>;
  cancelledItems: Array<{ name: string; quantity: number; size?: string | null }>;
  kotSettings: KOTPrintSettings;
  width?: number;
}): Buffer {
  const W = params.width ?? 32;
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('** DUPLICATE **'), E.BOLD_OFF);
    parts.push(E.divider('=', W));
  }

  const header = params.isDelta ? 'MODIFIED KOT' : 'KITCHEN ORDER';
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(header), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_LEFT);

  const table = params.tableNumber ? `Table: ${params.tableNumber}` : 'Takeaway';
  const kotRef = params.kotNumber ? `KOT#: ${params.kotNumber}` : `Ord: ${params.orderNumber.slice(-6)}`;
  parts.push(E.twoColumns(table, kotRef, W));

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  parts.push(E.twoColumns(dateStr, timeStr, W));
  parts.push(E.divider('-', W));

  for (const item of params.newItems) {
    const label = item.size ? `${item.name} (${item.size})` : item.name;
    parts.push(E.BOLD_ON, E.line(`  ${item.quantity}x ${label}`), E.BOLD_OFF);
    if (params.kotSettings.printAddons && item.instructions) {
      parts.push(E.line(`     [${item.instructions}]`));
    }
  }

  if (params.kotSettings.printModifiedItemsOnly && params.modifiedItems.length > 0) {
    for (const item of params.modifiedItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      parts.push(E.twoColumns(`  ${item.quantity}x ${label}`, `was ${item.previousQty}`, W));
    }
  }

  if (params.kotSettings.printCancelledKOT && params.cancelledItems.length > 0) {
    parts.push(E.divider('-', W));
    for (const item of params.cancelledItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      parts.push(E.BOLD_ON, E.line(`  ** VOID **  ${item.quantity}x ${label}`), E.BOLD_OFF);
    }
  }

  const totalItems = params.newItems.reduce((s, i) => s + i.quantity, 0);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(`Items: ${totalItems}`), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}

// ── Bill Document ─────────────────────────────────────────────────────────────

export function generateBillBuffer(params: {
  order: {
    orderNumber: string;
    tableNumber: string | null;
    customerName: string | null;
    orderType: string;
    totalAmount: string;
    taxAmount: string;
    discountAmount: string | null;
    paymentMethod: string | null;
    billPrintCount: number;
    createdAt: Date | string;
  };
  items: Array<{
    name: string;
    quantity: number;
    price: string;
    size?: string | null;
    specialInstructions?: string | null;
  }>;
  restaurant: RestaurantSettings;
  billSettings: BillPrintSettings;
  width?: number;
}): Buffer {
  const W = params.width ?? 32;
  const { order, items, restaurant, billSettings } = params;
  const sym = restaurant.currencySymbol || '₹';
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  if (order.billPrintCount > 0 && billSettings.showDuplicate) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('** DUPLICATE **'), E.BOLD_OFF);
    parts.push(E.divider('=', W));
  }

  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(restaurant.restaurantName), E.BOLD_OFF);
  if (restaurant.address) parts.push(E.centered(restaurant.address.substring(0, W), W));
  if (restaurant.phone)   parts.push(E.centered(`Tel: ${restaurant.phone}`, W));
  if (restaurant.gstNumber) parts.push(E.centered(`GST: ${restaurant.gstNumber}`, W));
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line('RETAIL INVOICE'), E.BOLD_OFF);
  parts.push(E.divider('=', W));
  parts.push(E.ALIGN_LEFT);

  const created = new Date(order.createdAt);
  const dateStr = created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  parts.push(E.twoColumns(`Order: ${order.orderNumber}`, dateStr, W));
  parts.push(E.twoColumns(
    order.tableNumber ? `Table: ${order.tableNumber}` : order.orderType,
    timeStr, W
  ));
  if (order.customerName) parts.push(E.line(`Customer: ${order.customerName}`));
  parts.push(E.divider('-', W));

  const QW = 4, AW = 7, NW = W - QW - AW - 2;
  parts.push(E.BOLD_ON);
  parts.push(E.line(`${'Item'.padEnd(NW)} ${'Qty'.padStart(QW)} ${'Amt'.padStart(AW)}`));
  parts.push(E.BOLD_OFF);
  parts.push(E.divider('-', W));

  let displayItems = items;
  if (billSettings.mergeDuplicateItems) {
    const map = new Map<string, typeof items[0] & { totalQty: number; totalAmt: number }>();
    for (const item of items) {
      const key = `${item.name}:${item.size ?? ''}`;
      const ex = map.get(key);
      if (ex) {
        ex.totalQty += item.quantity;
        ex.totalAmt += item.quantity * parseFloat(item.price);
      } else {
        map.set(key, { ...item, totalQty: item.quantity, totalAmt: item.quantity * parseFloat(item.price) });
      }
    }
    displayItems = Array.from(map.values()).map(i => ({
      ...i,
      quantity: i.totalQty,
      price: String(i.totalAmt / i.totalQty),
    }));
  }

  for (const item of displayItems) {
    const label = (item.size ? `${item.name}(${item.size})` : item.name).substring(0, NW).padEnd(NW);
    const qty   = String(item.quantity).padStart(QW);
    const amt   = `${sym}${(item.quantity * parseFloat(item.price)).toFixed(0)}`.padStart(AW);
    parts.push(E.line(`${label} ${qty} ${amt}`));
    if (billSettings.showAddons && item.specialInstructions) {
      parts.push(E.line(`  [${item.specialInstructions}]`));
    }
  }

  parts.push(E.divider('-', W));

  const subtotal = parseFloat(order.totalAmount) - parseFloat(order.taxAmount);
  const discount = parseFloat(order.discountAmount || '0');
  const tax      = parseFloat(order.taxAmount);
  const total    = parseFloat(order.totalAmount);

  parts.push(E.twoColumns('Subtotal:', `${sym}${subtotal.toFixed(0)}`, W));
  if (discount > 0) parts.push(E.twoColumns('Discount:', `-${sym}${discount.toFixed(0)}`, W));
  if (billSettings.showBackwardTax && tax > 0) {
    parts.push(E.twoColumns(`Tax (${restaurant.taxRate}%):`, `${sym}${tax.toFixed(0)}`, W));
  }
  parts.push(E.divider('=', W));
  parts.push(E.BOLD_ON, E.twoColumns('TOTAL:', `${sym}${total.toFixed(0)}`, W), E.BOLD_OFF);
  if (order.paymentMethod) {
    parts.push(E.twoColumns('Payment:', order.paymentMethod.toUpperCase(), W));
  }
  parts.push(E.divider('=', W));
  if (restaurant.footerNote) {
    parts.push(E.centered(restaurant.footerNote.substring(0, W), W));
  }
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}
