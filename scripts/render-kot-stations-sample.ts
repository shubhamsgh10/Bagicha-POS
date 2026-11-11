/**
 * Renders a 4-station sample KOT (+ General) the way runKotPrint builds it, to PNG-less text on stdout:
 * one line per ticket with its raster height and cut count. Manual: npx tsx scripts/render-kot-stations-sample.ts
 */
import { groupByStation, assemblePrinterJobs, filterKotSkipped } from "../shared/kotStations";
import { generateKOTBuffer } from "../shared/print/generators";

const cat: Record<number, number> = { 1: 11, 2: 12, 3: 13, 4: 14, 5: 15, 6: 16, 7: 17 };
const kotSettings = { enabled: true, printModifiedKOT: true, printModifiedItemsOnly: true, printCancelledKOT: true, printAddons: true, showDuplicateWatermark: true, kotNumbering: true, kotStyle: "image" } as any;
const stations = { enabled: true, generalName: "General", stations: [
  { id: "si", name: "South Indian", categoryIds: [11] },
  { id: "mc", name: "Main Course", categoryIds: [12, 13] },
  { id: "pz", name: "Pizza", categoryIds: [14] },
  { id: "ch", name: "Chinese", categoryIds: [15] },
] };
const skip = { categoryIds: [], itemIds: [7] };
const items = [
  { itemId: 1, name: "Masala Dosa", quantity: 2, serviceMode: "dinein" },
  { itemId: 2, name: "Paneer Butter Masala", quantity: 1, serviceMode: "dinein" },
  { itemId: 3, name: "Butter Naan", quantity: 4, serviceMode: "dinein" },
  { itemId: 4, name: "Margherita Pizza", size: "Medium", quantity: 1, serviceMode: "dinein" },
  { itemId: 5, name: "Veg Hakka Noodles", quantity: 1, serviceMode: "dinein" },
  { itemId: 6, name: "Gulab Jamun", quantity: 2, serviceMode: "dinein" },
  { itemId: 7, name: "Mineral Water", quantity: 1, serviceMode: "dinein" },
];
const kept = filterKotSkipped(items, (id) => cat[id], skip);
const groups = groupByStation({ newItems: kept, modifiedItems: [], cancelledItems: [] }, (id) => cat[id], stations);
const printer = { id: "main", width: 48 };
const jobs = assemblePrinterJobs(groups.map((g) => ({
  printer,
  buffer: generateKOTBuffer({ orderNumber: "ORD0001", tableNumber: "5", tableSection: "inner", stationName: g.name, kotNumber: "042", isReprint: false, isDelta: false, newItems: g.newItems, modifiedItems: [], cancelledItems: [], kotSettings, width: 48 }),
})));
console.log(`tickets: ${groups.map((g) => `${g.name}(${g.newItems.map((i) => i.name).join(", ")})`).join(" | ")}`);
console.log(`print jobs: ${jobs.length}, tickets in job: ${jobs[0].tickets.length}, bytes: ${jobs[0].buffer.length}`);
console.log(`Mineral Water printed: ${groups.some((g) => g.newItems.some((i) => i.name === "Mineral Water"))}`);
