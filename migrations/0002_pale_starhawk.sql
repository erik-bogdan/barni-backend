ALTER TABLE "stories" ADD COLUMN "audio_url" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "audio_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "audio_error" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "audio_voice_id" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "audio_preset" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "audio_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "audio_hash" text;