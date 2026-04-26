import bagichaLogoImg from "@assets/Bagicha Logo.png";

/**
 * KOT slip printer — matches the reference image:
 * centred KOT header, order# + datetime, customer, table, numbered item table,
 * total items. No prices, no logo, no address — kitchen-only info.
 */
export function printKOT(order: any, items: any[]): void {
  const orderDate = new Date(order.createdAt || Date.now());
  const dateStr   = orderDate.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr   = orderDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  const itemRows = items.length > 0
    ? items.map((item: any, i: number) => `
        <tr>
          <td class="sl">${i + 1}</td>
          <td class="name">${item.name || "Item"}</td>
          <td class="qty">${item.quantity}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="empty">No items</td></tr>`;

  const win = window.open("", "_blank", "width=310,height=500");
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>KOT - ${order.orderNumber || ""}</title>
<style>
  @page { size: 76mm auto; margin: 3mm 4mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    color: #000;
    background: #fff;
    width: 68mm;
  }
  .kot-title {
    text-align: center;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 2px;
    margin-bottom: 6px;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    margin-bottom: 5px;
  }
  hr { border: none; border-top: 1px solid #000; margin: 5px 0; }
  .info-line { font-size: 11px; margin-bottom: 3px; }
  .info-line span { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead th {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 2px;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    text-align: left;
  }
  th.qty, td.qty { text-align: right; width: 28px; }
  th.sl,  td.sl  { width: 28px; }
  tbody td { font-size: 11px; padding: 3px 2px; vertical-align: top; }
  tbody tr:last-child td { border-bottom: 1px solid #000; }
  .empty { text-align: center; color: #888; padding: 6px 0; border-bottom: 1px solid #000; }
  .total-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 700;
    margin-top: 5px;
  }
  .total-row .label { }
  .total-row .val { min-width: 20px; text-align: right; }
</style>
</head><body>

<div class="kot-title">KOT</div>

<div class="meta-row">
  <span>${order.orderNumber || "—"}</span>
  <span>${dateStr} ${timeStr}</span>
</div>

<hr>

${order.customerName ? `<div class="info-line">Customer &nbsp;: &nbsp;<span>${order.customerName}</span></div>` : ""}
${order.tableNumber  ? `<div class="info-line">Table No. : &nbsp;<span>${order.tableNumber}</span></div>`  :
  order.tableName    ? `<div class="info-line">Table No. : &nbsp;<span>${order.tableName}</span></div>`    : ""}

<table>
  <thead>
    <tr>
      <th class="sl">Sl.No</th>
      <th class="name">Item Name</th>
      <th class="qty">Qty.</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="total-row">
  <span class="label">Total Items :</span>
  <span class="val">${items.length}</span>
</div>

</body></html>`);

  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 600);
}

/** Shared retail-invoice bill printer used by Tables and POS. */
export async function printOrderBill(order: any, items: any[], settings: any): Promise<void> {
  const restaurantName = settings?.restaurantName || "Bagicha Restaurant";
  const address        = settings?.address        || "";
  const phone          = settings?.phone          || "";
  const gstNumber      = settings?.gstNumber      || "";
  const fssaiNumber    = settings?.fssaiNumber    || "";
  const upiId          = settings?.upiId          || "";
  const footerNote     = settings?.footerNote     || "Thank you for dining with us!";

  const subtotal   = parseFloat(order.totalAmount) - parseFloat(order.taxAmount || "0");
  const discount   = parseFloat(order.discountAmount || "0");
  const tax        = parseFloat(order.taxAmount || "0");
  const grandTotal = parseFloat(order.totalAmount);

  const orderDate = new Date(order.createdAt || Date.now());
  const dateStr   = orderDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const timeStr   = orderDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

  // Embed logo as base64 so it renders in the detached print window
  let logoHtml = `<div class="logo-placeholder">Your<br>Logo</div>`;
  try {
    const logoRes = await fetch(bagichaLogoImg);
    const blob    = await logoRes.blob();
    const base64  = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    logoHtml = `<img src="${base64}" class="logo-img" alt="Logo" />`;
  } catch { /* keep placeholder */ }

  const itemRows = items.length > 0
    ? items.map((item: any, i: number) => `
        <tr>
          <td class="item-name">${i + 1}. ${item.name || "Item"}</td>
          <td class="r">${item.quantity}</td>
          <td class="r">₹${parseFloat(item.price).toFixed(0)}</td>
          <td class="r">₹${(parseFloat(item.price) * item.quantity).toFixed(0)}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="color:#bbb;padding:8px 0;text-align:center;">No items</td></tr>`;

  const upiQrHtml = upiId ? `
    <div class="upi-box">
      <div class="upi-text"><strong>UPI Payment</strong><br><span style="font-size:11px;color:#555;">Scan to pay</span></div>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(restaurantName)}&cu=INR"
           width="72" height="72" alt="UPI QR" />
    </div>` : "";

  const metaLine = [
    gstNumber   ? `GST - ${gstNumber}`     : "",
    fssaiNumber ? `FSSAI - ${fssaiNumber}` : "",
    !gstNumber && !fssaiNumber && address ? address : "",
    phone ? `Ph: ${phone}` : "",
  ].filter(Boolean).join("<br>");

  // 76mm thermal/KOT roll paper — window width matches usable print area
  const win = window.open("", "_blank", "width=310,height=600");
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Bill - ${order.orderNumber}</title>
<style>
  /* ── 76 mm thermal roll paper ── */
  @page {
    size: 76mm auto;   /* width fixed, height grows with content */
    margin: 2mm 3mm;   /* narrow margins — thermal printers use almost full width */
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:'Courier New',Courier,monospace; /* thermal printers render monospace cleanly */
    font-size:11px;
    color:#000;
    background:#fff;
    width:70mm;        /* 76mm roll − 3mm×2 side margins */
    padding:2mm 0;
  }
  .header{display:flex;align-items:flex-start;gap:6px;margin-bottom:8px}
  .logo-placeholder{width:44px;height:44px;flex-shrink:0;border:1px dashed #999;display:flex;align-items:center;justify-content:center;font-size:8px;color:#888;text-align:center;line-height:1.3}
  .logo-img{width:44px;height:44px;flex-shrink:0;object-fit:contain}
  .header-info{flex:1;min-width:0}
  .retail-label{font-size:8px;color:#666;margin-bottom:1px;text-transform:uppercase;letter-spacing:.04em}
  .rest-name{font-size:13px;font-weight:700;line-height:1.2;margin-bottom:3px;word-break:break-word}
  .meta{font-size:8.5px;color:#333;line-height:1.7}
  hr{border:none;border-top:1px dashed #555;margin:6px 0}
  .token-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:4px}
  .token-no{font-size:12px;font-weight:700;white-space:nowrap}
  .datetime{font-size:8px;color:#444;text-align:right;white-space:nowrap}
  .order-meta{font-size:9px;color:#333;margin-bottom:6px;line-height:1.6}
  .order-meta span{display:block}
  table{width:100%;border-collapse:collapse}
  thead th{font-size:8.5px;color:#555;font-weight:700;padding:0 0 3px;border-bottom:1px dashed #555;text-transform:uppercase;text-align:left}
  thead th.r,tbody td.r{text-align:right}
  tbody td{font-size:10px;padding:3px 0;vertical-align:top;border-bottom:1px dotted #ddd;word-break:break-word}
  tbody td.item-name{padding-right:4px;max-width:38mm}
  tbody tr:last-child td{border-bottom:none}
  .totals{margin-top:6px}
  .trow{display:flex;justify-content:space-between;padding:2px 0;font-size:10px;color:#222}
  .trow.discount{color:#1a7a1a;font-weight:600}
  .trow.tax{font-size:9px;color:#444}
  .grand{display:flex;justify-content:space-between;font-size:13px;font-weight:700;border-top:1px solid #000;padding-top:5px;margin-top:4px}
  .pay-row{font-size:9px;color:#555;margin-top:4px;display:flex;justify-content:space-between}
  .upi-box{display:flex;align-items:center;justify-content:space-between;border:1px dashed #888;padding:6px 8px;margin-top:10px}
  .upi-text{font-size:9px;line-height:1.5;color:#222}
  .footer{text-align:center;font-size:8.5px;color:#555;margin-top:12px;line-height:1.7}
</style>
</head><body>

<div class="header">
  ${logoHtml}
  <div class="header-info">
    <div class="retail-label">Retail Invoice</div>
    <div class="rest-name">${restaurantName}</div>
    <div class="meta">${metaLine}</div>
  </div>
</div>

<hr>

<div class="token-row">
  <span class="token-no">Order #${order.orderNumber}</span>
  <span class="datetime">${dateStr}&nbsp;&nbsp;${timeStr}</span>
</div>

${(order.orderType || order.tableNumber || order.customerName) ? `
<div class="order-meta">
  ${order.orderType    ? `<span>${order.orderType}</span>`          : ""}
  ${order.tableNumber  ? `<span>Table: ${order.tableNumber}</span>` : ""}
  ${order.customerName ? `<span>${order.customerName}</span>`       : ""}
</div>` : ""}

<table>
  <thead>
    <tr>
      <th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amt</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<hr>

<div class="totals">
  <div class="trow"><span>Sub-total:</span><span>₹${subtotal.toFixed(2)}</span></div>
  ${discount > 0 ? `<div class="trow discount"><span>Discount:</span><span>-₹${discount.toFixed(2)}</span></div>` : ""}
  ${tax > 0      ? `<div class="trow tax"><span>Tax (GST):</span><span>₹${tax.toFixed(2)}</span></div>`         : ""}
  <div class="grand"><span>Grand Total:</span><span>₹${grandTotal.toFixed(2)}</span></div>
  ${order.paymentMethod ? `<div class="pay-row"><span>Payment</span><span>${order.paymentMethod}</span></div>` : ""}
</div>

${upiQrHtml}

<div class="footer">${footerNote}<br>Please visit again</div>

</body></html>`);

  win.document.close();
  win.focus();
  // 1 s — gives the thermal driver time to receive the page size before the dialog opens,
  // and allows the base64 logo + QR image (if any) to fully render.
  setTimeout(() => { win.print(); win.close(); }, 1000);
}
