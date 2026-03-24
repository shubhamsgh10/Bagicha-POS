import {
  users, categories, menuItems, inventory, orders, orderItems, kotTickets, deliveryIntegrations, sales, tables,
  type User, type InsertUser, type Category, type InsertCategory, type MenuItem, type InsertMenuItem,
  type Inventory, type InsertInventory, type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
  type KotTicket, type InsertKotTicket, type DeliveryIntegration, type InsertDeliveryIntegration,
  type Sales, type InsertSales, type Table, type InsertTable
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

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

  // Menu Items
  getMenuItems(): Promise<MenuItem[]>;
  getMenuItemsByCategory(categoryId: number): Promise<MenuItem[]>;
  createMenuItem(item: InsertMenuItem): Promise<MenuItem>;
  updateMenuItem(id: number, item: Partial<InsertMenuItem>): Promise<MenuItem>;
  deleteMenuItem(id: number): Promise<void>;

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
  getSalesChart(): Promise<Array<{ date: string; total: number }>>;
  getCategorySales(): Promise<Array<{ category: string; total: number }>>;
  getDashboardTopItems(limit?: number): Promise<Array<{ name: string; qty: number }>>;

  // Reports
  getTopSellingItems(limit?: number): Promise<Array<{ name: string; totalSold: number; revenue: number }>>;
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
    return await db.select().from(categories).where(eq(categories.isActive, true));
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    const [newCategory] = await db.insert(categories).values(category).returning();
    return newCategory;
  }

  async updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category> {
    const [updated] = await db.update(categories).set(category).where(eq(categories.id, id)).returning();
    return updated;
  }

  async deleteCategory(id: number): Promise<void> {
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, id));
  }

  // Menu Items
  async getMenuItems(): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(eq(menuItems.isAvailable, true));
  }

  async getMenuItemsByCategory(categoryId: number): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(
      and(eq(menuItems.categoryId, categoryId), eq(menuItems.isAvailable, true))
    );
  }

  async createMenuItem(item: InsertMenuItem): Promise<MenuItem> {
    const [newItem] = await db.insert(menuItems).values(item).returning();
    return newItem;
  }

  async updateMenuItem(id: number, item: Partial<InsertMenuItem>): Promise<MenuItem> {
    const [updated] = await db.update(menuItems).set(item).where(eq(menuItems.id, id)).returning();
    return updated;
  }

  async deleteMenuItem(id: number): Promise<void> {
    await db.update(menuItems).set({ isAvailable: false }).where(eq(menuItems.id, id));
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
      ...order,
      updatedAt: new Date()
    }).returning();
    return newOrder;
  }

  async updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order> {
    const [updated] = await db.update(orders).set({
      ...order,
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
      items = Array.from(items);
    }
    const fixedTicket = {
      ...ticket,
      items: Array.isArray(items) ? items : undefined,
    };
    const [newTicket] = await db.insert(kotTickets).values(fixedTicket).returning();
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
  async getTables(): Promise<(Table & { runningTotal?: number })[]> {
    const rows = await db
      .select({
        id: tables.id,
        name: tables.name,
        capacity: tables.capacity,
        status: tables.status,
        currentOrderId: tables.currentOrderId,
        section: tables.section,
        runningTotal: orders.totalAmount,
      })
      .from(tables)
      .leftJoin(orders, eq(tables.currentOrderId, orders.id))
      .orderBy(tables.name);
    return rows.map(r => ({
      ...r,
      runningTotal: r.runningTotal != null ? Number(r.runningTotal) : undefined,
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
  async getSalesChart(): Promise<Array<{ date: string; total: number }>> {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const allOrders = await db.select({
      createdAt: orders.createdAt,
      totalAmount: orders.totalAmount,
    }).from(orders).where(
      and(gte(orders.createdAt, start), lte(orders.createdAt, end))
    );

    const days: Array<{ date: string; dateKey: string; total: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({
        date: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
        dateKey: d.toISOString().slice(0, 10),
        total: 0,
      });
    }

    for (const order of allOrders) {
      const dateKey = new Date(order.createdAt!).toISOString().slice(0, 10);
      const day = days.find(d => d.dateKey === dateKey);
      if (day) day.total += parseFloat(order.totalAmount);
    }

    return days.map(({ date, total }) => ({ date, total }));
  }

  async getCategorySales(): Promise<Array<{ category: string; total: number }>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await db
      .select({
        category: categories.name,
        total: sql<number>`cast(sum(cast(${orderItems.quantity} as numeric) * cast(${orderItems.price} as numeric)) as numeric)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .innerJoin(categories, eq(menuItems.categoryId, categories.id))
      .where(and(gte(orders.createdAt, today), lte(orders.createdAt, tomorrow)))
      .groupBy(categories.id, categories.name)
      .orderBy(sql`sum(cast(${orderItems.quantity} as numeric) * cast(${orderItems.price} as numeric)) desc`);

    return result.map(r => ({ category: r.category, total: Number(r.total) }));
  }

  async getDashboardTopItems(limit: number = 8): Promise<Array<{ name: string; qty: number }>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await db
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
      .limit(limit);

    return result.map(r => ({ name: r.name, qty: Number(r.qty) }));
  }

  async getTopSellingItems(limit: number = 10): Promise<Array<{ name: string; totalSold: number; revenue: number }>> {
    const result = await db
      .select({
        name: menuItems.name,
        totalSold: sql<number>`cast(sum(${orderItems.quantity}) as int)`,
        revenue: sql<number>`cast(sum(cast(${orderItems.quantity} as numeric) * ${orderItems.price}) as numeric)`,
      })
      .from(orderItems)
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .groupBy(menuItems.id, menuItems.name)
      .orderBy(sql`sum(${orderItems.quantity}) desc`)
      .limit(limit);

    return result.map(r => ({
      name: r.name,
      totalSold: Number(r.totalSold),
      revenue: Number(r.revenue),
    }));
  }
}

export const storage = new DatabaseStorage();
