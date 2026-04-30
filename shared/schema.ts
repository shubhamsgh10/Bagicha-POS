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
  createdBy: integer("created_by"),  // staff user id who created the order
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
  FEEDBACK_RECEIVED: "FEEDBACK_RECEIVED",
  POINTS_EARNED:    "POINTS_EARNED",
  POINTS_REDEEMED:  "POINTS_REDEEMED",
} as const;

export type CrmEventType = typeof CRM_EVENT_TYPES[keyof typeof CRM_EVENT_TYPES];

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1 GROWTH TABLES — Coupons, Loyalty, Feedback, Payments, Daily Digest
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * coupons — Generic coupon codes for discounts.
 * Coupons can be:
 *   - Manually issued (admin creates one for promo)
 *   - Auto-issued by automation (birthday, win-back, NPS recovery)
 */
export const coupons = pgTable("coupons", {
  id:           serial("id").primaryKey(),
  code:         text("code").notNull().unique(),
  type:         text("type").notNull(),                                // percent | flat | item
  value:        decimal("value", { precision: 10, scale: 2 }).notNull(),
  description:  text("description"),
  minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0"),
  maxDiscount:  decimal("max_discount", { precision: 10, scale: 2 }),
  usageLimit:   integer("usage_limit").default(1).notNull(),           // total redemptions allowed
  perCustomerLimit: integer("per_customer_limit").default(1).notNull(),
  validFrom:    timestamp("valid_from").notNull().defaultNow(),
  validUntil:   timestamp("valid_until"),
  isActive:     boolean("is_active").notNull().default(true),
  customerId:   uuid("customer_id"),                                   // null = public, else customer-bound
  source:       text("source").notNull().default("manual"),            // manual | birthday | nps | win_back | welcome | referral
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

/**
 * coupon_redemptions — Audit trail of every coupon use.
 */
export const couponRedemptions = pgTable("coupon_redemptions", {
  id:             serial("id").primaryKey(),
  couponId:       integer("coupon_id").notNull(),
  orderId:        integer("order_id").notNull(),
  customerId:     uuid("customer_id"),
  customerKey:    text("customer_key"),                                // phone||name fallback
  discountApplied: decimal("discount_applied", { precision: 10, scale: 2 }).notNull(),
  redeemedAt:     timestamp("redeemed_at").notNull().defaultNow(),
});

/**
 * loyalty_points — Server-backed loyalty point ledger.
 * Replaces localStorage redemptions with a persistent, per-customer ledger.
 * Each row is a transaction (positive = earned, negative = redeemed).
 */
export const loyaltyPoints = pgTable("loyalty_points", {
  id:           serial("id").primaryKey(),
  customerId:   uuid("customer_id").notNull(),
  customerKey:  text("customer_key").notNull(),                        // dedup fallback
  points:       integer("points").notNull(),                           // signed: + earned, - redeemed
  reason:       text("reason").notNull(),                              // earn_order | redeem_order | manual | expired
  orderId:      integer("order_id"),
  metadata:     json("metadata").$type<Record<string, unknown>>(),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

/**
 * feedback — Post-order NPS / rating collection.
 */
export const feedback = pgTable("feedback", {
  id:           serial("id").primaryKey(),
  orderId:      integer("order_id").notNull(),
  customerId:   uuid("customer_id"),
  customerKey:  text("customer_key"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  token:        text("token").notNull().unique(),                      // public secret for the rating link
  rating:       integer("rating"),                                     // 1..5 (null = not yet submitted)
  npsScore:     integer("nps_score"),                                  // 0..10 (optional)
  comment:      text("comment"),
  sentiment:    text("sentiment"),                                     // positive | neutral | negative (auto)
  recoveryStatus: text("recovery_status").default("none"),             // none | pending | resolved
  recoveryCouponId: integer("recovery_coupon_id"),
  channel:      text("channel").notNull().default("whatsapp"),
  sentAt:       timestamp("sent_at"),
  submittedAt:  timestamp("submitted_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

/**
 * payment_transactions — Razorpay (and other gateway) transaction ledger.
 * One order can have multiple transactions (e.g., a failed attempt + a success).
 */
export const paymentTransactions = pgTable("payment_transactions", {
  id:               serial("id").primaryKey(),
  orderId:          integer("order_id").notNull(),
  gateway:          text("gateway").notNull().default("razorpay"),     // razorpay | cash | card | upi_manual
  gatewayOrderId:   text("gateway_order_id"),                          // Razorpay order_id
  gatewayPaymentId: text("gateway_payment_id"),                        // Razorpay payment_id
  gatewaySignature: text("gateway_signature"),
  amount:           decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency:         text("currency").notNull().default("INR"),
  status:           text("status").notNull().default("pending"),       // pending | success | failed | refunded
  method:           text("method"),                                    // upi | card | netbanking | wallet
  errorCode:        text("error_code"),
  errorDescription: text("error_description"),
  raw:              json("raw").$type<Record<string, unknown>>(),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  completedAt:      timestamp("completed_at"),
});

/**
 * daily_digests — Owner end-of-day AI summaries (history log).
 */
export const dailyDigests = pgTable("daily_digests", {
  id:           serial("id").primaryKey(),
  digestDate:   text("digest_date").notNull().unique(),                // YYYY-MM-DD
  summary:      text("summary").notNull(),
  metrics:      json("metrics").$type<Record<string, unknown>>().notNull(),
  sentAt:       timestamp("sent_at"),
  sentTo:       text("sent_to"),
  status:       text("status").notNull().default("generated"),         // generated | sent | failed
  error:        text("error"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

// ── Relations for new tables ──────────────────────────────────────────────────

export const couponsRelations = relations(coupons, ({ many }) => ({
  redemptions: many(couponRedemptions),
}));

export const couponRedemptionsRelations = relations(couponRedemptions, ({ one }) => ({
  coupon: one(coupons,    { fields: [couponRedemptions.couponId], references: [coupons.id] }),
  order:  one(orders,     { fields: [couponRedemptions.orderId],  references: [orders.id] }),
}));

export const feedbackRelations = relations(feedback, ({ one }) => ({
  order:           one(orders,  { fields: [feedback.orderId],          references: [orders.id] }),
  recoveryCoupon:  one(coupons, { fields: [feedback.recoveryCouponId], references: [coupons.id] }),
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({ one }) => ({
  order: one(orders, { fields: [paymentTransactions.orderId], references: [orders.id] }),
}));

// ── Insert schemas + types ────────────────────────────────────────────────────

export const insertCouponSchema             = createInsertSchema(coupons).omit({ id: true, createdAt: true });
export const insertCouponRedemptionSchema   = createInsertSchema(couponRedemptions).omit({ id: true, redeemedAt: true });
export const insertLoyaltyPointSchema       = createInsertSchema(loyaltyPoints).omit({ id: true, createdAt: true });
export const insertFeedbackSchema           = createInsertSchema(feedback).omit({ id: true, createdAt: true });
export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({ id: true, createdAt: true });
export const insertDailyDigestSchema        = createInsertSchema(dailyDigests).omit({ id: true, createdAt: true });

export type Coupon             = typeof coupons.$inferSelect;
export type InsertCoupon       = z.infer<typeof insertCouponSchema>;
export type CouponRedemption   = typeof couponRedemptions.$inferSelect;
export type InsertCouponRedemption = z.infer<typeof insertCouponRedemptionSchema>;
export type LoyaltyPoint       = typeof loyaltyPoints.$inferSelect;
export type InsertLoyaltyPoint = z.infer<typeof insertLoyaltyPointSchema>;
export type Feedback           = typeof feedback.$inferSelect;
export type InsertFeedback     = z.infer<typeof insertFeedbackSchema>;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;
export type DailyDigest        = typeof dailyDigests.$inferSelect;
export type InsertDailyDigest  = z.infer<typeof insertDailyDigestSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// STAFF MANAGEMENT — Attendance + Performance
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * attendance_records — imported from Google Sheets (biometric export).
 * Each row = one punch-in/punch-out pair for a staff member on a date.
 */
export const attendanceRecords = pgTable("attendance_records", {
  id:           serial("id").primaryKey(),
  employeeName: text("employee_name").notNull(),
  employeeCode: text("employee_code"),
  date:         text("date").notNull(),             // YYYY-MM-DD
  punchIn:      text("punch_in"),                   // HH:MM or HH:MM:SS
  punchOut:     text("punch_out"),
  hoursWorked:  decimal("hours_worked", { precision: 5, scale: 2 }),
  status:       text("status").notNull().default("present"), // present | absent | half-day | late
  source:       text("source").notNull().default("gsheet"),  // gsheet | manual
  rawRow:       json("raw_row").$type<Record<string, string>>(),
  syncedAt:     timestamp("synced_at").notNull().defaultNow(),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

/**
 * attendance_sync_log — tracks each Google Sheets sync run.
 */
export const attendanceSyncLog = pgTable("attendance_sync_log", {
  id:         serial("id").primaryKey(),
  syncedAt:   timestamp("synced_at").notNull().defaultNow(),
  rowsFetched: integer("rows_fetched").notNull().default(0),
  rowsInserted: integer("rows_inserted").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  status:     text("status").notNull().default("success"),  // success | failed | partial
  error:      text("error"),
  sheetUrl:   text("sheet_url"),
});

// ── Insert schemas + types ────────────────────────────────────────────────────

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true, createdAt: true, syncedAt: true });
export const insertAttendanceSyncLogSchema = createInsertSchema(attendanceSyncLog).omit({ id: true, syncedAt: true });

export type AttendanceRecord       = typeof attendanceRecords.$inferSelect;
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceSyncLog      = typeof attendanceSyncLog.$inferSelect;

// ── Staff Members (separate from system users — for the staff selector login) ─
export const staffMembers = pgTable("staff_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  pin: text("pin"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStaffMemberSchema = createInsertSchema(staffMembers).omit({ id: true, createdAt: true });
export type StaffMember       = typeof staffMembers.$inferSelect;
export type InsertStaffMember = z.infer<typeof insertStaffMemberSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG — Immutable append-only trail for all sensitive actions
// ═══════════════════════════════════════════════════════════════════════════════

export const auditLogs = pgTable("audit_logs", {
  id:         serial("id").primaryKey(),
  actorId:    text("actor_id").notNull(),        // user id or "system"
  actorName:  text("actor_name").notNull(),
  actorRole:  text("actor_role").notNull(),
  action:     text("action").notNull(),           // e.g. "order.payment"
  entityType: text("entity_type").notNull(),      // "order" | "user" | "coupon" | "settings"
  entityId:   text("entity_id"),
  metadata:   json("metadata").$type<Record<string, unknown>>(),
  ip:         text("ip"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type AuditLog       = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
