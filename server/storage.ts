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
  getAttendance(filters: { userId?: number; date?: string; month?: string }): Promise<(Attendance & { user: User })[]>;
  getTodayAttendance(): Promise<(Attendance & { user: User })[]>;
  upsertAttendance(userId: number, date: string, data: Partial<InsertAttendance>): Promise<Attendance>;
  updateAttendance(id: number, data: Partial<InsertAttendance>): Promise<Attendance>;
  getAttendanceReport(month: string): Promise<any[]>;
  getLeaves(filters: { userId?: number; month?: string; status?: string }): Promise<(Leave & { user: User })[]>;
  createLeave(data: InsertLeave): Promise<Leave>;
  updateLeave(id: number, data: Partial<InsertLeave>): Promise<Leave>;
  getShifts(): Promise<Shift[]>;
  createShift(data: InsertShift): Promise<Shift>;
  updateShift(id: number, data: Partial<InsertShift>): Promise<Shift>;
  getRoster(week: string): Promise<any[]>;
  upsertShiftAssignment(userId: number, date: string, shiftId: number, createdBy: number): Promise<ShiftAssignment>;
  deleteShiftAssignment(id: number): Promise<void>;
  getPayrollReport(month: string): Promise<any[]>;
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
  async getTables(): Promise<(Table & { runningTotal?: number; orderCreatedAt?: string })[]> {
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
      })
      .from(tables)
      .leftJoin(orders, eq(tables.currentOrderId, orders.id))
      .orderBy(tables.name);
    return rows.map(r => ({
      ...r,
      runningTotal: r.runningTotal != null ? Number(r.runningTotal) : undefined,
      orderCreatedAt: r.orderCreatedAt ? new Date(r.orderCreatedAt).toISOString() : undefined,
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

  async getAttendance(filters: { userId?: number; date?: string; month?: string }): Promise<(Attendance & { user: User })[]> {
    const conditions: any[] = [];
    if (filters.userId) conditions.push(eq(attendance.userId, filters.userId));
    if (filters.date)   conditions.push(eq(attendance.date, filters.date));
    if (filters.month)  conditions.push(sql`${attendance.date} LIKE ${filters.month + '-%'}`);
    const rows = conditions.length
      ? await db.select().from(attendance).where(and(...conditions)).orderBy(desc(attendance.date))
      : await db.select().from(attendance).orderBy(desc(attendance.date));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return rows.map(r => ({ ...r, user: userMap.get(r.userId)! })).filter(r => r.user);
  }

  async getTodayAttendance(): Promise<(Attendance & { user: User })[]> {
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

  async getLeaves(filters: { userId?: number; month?: string; status?: string }): Promise<(Leave & { user: User })[]> {
    const conditions: any[] = [];
    if (filters.userId) conditions.push(eq(leaves.userId, filters.userId));
    if (filters.status && filters.status !== '') conditions.push(eq(leaves.status, filters.status));
    if (filters.month)  conditions.push(sql`${leaves.startDate} LIKE ${filters.month + '-%'}`);
    const rows = conditions.length
      ? await db.select().from(leaves).where(and(...conditions)).orderBy(desc(leaves.createdAt))
      : await db.select().from(leaves).orderBy(desc(leaves.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return rows.map(r => ({ ...r, user: userMap.get(r.userId)! })).filter(r => r.user);
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
    const [created] = await db.insert(shifts).values(data).returning();
    return created;
  }

  async updateShift(id: number, data: Partial<InsertShift>): Promise<Shift> {
    const [updated] = await db.update(shifts).set(data).where(eq(shifts.id, id)).returning();
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
    const allUsers = await db.select().from(users);
    const assignments = await db.select().from(shiftAssignments)
      .where(sql`${shiftAssignments.date} = ANY(ARRAY[${sql.join(dates.map(d => sql`${d}`), sql`, `)}])`);
    const allShifts = await db.select().from(shifts);
    const shiftMap = new Map(allShifts.map(s => [s.id, s]));
    return allUsers.map(u => {
      const userAssignments: Record<string, any> = {};
      dates.forEach(d => {
        const a = assignments.find(x => x.userId === u.id && x.date === d);
        userAssignments[d] = a ? { assignmentId: a.id, shift: shiftMap.get(a.shiftId) } : null;
      });
      return { userId: u.id, username: u.username, role: u.role, dates, assignments: userAssignments };
    });
  }

  async upsertShiftAssignment(userId: number, date: string, shiftId: number, createdBy: number): Promise<ShiftAssignment> {
    const [existing] = await db.select().from(shiftAssignments)
      .where(and(eq(shiftAssignments.userId, userId), eq(shiftAssignments.date, date)));
    if (existing) {
      const [updated] = await db.update(shiftAssignments)
        .set({ shiftId, createdBy })
        .where(eq(shiftAssignments.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(shiftAssignments).values({ userId, date, shiftId, createdBy }).returning();
    return created;
  }

  async deleteShiftAssignment(id: number): Promise<void> {
    await db.delete(shiftAssignments).where(eq(shiftAssignments.id, id));
  }

  async getPayrollReport(month: string): Promise<any[]> {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    let sundays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, mon - 1, d).getDay() === 0) sundays++;
    }
    const workingDays = daysInMonth - sundays;
    const allUsers = await db.select().from(users);
    const profiles = await db.select().from(staffProfiles);
    const profileMap = new Map(profiles.map(p => [p.userId, p]));
    const monthAttendance = await db.select().from(attendance)
      .where(sql`${attendance.date} LIKE ${month + '-%'}`);
    const monthLeaves = await db.select().from(leaves)
      .where(and(sql`${leaves.startDate} LIKE ${month + '-%'}`, eq(leaves.status, 'approved')));
    return allUsers.map(u => {
      const profile = profileMap.get(u.id);
      const salary = parseFloat(profile?.monthlySalary ?? '0');
      const records = monthAttendance.filter(a => a.userId === u.id);
      const daysPresent = records.filter(a => a.status === 'present').length;
      const halfDays = records.filter(a => a.status === 'half-day').length;
      const approvedLeaves = monthLeaves.filter(l => l.userId === u.id).reduce((s, l) => s + l.totalDays, 0);
      const paidDays = daysPresent + (halfDays * 0.5) + approvedLeaves;
      const absentDays = Math.max(0, workingDays - paidDays);
      const dailyRate = workingDays > 0 ? salary / workingDays : 0;
      const deductions = absentDays * dailyRate;
      const overtimeHours = records.reduce((s, a) => s + parseFloat(a.overtimeHours ?? '0'), 0);
      const overtimePay = overtimeHours * (dailyRate / 8);
      const netSalary = salary - deductions + overtimePay;
      return {
        userId: u.id, username: u.username, role: u.role,
        monthlySalary: salary, workingDays, daysPresent, halfDays,
        approvedLeaves, absentDays: Math.round(absentDays * 10) / 10,
        deductions: Math.round(deductions * 100) / 100,
        overtimeHours: Math.round(overtimeHours * 10) / 10,
        overtimePay: Math.round(overtimePay * 100) / 100,
        netSalary: Math.round(netSalary * 100) / 100,
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
    const [sm] = await db.update(staffMembers).set(data).where(eq(staffMembers.id, id)).returning();
    return sm;
  }

  async deleteStaffMember(id: number): Promise<void> {
    await db.delete(staffMembers).where(eq(staffMembers.id, id));
  }
}

export const storage = new DatabaseStorage();
