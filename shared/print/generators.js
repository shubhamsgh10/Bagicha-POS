import * as E from "./escpos";
export function generateKOTBuffer(params) {
    const W = params.width ?? 32;
    const parts = [];
    parts.push(E.INIT);
    if (params.isReprint && params.kotSettings.showDuplicateWatermark) {
        parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line("** DUPLICATE **"), E.BOLD_OFF);
        parts.push(E.divider("=", W));
    }
    const header = params.isDelta ? "MODIFIED KOT" : "KITCHEN ORDER";
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(header), E.BOLD_OFF);
    parts.push(E.divider("=", W));
    parts.push(E.ALIGN_LEFT);
    const table = params.tableNumber ? `Table: ${params.tableNumber}` : "Takeaway";
    const kotRef = params.kotNumber ? `KOT#: ${params.kotNumber}` : `Ord: ${params.orderNumber.slice(-6)}`;
    parts.push(E.twoColumns(table, kotRef, W));
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    parts.push(E.twoColumns(dateStr, timeStr, W));
    parts.push(E.divider("-", W));
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
        parts.push(E.divider("-", W));
        for (const item of params.cancelledItems) {
            const label = item.size ? `${item.name} (${item.size})` : item.name;
            parts.push(E.BOLD_ON, E.line(`  ** VOID **  ${item.quantity}x ${label}`), E.BOLD_OFF);
        }
    }
    const totalItems = params.newItems.reduce((s, i) => s + i.quantity, 0);
    parts.push(E.divider("=", W));
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(`Items: ${totalItems}`), E.BOLD_OFF);
    parts.push(E.divider("=", W));
    parts.push(E.feed(3));
    parts.push(E.CUT);
    return E.build(...parts);
}
export function generateBillBuffer(params) {
    const W = params.width ?? 32;
    const { order, items, restaurant, billSettings } = params;
    const sym = restaurant.currencySymbol || "₹";
    const parts = [];
    parts.push(E.INIT);
    if (order.billPrintCount > 0 && billSettings.showDuplicate) {
        parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line("** DUPLICATE **"), E.BOLD_OFF);
        parts.push(E.divider("=", W));
    }
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line(restaurant.restaurantName), E.BOLD_OFF);
    if (restaurant.address)
        parts.push(E.centered(restaurant.address.substring(0, W), W));
    if (restaurant.phone)
        parts.push(E.centered(`Tel: ${restaurant.phone}`, W));
    if (restaurant.gstNumber)
        parts.push(E.centered(`GST: ${restaurant.gstNumber}`, W));
    if (billSettings.showOrderBarcode) {
        parts.push(E.ALIGN_CENTER, E.barcode128(order.orderNumber));
    }
    parts.push(E.divider("=", W));
    parts.push(E.ALIGN_CENTER, E.BOLD_ON, E.line("RETAIL INVOICE"), E.BOLD_OFF);
    parts.push(E.divider("=", W));
    parts.push(E.ALIGN_LEFT);
    const created = new Date(order.createdAt);
    const dateStr = created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const orderLabel = billSettings.showKotAsToken && (order.kotPrintCount ?? 0) > 0
        ? `Token: #${order.kotPrintCount}`
        : `Order: ${order.orderNumber}`;
    parts.push(E.twoColumns(orderLabel, dateStr, W));
    parts.push(E.twoColumns(order.tableNumber ? `Table: ${order.tableNumber}` : order.orderType, timeStr, W));
    if (order.customerName)
        parts.push(E.line(`Customer: ${order.customerName}`));
    parts.push(E.divider("-", W));
    const QW = 4;
    const AW = 7;
    const NW = W - QW - AW - 2;
    parts.push(E.BOLD_ON);
    parts.push(E.line(`${"Item".padEnd(NW)} ${"Qty".padStart(QW)} ${"Amt".padStart(AW)}`));
    parts.push(E.BOLD_OFF);
    parts.push(E.divider("-", W));
    let displayItems = items;
    if (billSettings.mergeDuplicateItems) {
        const map = new Map();
        for (const item of items) {
            const key = `${item.name}:${item.size ?? ""}`;
            const ex = map.get(key);
            if (ex) {
                ex.totalQty += item.quantity;
                ex.totalAmt += item.quantity * parseFloat(item.price);
            }
            else {
                map.set(key, {
                    ...item,
                    totalQty: item.quantity,
                    totalAmt: item.quantity * parseFloat(item.price),
                });
            }
        }
        displayItems = Array.from(map.values()).map((i) => ({
            ...i,
            quantity: i.totalQty,
            price: String(i.totalAmt / i.totalQty),
        }));
    }
    const priceMultiplier = billSettings.itemPriceMode === "inclusive" ? 1 + restaurant.taxRate / 100 : 1;
    for (const item of displayItems) {
        const label = (item.size ? `${item.name}(${item.size})` : item.name).substring(0, NW).padEnd(NW);
        const qty = String(item.quantity).padStart(QW);
        const amt = `${sym}${(item.quantity * parseFloat(item.price) * priceMultiplier).toFixed(0)}`.padStart(AW);
        parts.push(E.line(`${label} ${qty} ${amt}`));
        if (billSettings.showAddons && item.specialInstructions) {
            parts.push(E.line(`  [${item.specialInstructions}]`));
        }
    }
    parts.push(E.divider("-", W));
    const subtotal = parseFloat(order.totalAmount) - parseFloat(order.taxAmount);
    const discount = parseFloat(order.discountAmount || "0");
    const tax = parseFloat(order.taxAmount);
    const total = parseFloat(order.totalAmount);
    parts.push(E.twoColumns("Subtotal:", `${sym}${subtotal.toFixed(0)}`, W));
    if (discount > 0)
        parts.push(E.twoColumns("Discount:", `-${sym}${discount.toFixed(0)}`, W));
    if (billSettings.showBackwardTax && tax > 0) {
        parts.push(E.twoColumns(`Tax (${restaurant.taxRate}%):`, `${sym}${tax.toFixed(0)}`, W));
    }
    parts.push(E.divider("=", W));
    parts.push(E.BOLD_ON, E.twoColumns("TOTAL:", `${sym}${total.toFixed(0)}`, W), E.BOLD_OFF);
    if (order.paymentMethod) {
        parts.push(E.twoColumns("Payment:", order.paymentMethod.toUpperCase(), W));
    }
    parts.push(E.divider("=", W));
    if (restaurant.footerNote) {
        parts.push(E.centered(restaurant.footerNote.substring(0, W), W));
    }
    parts.push(E.feed(3));
    parts.push(E.CUT);
    return E.build(...parts);
}
export function toPrintJob(printerId, buffer) {
    return {
        printerId,
        encoding: "escpos-base64",
        data: buffer.toString("base64"),
    };
}
