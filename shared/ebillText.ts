import { deriveBillTotals } from "./orderPricing";

/**
 * The WhatsApp e-bill text a customer receives (pure — no window, no network; POS.tsx opens the wa.me
 * link). Every figure comes from the order's own persisted numbers through deriveBillTotals — never
 * `total − tax`, which silently folds a flat container charge into "Subtotal" (₹499 of food + ₹20
 * container read "Subtotal ₹519") and hides the charge entirely. total = (subtotal − discount) ×
 * (1 + tax rate) + container + delivery, so the rows read
 * Subtotal → Discount → Tax → Container → Delivery → TOTAL.
 */
export interface EbillSettings {
  restaurantName?: string;
  address?: string;
  footerNote?: string;
}

export function buildEbillText(order: any, items: any[] = [], settings?: EbillSettings): string {
  const restaurantName = settings?.restaurantName || "Bagicha Restaurant";
  const address = settings?.address ? `\n${settings.address}` : "";
  const itemLines = items.length > 0
    ? items.map((i: any) => `  • ${i.name || "Item"} × ${i.quantity}  ₹${(parseFloat(i.price) * i.quantity).toFixed(0)}`).join("\n")
    : "";
  const { subtotal, discount, tax, containerCharge, deliveryCharge, total } = deriveBillTotals(order);
  return [
    `🧾 *${restaurantName}*${address}`,
    ``,
    `Order: *${order.orderNumber}*`,
    order.tableNumber ? `Table: ${order.tableNumber}` : null,
    order.customerName ? `Name: ${order.customerName}` : null,
    ``,
    `*ITEMS*`,
    itemLines,
    ``,
    `Subtotal: ₹${subtotal.toFixed(0)}`,
    discount > 0 ? `Discount: -₹${discount.toFixed(0)}` : null,
    `Tax: ₹${tax.toFixed(0)}`,
    containerCharge > 0 ? `Container: ₹${containerCharge.toFixed(0)}` : null,
    deliveryCharge > 0 ? `Delivery: ₹${deliveryCharge.toFixed(0)}` : null,
    `*TOTAL: ₹${total.toFixed(0)}*`,
    ``,
    settings?.footerNote || "Thank you for dining with us!",
  ].filter((l) => l !== null).join("\n");
}
