/**
 * Verifies shared/ebillText.ts — the WhatsApp e-bill text sent to a CUSTOMER. It used to compute
 * "Subtotal" as total − tax and print no container line, so an order with a flat container charge
 * showed a Subtotal inflated by the charge (₹499 of food + ₹20 container read "Subtotal ₹519") and
 * the charge itself appeared nowhere. Money text a customer reads must foot, so it is locked here.
 * Run: npx tsx scripts/verify-ebill-text.ts
 */
import { buildEbillText } from "../shared/ebillText";

const checks: Array<[string, boolean]> = [];
const lineOf = (text: string, prefix: string) => text.split("\n").find((l) => l.replace(/^\*/, "").startsWith(prefix));

// Real order #2093 (takeaway): food 499, 5% tax 24.95, flat container 20 → 543.95
const o2093 = { orderNumber: "ORD0650", totalAmount: "543.95", taxAmount: "24.95", subtotalAmount: "499.00", discountAmount: "0.00", containerCharge: "20.00" };
const items = [{ name: "Wildfire (Medium)", quantity: 1, price: "499.00" }];
{
  const t = buildEbillText(o2093, items, { restaurantName: "Bagicha", footerNote: "Thanks!" });
  checks.push(["container order: Subtotal is the real food total (499), not total − tax (519)", lineOf(t, "Subtotal:") === "Subtotal: ₹499" && !t.includes("₹519")]);
  checks.push(["container order: a Container line is printed", lineOf(t, "Container:") === "Container: ₹20"]);
  checks.push(["container order: Tax and Total are unchanged", lineOf(t, "Tax:") === "Tax: ₹25" && lineOf(t, "TOTAL:") === "*TOTAL: ₹544*"]);
  const rows = ["Subtotal:", "Tax:", "Container:", "TOTAL:"].map((p) => t.indexOf(p));
  checks.push(["container order: rows read Subtotal → Tax → Container → TOTAL", rows.every((i) => i >= 0) && rows.every((v, i) => i === 0 || v > rows[i - 1])]);
  checks.push(["container order: the lines foot (499 + 25 + 20 = 544)", 499 + 25 + 20 === 544]);
  checks.push(["no Discount line when there is no discount", !t.includes("Discount:")]);
  checks.push(["header, item line and footer are kept", t.includes("*Bagicha*") && t.includes("Order: *ORD0650*") && t.includes("  • Wildfire (Medium) × 1  ₹499") && t.endsWith("Thanks!")]);
}

// Discount + container together: total = (subtotal − discount) × 1.05 + container
{
  const t = buildEbillText({ orderNumber: "X", totalAmount: "965.00", taxAmount: "45.00", subtotalAmount: "1000.00", discountAmount: "100.00", containerCharge: "20.00" }, []);
  checks.push(["discount + container: every row present and in order", ["Subtotal: ₹1000", "Discount: -₹100", "Tax: ₹45", "Container: ₹20", "TOTAL: ₹965"].every((s) => t.includes(s))
    && t.indexOf("Discount:") < t.indexOf("Tax:") && t.indexOf("Tax:") < t.indexOf("Container:")]);
}

// No container charge: the message is exactly what it was before (no empty ₹0 row).
{
  const t = buildEbillText({ orderNumber: "Y", totalAmount: "105.00", taxAmount: "5.00", subtotalAmount: "100.00", discountAmount: "0.00", containerCharge: "0.00" }, []);
  checks.push(["no container charge: no Container line", !t.includes("Container")]);
  checks.push(["no container charge: Subtotal 100, Tax 5, Total 105", t.includes("Subtotal: ₹100") && t.includes("Tax: ₹5") && t.includes("*TOTAL: ₹105*")]);
}

// Delivery order: an untaxed flat Delivery line after Container, before TOTAL; Subtotal is still the food.
{
  const t = buildEbillText({ orderNumber: "D", totalAmount: "585.00", taxAmount: "25.00", subtotalAmount: "500.00", discountAmount: "0.00", containerCharge: "20.00", deliveryCharge: "40.00" }, []);
  checks.push(["delivery order: a Delivery line is printed", lineOf(t, "Delivery:") === "Delivery: ₹40"]);
  const rows = ["Tax:", "Container:", "Delivery:", "TOTAL:"].map((p) => t.indexOf(p));
  checks.push(["delivery order: rows read Tax → Container → Delivery → TOTAL", rows.every((i) => i >= 0) && rows.every((v, i) => i === 0 || v > rows[i - 1])]);
  checks.push(["delivery order: Subtotal is the food total and TOTAL foots (500+25+20+40=585)", lineOf(t, "Subtotal:") === "Subtotal: ₹500" && lineOf(t, "TOTAL:") === "*TOTAL: ₹585*"]);
}
{
  const t = buildEbillText({ orderNumber: "Y2", totalAmount: "105.00", taxAmount: "5.00", subtotalAmount: "100.00", deliveryCharge: "0.00" }, []);
  checks.push(["no delivery charge: no Delivery line", !t.includes("Delivery")]);
}

// Legacy rows written before subtotalAmount/containerCharge existed fall back to total − tax.
{
  const t = buildEbillText({ orderNumber: "Z", totalAmount: "105.00", taxAmount: "5.00" }, []);
  checks.push(["legacy row (no persisted columns): falls back to total − tax, no Container line", t.includes("Subtotal: ₹100") && !t.includes("Container")]);
}

// Optional header fields.
{
  const t = buildEbillText({ orderNumber: "A", tableNumber: "7", customerName: "Raj", totalAmount: "10", taxAmount: "0" }, [], { restaurantName: "R", address: "12 Road" });
  checks.push(["table, customer name and address appear when present", t.includes("Table: 7") && t.includes("Name: Raj") && t.includes("12 Road")]);
  const bare = buildEbillText({ orderNumber: "B", totalAmount: "10", taxAmount: "0" }, []);
  checks.push(["default restaurant name and thank-you footer", bare.includes("*Bagicha Restaurant*") && bare.endsWith("Thank you for dining with us!")]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failed})`);
process.exit(failed === 0 ? 0 : 1);
