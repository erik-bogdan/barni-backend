CREATE TYPE "public"."story_status" AS ENUM('queued', 'generating_text', 'extracting_meta', 'generating_cover', 'uploading_cover', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"child_id" uuid NOT NULL,
	"status" "story_status" DEFAULT 'queued' NOT NULL,
	"title" text,
	"summary" text,
	"text" text,
	"setting" text,
	"conflict" text,
	"tone" text,
	"theme" text NOT NULL,
	"mood" text NOT NULL,
	"length" text NOT NULL,
	"lesson" text,
	"preview_url" text,
	"with_audio" boolean DEFAULT false,
	"credit_cost" integer NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "story_credit_transactions" ADD COLUMN "story_id" uuid;--> statement-breakpoint
ALTER TABLE "story_credit_transactions" ADD COLUMN "type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_credit_transactions" ADD CONSTRAINT "story_credit_transactions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;