import * as E from "./escpos";
import type { BillPrintSettings, KOTPrintSettings } from "./types";

export interface KOTItem {
  name: string;
  quantity: number;
  size?: string | null;
  instructions?: string | null;
  serviceMode?: string | null;
}

export interface BillRestaurantInfo {
  restaurantName: string;
  businessName?: string;
  address: string;
  phone: string;
  gstNumber: string;
  fssaiNumber?: string;
  taxRate: number;
  currencySymbol: string;
  footerNote: string;
}

export function generateKOTBuffer(params: {
  orderNumber: string;
  tableNumber: string | null;
  kotNumber?: string | number;
  isReprint: boolean;
  isDelta: boolean;
  newItems: KOTItem[];
  modifiedItems: Array<KOTItem & { previousQty: number }>;
  cancelledItems: Array<{ name: string; quantity: number; size?: string | null }>;
  kotSettings: KOTPrintSettings;
  width?: number;
}): Buffer {
  const W = params.width ?? 48;
  const M = 1;
  const bodyLine = (s: string) => E.line(" ".repeat(M) + s);
  const tw = (l: string, r: string) => {
    const iW = W - 2 * M;
    const maxL = Math.max(1, iW - r.length - 1);
    return E.line(" ".repeat(M) + l.substring(0, maxL).padEnd(maxL) + " " + r);
  };
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line("** DUPLICATE **"), E.BOLD_OFF);
    parts.push(E.divider("=", W));
  }

  const tableHeader = params.tableNumber ? `TABLE - ${params.tableNumber}` : "TAKEAWAY";
  parts.push(E.ALIGN_CENTER);
  parts.push(E.DOUBLE_SIZE_ON, E.line(tableHeader), E.DOUBLE_SIZE_OFF);

  const subHeader = params.isDelta ? "MODIFIED KOT" : "KITCHEN ORDER";
  parts.push(E.BOLD_ON, E.line(subHeader), E.BOLD_OFF);
  parts.push(E.divider("=", W));
  parts.push(E.ALIGN_LEFT);

  if (params.kotSettings.kotNumbering !== false) {
    const kotNum = String(params.kotNumber ?? 1).padStart(3, "0");
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    parts.push(bodyLine(`KOT#: ${kotNum}   ${dd}/${mo}/${yy}   ${hh}:${mi}`));
  }
  parts.push(E.divider("-", W));

  const renderKotItem = (item: KOTItem) => {
    const label = item.size ? `${item.name} (${item.size})` : item.name;
    const qty = `[ ${String(item.quantity).padStart(2, "0")} ]`;
    parts.push(E.BOLD_ON, bodyLine(`${qty}  ${label}`), E.BOLD_OFF);
    if (params.kotSettings.printAddons && item.instructions) {
      parts.push(bodyLine(`       >> ${item.instructions}`));
    }
  };

  const modeHeaders: Record<string, string> = { dinein: '[ DINE-IN ]', pickup: '[ PICKUP ]', delivery: '[ DELIVERY ]' };
  const hasMixed = params.newItems.some(i => i.serviceMode && i.serviceMode !== 'dinein');
  if (hasMixed) {
    for (const mode of ['dinein', 'pickup', 'delivery']) {
      const group = params.newItems.filter(i => (i.serviceMode ?? 'dinein') === mode);
      if (group.length === 0) continue;
      const hdr = modeHeaders[mode] ?? `[ ${mode.toUpperCase()} ]`;
      parts.push(E.ALIGN_CENTER, E.line(hdr), E.ALIGN_LEFT);
      group.forEach(renderKotItem);
    }
  } else {
    params.newItems.forEach(renderKotItem);
  }

  if (params.kotSettings.printModifiedItemsOnly && params.modifiedItems.length > 0) {
    for (const item of params.modifiedItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, "0")} ]`;
      parts.push(E.BOLD_ON, tw(`${qty}  ${label}`, `was ${item.previousQty}`), E.BOLD_OFF);
      if (params.kotSettings.printAddons && item.instructions) {
        parts.push(bodyLine(`       >> ${item.instructions}`));
      }
    }
  }

  if (params.kotSettings.printCancelledKOT && params.cancelledItems.length > 0) {
    parts.push(E.divider("-", W));
    for (const item of params.cancelledItems) {
      const label = item.size ? `${item.name} (${item.size})` : item.name;
      const qty = `[ ${String(item.quantity).padStart(2, "0")} ]`;
      parts.push(E.BOLD_ON, bodyLine(`** VOID **  ${qty}  ${label}`), E.BOLD_OFF);
    }
  }

  const totalItems = params.newItems.reduce((s, i) => s + i.quantity, 0);
  parts.push(E.divider("=", W));
  parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(`Total Items: ${totalItems}`), E.BOLD_OFF);
  parts.push(E.divider("=", W));
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}

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
    kotPrintCount?: number;
    createdAt: Date | string;
  };
  items: Array<{
    name: string;
    quantity: number;
    price: string;
    size?: string | null;
    specialInstructions?: string | null;
  }>;
  restaurant: BillRestaurantInfo;
  billSettings: BillPrintSettings;
  cashierName?: string;
  width?: number;
}): Buffer {
  const W = params.width ?? 48;
  const M = 1;
  const bodyLine = (s: string) => E.line(" ".repeat(M) + s);
  const tw = (l: string, r: string) => {
    const iW = W - 2 * M;
    const maxL = Math.max(1, iW - r.length - 1);
    return E.line(" ".repeat(M) + l.substring(0, maxL).padEnd(maxL) + " " + r);
  };
  const { order, items, restaurant, billSettings } = params;
  const sym = (restaurant.currencySymbol || "Rs.").replace("₹", "Rs.");
  const parts: Buffer[] = [];

  parts.push(E.INIT);

  if (order.billPrintCount > 0 && billSettings.showDuplicate) {
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line("** DUPLICATE **"), E.BOLD_OFF);
    parts.push(E.divider("=", W));
  }

  parts.push(E.ALIGN_CENTER);

  if (billSettings.showLogo) {
    parts.push(E.LOGO_NV_FLASH, E.LF);
  }

  parts.push(E.BOLD_ON, E.line(restaurant.restaurantName), E.BOLD_OFF);

  if (restaurant.businessName) {
    parts.push(E.centered(restaurant.businessName, W));
  }
  if (restaurant.gstNumber) {
    parts.push(E.centered(`GST -${restaurant.gstNumber}`, W));
  }
  if (restaurant.phone) {
    parts.push(E.centered(`M - ${restaurant.phone}`, W));
  }
  if (restaurant.address) {
    for (const seg of restaurant.address.split(",").map((s) => s.trim()).filter(Boolean)) {
      parts.push(E.centered(seg.substring(0, W), W));
    }
  }
  if (billSettings.showFssai && restaurant.fssaiNumber) {
    parts.push(E.centered(`FSSAI: ${restaurant.fssaiNumber}`, W));
  }

  parts.push(E.divider("=", W));
  parts.push(E.ALIGN_LEFT);

  if (billSettings.showNameField) {
    parts.push(bodyLine(`Name:${"_".repeat(Math.max(10, W - 2 * M - 5))}`));
    parts.push(E.LF);
  }

  const created = new Date(order.createdAt);
  const dd = String(created.getDate()).padStart(2, "0");
  const mo = String(created.getMonth() + 1).padStart(2, "0");
  const yy = String(created.getFullYear()).slice(-2);
  const hh = String(created.getHours()).padStart(2, "0");
  const mi = String(created.getMinutes()).padStart(2, "0");
  const dateStr = `${dd}/${mo}/${yy}`;
  const timeStr = `${hh}:${mi}`;
  const orderTypeLabel = order.orderType || (order.tableNumber ? "Dine In" : "Pick Up");

  const datePrefix = `Date: ${dateStr}   `;
  const padLen = Math.max(0, (W - 2 * M) - datePrefix.length - orderTypeLabel.length);
  parts.push(
    E.text(" ".repeat(M) + datePrefix + " ".repeat(padLen)),
    E.BOLD_ON, E.line(orderTypeLabel), E.BOLD_OFF,
  );
  parts.push(bodyLine(timeStr));
  parts.push(tw(`Cashier: ${params.cashierName ?? "Admin"}`, `Bill No.: ${order.orderNumber}`));
  parts.push(E.divider("-", W));

  const IW = W - 2 * M - 4 - 9 - 8 - 3;

  parts.push(E.BOLD_ON);
  parts.push(E.line(
    " ".repeat(M) + `${"Item".padEnd(IW)} ${"Qty".padStart(4)} ${"Price".padStart(9)} ${"Amt".padStart(8)}`
  ));
  parts.push(E.BOLD_OFF);
  parts.push(E.divider("-", W));

  let displayItems = items;
  if (billSettings.mergeDuplicateItems) {
    const map = new Map<string, typeof items[0] & { totalQty: number; totalAmt: number }>();
    for (const item of items) {
      const key = `${item.name}:${item.size ?? ""}`;
      const ex = map.get(key);
      if (ex) {
        ex.totalQty += item.quantity;
        ex.totalAmt += item.quantity * parseFloat(item.price);
      } else {
        map.set(key, { ...item, totalQty: item.quantity, totalAmt: item.quantity * parseFloat(item.price) });
      }
    }
    displayItems = Array.from(map.values()).map((i) => ({
      ...i,
      quantity: i.totalQty,
      price: String(i.totalAmt / i.totalQty),
    }));
  }

  let totalQty = 0;
  for (const item of displayItems) {
    const fullName = item.size ? `${item.name} (${item.size})` : item.name;
    const unitPrice = parseFloat(item.price);
    const lineAmt = unitPrice * item.quantity;
    const qtyStr   = String(item.quantity).padStart(4);
    const priceStr = unitPrice.toFixed(2).padStart(9);
    const amtStr   = lineAmt.toFixed(2).padStart(8);

    let remaining = fullName;
    let first = true;
    while (remaining.length > 0) {
      const chunk = remaining.substring(0, IW);
      remaining = remaining.substring(IW);
      if (first) {
        parts.push(E.line(" ".repeat(M) + `${chunk.padEnd(IW)} ${qtyStr} ${priceStr} ${amtStr}`));
        first = false;
      } else {
        parts.push(bodyLine(chunk));
      }
    }

    if (billSettings.showAddons && item.specialInstructions) {
      parts.push(bodyLine(`  [${item.specialInstructions}]`));
    }
    totalQty += item.quantity;
  }

  parts.push(E.divider("-", W));

  const tax      = parseFloat(order.taxAmount);
  const discount = parseFloat(order.discountAmount || "0");
  const subtotal = parseFloat(order.totalAmount) - tax;
  const rawTotal = parseFloat(order.totalAmount);
  const rounded  = Math.round(rawTotal);
  const roundOff = rounded - rawTotal;
  const cgstRate = restaurant.taxRate / 2;
  const cgst     = tax / 2;
  const sgst     = tax / 2;

  parts.push(tw(`Total Qty: ${totalQty}`, `Sub Total ${subtotal.toFixed(2)}`));
  parts.push(tw("", `CGST ${cgstRate}%  ${cgst.toFixed(2)}`));
  parts.push(tw("", `SGST ${cgstRate}%  ${sgst.toFixed(2)}`));
  if (discount > 0) {
    parts.push(tw("", `Discount  -${discount.toFixed(2)}`));
  }
  if (billSettings.showRoundOff && Math.abs(roundOff) >= 0.005) {
    parts.push(tw("", `Round off  ${roundOff.toFixed(2)}`));
  }
  parts.push(E.divider("=", W));
  parts.push(E.BOLD_ON, tw("", `Grand Total  ${sym}${rounded.toFixed(2)}`), E.BOLD_OFF);
  if (order.paymentMethod) {
    parts.push(tw("", order.paymentMethod.toUpperCase()));
  }
  parts.push(E.divider("=", W));

  if (restaurant.footerNote) {
    parts.push(E.ALIGN_CENTER, E.centered(restaurant.footerNote.substring(0, W), W));
  }
  parts.push(E.feed(3));
  parts.push(E.CUT);

  return E.build(...parts);
}

export function toPrintJob(printerId: string, buffer: Buffer) {
  return {
    printerId,
    encoding: "escpos-base64" as const,
    data: buffer.toString("base64"),
  };
}
