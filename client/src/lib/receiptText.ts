// Pure client-side receipt text generators — no server calls, no imports needed.

const _div = (c: string, w: number) => c.repeat(w);
const _center = (s: string, w: number) =>
  ' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;
const _two = (l: string, r: string, w: number) => {
  const ml = Math.max(1, w - r.length - 1);
  return l.substring(0, ml).padEnd(ml) + ' ' + r;
};

export function kotLines(params: {
  kotNumber?: string;
  orderRef?: string;
  tableNumber?: string | null;
  items: Array<{ name: string; quantity: number; size?: string | null; notes?: string | null }>;
  isReprint?: boolean;
  width?: number;
}): string[] {
  const W = params.width ?? 32;
  const lines: string[] = [];

  if (params.isReprint) { lines.push(_center('** DUPLICATE **', W), _div('=', W)); }
  lines.push(_center('KITCHEN ORDER', W), _div('=', W));

  const ref = (params.kotNumber ?? params.orderRef ?? '------').slice(-6);
  lines.push(_two(params.tableNumber ? `Table: ${params.tableNumber}` : 'Takeaway', `KOT: ${ref}`, W));

  const now = new Date();
  lines.push(_two(
    now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    W,
  ));
  lines.push(_div('-', W));

  for (const item of params.items) {
    lines.push(`  ${item.quantity}x ${item.size ? `${item.name} (${item.size})` : item.name}`);
    if (item.notes) lines.push(`     [${item.notes}]`);
  }

  const total = params.items.reduce((s, i) => s + i.quantity, 0);
  lines.push(_div('=', W), _center(`Items: ${total}`, W), _div('=', W));
  return lines;
}

export function billLines(params: {
  orderNumber: string;
  tableNumber?: string | null;
  customerName?: string | null;
  orderType?: string;
  totalAmount: number;
  taxAmount?: number;
  discountAmount?: number;
  paymentMethod?: string | null;
  billPrintCount?: number;
  createdAt?: Date | string;
  items: Array<{ name: string; quantity: number; price: number; size?: string | null; notes?: string | null }>;
  restaurantName?: string;
  address?: string;
  phone?: string;
  gstNumber?: string;
  currencySymbol?: string;
  taxRate?: number;
  footerNote?: string;
  showTax?: boolean;
  width?: number;
}): string[] {
  const W = params.width ?? 32;
  const sym = params.currencySymbol ?? '₹';
  const lines: string[] = [];

  lines.push(_center(params.restaurantName ?? 'Restaurant', W));
  if (params.address) lines.push(_center(params.address.substring(0, W), W));
  if (params.phone)   lines.push(_center(`Tel: ${params.phone}`, W));
  if (params.gstNumber) lines.push(_center(`GST: ${params.gstNumber}`, W));
  lines.push(_div('=', W), _center('RETAIL INVOICE', W), _div('=', W));

  const created = new Date(params.createdAt ?? Date.now());
  lines.push(_two(`Order: ${params.orderNumber}`, created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), W));
  lines.push(_two(
    params.tableNumber ? `Table: ${params.tableNumber}` : (params.orderType ?? 'Order'),
    created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    W,
  ));
  if (params.customerName) lines.push(`Customer: ${params.customerName}`);
  lines.push(_div('-', W));

  const QW = 4, AW = 7, NW = W - QW - AW - 2;
  lines.push(`${'Item'.padEnd(NW)} ${'Qty'.padStart(QW)} ${'Amt'.padStart(AW)}`);
  lines.push(_div('-', W));

  for (const item of params.items) {
    const label = (item.size ? `${item.name}(${item.size})` : item.name).substring(0, NW).padEnd(NW);
    lines.push(`${label} ${String(item.quantity).padStart(QW)} ${(`${sym}${(item.quantity * item.price).toFixed(0)}`).padStart(AW)}`);
    if (item.notes) lines.push(`  [${item.notes}]`);
  }
  lines.push(_div('-', W));

  const subtotal = params.totalAmount - (params.taxAmount ?? 0);
  lines.push(_two('Subtotal:', `${sym}${subtotal.toFixed(0)}`, W));
  if ((params.discountAmount ?? 0) > 0) lines.push(_two('Discount:', `-${sym}${(params.discountAmount ?? 0).toFixed(0)}`, W));
  if (params.showTax !== false && (params.taxAmount ?? 0) > 0) {
    lines.push(_two(`Tax (${params.taxRate ?? 0}%):`, `${sym}${(params.taxAmount ?? 0).toFixed(0)}`, W));
  }
  lines.push(_div('=', W), _two('TOTAL:', `${sym}${params.totalAmount.toFixed(0)}`, W));
  if (params.paymentMethod) lines.push(_two('Payment:', params.paymentMethod.toUpperCase(), W));
  lines.push(_div('=', W));
  if (params.footerNote) lines.push(_center(params.footerNote.substring(0, W), W));
  return lines;
}
