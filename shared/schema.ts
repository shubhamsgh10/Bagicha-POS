import { pgTable, text, serial, integer, boolean, timestamp, decimal, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("staff"), // admin, manager, staff
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
});

export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  categoryId: integer("category_id").notNull(),
  isAvailable: boolean("is_available").notNull().default(true),
  preparationTime: integer("preparation_time").notNull().default(15), // minutes
  ingredients: text("ingredients").array(),
  image: text("image"),
  sizes: json("sizes").$type<Array<{ size: string; price: number }>>(),
});

export const inventory = pgTable("inventory", {
  id: serial("id").primaryKey(),
  itemName: text("item_name").notNull(),
  currentStock: decimal("current_stock", { precision: 10, scale: 2 }).notNull(),
  minStock: decimal("min_stock", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull(), // kg, pcs, liters
  lastRestocked: timestamp("last_restocked").defaultNow(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  orderType: text("order_type").notNull(), // dine-in, takeaway, delivery
  tableNumber: text("table_number"),
  source: text("source").notNull().default("pos"), // pos, zomato, swiggy
  sourceOrderId: text("source_order_id"),
  status: text("status").notNull().default("pending"), // pending, preparing, ready, served, delivered, cancelled
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0"),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending, paid, refunded
  paymentMethod: text("payment_method"), // cash, card, upi, online
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  menuItemId: integer("menu_item_id").notNull(),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  specialInstructions: text("special_instructions"),
  size: text("size"),
});

export const kotTickets = pgTable("kot_tickets", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  kotNumber: text("kot_number").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending, in-progress, completed
  printedAt: timestamp("printed_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  items: json("items").$type<Array<{
    name: string;
    quantity: number;
    instructions?: string;
  }>>(),
});

export const deliveryIntegrations = pgTable("delivery_integrations", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(), // zomato, swiggy, others
  isActive: boolean("is_active").notNull().default(true),
  apiKey: text("api_key"),
  webhookUrl: text("webhook_url"),
  config: json("config"),
});

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull().defaultNow(),
  totalOrders: integer("total_orders").notNull(),
  totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }).notNull(),
  avgOrderValue: decimal("avg_order_value", { precision: 10, scale: 2 }).notNull(),
  cashSales: decimal("cash_sales", { precision: 10, scale: 2 }).notNull(),
  cardSales: decimal("card_sales", { precision: 10, scale: 2 }).notNull(),
  onlineSales: decimal("online_sales", { precision: 10, scale: 2 }).notNull(),
});

// Relations
export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  category: one(categories, {
    fields: [menuItems.categoryId],
    references: [categories.id],
  }),
  orderItems: many(orderItems),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  menuItems: many(menuItems),
}));

export const ordersRelations = relations(orders, ({ many, one }) => ({
  items: many(orderItems),
  kotTicket: one(kotTickets, {
    fields: [orders.id],
    references: [kotTickets.orderId],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
}));

export const kotTicketsRelations = relations(kotTickets, ({ one }) => ({
  order: one(orders, {
    fields: [kotTickets.orderId],
    references: [orders.id],
  }),
}));

// Zod schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertMenuItemSchema = createInsertSchema(menuItems).omit({ id: true });
export const insertInventorySchema = createInsertSchema(inventory).omit({ id: true, lastRestocked: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertKotTicketSchema = createInsertSchema(kotTickets).omit({ id: true, printedAt: true, completedAt: true });
export const insertDeliveryIntegrationSchema = createInsertSchema(deliveryIntegrations).omit({ id: true });
export const insertSalesSchema = createInsertSchema(sales).omit({ id: true, date: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type MenuItem = typeof menuItems.$inferSelect;
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type Inventory = typeof inventory.$inferSelect;
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type KotTicket = typeof kotTickets.$inferSelect;
export type InsertKotTicket = z.infer<typeof insertKotTicketSchema>;
export type DeliveryIntegration = typeof deliveryIntegrations.$inferSelect;
export type InsertDeliveryIntegration = z.infer<typeof insertDeliveryIntegrationSchema>;
export type Sales = typeof sales.$inferSelect;
export type InsertSales = z.infer<typeof insertSalesSchema>;
