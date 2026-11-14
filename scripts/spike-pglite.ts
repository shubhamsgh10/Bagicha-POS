// MANUAL spike — never in test:pure. Runs the real storage layer on in-memory PGlite.
// Never loads .env: the production DATABASE_URL must not be reachable from here.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
process.env.BAGICHA_DB = "pglite";
delete process.env.DATABASE_URL;
process.env.BAGICHA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bagicha-spike-"));
for (const k of Object.keys(process.env)) if (k.startsWith("PUSHER") || k.startsWith("VITE_PUSHER")) delete process.env[k];

let failures = 0;
const timings: Array<[string, number]> = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}
async function timed<T>(name: string, fn: () => Promise<T>, ms = 10_000): Promise<T> {
  const t0 = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`HANG >${ms}ms (global db used inside a transaction?)`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    timings.push([name, performance.now() - t0]);
  }
}
async function step(name: string, fn: () => Promise<void>, ms = 10_000) {
  try {
    await timed(name, fn, ms);
  } catch (e: any) {
    check(name, false, `threw: ${e?.message ?? e}`);
  }
}

async function main() {
  const { db, localClient, pool } = await import("../server/db");
  check("pg pool never created", pool === null);
  check("PGlite client created", localClient !== null);
  const { schemaStatements } = await import("./lib/pgliteSchema");
  const stmts = await schemaStatements();
  for (const s of stmts) await localClient!.exec(s);
  const { sql } = await import("drizzle-orm");
  const { storage } = await import("../server/storage");
  const settings = await import("../server/settingsStore");
  const { queryFingerprint } = await import("../server/dbEtag");

  let catId = 0, invId = 0, plainId = 0, linkedId = 0, tableId = 0, orderId = 0;
  let orderTotal = "0.00";
  const LINK_AMT = 2.5;

  await step("0 seed via storage", async () => {
    const cat = await storage.createCategory({ name: "Spike Cat" } as any);
    catId = cat.id;
    const inv = await storage.createInventoryItem({ itemName: "Flour", currentStock: "100", minStock: "5", unit: "kg" } as any);
    invId = inv.id;
    const plain = await storage.createMenuItem({ name: "Water", price: "20", categoryId: catId } as any);
    plainId = plain.id;
    const linked = await storage.createMenuItem({
      name: "Pizza", price: "100", categoryId: catId,
      sizes: [{ size: "Regular", price: 100, stockMultiplier: 1 }, { size: "Large", price: 150, stockMultiplier: 2 }],
      inventoryLinks: [{ inventoryId: invId, quantity: LINK_AMT }],
    } as any);
    linkedId = linked.id;
    const t = await storage.createTable({ name: "T1", capacity: 4, section: "inner" } as any);
    tableId = t.id;
    check("0 seed ids", !!(catId && invId && plainId && linkedId && tableId), JSON.stringify({ catId, invId, plainId, linkedId, tableId }));
  });

  await step("1 initSettings + sequential counters", async () => {
    await settings.initSettings();
    const s = settings.getSettings();
    check("1 getSettings object", !!s && typeof s === "object");
    const a = await settings.incrementBillCounter();
    const b = await settings.incrementBillCounter();
    check("1 consecutive bill counters", b === a + 1, `${a},${b}`);
  });

  await step("2 20 concurrent bill counters", async () => {
    const vals = await Promise.all(Array.from({ length: 20 }, () => settings.incrementBillCounter()));
    const set = new Set(vals);
    check("2 distinct", set.size === 20);
    check("2 span 19", Math.max(...vals) - Math.min(...vals) === 19, `${Math.min(...vals)}..${Math.max(...vals)}`);
  });

  await step("3 saveSettings vs KOT counters", async () => {
    const read = async () => {
      const r: any = await db.execute(sql`SELECT settings->>'kotCounter' AS v FROM restaurant_settings WHERE id=1`);
      return Number(r?.rows?.[0]?.v ?? 0);
    };
    const before = await read();
    await Promise.all([
      settings.saveSettings({ restaurantName: "Spike Cafe" } as any),
      ...Array.from({ length: 10 }, () => settings.incrementKotCounter()),
    ]);
    const after = await read();
    check("3 kot counter not rolled back", after === before + 10, `before=${before} after=${after}`);
  });

  await step("4 createOrderWithItems", async () => {
    const bill = await settings.incrementBillCounter();
    const kotN = await settings.incrementKotCounter();
    const r = await storage.createOrderWithItems(
      {
        orderNumber: `ZZTEST-${bill}`, orderType: "dine-in", tableId, tableNumber: "T1",
        totalAmount: "262.50", taxAmount: "12.50", discountAmount: "0", status: "pending",
      } as any,
      [
        { menuItemId: linkedId, name: "Pizza", quantity: 2, price: "100", size: "Regular" },
        { menuItemId: plainId, name: "Water", quantity: 1, price: "20" },
      ] as any,
      { kotNumber: `K${kotN}`, items: [{ name: "Pizza", quantity: 2 }, { name: "Water", quantity: 1 }] } as any,
    );
    orderId = r.order.id;
    orderTotal = r.order.totalAmount;
    check("4 order id", !!orderId);
    check("4 two items", r.items.length === 2);
    check("4 kotTicket", r.kotTicket !== null);
  });

  await step("5 replaceOrderItems", async () => {
    const kotN = await settings.incrementKotCounter();
    const r = await storage.replaceOrderItems(
      orderId,
      [
        { menuItemId: linkedId, name: "Pizza", quantity: 3, price: "100", size: "Regular" },
        { menuItemId: plainId, name: "Water", quantity: 1, price: "20" },
      ] as any,
      { totalAmount: "336.00", taxAmount: "16.00" } as any,
      { kotNumber: Promise.resolve(`K${kotN}`), items: [{ name: "Pizza", quantity: 1 }] } as any,
    );
    orderTotal = r.order.totalAmount;
    check("5 items returned", r.items.length === 2 && r.items.find((i) => i.menuItemId === linkedId)?.quantity === 3);
    check("5 kotTicket", r.kotTicket !== null);
  });

  await step("6 reconcileOrderInventory + concurrent idempotency", async () => {
    const lines = [{ menuItemId: linkedId, quantity: 3, size: "Regular" }, { menuItemId: plainId, quantity: 1 }];
    const stock = async () => Number(((await db.execute(sql`SELECT current_stock AS v FROM inventory WHERE id=${invId}`)) as any).rows[0].v);
    await storage.reconcileOrderInventory(orderId, lines);
    const s1 = await stock();
    check("6 stock = 100 - 3*2.5", Math.abs(s1 - (100 - 3 * LINK_AMT)) < 0.001, String(s1));
    await Promise.all([storage.reconcileOrderInventory(orderId, lines), storage.reconcileOrderInventory(orderId, lines)]);
    const s2 = await stock();
    check("6 concurrent re-run unchanged", Math.abs(s2 - s1) < 0.001, String(s2));
  });

  await step("7 concurrent settleOrderIfUnpaid", async () => {
    const patch = { paymentStatus: "paid", paymentMethod: "cash", paidAmount: orderTotal, status: "served" } as any;
    const [a, b] = await Promise.all([storage.settleOrderIfUnpaid(orderId, patch), storage.settleOrderIfUnpaid(orderId, patch)]);
    check("7 exactly one winner", !!a !== !!b, `a=${!!a} b=${!!b}`);
  });

  await step("8 reads", async () => {
    const open = await storage.findOrders({ open: true });
    check("8 findOrders", Array.isArray(open), `n=${open.length}`);
    const fp: any = await db.execute(queryFingerprint(storage.findOrdersQuery({})));
    console.log("     db.execute result keys:", Object.keys(fp ?? {}), "isArray:", Array.isArray(fp), "rows:", fp?.rows?.length, "rowCount:", fp?.rowCount, "fields:", !!fp?.fields);
    check("8 fingerprint rows[0].h", !!fp?.rows?.[0]?.h, String(fp?.rows?.[0]?.h));
    const tabs = await storage.getOpenTabsByCustomer();
    check("8 getOpenTabsByCustomer", Array.isArray(tabs), `n=${tabs.length}`);
    const dash = await storage.getDashboardStats();
    check("8 getDashboardStats", !!dash, `todayOrders=${(dash as any).todayOrders}`);
    const kots = await storage.kotTicketsQuery({});
    check("8 kotTicketsQuery", Array.isArray(kots), `n=${kots.length}`);
    const st = await storage.getOpenOrderStats();
    check("8 getOpenOrderStats", !!st, JSON.stringify(st));
  });

  await step("9a 50 sequential getOrderById", async () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) await storage.getOrderById(orderId);
    console.log(`     getOrderById avg ${((performance.now() - t0) / 50).toFixed(2)} ms`);
    check("9a done", true);
  });
  await step("9b 50 sequential getMenuRowsForOrder", async () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) await storage.getMenuRowsForOrder([linkedId, plainId]);
    console.log(`     getMenuRowsForOrder avg ${((performance.now() - t0) / 50).toFixed(2)} ms`);
    check("9b done", true);
  });

  console.log("\nTimings (ms):");
  for (const [n, t] of timings) console.log(`  ${t.toFixed(1).padStart(9)}  ${n}`);
  console.log(failures ? `\nSPIKE FAILED (${failures})` : "\nSPIKE PASSED");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error("SPIKE CRASHED:", e); process.exit(2); });
