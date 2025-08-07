CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"api_key" text,
	"webhook_url" text,
	"config" json
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_name" text NOT NULL,
	"current_stock" numeric(10, 2) NOT NULL,
	"min_stock" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"last_restocked" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kot_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"kot_number" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"printed_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"items" json,
	CONSTRAINT "kot_tickets_kot_number_unique" UNIQUE("kot_number")
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"category_id" integer NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"preparation_time" integer DEFAULT 15 NOT NULL,
	"ingredients" text[],
	"image" text
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"menu_item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"special_instructions" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"order_type" text NOT NULL,
	"table_number" text,
	"source" text DEFAULT 'pos' NOT NULL,
	"source_order_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"tax_amount" numeric(10, 2) NOT NULL,
	"discount_amount" numeric(10, 2) DEFAULT '0',
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"total_orders" integer NOT NULL,
	"total_revenue" numeric(10, 2) NOT NULL,
	"avg_order_value" numeric(10, 2) NOT NULL,
	"cash_sales" numeric(10, 2) NOT NULL,
	"card_sales" numeric(10, 2) NOT NULL,
	"online_sales" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
