CREATE TABLE "automation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"rule_id" integer,
	"trigger_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"scheduled_at" timestamp DEFAULT now() NOT NULL,
	"executed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"conditions" json,
	"actions" json,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"coupon_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"customer_id" uuid,
	"customer_key" text,
	"discount_applied" numeric(10, 2) NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"description" text,
	"min_order_amount" numeric(10, 2) DEFAULT '0',
	"max_discount" numeric(10, 2),
	"usage_limit" integer DEFAULT 1 NOT NULL,
	"per_customer_limit" integer DEFAULT 1 NOT NULL,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"valid_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"customer_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "customer_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"email" text,
	"dob" text,
	"anniversary" text,
	"locality" text,
	"gst_no" text,
	"address" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"tags" text[],
	"remark" text,
	"notification_enabled" boolean DEFAULT true NOT NULL,
	"do_not_send_update" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_customer_id_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
CREATE TABLE "customer_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"segment" text DEFAULT 'New' NOT NULL,
	"rfm_score" integer DEFAULT 0 NOT NULL,
	"recency_score" integer DEFAULT 0 NOT NULL,
	"frequency_score" integer DEFAULT 0 NOT NULL,
	"monetary_score" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_segments_customer_id_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
CREATE TABLE "customers_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"phone" text,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customers_master_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "daily_digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_date" text NOT NULL,
	"summary" text NOT NULL,
	"metrics" json NOT NULL,
	"sent_at" timestamp,
	"sent_to" text,
	"status" text DEFAULT 'generated' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_digests_digest_date_unique" UNIQUE("digest_date")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"customer_id" uuid,
	"customer_key" text,
	"customer_name" text,
	"customer_phone" text,
	"token" text NOT NULL,
	"rating" integer,
	"nps_score" integer,
	"comment" text,
	"sentiment" text,
	"recovery_status" text DEFAULT 'none',
	"recovery_coupon_id" integer,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"sent_at" timestamp,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "loyalty_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_key" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"order_id" integer,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"gateway" text DEFAULT 'razorpay' NOT NULL,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"gateway_signature" text,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"error_code" text,
	"error_description" text,
	"raw" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"status" text DEFAULT 'free' NOT NULL,
	"current_order_id" integer,
	"section" text DEFAULT 'inner' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "sizes" json;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "addons_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "addons" json;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "variants" json;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "notes_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "short_code" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "inventory_links" json;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "table_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "kot_print_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bill_print_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_kot_snapshot" json;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin" text;