ALTER TABLE "stories" ADD COLUMN "is_interactive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "story_data" jsonb;