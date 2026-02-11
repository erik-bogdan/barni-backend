CREATE TYPE "public"."registration_promo_type" AS ENUM('percent', 'amount', 'bonus_credits');--> statement-breakpoint
ALTER TABLE "pricing_plans" ADD COLUMN "registration_promo_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_plans" ADD COLUMN "registration_promo_type" "registration_promo_type";--> statement-breakpoint
ALTER TABLE "pricing_plans" ADD COLUMN "registration_promo_value" integer;--> statement-breakpoint
ALTER TABLE "pricing_plans" ADD COLUMN "registration_promo_valid_hours" integer;