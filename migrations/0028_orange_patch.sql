CREATE TABLE "story_gpt_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"story_id" uuid NOT NULL,
	"operation_type" text DEFAULT 'story_generation' NOT NULL,
	"model" text NOT NULL,
	"request_text" text NOT NULL,
	"response_text" text NOT NULL,
	"request_id" text,
	"response_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_gpt_requests" ADD CONSTRAINT "story_gpt_requests_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;