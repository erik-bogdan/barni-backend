CREATE TABLE "story_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"length" text NOT NULL,
	"is_interactive" boolean DEFAULT false NOT NULL,
	"is_audio" boolean DEFAULT false NOT NULL,
	"credits" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_pricing_key_unique" UNIQUE("key")
);
