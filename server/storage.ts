import {
  users, categories, menuItems, inventory, inventoryCategories, orders, orderItems, kotTickets, deliveryIntegrations, sales, tables,
  staffProfiles, attendance, leaves, shifts, shiftAssignments,
  staffMembers, stockMovements,
  type User, type InsertUser, type Category, type InsertCategory, type MenuItem, type InsertMenuItem,
  type Inventory, type InsertInventory, type InventoryCategory, type InsertInventoryCategory,
  type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
  type KotTicket, type InsertKotTicket, type DeliveryIntegration, type InsertDeliveryIntegration,
  type Sales, type InsertSales, type Table, type InsertTable,
  type StaffProfile, type InsertStaffProfile, type Attendance, type InsertAttendance,
  type Leave, type InsertLeave, type Shift, type InsertShift,
  type ShiftAssignment, type InsertShiftAssignment,
  type StaffMember, type InsertStaffMember,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql, asc, inArray } from "drizzle-orm";
import { personPageKey } from "@shared/pageAccess";
import { shiftWindow, type DetectedSession } from "@shared/shiftTime";
import { computeMenuItemCost as computeMenuItemCostPure, resolveSizeMultiplier, type MenuCostResult } from "@shared/menuCost";

/** A person key for roster/attendance writes — a system account or a staff member. */
export type PersonRef = { kind: "user" | "staff"; id: number };

/** A customer with open "tabs" (served + unpaid orders), aggregated for the Dues report. */
export type OpenTabCustomer = {
  key: string;                 // customerPhone || customerName (grouping key)
  name: string;
  phone: string | null;
  orderCount: number;
  totalDue: number;
  orders: Array<{
    id: number; orderNumber: string; createdAt: Date; total: number;
    items: Array<{ name: string; quantity: number; amount: number }>;
  }>;
};

// An attendance row resolved to whoever it belongs to — a system account (`user`)
// OR a staff member (`staffMember`). `displayName` is the unified label for either.
export type AttendanceWho = Attendance & { user?: User; staffMember?: StaffMember; displayName: string };

