import { pgTable, text, serial, integer, boolean, timestamp, decimal, json, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("staff"),
  pin: text("pin"), // 4-6 digit PIN for manager authorization
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
});

export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  categoryId: integer("category_id").notNull(),
  isAvailable: boolean("is_available").notNull().default(true),
  preparationTime: integer("preparation_time").notNull().default(15),
  ingredients: text("ingredients").array(),
  image: text("image"),
  sizes: json("sizes").$type<Array<{ size: string; price: number }>>(),
  addonsEnabled: boolean("addons_enabled").notNull().default(false),
  addons: json("addons").$type<Array<{ name: string; price: number }>>(),
  variants: json("variants").$type<Array<{ group: string; options: Array<{ name: string; price?: number }>; required?: boolean }>>(),
  notesAllowed: boolean("notes_allowed").notNull().default(true),
  shortCode: text("short_code"),
  inventoryLinks: json("inventory_links").$type<Array<{ inventoryId: number; quantity: number }>>(),
});

export const inventory = pgTable("inventory", {
  id: serial("id").primaryKey(),
  itemName: text("item_name").notNull(),
  currentStock: decimal("current_stock", { precision: 10, scale: 2 }).notNull(),
  minStock: decimal("min_stock", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  lastRestocked: timestamp("last_restocked").defaultNow(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  orderType: text("order_type").notNull(),
  tableNumber: text("table_number"),
  tableId: integer("table_id"),
  source: text("source").notNull().default("pos"),
  sourceOrderId: text("source_order_id"),
  status: text("status").notNull().default("pending"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull(),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  kotPrintCount: integer("kot_print_count").default(0).notNull(),
  billPrintCount: integer("bill_print_count").default(0).notNull(),
  lastKotSnapshot: json("last_kot_snapshot").$type<{
    items: Array<{ itemId: number; name: string; quantity: number; size: string | null }>;
    printedAt: string;
  } | null>(),
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
  status: text("status").notNull().default("pending"),
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
  platform: text("platform").notNull(),
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

export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull().default(4),
  status: text("status").notNull().default("free"), // free | running | billed
  currentOrderId: integer("current_order_id"),
  section: text("section").notNull().default("inner"), // inner | outer | vip | terrace | hall | ...
});

// Relations
export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  category: one(categories, { fields: [menuItems.categoryId], references: [categories.id] }),
  orderItems: many(orderItems),
}));
export const categoriesRelations = relations(categories, ({ many }) => ({
  menuItems: many(menuItems),
}));
export const ordersRelations = relations(orders, ({ many, one }) => ({
  items: many(orderItems),
  kotTicket: one(kotTickets, { fields: [orders.id], references: [kotTickets.orderId] }),
}));
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  menuItem: one(menuItems, { fields: [orderItems.menuItemId], references: [menuItems.id] }),
}));
export const kotTicketsRelations = relations(kotTickets, ({ one }) => ({
  order: one(orders, { fields: [kotTickets.orderId], references: [orders.id] }),
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
export const insertTableSchema = createInsertSchema(tables).omit({ id: true });

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
export type Table = typeof tables.$inferSelect;
export type InsertTable = z.infer<typeof insertTableSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// CRM EXTENSION TABLES (Phase 1 — additive, backward-compatible)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * customers_master — stable UUID identity for every customer.
 * key = customer.key from the client (phone || name) — the bridge between
 * the existing string-keyed system and the new UUID world.
 */
export const customersMaster = pgTable("customers_master", {
  id:        uuid("id").primaryKey().defaultRandom(),
  key:       text("key").notNull().unique(),   // phone || name — matches CustomerProfile.key
  phone:     text("phone"),
  name:      text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * customer_profiles — extended CRM profile.
 * Mirrors the CustomerExtra interface stored in localStorage so both
 * sources can be merged (DB takes priority).
 */
export const customerProfiles = pgTable("customer_profiles", {
  id:                  serial("id").primaryKey(),
  customerId:          uuid("customer_id").notNull().unique(),
  email:               text("email"),
  dob:                 text("dob"),
  anniversary:         text("anniversary"),
  locality:            text("locality"),
  gstNo:               text("gst_no"),
  address:             text("address"),
  isFavorite:          boolean("is_favorite").notNull().default(false),
  tags:                text("tags").array(),
  remark:              text("remark"),
  notificationEnabled: boolean("notification_enabled").notNull().default(true),
  doNotSendUpdate:     boolean("do_not_send_update").notNull().default(false),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});

/**
 * customer_events — append-only event log.
 * Records every meaningful customer action for the CRM timeline.
 */
export const customerEvents = pgTable("customer_events", {
  id:         serial("id").primaryKey(),
  customerId: uuid("customer_id").notNull(),
  eventType:  text("event_type").notNull(), // ORDER_PLACED | VISIT | INACTIVE | MESSAGE_SENT | COUPON_USED | MILESTONE
  metadata:   json("metadata").$type<Record<string, unknown>>(),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

/**
 * customer_segments — RFM-scored segment per customer.
 * Recomputed after every order and by the hourly cron job.
 */
export const customerSegments = pgTable("customer_segments", {
  id:             serial("id").primaryKey(),
  customerId:     uuid("customer_id").notNull().unique(),
  segment:        text("segment").notNull().default("New"), // VIP | Regular | New | At Risk | Lapsed
  rfmScore:       integer("rfm_score").notNull().default(0),
  recencyScore:   integer("recency_score").notNull().default(0),
  frequencyScore: integer("frequency_score").notNull().default(0),
  monetaryScore:  integer("monetary_score").notNull().default(0),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

/**
 * automation_rules — admin-configurable trigger rules stored in DB.
 */
export const automationRules = pgTable("automation_rules", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  triggerType: text("trigger_type").notNull(), // INACTIVITY | BIRTHDAY | MILESTONE | HIGH_SPEND
  conditions:  json("conditions").$type<Record<string, unknown>>(),
  actions:     json("actions").$type<Record<string, unknown>>(),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

/**
 * automation_jobs — job queue tracking pending / executed sends.
 */
export const automationJobs = pgTable("automation_jobs", {
  id:          serial("id").primaryKey(),
  customerId:  uuid("customer_id").notNull(),
  ruleId:      integer("rule_id"),               // nullable — manual sends have no rule
  triggerType: text("trigger_type").notNull(),
  status:      text("status").notNull().default("pending"), // pending | sent | failed | skipped
  message:     text("message"),
  scheduledAt: timestamp("scheduled_at").notNull().defaultNow(),
  executedAt:  timestamp("executed_at"),
  error:       text("error"),
});

/**
 * customer_messages — omnichannel message log (WhatsApp / email / SMS).
 */
export const customerMessages = pgTable("customer_messages", {
  id:         serial("id").primaryKey(),
  customerId: uuid("customer_id").notNull(),
  channel:    text("channel").notNull().default("whatsapp"), // whatsapp | email | sms
  message:    text("message").notNull(),
  status:     text("status").notNull().default("pending"),   // pending | sent | failed | delivered
  trigger:    text("trigger"),
  sentAt:     timestamp("sent_at"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

// ── CRM Relations ─────────────────────────────────────────────────────────────

export const customersMasterRelations = relations(customersMaster, ({ one, many }) => ({
  profile:   one(customerProfiles, { fields: [customersMaster.id], references: [customerProfiles.customerId] }),
  segment:   one(customerSegments, { fields: [customersMaster.id], references: [customerSegments.customerId] }),
  events:    many(customerEvents),
  jobs:      many(automationJobs),
  messages:  many(customerMessages),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ one }) => ({
  customer: one(customersMaster, { fields: [customerProfiles.customerId], references: [customersMaster.id] }),
}));

export const customerSegmentsRelations = relations(customerSegments, ({ one }) => ({
  customer: one(customersMaster, { fields: [customerSegments.customerId], references: [customersMaster.id] }),
}));

export const customerEventsRelations = relations(customerEvents, ({ one }) => ({
  customer: one(customersMaster, { fields: [customerEvents.customerId], references: [customersMaster.id] }),
}));

export const automationJobsRelations = relations(automationJobs, ({ one }) => ({
  customer: one(customersMaster, { fields: [automationJobs.customerId], references: [customersMaster.id] }),
  rule:     one(automationRules, { fields: [automationJobs.ruleId],    references: [automationRules.id] }),
}));

export const customerMessagesRelations = relations(customerMessages, ({ one }) => ({
  customer: one(customersMaster, { fields: [customerMessages.customerId], references: [customersMaster.id] }),
}));

// ── CRM Insert Schemas ────────────────────────────────────────────────────────

export const insertCustomerMasterSchema  = createInsertSchema(customersMaster).omit({ id: true, createdAt: true });
export const insertCustomerProfileSchema = createInsertSchema(customerProfiles).omit({ id: true, updatedAt: true });
export const insertCustomerEventSchema   = createInsertSchema(customerEvents).omit({ id: true, createdAt: true });
export const insertCustomerSegmentSchema = createInsertSchema(customerSegments).omit({ id: true, updatedAt: true });
export const insertAutomationRuleSchema  = createInsertSchema(automationRules).omit({ id: true, createdAt: true });
export const insertAutomationJobSchema   = createInsertSchema(automationJobs).omit({ id: true });
export const insertCustomerMessageSchema = createInsertSchema(customerMessages).omit({ id: true, createdAt: true });

// ── CRM Types ─────────────────────────────────────────────────────────────────

export type CustomerMaster       = typeof customersMaster.$inferSelect;
export type InsertCustomerMaster = z.infer<typeof insertCustomerMasterSchema>;
export type CustomerProfile_DB   = typeof customerProfiles.$inferSelect;
export type InsertCustomerProfile_DB = z.infer<typeof insertCustomerProfileSchema>;
export type CustomerEvent        = typeof customerEvents.$inferSelect;
export type InsertCustomerEvent  = z.infer<typeof insertCustomerEventSchema>;
export type CustomerSegment      = typeof customerSegments.$inferSelect;
export type InsertCustomerSegment = z.infer<typeof insertCustomerSegmentSchema>;
export type AutomationRule       = typeof automationRules.$inferSelect;
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationJob        = typeof automationJobs.$inferSelect;
export type InsertAutomationJob  = z.infer<typeof insertAutomationJobSchema>;
export type CustomerMessage      = typeof customerMessages.$inferSelect;
export type InsertCustomerMessage = z.infer<typeof insertCustomerMessageSchema>;

// ── CRM Event type constants ──────────────────────────────────────────────────

export const CRM_EVENT_TYPES = {
  ORDER_PLACED:   "ORDER_PLACED",
  VISIT:          "VISIT",
  INACTIVE:       "INACTIVE",
  MESSAGE_SENT:   "MESSAGE_SENT",
  COUPON_USED:    "COUPON_USED",
  MILESTONE:      "MILESTONE",
  PROFILE_UPDATE: "PROFILE_UPDATE",
} as const;

export type CrmEventType = typeof CRM_EVENT_TYPES[keyof typeof CRM_EVENT_TYPES];

// =============================================================================
// STAFF MANAGEMENT TABLES
// =============================================================================

export const staffProfiles = pgTable("staff_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  biometricId: text("biometric_id"),
  department: text("department"),
  designation: text("designation"),
  monthlySalary: decimal("monthly_salary", { precision: 10, scale: 2 }).notNull().default("0"),
  joiningDate: text("joining_date"),
  emergencyContact: text("emergency_contact"),
  address: text("address"),
  bankAccountNo: text("bank_account_no"),
  bankName: text("bank_name"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: text("date").notNull(),        // "YYYY-MM-DD"
  clockIn: text("clock_in"),           // "HH:MM" or "HH:MM AM/PM"
  clockOut: text("clock_out"),         // "HH:MM" or "HH:MM AM/PM"
  status: text("status").notNull().default("present"), // present|absent|half-day|on-leave|holiday
  workingHours: decimal("working_hours", { precision: 4, scale: 2 }),
  overtimeHours: decimal("overtime_hours", { precision: 4, scale: 2 }).default("0"),
  notes: text("notes"),
  markedBy: integer("marked_by"),      // null = biometric import; userId = admin override
  importedAt: timestamp("imported_at").defaultNow(),
});

export const leaves = pgTable("leaves", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  leaveType: text("leave_type").notNull().default("casual"), // sick|casual|earned|unpaid
  startDate: text("start_date").notNull(),  // "YYYY-MM-DD"
  endDate: text("end_date").notNull(),      // "YYYY-MM-DD"
  totalDays: integer("total_days").notNull().default(1),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending|approved|rejected
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),  // "HH:MM"
  endTime: text("end_time").notNull(),      // "HH:MM"
  durationHours: decimal("duration_hours", { precision: 4, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
});

export const shiftAssignments = pgTable("shift_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  shiftId: integer("shift_id").notNull(),
  date: text("date").notNull(),  // "YYYY-MM-DD"
  createdBy: integer("created_by").notNull(),
});

// -- Staff Insert Schemas
export const insertStaffProfileSchema = createInsertSchema(staffProfiles).omit({ id: true, updatedAt: true });
export const insertAttendanceSchema = createInsertSchema(attendance).omit({ id: true, importedAt: true });
export const insertLeaveSchema = createInsertSchema(leaves).omit({ id: true, createdAt: true });
export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export const insertShiftAssignmentSchema = createInsertSchema(shiftAssignments).omit({ id: true });

// -- Staff Types
export type StaffProfile = typeof staffProfiles.$inferSelect;
export type InsertStaffProfile = z.infer<typeof insertStaffProfileSchema>;
export type Attendance = typeof attendance.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Leave = typeof leaves.$inferSelect;
export type InsertLeave = z.infer<typeof insertLeaveSchema>;
export type Shift = typeof shifts.$inferSelect;
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type InsertShiftAssignment = z.infer<typeof insertShiftAssignmentSchema>;
