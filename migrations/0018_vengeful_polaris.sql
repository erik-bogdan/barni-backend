CREATE TABLE "barion_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barion_customers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "barion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barion_event_id" text NOT NULL,
	"payment_id" text,
	"type" text NOT NULL,
	"created" timestamp with time zone NOT NULL,
	"livemode" boolean NOT NULL,
	"payload_json" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barion_events_barion_event_id_unique" UNIQUE("barion_event_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "barion_payment_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "barion_payment_request_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "barion_customer_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "barion_payment_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "barion_transaction_id" text;--> statement-breakpoint
ALTER TABLE "barion_customers" ADD CONSTRAINT "barion_customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_barion_payment_id_unique" UNIQUE("barion_payment_id");