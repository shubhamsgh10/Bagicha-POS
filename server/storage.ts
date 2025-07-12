import { 
  users, categories, menuItems, inventory, orders, orderItems, kotTickets, deliveryIntegrations, sales,
  type User, type InsertUser, type Category, type InsertCategory, type MenuItem, type InsertMenuItem,
  type Inventory, type InsertInventory, type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
  type KotTicket, type InsertKotTicket, type DeliveryIntegration, type InsertDeliveryIntegration,
  type Sales, type InsertSales
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

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

  // KOT Tickets
  getKotTickets(): Promise<KotTicket[]>;
  getKotTicketsByStatus(status: string): Promise<KotTicket[]>;
  createKotTicket(ticket: InsertKotTicket): Promise<KotTicket>;
  updateKotTicket(id: number, ticket: Partial<InsertKotTicket>): Promise<KotTicket>;

  // Delivery Integrations
  getDeliveryIntegrations(): Promise<DeliveryIntegration[]>;
  createDeliveryIntegration(integration: InsertDeliveryIntegration): Promise<DeliveryIntegration>;
  updateDeliveryIntegration(id: number, integration: Partial<InsertDeliveryIntegration>): Promise<DeliveryIntegration>;

  // Sales
  getSales(): Promise<Sales[]>;
  getSalesByDate(date: Date): Promise<Sales | undefined>;
  createSales(sales: InsertSales): Promise<Sales>;
  updateSales(id: number, sales: Partial<InsertSales>): Promise<Sales>;

  // Dashboard Stats
  getDashboardStats(): Promise<{
    todaySales: number;
    todayOrders: number;
    avgOrderValue: number;
    lowStockCount: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
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

  // KOT Tickets
  async getKotTickets(): Promise<KotTicket[]> {
    return await db.select().from(kotTickets).orderBy(desc(kotTickets.printedAt));
  }

  async getKotTicketsByStatus(status: string): Promise<KotTicket[]> {
    return await db.select().from(kotTickets).where(eq(kotTickets.status, status)).orderBy(desc(kotTickets.printedAt));
  }

  async createKotTicket(ticket: InsertKotTicket): Promise<KotTicket> {
    const [newTicket] = await db.insert(kotTickets).values(ticket).returning();
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

  // Dashboard Stats
  async getDashboardStats(): Promise<{
    todaySales: number;
    todayOrders: number;
    avgOrderValue: number;
    lowStockCount: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todayOrdersResult] = await db.select({
      count: sql<number>`count(*)`,
      total: sql<number>`sum(${orders.totalAmount})`
    }).from(orders).where(
      and(
        gte(orders.createdAt, today),
        lte(orders.createdAt, tomorrow),
        eq(orders.status, 'served')
      )
    );

    const [lowStockResult] = await db.select({
      count: sql<number>`count(*)`
    }).from(inventory).where(
      sql`${inventory.currentStock} <= ${inventory.minStock}`
    );

    const todayOrders = todayOrdersResult?.count || 0;
    const todaySales = todayOrdersResult?.total || 0;
    const avgOrderValue = todayOrders > 0 ? todaySales / todayOrders : 0;
    const lowStockCount = lowStockResult?.count || 0;

    return {
      todaySales,
      todayOrders,
      avgOrderValue,
      lowStockCount,
    };
  }
}

export const storage = new DatabaseStorage();
