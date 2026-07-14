import {
  users, categories, menuItems, inventory, orders, orderItems, kotTickets, deliveryIntegrations, sales, tables,
  staffProfiles, attendance, leaves, shifts, shiftAssignments,
  staffMembers,
  type User, type InsertUser, type Category, type InsertCategory, type MenuItem, type InsertMenuItem,
  type Inventory, type InsertInventory, type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
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

/** A person key for roster/attendance writes — a system account or a staff member. */
export type PersonRef = { kind: "user" | "staff"; id: number };

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
  deductInventoryForOrder(orderItems: Array<{ menuItemId: number; quantity: number }>): Promise<void>;

  // Inventory
  getInventory(): Promise<Inventory[]>;
  getLowStockItems(): Promise<Inventory[]>;
  updateInventory(id: number, stock: number): Promise<Inventory>;
  createInventoryItem(item: InsertInventory): Promise<Inventory>;
  updateInventoryItem(id: number, item: Partial<InsertInventory>): Promise<Inventory>;
  deleteInventoryItem(id: number): Promise<void>;

  // Orders
  getOrders(): Promise<Order[]>;
  getOrderById(id: number): Promise<Order | undefined>;
  getOrdersByStatus(status: string): Promise<Order[]>;
  getOrdersByDateRange(startDate: Date, endDate: Date): Promise<Order[]>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order>;
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
  getTopSellingItems(limit?: number, startDate?: Date, endDate?: Date): Promise<Array<{ name: string; totalSold: number; revenue: number }>>;

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
    // Assign next display_order
    const existing = await db.select().from(categories).where(eq(categories.isActive, true));
    const maxOrder = existing.reduce((m, c) => Math.max(m, c.displayOrder ?? 0), 0);
    const [newCategory] = await db.insert(categories).values({ ...category, displayOrder: maxOrder + 1 }).returning();
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
    return await db.select().from(menuItems).where(eq(menuItems.isAvailable, true));
  }

  async getAllMenuItems(): Promise<MenuItem[]> {
    return await db.select().from(menuItems);
  }

  async getMenuItemsByCategory(categoryId: number): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(
      and(eq(menuItems.categoryId, categoryId), eq(menuItems.isAvailable, true))
    );
  }

  async getMenuItemById(id: number): Promise<MenuItem | undefined> {
    const [item] = await db.select().from(menuItems).where(eq(menuItems.id, id));
    return item;
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
    await db.update(menuItems).set({ isAvailable: false }).where(inArray(menuItems.id, ids));
  }

  async deleteMenuItem(id: number): Promise<void> {
    await db.update(menuItems).set({ isAvailable: false }).where(eq(menuItems.id, id));
  }

  async deductInventoryForOrder(orderItems: Array<{ menuItemId: number; quantity: number }>): Promise<void> {
    for (const { menuItemId, quantity } of orderItems) {
      const item = await this.getMenuItemById(menuItemId);
      if (!item?.inventoryLinks || item.inventoryLinks.length === 0) continue;
      for (const link of item.inventoryLinks) {
        const needed = link.quantity * quantity;
        await db.execute(
          sql`UPDATE inventory SET current_stock = GREATEST(0, current_stock - ${needed}) WHERE id = ${link.inventoryId}`
        );
      }
    }
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

  async updateInventory(id: number, stock: number): Promise<Inventory> {
    const [updated] = await db.update(inventory).set({ 
      currentStock: stock.toString(),
      lastRestocked: new Date()
    }).where(eq(inventory.id, id)).returning();
    return updated;
  }

  async createInventoryItem(item: InsertInventory): Promise<Inventory> {
    const [newItem] = await db.insert(inventory).values(item).returning();
    return newItem;
  }

  async updateInventoryItem(id: number, item: Partial<InsertInventory>): Promise<Inventory> {
    const [updated] = await db.update(inventory).set(item).where(eq(inventory.id, id)).returning();
    return updated;
  }

  async deleteInventoryItem(id: number): Promise<void> {
    await db.delete(inventory).where(eq(inventory.id, id));
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

  async getOrdersByDateRange(startDate: Date, endDate: Date): Promise<Order[]> {
    return await db.select().from(orders).where(
      and(gte(orders.createdAt, startDate), lte(orders.createdAt, endDate))
    ).orderBy(desc(orders.createdAt));
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

  async updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order> {
    const [updated] = await db.update(orders).set({
      ...(order as any),
      updatedAt: new Date()
    }).where(eq(orders.id, id)).returning();
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

  async updateOrderItem(id: number, item: Partial<InsertOrderItem>): Promise<OrderItem> {
    const [updated] = await db.update(orderItems).set(item).where(eq(orderItems.id, id)).returning();
    return updated;
  }

  async deleteOrderItem(id: number): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.id, id));
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
        name: menuItems.name,
        qty: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(and(gte(orders.createdAt, today), lte(orders.createdAt, tomorrow)))
      .groupBy(menuItems.id, menuItems.name)
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
        name: menuItems.name,
        qty: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)))
      .groupBy(menuItems.id, menuItems.name)
      .orderBy(sql`sum(${orderItems.quantity}) desc`)
      .limit(limit);

    return result.map(r => ({ name: r.name, qty: Number(r.qty) }));
  }

  async getTopSellingItems(
    limit = 10,
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ name: string; totalSold: number; revenue: number }>> {
    const conditions = [];
    if (startDate) conditions.push(gte(orders.createdAt, startDate));
    if (endDate)   conditions.push(lte(orders.createdAt, endDate));

    const result = await db
      .select({
        name: menuItems.name,
        totalSold: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
        revenue: sql<number>`cast(sum(cast(${orderItems.quantity} as numeric) * ${orderItems.price}) as numeric)`,
      })
      .from(orderItems)
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(menuItems.id, menuItems.name)
      .orderBy(sql`sum(${orderItems.quantity}) desc`)
      .limit(limit);

    return result.map(r => ({
      name: r.name,
      totalSold: Number(r.totalSold),
      revenue: Number(r.revenue),
    }));
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
