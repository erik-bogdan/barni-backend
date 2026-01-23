ALTER TYPE "public"."story_feedback_type" ADD VALUE 'dislike';--> statement-breakpoint
ALTER TABLE "story_feedback" ADD COLUMN "comment" text;