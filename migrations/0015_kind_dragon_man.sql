CREATE TABLE "free_story_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"free_story_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"child_id" uuid,
	"type" "story_feedback_type" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "free_story_feedback" ADD CONSTRAINT "free_story_feedback_free_story_id_free_stories_id_fk" FOREIGN KEY ("free_story_id") REFERENCES "public"."free_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_story_feedback" ADD CONSTRAINT "free_story_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_story_feedback" ADD CONSTRAINT "free_story_feedback_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE set null ON UPDATE no action;