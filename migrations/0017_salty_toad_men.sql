CREATE TABLE "audio_star_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"story_id" uuid,
	"order_id" uuid,
	"type" text DEFAULT 'manual' NOT NULL,
	"amount" integer NOT NULL,
	"reason" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricing_plans" ADD COLUMN "bonus_audio_stars" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_plans" ADD COLUMN "bonus_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_star_transactions" ADD CONSTRAINT "audio_star_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_star_transactions" ADD CONSTRAINT "audio_star_transactions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;