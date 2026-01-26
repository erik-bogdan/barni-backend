ALTER TABLE "launch_subscriptions" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "launch_subscriptions" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "launch_subscriptions" ADD COLUMN "send_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "launch_subscriptions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "launch_subscriptions" ADD CONSTRAINT "launch_subscriptions_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE set null ON UPDATE no action;