// A payroll-eligible person, pulled from EITHER a system account (`user`, role manager/staff —
// admins/owner excluded) OR a `staffMember`. Names are owned by the Admin page; the HR fields
// (role/biometricId/monthlySalary) are annotated on the Staff page and stored per-kind.
export type PayrollPerson = {
  kind: "user" | "staff";
  id: number;
  name: string;
  role: string | null;          // job designation (Manager/Cook/…)
  biometricId: string | null;
  monthlySalary: string;
};

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;

  // Categories
  getCategories(): Promise<Category[]>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: number): Promise<void>;
  reorderCategories(orderedIds: number[]): Promise<void>;

  // Menu Items
  getMenuItems(): Promise<MenuItem[]>;
  getAllMenuItems(): Promise<MenuItem[]>;
  getMenuItemsByCategory(categoryId: number): Promise<MenuItem[]>;
  getMenuItemById(id: number): Promise<MenuItem | undefined>;
  createMenuItem(item: InsertMenuItem): Promise<MenuItem>;
  updateMenuItem(id: number, item: Partial<InsertMenuItem>): Promise<MenuItem>;
  bulkUpdateMenuItems(ids: number[], updates: Partial<InsertMenuItem>): Promise<void>;
  bulkDeleteMenuItems(ids: number[]): Promise<void>;
  deleteMenuItem(id: number): Promise<void>;
  computeMenuItemCost(menuItemId: number, size?: string | null): Promise<MenuCostResult | null>;
  computeMenuItemCosts(items: Array<{ menuItemId: number; size?: string | null }>): Promise<Array<MenuCostResult | null>>;
  reconcileOrderInventory(
    orderId: number,
    lineItems: Array<{ menuItemId: number; quantity: number; size?: string | null }>,
    actor?: { userId?: number; staffMemberId?: number },
  ): Promise<void>;

  // Inventory
  getInventory(): Promise<Inventory[]>;
  getLowStockItems(): Promise<Inventory[]>;
  getNegativeStockItems(): Promise<Inventory[]>;
  recordStockMovement(m: {
    inventoryId: number;
    quantityDelta: number;
    type: "sale" | "sale_reversal" | "manual_adjustment" | "restock" | "import";
    orderId?: number | null;
    menuItemId?: number | null;
    note?: string | null;
    actorUserId?: number | null;
    actorStaffMemberId?: number | null;
  }, tx?: any): Promise<void>;
  createInventoryItem(item: InsertInventory): Promise<Inventory>;
  updateInventoryItem(id: number, item: Partial<InsertInventory>, actor?: { userId?: number; staffMemberId?: number }): Promise<Inventory>;
  deleteInventoryItem(id: number): Promise<void>;

  // Inventory Categories
  getInventoryCategories(): Promise<InventoryCategory[]>;
  createInventoryCategory(category: InsertInventoryCategory): Promise<InventoryCategory>;
  updateInventoryCategory(id: number, category: Partial<InsertInventoryCategory>): Promise<InventoryCategory>;
  deleteInventoryCategory(id: number): Promise<void>;
  reorderInventoryCategories(orderedIds: number[]): Promise<void>;

  // Orders
  getOrders(): Promise<Order[]>;
  getOrderById(id: number): Promise<Order | undefined>;
  getOrdersByStatus(status: string): Promise<Order[]>;
  getOrdersByDateRange(startDate?: Date, endDate?: Date): Promise<Order[]>;
  getOpenTabsByCustomer(): Promise<OpenTabCustomer[]>;
  settleCustomerTabs(key: string, paymentMethod?: string): Promise<number>;
  createOrder(order: InsertOrder): Promise<Order>;
  createOrderWithItems(
    order: InsertOrder,
    items: Array<Omit<InsertOrderItem, "orderId">>,
    kot: Omit<InsertKotTicket, "orderId">,
  ): Promise<Order>;
  updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order>;
  settleOrderIfUnpaid(id: number, order: Partial<InsertOrder>): Promise<Order | undefined>;
  deleteOrder(id: number): Promise<void>;

  // Order Items
  getOrderItems(orderId: number): Promise<OrderItem[]>;
  createOrderItem(item: InsertOrderItem): Promise<OrderItem>;
  updateOrderItem(id: number, item: Partial<InsertOrderItem>): Promise<OrderItem>;
  deleteOrderItem(id: number): Promise<void>;
  deleteOrderItemsByOrderId(orderId: number): Promise<void>;

  // KOT Tickets
  getKotTickets(): Promise<KotTicket[]>;
  getKotTicketsByStatus(status: string): Promise<KotTicket[]>;
  createKotTicket(ticket: InsertKotTicket): Promise<KotTicket>;
  updateKotTicket(id: number, ticket: Partial<InsertKotTicket>): Promise<KotTicket>;

  // Delivery Integrations
  getDeliveryIntegrations(): Promise<DeliveryIntegration[]>;
  createDeliveryIntegration(integration: InsertDeliveryIntegration): Promise<DeliveryIntegration>;
  updateDeliveryIntegration(id: number, integration: Partial<InsertDeliveryIntegration>): Promise<DeliveryIntegration>;

  // Tables
  getTables(): Promise<(Table & { runningTotal?: number })[]>;
  getTableById(id: number): Promise<Table | undefined>;
  createTable(table: InsertTable): Promise<Table>;
  updateTable(id: number, data: Partial<InsertTable>): Promise<Table>;
  deleteTable(id: number): Promise<void>;
  updateTableStatus(id: number, status: string, currentOrderId?: number | null): Promise<Table>;

  // Sales
  getSales(): Promise<Sales[]>;
  getSalesByDate(date: Date): Promise<Sales | undefined>;
  createSales(sales: InsertSales): Promise<Sales>;
  updateSales(id: number, sales: Partial<InsertSales>): Promise<Sales>;

  // Sold Today
  getSoldToday(): Promise<Record<number, number>>;

  // Dashboard Stats
  getDashboardStats(): Promise<{
    todaySales: number;
    todayOrders: number;
    avgOrderValue: number;
    activeOrders: number;
    totalRevenue: number;
    lowStockCount: number;
    topItem: string;
    innerRunning: number;
    outerRunning: number;
    totalTables: number;
  }>;

  // Dashboard Charts
  getSalesChart(startDate?: Date, endDate?: Date): Promise<Array<{ date: string; total: number }>>;
  getCategorySales(startDate?: Date, endDate?: Date): Promise<Array<{ category: string; total: number }>>;
  getDashboardTopItems(limit?: number, startDate?: Date, endDate?: Date): Promise<Array<{ name: string; qty: number }>>;

  // Reports
  getTopSellingItems(limit?: number, startDate?: Date, endDate?: Date): Promise<Array<{
    name: string; totalSold: number; revenue: number;
    cost: number | null; costCoverageQty: number; margin: number | null;
  }>>;

  // Staff Management
  getStaffProfiles(): Promise<(StaffProfile & { user: User })[]>;
  getStaffProfile(userId: number): Promise<StaffProfile | null>;
  upsertStaffProfile(userId: number, data: Partial<InsertStaffProfile>): Promise<StaffProfile>;
  getAttendance(filters: { userId?: number; staffMemberId?: number; date?: string; month?: string }): Promise<AttendanceWho[]>;
  getTodayAttendance(): Promise<AttendanceWho[]>;
  upsertAttendance(userId: number, date: string, data: Partial<InsertAttendance>): Promise<Attendance>;
  upsertAttendanceForStaffMember(staffMemberId: number, date: string, data: Partial<InsertAttendance>): Promise<Attendance>;
  updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance>;
  getAttendanceReport(month: string): Promise<any[]>;
  getLeaves(filters: { userId?: number; staffMemberId?: number; month?: string; status?: string }): Promise<(Leave & { user?: User; staffMember?: StaffMember; displayName: string })[]>;
  createLeave(data: InsertLeave): Promise<Leave>;
  updateLeave(id: number, data: Partial<InsertLeave>): Promise<Leave>;
  getShifts(): Promise<Shift[]>;
  createShift(data: InsertShift): Promise<Shift>;
  updateShift(id: number, data: Partial<InsertShift>): Promise<Shift>;
  getRoster(week: string): Promise<any[]>;
  upsertShiftAssignment(person: PersonRef, date: string, shiftId: number, createdBy: number): Promise<ShiftAssignment>;
  deleteShiftAssignment(id: number): Promise<void>;
  replaceAutoShiftSessions(person: PersonRef, date: string, sessions: DetectedSession[]): Promise<void>;
  getAutoShiftSessions(person: PersonRef, date: string): Promise<ShiftAssignment[]>;
  getPayrollPeople(): Promise<PayrollPerson[]>;
  getPayrollReport(month: string): Promise<any[]>;
  getAttendanceRange(filters: { from?: string; to?: string; key?: string }): Promise<any[]>;
  getAttendanceSummary(filters: { from?: string; to?: string }): Promise<any[]>;
  // Staff Members (separate from system users)
  getStaffMembers(): Promise<StaffMember[]>;
  getStaffMember(id: number): Promise<StaffMember | undefined>;
  createStaffMember(data: InsertStaffMember): Promise<StaffMember>;
  updateStaffMember(id: number, data: Partial<InsertStaffMember>): Promise<StaffMember>;
  deleteStaffMember(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.username);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    return await db.select().from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.displayOrder), asc(categories.id));
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    // Assign next display_order in the same INSERT instead of a separate SELECT round trip.
    const [newCategory] = await db.insert(categories).values({
      ...category,
      displayOrder: sql`(SELECT COALESCE(MAX(${categories.displayOrder}), -1) + 1 FROM ${categories} WHERE ${categories.isActive} = true)`,
    } as any).returning();
    return newCategory;
  }

  async updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category> {
    const [updated] = await db.update(categories).set(category).where(eq(categories.id, id)).returning();
    return updated;
  }

  async deleteCategory(id: number): Promise<void> {
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, id));
  }

  async reorderCategories(orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        db.update(categories).set({ displayOrder: index }).where(eq(categories.id, id))
      )
    );
  }

  // Menu Items
  async getMenuItems(): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(
      and(eq(menuItems.isAvailable, true), eq(menuItems.isDeleted, false))
    );
  }

  async getAllMenuItems(): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(eq(menuItems.isDeleted, false));
  }

  async getMenuItemsByCategory(categoryId: number): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(
      and(eq(menuItems.categoryId, categoryId), eq(menuItems.isAvailable, true), eq(menuItems.isDeleted, false))
    );
  }

  async getMenuItemById(id: number): Promise<MenuItem | undefined> {
    const [item] = await db.select().from(menuItems).where(eq(menuItems.id, id));
    return item;
  }

  // Live plate cost — walks inventoryLinks against CURRENT inventory.costPerUnit, scaled
  // by the size's stockMultiplier if any. Used both for the admin-facing cost/margin
  // preview and (via the orderId-bearing caller) to snapshot orderItems.unitCost at sale
  // time — that snapshot deliberately freezes the value so a later costPerUnit change
  // doesn't retroactively rewrite historical COGS. See shared/menuCost.ts for the math.
  async computeMenuItemCost(menuItemId: number, size?: string | null): Promise<MenuCostResult | null> {
    const item = await this.getMenuItemById(menuItemId);
    if (!item) return null;
    // No recipe entered means "cost unknown," NOT "cost is zero" — most menu items
    // predate this feature, and reporting them as a free 100% margin would be worse
    // than just admitting the data isn't there. Only a fully-costed recipe returns a number.
    if (!item.inventoryLinks || item.inventoryLinks.length === 0) return null;
    const invRows = await db.select().from(inventory);
    const costByInventoryId = new Map(invRows.map((r) => [r.id, r.costPerUnit]));
    const sizeMultiplier = resolveSizeMultiplier(item.sizes, size);
    return computeMenuItemCostPure(item.inventoryLinks, costByInventoryId, sizeMultiplier);
  }

  // Batched version of computeMenuItemCost — fetches the distinct menu items and the
  // whole inventory table ONCE regardless of order size, instead of once per line item.
  // Order create/edit call this per-item via Promise.all; an N-item order previously
  // meant up to 2N DB round trips here alone (getMenuItemById + full inventory scan,
  // each per item) on the two hottest routes in the app. Returns results positionally,
  // matching `items`.
  async computeMenuItemCosts(
    items: Array<{ menuItemId: number; size?: string | null }>,
  ): Promise<Array<MenuCostResult | null>> {
    const distinctIds = Array.from(new Set(items.map((i) => i.menuItemId)));
    const [menuItemRows, invRows] = await Promise.all([
      distinctIds.length > 0
        ? db.select().from(menuItems).where(inArray(menuItems.id, distinctIds))
        : Promise.resolve([] as MenuItem[]),
      db.select().from(inventory),
    ]);
    const menuItemById = new Map(menuItemRows.map((m) => [m.id, m]));
    const costByInventoryId = new Map(invRows.map((r) => [r.id, r.costPerUnit]));
    return items.map(({ menuItemId, size }) => {
      const item = menuItemById.get(menuItemId);
      if (!item?.inventoryLinks || item.inventoryLinks.length === 0) return null;
      const sizeMultiplier = resolveSizeMultiplier(item.sizes, size);
      return computeMenuItemCostPure(item.inventoryLinks, costByInventoryId, sizeMultiplier);
    });
  }

  async createMenuItem(item: InsertMenuItem): Promise<MenuItem> {
    const [newItem] = await db.insert(menuItems).values(item as any).returning();
    return newItem;
  }

  async updateMenuItem(id: number, item: Partial<InsertMenuItem>): Promise<MenuItem> {
    const [updated] = await db.update(menuItems).set(item as any).where(eq(menuItems.id, id)).returning();
    return updated;
  }

  async bulkUpdateMenuItems(ids: number[], updates: Partial<InsertMenuItem>): Promise<void> {
    if (ids.length === 0) return;
    await db.update(menuItems).set(updates as any).where(inArray(menuItems.id, ids));
  }

  async bulkDeleteMenuItems(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db.update(menuItems).set({ isDeleted: true }).where(inArray(menuItems.id, ids));
  }

  async deleteMenuItem(id: number): Promise<void> {
    await db.update(menuItems).set({ isDeleted: true }).where(eq(menuItems.id, id));
  }

  // Reconciles one order's net inventory footprint to `lineItems` — the single function
  // behind create, edit, AND cancel (called with lineItems = [] to reverse everything).
  // Rather than re-deducting from scratch, it diffs the freshly-computed target against
  // what stock_movements says this order has ALREADY consumed, and applies only the
  // difference. That makes it naturally idempotent (same lineItems twice → zero-diff
  // second time), correct even if a recipe changes after the order was placed (the
  // ledger, not the current recipe, is the source of truth for "what was deducted"),
  // and the one thing that finally makes editing/cancelling an order touch stock at all.
  async reconcileOrderInventory(
    orderId: number,
    lineItems: Array<{ menuItemId: number; quantity: number; size?: string | null }>,
    actor?: { userId?: number; staffMemberId?: number },
  ): Promise<void> {
    // 1. Target consumption per inventoryId for the given line items.
    //    Batch-fetch all distinct menu items in one query instead of one per line —
    //    an order with 5 items previously meant 5 sequential round trips here.
    const distinctIds = Array.from(new Set(lineItems.map((li) => li.menuItemId)));
    const menuItemRows = distinctIds.length > 0
      ? await db.select().from(menuItems).where(inArray(menuItems.id, distinctIds))
      : [];
    const menuItemById = new Map(menuItemRows.map((m) => [m.id, m]));

    const target = new Map<number, { qty: number; menuItemId: number }>();
    for (const { menuItemId, quantity, size } of lineItems) {
      const item = menuItemById.get(menuItemId);
      if (!item?.inventoryLinks || item.inventoryLinks.length === 0) continue;
      const sizeMultiplier =
        size && Array.isArray(item.sizes)
          ? (item.sizes.find((s) => s.size === size)?.stockMultiplier ?? 1)
          : 1;
      for (const link of item.inventoryLinks) {
        const needed = link.quantity * quantity * sizeMultiplier;
        const existing = target.get(link.inventoryId);
        target.set(link.inventoryId, { qty: (existing?.qty ?? 0) + needed, menuItemId });
      }
    }

    // 2. What this order has already net-consumed, per the ledger (not the previous
    //    order_items rows — the ledger is authoritative even across a recipe change).
    const already: any = await db.execute(sql`
      SELECT inventory_id, SUM(quantity_delta) AS net
      FROM stock_movements
      WHERE order_id = ${orderId} AND type IN ('sale', 'sale_reversal')
      GROUP BY inventory_id
    `);
    const alreadyApplied = new Map<number, number>(
      (already?.rows ?? []).map((r: any) => [Number(r.inventory_id), parseFloat(r.net)])
    );

    // 3. Diff and apply. round() avoids float-noise producing spurious near-zero diffs.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const inventoryIds = new Set<number>(Array.from(target.keys()).concat(Array.from(alreadyApplied.keys())));

    await db.transaction(async (tx) => {
      for (const inventoryId of Array.from(inventoryIds)) {
        const desiredDelta = round2(-(target.get(inventoryId)?.qty ?? 0)); // negative = net consumption
        const currentDelta = round2(alreadyApplied.get(inventoryId) ?? 0);
        const diff = round2(desiredDelta - currentDelta);
        if (Math.abs(diff) < 0.005) continue;
        await this.recordStockMovement(
          {
            inventoryId,
            quantityDelta: diff,
            type: diff < 0 ? "sale" : "sale_reversal",
            orderId,
            menuItemId: target.get(inventoryId)?.menuItemId ?? null, // best-effort — a diff spanning multiple dishes sharing this ingredient can't attribute to one; orderId is the reliable trace
            actorUserId: actor?.userId ?? null,
            actorStaffMemberId: actor?.staffMemberId ?? null,
          },
          tx as any,
        );
      }
    });
  }

  // Inventory
  async getInventory(): Promise<Inventory[]> {
    return await db.select().from(inventory).orderBy(inventory.itemName);
  }

  async getLowStockItems(): Promise<Inventory[]> {
    return await db.select().from(inventory).where(
      sql`${inventory.currentStock} <= ${inventory.minStock}`
    );
  }

  // Rows with a known-wrong (negative) balance — distinct from "low stock", which is
  // still >= 0 but below minStock. Negative means an oversold order drove the count
  // past zero and the physical shelf needs a recount. See recordStockMovement — no
  // GREATEST(0, ...) clamp is applied anywhere, so this can genuinely happen.
  async getNegativeStockItems(): Promise<Inventory[]> {
    return await db.select().from(inventory).where(sql`${inventory.currentStock} < 0`);
  }

  // Single choke point for every write to inventory.currentStock. Applies the signed
  // delta (no clamping — negative stock is allowed and surfaced via getNegativeStockItems,
  // not silently absorbed) and appends a self-describing, append-only ledger row in the
  // same statement group. Accepts an optional transaction handle so callers that need to
  // batch several movements atomically (reconcileOrderInventory) can pass one in.
  async recordStockMovement(
    m: {
      inventoryId: number;
      quantityDelta: number;
      type: "sale" | "sale_reversal" | "manual_adjustment" | "restock" | "import";
      orderId?: number | null;
      menuItemId?: number | null;
      note?: string | null;
      actorUserId?: number | null;
      actorStaffMemberId?: number | null;
    },
    tx: typeof db = db,
  ): Promise<void> {
    const result: any = await tx.execute(sql`
      UPDATE inventory SET current_stock = current_stock + ${m.quantityDelta}
      WHERE id = ${m.inventoryId}
      RETURNING current_stock
    `);
    const stockAfter = result?.rows?.[0]?.current_stock;
    if (stockAfter === undefined) return; // inventory row no longer exists — nothing to ledger
    await tx.insert(stockMovements).values({
      inventoryId: m.inventoryId,
      orderId: m.orderId ?? null,
      menuItemId: m.menuItemId ?? null,
      type: m.type,
      quantityDelta: m.quantityDelta.toString(),
      stockAfter: String(stockAfter),
      note: m.note ?? null,
      actorUserId: m.actorUserId ?? null,
      actorStaffMemberId: m.actorStaffMemberId ?? null,
    });
  }

  async createInventoryItem(item: InsertInventory): Promise<Inventory> {
    const [newItem] = await db.insert(inventory).values(item).returning();
    return newItem;
  }

  // Manual edits (Admin → Inventory) route currentStock changes through recordStockMovement
  // so they're ledgered as 'manual_adjustment' — every other field updates directly.
  async updateInventoryItem(id: number, item: Partial<InsertInventory>, actor?: { userId?: number; staffMemberId?: number }): Promise<Inventory> {
    if (item.currentStock !== undefined) {
      const { currentStock, ...rest } = item;
      const [current] = await db.select().from(inventory).where(eq(inventory.id, id));
      if (current && Object.keys(rest).length > 0) {
        await db.update(inventory).set(rest).where(eq(inventory.id, id));
      }
      if (current) {
        const delta = parseFloat(String(currentStock)) - parseFloat(current.currentStock);
        if (delta !== 0) {
          await this.recordStockMovement({
            inventoryId: id,
            quantityDelta: delta,
            type: "manual_adjustment",
            actorUserId: actor?.userId ?? null,
            actorStaffMemberId: actor?.staffMemberId ?? null,
          });
        }
      }
      const [updated] = await db.select().from(inventory).where(eq(inventory.id, id));
      return updated;
    }
    const [updated] = await db.update(inventory).set(item).where(eq(inventory.id, id)).returning();
    return updated;
  }

  async deleteInventoryItem(id: number): Promise<void> {
    await db.delete(inventory).where(eq(inventory.id, id));
  }

  // Inventory Categories
  async getInventoryCategories(): Promise<InventoryCategory[]> {
    return await db.select().from(inventoryCategories)
      .where(eq(inventoryCategories.isActive, true))
      .orderBy(asc(inventoryCategories.displayOrder), asc(inventoryCategories.id));
  }

  async createInventoryCategory(category: InsertInventoryCategory): Promise<InventoryCategory> {
    const existing = await db.select().from(inventoryCategories).where(eq(inventoryCategories.isActive, true));
    const maxOrder = existing.reduce((m, c) => Math.max(m, c.displayOrder ?? 0), 0);
    const [newCategory] = await db.insert(inventoryCategories).values({ ...category, displayOrder: maxOrder + 1 }).returning();
    return newCategory;
  }

  async updateInventoryCategory(id: number, category: Partial<InsertInventoryCategory>): Promise<InventoryCategory> {
    const [updated] = await db.update(inventoryCategories).set(category).where(eq(inventoryCategories.id, id)).returning();
    return updated;
  }

  async deleteInventoryCategory(id: number): Promise<void> {
    // Detach items first so they fall back to "Uncategorized" instead of pointing at a hidden category.
    await db.update(inventory).set({ categoryId: null }).where(eq(inventory.categoryId, id));
    await db.update(inventoryCategories).set({ isActive: false }).where(eq(inventoryCategories.id, id));
  }

  async reorderInventoryCategories(orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        db.update(inventoryCategories).set({ displayOrder: index }).where(eq(inventoryCategories.id, id))
      )
    );
  }

  // Orders
  async getOrders(): Promise<Order[]> {
    return await db.select().from(orders).orderBy(desc(orders.createdAt));
  }

  async getOrderById(id: number): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order || undefined;
  }

  async getOrdersByStatus(status: string): Promise<Order[]> {
    return await db.select().from(orders).where(eq(orders.status, status)).orderBy(desc(orders.createdAt));
  }

  async getOrdersByDateRange(startDate?: Date, endDate?: Date): Promise<Order[]> {
    const conditions = [];
    if (startDate) conditions.push(gte(orders.createdAt, startDate));
    if (endDate) conditions.push(lte(orders.createdAt, endDate));
    if (conditions.length === 0) return await this.getOrders();
    return await db.select().from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt));
  }

  // Customers with open "tabs" = served + unpaid orders (paymentStatus pending), grouped by
  // customerPhone||customerName. Powers the Dues / Pay-Later report + consolidated e-bills.
  async getOpenTabsByCustomer(): Promise<OpenTabCustomer[]> {
    const dueOrders = await db.select().from(orders)
      .where(and(eq(orders.paymentStatus, "pending"), eq(orders.status, "served")))
      .orderBy(desc(orders.createdAt));
    if (dueOrders.length === 0) return [];

    // All items for these orders in one pass — open-item safe (prefer orderItems.name, else menu name).
    const orderIds = dueOrders.map(o => o.id);
    const itemRows = await db
      .select({
        orderId: orderItems.orderId,
        name: sql<string>`coalesce(${menuItems.name}, 'Item')`,
        quantity: orderItems.quantity,
        price: orderItems.price,
      })
      .from(orderItems)
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(inArray(orderItems.orderId, orderIds));
    const itemsByOrder = new Map<number, Array<{ name: string; quantity: number; amount: number }>>();
    for (const r of itemRows) {
      const list = itemsByOrder.get(r.orderId) ?? [];
      list.push({ name: r.name, quantity: Number(r.quantity), amount: Math.round(Number(r.quantity) * parseFloat(String(r.price ?? "0"))) });
      itemsByOrder.set(r.orderId, list);
    }

    const groups = new Map<string, OpenTabCustomer>();
    for (const o of dueOrders) {
      const key = o.customerPhone?.trim() || o.customerName?.trim() || `order-${o.id}`;
      const total = parseFloat(String(o.totalAmount ?? "0"));
      const paid = parseFloat(String(o.paidAmount ?? "0"));
      const due = Math.max(0, total - paid);
      let g = groups.get(key);
      if (!g) {
        g = { key, name: o.customerName?.trim() || "Walk-in", phone: o.customerPhone?.trim() || null, orderCount: 0, totalDue: 0, orders: [] };
        groups.set(key, g);
      }
      if (!g.phone && o.customerPhone?.trim()) g.phone = o.customerPhone.trim();
      g.orderCount += 1;
      g.totalDue += due;
      g.orders.push({ id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt, total: due, items: itemsByOrder.get(o.id) ?? [] });
    }
    return Array.from(groups.values()).sort((a, b) => b.totalDue - a.totalDue);
  }

  // Mark ALL of a customer's open tabs paid (weekly/bulk settle). Returns the count settled.
  async settleCustomerTabs(key: string, paymentMethod = "cash"): Promise<number> {
    const dueOrders = await db.select().from(orders)
      .where(and(eq(orders.paymentStatus, "pending"), eq(orders.status, "served")));
    const mine = dueOrders.filter(o => (o.customerPhone?.trim() || o.customerName?.trim() || `order-${o.id}`) === key);
    if (mine.length === 0) return 0;
    // Single UPDATE across all matching ids — paymentMethod/paidAmount expressions
    // reference each row's own existing columns, so this stays a per-row-correct
    // update without a per-row round trip.
    await db.update(orders).set({
      paymentStatus: "paid",
      paymentMethod: sql`coalesce(${orders.paymentMethod}, ${paymentMethod})`,
      paidAmount: sql`coalesce(${orders.totalAmount}, '0')`,
    }).where(inArray(orders.id, mine.map((o) => o.id)));
    return mine.length;
  }

  async getStaffTableReport(startDate: Date, endDate: Date): Promise<Array<{
    date: string;
    staff: string;
    tables: string[];
    orderCount: number;
    revenue: number;
  }>> {
    const rows = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        staff: orders.createdByName,
        tableNumber: orders.tableNumber,
        orderCount: sql<number>`COUNT(*)`,
        revenue: sql<number>`SUM(CAST(${orders.totalAmount} AS numeric))`,
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, startDate),
        lte(orders.createdAt, endDate),
        sql`${orders.tableNumber} IS NOT NULL`,
        sql`${orders.createdByName} IS NOT NULL`,
      ))
      .groupBy(sql`DATE(${orders.createdAt})`, orders.createdByName, orders.tableNumber)
      .orderBy(sql`DATE(${orders.createdAt}) DESC`, orders.createdByName);

    // Merge rows with the same date+staff, collecting distinct tables
    const map = new Map<string, { date: string; staff: string; tables: Set<string>; orderCount: number; revenue: number }>();
    for (const r of rows) {
      const key = `${r.date}__${r.staff}`;
      if (!map.has(key)) {
        map.set(key, { date: r.date, staff: r.staff!, tables: new Set(), orderCount: 0, revenue: 0 });
      }
      const entry = map.get(key)!;
      if (r.tableNumber) entry.tables.add(r.tableNumber);
      entry.orderCount += Number(r.orderCount);
      entry.revenue += Number(r.revenue);
    }
    return Array.from(map.values() as any).map((e: any) => ({
      date: e.date as string,
      staff: e.staff as string,
      tables: Array.from(e.tables as Set<string>).sort() as string[],
      orderCount: e.orderCount as number,
      revenue: e.revenue as number,
    }));
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    const [newOrder] = await db.insert(orders).values({
      ...(order as any),
      updatedAt: new Date()
    }).returning();
    return newOrder;
  }

  // Atomic order creation: the order row, its items, and the KOT ticket are all
  // inserted in one transaction so a failure can't leave an orphan order with
  // missing items or a missing KOT. Inventory deduction / table status stay
  // outside (best-effort, independently recoverable).
  async createOrderWithItems(
    order: InsertOrder,
    items: Array<Omit<InsertOrderItem, "orderId">>,
    kot: Omit<InsertKotTicket, "orderId">,
  ): Promise<Order> {
    return await db.transaction(async (tx) => {
      const [newOrder] = await tx.insert(orders).values({
        ...(order as any),
        updatedAt: new Date(),
      }).returning();
      if (items.length > 0) {
        await tx.insert(orderItems).values(
          items.map((it) => ({ ...(it as any), orderId: newOrder.id })),
        );
      }
      const kotItems = Array.isArray(kot.items) ? kot.items : undefined;
      await tx.insert(kotTickets).values({ ...(kot as any), items: kotItems, orderId: newOrder.id });
      return newOrder;
    });
  }

  async updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order> {
    const [updated] = await db.update(orders).set({
      ...(order as any),
      updatedAt: new Date()
    }).where(eq(orders.id, id)).returning();
    return updated;
  }

  // Conditional settle: only flips an order that is still payment_status='pending'.
  // Returns the updated row when THIS call performed the transition, or undefined
  // if it was already settled — so a concurrent second settlement is a no-op and
  // the caller's one-time side effects (loyalty, messages, feedback) don't double-fire.
  async settleOrderIfUnpaid(id: number, order: Partial<InsertOrder>): Promise<Order | undefined> {
    const [updated] = await db.update(orders).set({
      ...(order as any),
      updatedAt: new Date(),
    }).where(and(eq(orders.id, id), eq(orders.paymentStatus, "pending"))).returning();
    return updated;
  }

  async deleteOrder(id: number): Promise<void> {
    await db.delete(orders).where(eq(orders.id, id));
  }

  // Order Items
  async getOrderItems(orderId: number): Promise<OrderItem[]> {
    return await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  }

  async createOrderItem(item: InsertOrderItem): Promise<OrderItem> {
    const [newItem] = await db.insert(orderItems).values(item).returning();
    return newItem;
  }

  async createOrderItems(items: InsertOrderItem[]): Promise<OrderItem[]> {
    if (items.length === 0) return [];
    return await db.insert(orderItems).values(items).returning();
  }

  async updateOrderItem(id: number, item: Partial<InsertOrderItem>): Promise<OrderItem> {
    const [updated] = await db.update(orderItems).set(item).where(eq(orderItems.id, id)).returning();
    return updated;
  }

  async deleteOrderItem(id: number): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.id, id));
  }

  async deleteOrderItems(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(orderItems).where(inArray(orderItems.id, ids));
  }

  async deleteOrderItemsByOrderId(orderId: number): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  }

  // KOT Tickets
  async getKotTickets(): Promise<KotTicket[]> {
    return await db.select().from(kotTickets).orderBy(desc(kotTickets.printedAt));
  }

  async getKotTicketsByStatus(status: string): Promise<KotTicket[]> {
    return await db.select().from(kotTickets).where(eq(kotTickets.status, status)).orderBy(desc(kotTickets.printedAt));
  }

  async createKotTicket(ticket: InsertKotTicket): Promise<KotTicket> {
    let items = ticket.items;
    if (items && !Array.isArray(items)) {
      items = Array.from(items as any) as typeof items;
    }
    const fixedTicket = {
      ...ticket,
      items: Array.isArray(items) ? items : undefined,
    };
    const [newTicket] = await db.insert(kotTickets).values(fixedTicket as any).returning();
    return newTicket;
  }

  async updateKotTicket(id: number, ticket: Partial<InsertKotTicket>): Promise<KotTicket> {
    const updateData: any = { ...ticket };
    if (ticket.items) {
      updateData.items = ticket.items;
    }
    const [updated] = await db.update(kotTickets).set(updateData).where(eq(kotTickets.id, id)).returning();
    return updated;
  }

  // Delivery Integrations
  async getDeliveryIntegrations(): Promise<DeliveryIntegration[]> {
    return await db.select().from(deliveryIntegrations);
  }

  async createDeliveryIntegration(integration: InsertDeliveryIntegration): Promise<DeliveryIntegration> {
    const [newIntegration] = await db.insert(deliveryIntegrations).values(integration).returning();
    return newIntegration;
  }

  async updateDeliveryIntegration(id: number, integration: Partial<InsertDeliveryIntegration>): Promise<DeliveryIntegration> {
    const [updated] = await db.update(deliveryIntegrations).set(integration).where(eq(deliveryIntegrations.id, id)).returning();
    return updated;
  }

  // Tables
  async getTables(): Promise<(Table & { runningTotal?: number; orderCreatedAt?: string; servedByName?: string | null })[]> {
    const rows = await db
      .select({
        id: tables.id,
        name: tables.name,
        capacity: tables.capacity,
        status: tables.status,
        currentOrderId: tables.currentOrderId,
        section: tables.section,
        runningTotal: orders.totalAmount,
        orderCreatedAt: orders.createdAt,
        servedByName: orders.createdByName,
      })
      .from(tables)
      .leftJoin(orders, eq(tables.currentOrderId, orders.id))
      .orderBy(tables.name);
    return rows.map(r => ({
      ...r,
      runningTotal: r.runningTotal != null ? Number(r.runningTotal) : undefined,
      orderCreatedAt: r.orderCreatedAt ? new Date(r.orderCreatedAt).toISOString() : undefined,
      servedByName: r.servedByName ?? null,
    }));
  }

  async getTableById(id: number): Promise<Table | undefined> {
    const [table] = await db.select().from(tables).where(eq(tables.id, id));
    return table || undefined;
  }

  async createTable(table: InsertTable): Promise<Table> {
    const [newTable] = await db.insert(tables).values(table).returning();
    return newTable;
  }

  async updateTable(id: number, data: Partial<InsertTable>): Promise<Table> {
    const [updated] = await db.update(tables).set(data).where(eq(tables.id, id)).returning();
    return updated;
  }

  async deleteTable(id: number): Promise<void> {
    await db.delete(tables).where(eq(tables.id, id));
  }

  async updateTableStatus(id: number, status: string, currentOrderId?: number | null): Promise<Table> {
    const updateData: any = { status };
    if (currentOrderId !== undefined) updateData.currentOrderId = currentOrderId;
    const [updated] = await db.update(tables).set(updateData).where(eq(tables.id, id)).returning();
    return updated;
  }

  // Sales
  async getSales(): Promise<Sales[]> {
    return await db.select().from(sales).orderBy(desc(sales.date));
  }

  async getSalesByDate(date: Date): Promise<Sales | undefined> {
    const [sale] = await db.select().from(sales).where(eq(sales.date, date));
    return sale || undefined;
  }

  async createSales(salesData: InsertSales): Promise<Sales> {
    const [newSales] = await db.insert(sales).values(salesData).returning();
    return newSales;
  }

  async updateSales(id: number, salesData: Partial<InsertSales>): Promise<Sales> {
    const [updated] = await db.update(sales).set(salesData).where(eq(sales.id, id)).returning();
    return updated;
  }

  // Sold Today
  async getSoldToday(): Promise<Record<number, number>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await db
      .select({
        menuItemId: orderItems.menuItemId,
        totalSold: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(gte(orders.createdAt, today), lte(orders.createdAt, tomorrow)))
      .groupBy(orderItems.menuItemId);

    const counts: Record<number, number> = {};
    for (const row of result) {
      counts[row.menuItemId] = Number(row.totalSold);
    }
    return counts;
  }

  // Dashboard Stats
  async getDashboardStats(): Promise<{
    todaySales: number;
    todayOrders: number;
    avgOrderValue: number;
    activeOrders: number;
    totalRevenue: number;
    lowStockCount: number;
    topItem: string;
    innerRunning: number;
    outerRunning: number;
    totalTables: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todayResult] = await db.select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(cast(${orders.totalAmount} as numeric)), 0)`
    }).from(orders).where(
      and(gte(orders.createdAt, today), lte(orders.createdAt, tomorrow))
    );

    const [activeResult] = await db.select({
      count: sql<number>`count(*)`
    }).from(orders).where(
      sql`${orders.status} NOT IN ('served', 'cancelled')`
    );

    const [revenueResult] = await db.select({
      total: sql<number>`coalesce(sum(cast(${orders.totalAmount} as numeric)), 0)`
    }).from(orders);

    const [lowStockResult] = await db.select({
      count: sql<number>`count(*)`
    }).from(inventory).where(
      sql`${inventory.currentStock} <= ${inventory.minStock}`
    );

    const topItemRows = await db
      .select({
        name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
        qty: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(and(gte(orders.createdAt, today), lte(orders.createdAt, tomorrow)))
      .groupBy(sql`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`)
      .orderBy(sql`sum(${orderItems.quantity}) desc`)
      .limit(1);

    const todayOrders = Number(todayResult?.count || 0);
    const todaySales = Number(todayResult?.total || 0);

    // Section-level table stats
    const allTables = await db.select().from(tables);
    const innerRunning = allTables.filter(t => t.section === 'inner' && t.status === 'running').length;
    const outerRunning = allTables.filter(t => t.section === 'outer' && t.status === 'running').length;

    return {
      todaySales,
      todayOrders,
      avgOrderValue: todayOrders > 0 ? todaySales / todayOrders : 0,
      activeOrders: Number(activeResult?.count || 0),
      totalRevenue: Number(revenueResult?.total || 0),
      lowStockCount: Number(lowStockResult?.count || 0),
      topItem: topItemRows[0]?.name || '—',
      innerRunning,
      outerRunning,
      totalTables: allTables.length,
    };
  }

  // Dashboard Charts
  async getSalesChart(startDate?: Date, endDate?: Date): Promise<Array<{ date: string; total: number }>> {
    let start: Date, end: Date;
    if (startDate && endDate) {
      start = new Date(startDate); start.setHours(0, 0, 0, 0);
      end   = new Date(endDate);   end.setHours(23, 59, 59, 999);
    } else {
      end = new Date(); end.setHours(23, 59, 59, 999);
      start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
    }

    const allOrders = await db.select({
      createdAt: orders.createdAt,
      totalAmount: orders.totalAmount,
    }).from(orders).where(
      and(gte(orders.createdAt, start), lte(orders.createdAt, end))
    );

    // Build a day slot for every day in the range
    const days: Array<{ date: string; dateKey: string; total: number }> = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      days.push({
        date: cursor.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
        dateKey: cursor.toISOString().slice(0, 10),
        total: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const order of allOrders) {
      const dateKey = new Date(order.createdAt!).toISOString().slice(0, 10);
      const day = days.find(d => d.dateKey === dateKey);
      if (day) day.total += parseFloat(order.totalAmount);
    }

    return days.map(({ date, total }) => ({ date, total }));
  }

  async getCategorySales(startDate?: Date, endDate?: Date): Promise<Array<{ category: string; total: number }>> {
    let start: Date, end: Date;
    if (startDate && endDate) {
      start = new Date(startDate); start.setHours(0, 0, 0, 0);
      end   = new Date(endDate);   end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(); start.setHours(0, 0, 0, 0);
      end   = new Date(); end.setHours(23, 59, 59, 999);
    }

    const result = await db
      .select({
        category: categories.name,
        total: sql<number>`cast(sum(cast(${orderItems.quantity} as numeric) * cast(${orderItems.price} as numeric)) as numeric)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .innerJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)))
      .groupBy(categories.id, categories.name)
      .orderBy(sql`sum(cast(${orderItems.quantity} as numeric) * cast(${orderItems.price} as numeric)) desc`);

    return result.map(r => ({ category: r.category, total: Number(r.total) }));
  }

  async getDashboardTopItems(limit: number = 8, startDate?: Date, endDate?: Date): Promise<Array<{ name: string; qty: number }>> {
    let start: Date, end: Date;
    if (startDate && endDate) {
      start = new Date(startDate); start.setHours(0, 0, 0, 0);
      end   = new Date(endDate);   end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(); start.setHours(0, 0, 0, 0);
      end   = new Date(); end.setHours(23, 59, 59, 999);
    }

    const result = await db
      .select({
        name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
        qty: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)))
      .groupBy(sql`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`)
      .orderBy(sql`sum(${orderItems.quantity}) desc`)
      .limit(limit);

    return result.map(r => ({ name: r.name, qty: Number(r.qty) }));
  }

  async getTopSellingItems(
    limit = 10,
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{
    name: string; totalSold: number; revenue: number;
    cost: number | null; costCoverageQty: number; margin: number | null;
  }>> {
    const conditions = [];
    if (startDate) conditions.push(gte(orders.createdAt, startDate));
    if (endDate)   conditions.push(lte(orders.createdAt, endDate));

    const result = await db
      .select({
        name: sql<string>`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`,
        totalSold: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
        revenue: sql<number>`cast(sum(cast(${orderItems.quantity} as numeric) * ${orderItems.price}) as numeric)`,
        // COGS is only summed over rows that actually carry a unitCost snapshot (orders
        // placed before this feature shipped, or items with no priced recipe, have
        // unit_cost = NULL) — costCoverageQty tells the caller how much of totalSold
        // that cost figure actually covers, so a partial number is never presented as
        // if it were complete.
        costSum: sql<string | null>`sum(cast(${orderItems.quantity} as numeric) * ${orderItems.unitCost}) FILTER (WHERE ${orderItems.unitCost} IS NOT NULL)`,
        costCoverageQty: sql<string | null>`sum(${orderItems.quantity}) FILTER (WHERE ${orderItems.unitCost} IS NOT NULL)`,
      })
      .from(orderItems)
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(sql`coalesce(${orderItems.name}, ${menuItems.name}, 'Item')`)
      .orderBy(sql`sum(${orderItems.quantity}) desc`)
      .limit(limit);

    return result.map(r => {
      const revenue = Number(r.revenue);
      const costCoverageQty = Number(r.costCoverageQty ?? 0);
      const cost = costCoverageQty > 0 ? Number(r.costSum) : null;
      const margin = cost != null && revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
      return {
        name: r.name,
        totalSold: Number(r.totalSold),
        revenue,
        cost,
        costCoverageQty,
        margin,
      };
    });
  }

  // ============================================================
  // STAFF MANAGEMENT
  // ============================================================

  async getStaffProfiles(): Promise<(StaffProfile & { user: User })[]> {
    const allUsers = await db.select().from(users).orderBy(asc(users.id));
    const profiles = await db.select().from(staffProfiles);
    const profileMap = new Map(profiles.map(p => [p.userId, p]));
    return allUsers.map(u => ({
      ...(profileMap.get(u.id) ?? {
        id: 0, userId: u.id, biometricId: null, department: null, designation: null,
        monthlySalary: "0", joiningDate: null, emergencyContact: null, address: null,
        bankAccountNo: null, bankName: null, isActive: true, updatedAt: new Date(),
      }),
      user: u,
    })) as (StaffProfile & { user: User })[];
  }

  async getStaffProfile(userId: number): Promise<StaffProfile | null> {
    const [p] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, userId));
    return p ?? null;
  }

  async upsertStaffProfile(userId: number, data: Partial<InsertStaffProfile>): Promise<StaffProfile> {
    const existing = await this.getStaffProfile(userId);
    if (existing) {
      const [updated] = await db.update(staffProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(staffProfiles.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(staffProfiles)
      .values({ userId, monthlySalary: "0", ...data })
      .returning();
    return created;
  }

  async getAttendance(filters: { userId?: number; staffMemberId?: number; date?: string; month?: string }): Promise<AttendanceWho[]> {
    const conditions: any[] = [];
    if (filters.userId)        conditions.push(eq(attendance.userId, filters.userId));
    if (filters.staffMemberId) conditions.push(eq(attendance.staffMemberId, filters.staffMemberId));
    if (filters.date)          conditions.push(eq(attendance.date, filters.date));
    if (filters.month)         conditions.push(sql`${attendance.date} LIKE ${filters.month + '-%'}`);
    const rows = conditions.length
      ? await db.select().from(attendance).where(and(...conditions)).orderBy(desc(attendance.date))
      : await db.select().from(attendance).orderBy(desc(attendance.date));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allStaff = await db.select().from(staffMembers);
    const staffMap = new Map(allStaff.map(s => [s.id, s]));
    return rows
      .map(r => {
        const user = r.userId != null ? userMap.get(r.userId) : undefined;
        const staffMember = r.staffMemberId != null ? staffMap.get(r.staffMemberId) : undefined;
        return { ...r, user, staffMember, displayName: user?.username ?? staffMember?.name ?? "Unknown" };
      })
      .filter(r => r.user || r.staffMember);
  }

  async getTodayAttendance(): Promise<AttendanceWho[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.getAttendance({ date: today });
  }

  async upsertAttendance(userId: number, date: string, data: Partial<InsertAttendance>): Promise<Attendance> {
    const [existing] = await db.select().from(attendance)
      .where(and(eq(attendance.userId, userId), eq(attendance.date, date)));
    if (existing) {
      const [updated] = await db.update(attendance).set(data).where(eq(attendance.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(attendance).values({ userId, date, status: "present", ...data }).returning();
    return created;
  }

  async upsertAttendanceForStaffMember(staffMemberId: number, date: string, data: Partial<InsertAttendance>): Promise<Attendance> {
    const [existing] = await db.select().from(attendance)
      .where(and(eq(attendance.staffMemberId, staffMemberId), eq(attendance.date, date)));
    if (existing) {
      const [updated] = await db.update(attendance).set(data).where(eq(attendance.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(attendance).values({ staffMemberId, date, status: "present", ...data }).returning();
    return created;
  }

  async updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance> {
    const [updated] = await db.update(attendance).set(data).where(eq(attendance.id, id)).returning();
    return updated;
  }

  async getAttendanceReport(month: string): Promise<any[]> {
    const allUsers = await db.select().from(users);
    const monthAttendance = await db.select().from(attendance)
      .where(sql`${attendance.date} LIKE ${month + '-%'}`);
    return allUsers.map(u => {
      const records = monthAttendance.filter(a => a.userId === u.id);
      const present   = records.filter(a => a.status === 'present').length;
      const halfDay   = records.filter(a => a.status === 'half-day').length;
      const onLeave   = records.filter(a => a.status === 'on-leave').length;
      const absent    = records.filter(a => a.status === 'absent').length;
      const totalHours = records.reduce((sum, a) => sum + parseFloat(a.workingHours ?? '0'), 0);
      return { userId: u.id, username: u.username, role: u.role, present, halfDay, onLeave, absent, totalHours: totalHours.toFixed(1) };
    });
  }

  // Resolves against BOTH identity systems (users + staffMembers), like getAttendance — a PIN/
  // biometric-only staff member's leave requests used to vanish here (userId-only lookup).
  async getLeaves(filters: { userId?: number; staffMemberId?: number; month?: string; status?: string }): Promise<(Leave & { user?: User; staffMember?: StaffMember; displayName: string })[]> {
    const conditions: any[] = [];
    if (filters.userId)        conditions.push(eq(leaves.userId, filters.userId));
    if (filters.staffMemberId) conditions.push(eq(leaves.staffMemberId, filters.staffMemberId));
    if (filters.status && filters.status !== '') conditions.push(eq(leaves.status, filters.status));
    if (filters.month)  conditions.push(sql`${leaves.startDate} LIKE ${filters.month + '-%'}`);
    const rows = conditions.length
      ? await db.select().from(leaves).where(and(...conditions)).orderBy(desc(leaves.createdAt))
      : await db.select().from(leaves).orderBy(desc(leaves.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allStaff = await db.select().from(staffMembers);
    const staffMap = new Map(allStaff.map(s => [s.id, s]));
    return rows
      .map(r => {
        const user = r.userId != null ? userMap.get(r.userId) : undefined;
        const staffMember = r.staffMemberId != null ? staffMap.get(r.staffMemberId) : undefined;
        return { ...r, user, staffMember, displayName: user?.username ?? staffMember?.name ?? "Unknown" };
      })
      .filter(r => r.user || r.staffMember);
  }

  async createLeave(data: InsertLeave): Promise<Leave> {
    const [created] = await db.insert(leaves).values(data).returning();
    return created;
  }

  async updateLeave(id: number, data: Partial<InsertLeave>): Promise<Leave> {
    const [updated] = await db.update(leaves).set(data).where(eq(leaves.id, id)).returning();
    return updated;
  }

  async getShifts(): Promise<Shift[]> {
    return db.select().from(shifts).where(eq(shifts.isActive, true)).orderBy(asc(shifts.id));
  }

  async createShift(data: InsertShift): Promise<Shift> {
    // Compute durationHours server-side (single source of truth) with midnight-wrap — never trust the client.
    const durationHours = shiftWindow(data.startTime, data.endTime).hours.toFixed(2);
    const [created] = await db.insert(shifts).values({ ...data, durationHours }).returning();
    return created;
  }

  async updateShift(id: number, data: Partial<InsertShift>): Promise<Shift> {
    const patch: Partial<InsertShift> = { ...data };
    if (data.startTime && data.endTime) {
      patch.durationHours = shiftWindow(data.startTime, data.endTime).hours.toFixed(2);
    }
    const [updated] = await db.update(shifts).set(patch).where(eq(shifts.id, id)).returning();
    return updated;
  }

  async getRoster(week: string): Promise<any[]> {
    const [year, weekNum] = week.split('-').map(Number);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const weekStart = new Date(jan4);
    weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    // Union of BOTH identity systems (users manager/staff + staffMembers), like payroll —
    // so PIN/biometric-only staff appear in the roster, not just login accounts.
    const people = await this.getPayrollPeople();
    const assignments = await db.select().from(shiftAssignments)
      .where(sql`${shiftAssignments.date} = ANY(ARRAY[${sql.join(dates.map(d => sql`${d}`), sql`, `)}])`);
    const allShifts = await db.select().from(shifts);
    const shiftMap = new Map(allShifts.map(s => [s.id, s]));
    return people.map(p => {
      const dateMap: Record<string, any[]> = {};
      dates.forEach(d => {
        const rows = assignments.filter(x =>
          x.date === d && (p.kind === "user" ? x.userId === p.id : x.staffMemberId === p.id));
        dateMap[d] = rows.map(a => ({
          assignmentId: a.id,
          shift: shiftMap.get(a.shiftId),
          source: a.source,
          clockIn: a.clockIn,
          clockOut: a.clockOut,
          workingHours: a.workingHours,
        }));
      });
      return {
        key: personPageKey(p.kind, p.id),
        kind: p.kind,
        id: p.id,
        username: p.name,
        role: p.role ?? "staff",
        dates,
        assignments: dateMap,
      };
    });
  }

  // Manual roster assignment. Inserts a 'manual' row (guards against a duplicate same-shift on that
  // person+date); never touches 'auto' rows so a manual add coexists with detected shifts.
  async upsertShiftAssignment(person: PersonRef, date: string, shiftId: number, createdBy: number): Promise<ShiftAssignment> {
    const personCond = person.kind === "user"
      ? eq(shiftAssignments.userId, person.id)
      : eq(shiftAssignments.staffMemberId, person.id);
    const [existing] = await db.select().from(shiftAssignments)
      .where(and(personCond, eq(shiftAssignments.date, date), eq(shiftAssignments.shiftId, shiftId), eq(shiftAssignments.source, "manual")));
    if (existing) return existing;
    const [created] = await db.insert(shiftAssignments).values({
      userId: person.kind === "user" ? person.id : null,
      staffMemberId: person.kind === "staff" ? person.id : null,
      shiftId, date, source: "manual", createdBy,
    }).returning();
    return created;
  }

  async deleteShiftAssignment(id: number): Promise<void> {
    // Only manual rows are removable from the UI; auto rows re-derive from punches.
    await db.delete(shiftAssignments).where(and(eq(shiftAssignments.id, id), eq(shiftAssignments.source, "manual")));
  }

  async getAutoShiftSessions(person: PersonRef, date: string): Promise<ShiftAssignment[]> {
    const personCond = person.kind === "user"
      ? eq(shiftAssignments.userId, person.id)
      : eq(shiftAssignments.staffMemberId, person.id);
    return db.select().from(shiftAssignments)
      .where(and(personCond, eq(shiftAssignments.date, date), eq(shiftAssignments.source, "auto")));
  }

  // Idempotently rewrite a person's AUTO sessions for a date (manual rows untouched).
  async replaceAutoShiftSessions(person: PersonRef, date: string, sessions: DetectedSession[]): Promise<void> {
    const personCond = person.kind === "user"
      ? eq(shiftAssignments.userId, person.id)
      : eq(shiftAssignments.staffMemberId, person.id);
    await db.delete(shiftAssignments)
      .where(and(personCond, eq(shiftAssignments.date, date), eq(shiftAssignments.source, "auto")));
    if (sessions.length === 0) return;
    await db.insert(shiftAssignments).values(sessions.map(s => ({
      userId: person.kind === "user" ? person.id : null,
      staffMemberId: person.kind === "staff" ? person.id : null,
      shiftId: s.shiftId,
      date,
      source: "auto",
      clockIn: s.clockIn,
      clockOut: s.clockOut ?? null,
      workingHours: s.workingHours.toFixed(2),
      createdBy: null,
    })));
  }

  // The payroll-eligible roster, pulled from BOTH systems and created in Admin:
  //  • `users` with role manager/staff (admins + owner excluded), HR fields from `staffProfiles`
  //  • `staffMembers` (PIN cards + attendance-only), skipping `excludeFromPayroll`
  async getPayrollPeople(): Promise<PayrollPerson[]> {
    const allUsers = await db.select().from(users);
    const profiles = await db.select().from(staffProfiles);
    const profileMap = new Map(profiles.map(p => [p.userId, p]));
    const userPeople: PayrollPerson[] = allUsers
      .filter(u => u.role === 'manager' || u.role === 'staff')
      .map(u => {
        const p = profileMap.get(u.id);
        return {
          kind: 'user', id: u.id, name: u.username,
          role: p?.designation ?? null, biometricId: p?.biometricId ?? null,
          monthlySalary: p?.monthlySalary ?? '0',
        };
      });
    const members = await db.select().from(staffMembers);
    const memberPeople: PayrollPerson[] = members
      .filter(m => !m.excludeFromPayroll)
      .map(m => ({
        kind: 'staff', id: m.id, name: m.name,
        role: m.designation ?? null, biometricId: m.biometricId ?? null,
        monthlySalary: m.monthlySalary ?? '0',
      }));
    return [...userPeople, ...memberPeople];
  }

  async getPayrollReport(month: string): Promise<any[]> {
    const [year, mon] = month.split('-').map(Number);
    // The restaurant operates every day of the week — Sunday is a normal working day, not a weekly off.
    const workingDays = new Date(year, mon, 0).getDate();
    const people = await this.getPayrollPeople();
    const monthAttendance = await db.select().from(attendance)
      .where(sql`${attendance.date} LIKE ${month + '-%'}`);
    return people.map(person => {
      const salary = parseFloat(person.monthlySalary ?? '0');
      const records = person.kind === 'user'
        ? monthAttendance.filter(a => a.userId === person.id)
        : monthAttendance.filter(a => a.staffMemberId === person.id);
      const daysPresent = records.filter(a => a.status === 'present').length;
      const halfDays = records.filter(a => a.status === 'half-day').length;
      const approvedLeaves = 0; // leave is modelled per-user only; not counted in the unified roster yet
      const paidDays = daysPresent + (halfDays * 0.5) + approvedLeaves;
      const absentDays = Math.max(0, workingDays - paidDays);
      const dailyRate = workingDays > 0 ? salary / workingDays : 0;
      const deductions = absentDays * dailyRate;
      const overtimeHours = records.reduce((s, a) => s + parseFloat(a.overtimeHours ?? '0'), 0);
      const overtimePay = overtimeHours * (dailyRate / 8);
      const netSalary = salary - deductions + overtimePay;
      return {
        kind: person.kind,
        userId: person.kind === 'user' ? person.id : undefined,
        staffMemberId: person.kind === 'staff' ? person.id : undefined,
        name: person.name, designation: person.role,
        // `username`/`role` kept for the existing payroll UI's column rendering.
        username: person.name, role: person.role ?? 'staff',
        monthlySalary: salary, workingDays, daysPresent, halfDays,
        approvedLeaves, absentDays: Math.round(absentDays * 10) / 10,
        deductions: Math.round(deductions * 100) / 100,
        overtimeHours: Math.round(overtimeHours * 10) / 10,
        overtimePay: Math.round(overtimePay * 100) / 100,
        netSalary: Math.round(netSalary * 100) / 100,
      };
    });
  }

  // Device attendance rows in a date range, resolved to the unified roster (owner/admins excluded).
  async getAttendanceRange(filters: { from?: string; to?: string; key?: string }): Promise<any[]> {
    const people = await this.getPayrollPeople();
    const byUser = new Map<number, PayrollPerson>();
    const byStaff = new Map<number, PayrollPerson>();
    for (const p of people) (p.kind === 'user' ? byUser : byStaff).set(p.id, p);
    const conds: any[] = [];
    if (filters.from) conds.push(gte(attendance.date, filters.from));
    if (filters.to)   conds.push(lte(attendance.date, filters.to));
    const rows = conds.length
      ? await db.select().from(attendance).where(and(...conds)).orderBy(desc(attendance.date))
      : await db.select().from(attendance).orderBy(desc(attendance.date));
    const out = rows
      .map(r => {
        const p = r.userId != null ? byUser.get(r.userId) : (r.staffMemberId != null ? byStaff.get(r.staffMemberId) : undefined);
        if (!p) return null;
        // Field names mirror the existing Attendance-tab UI (employeeName/punchIn/punchOut/hoursWorked).
        return {
          date: r.date, key: personPageKey(p.kind, p.id),
          employeeName: p.name, employeeCode: p.role ?? null, role: p.role,
          punchIn: r.clockIn, punchOut: r.clockOut, status: r.status,
          hoursWorked: r.workingHours,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    return filters.key ? out.filter(r => r.key === filters.key) : out;
  }

  // Per-person attendance summary over the unified roster for a date range.
  async getAttendanceSummary(filters: { from?: string; to?: string }): Promise<any[]> {
    const people = await this.getPayrollPeople();
    const conds: any[] = [];
    if (filters.from) conds.push(gte(attendance.date, filters.from));
    if (filters.to)   conds.push(lte(attendance.date, filters.to));
    const rows = conds.length
      ? await db.select().from(attendance).where(and(...conds))
      : await db.select().from(attendance);
    return people.map(p => {
      const recs = rows.filter(r => p.kind === 'user' ? r.userId === p.id : r.staffMemberId === p.id);
      const totalHours = recs.reduce((s, r) => s + parseFloat(r.workingHours ?? '0'), 0);
      return {
        key: personPageKey(p.kind, p.id), name: p.name, role: p.role,
        present: recs.filter(r => r.status === 'present').length,
        halfDay: recs.filter(r => r.status === 'half-day').length,
        absent:  recs.filter(r => r.status === 'absent').length,
        late: 0, // device attendance has no "late" status; kept for the existing Summary UI
        totalHours: Math.round(totalHours * 10) / 10,
      };
    });
  }

  // Staff Members
  async getStaffMembers(): Promise<StaffMember[]> {
    return db.select().from(staffMembers).orderBy(staffMembers.name);
  }

  async getStaffMember(id: number): Promise<StaffMember | undefined> {
    const [sm] = await db.select().from(staffMembers).where(eq(staffMembers.id, id));
    return sm || undefined;
  }

  async createStaffMember(data: InsertStaffMember): Promise<StaffMember> {
    const [sm] = await db.insert(staffMembers).values(data).returning();
    return sm;
  }

  async updateStaffMember(id: number, data: Partial<InsertStaffMember>): Promise<StaffMember> {
    if (Object.keys(data).length === 0) return this.getStaffMember(id) as Promise<StaffMember>; // no-op: avoid Drizzle "No values to set"
    const [sm] = await db.update(staffMembers).set(data).where(eq(staffMembers.id, id)).returning();
    return sm;
  }

  async deleteStaffMember(id: number): Promise<void> {
    await db.delete(staffMembers).where(eq(staffMembers.id, id));
  }
}

export const storage = new DatabaseStorage();
