import { eq, and, gte, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { pricingPlans } from "../../packages/db/src/schema";

export type PricingPlan = typeof pricingPlans.$inferSelect;

/**
 * Calculate effective price for a pricing plan
 * Supports both percentage and amount-based promotions
 * Returns calculated promo price if promo is enabled and current time is within promo window,
 * otherwise returns price_cents
 */
export function getEffectivePrice(plan: PricingPlan, now: Date = new Date()): number {
  if (!plan.promoEnabled) {
    return plan.priceCents;
  }

  const nowTime = now.getTime();
  const promoStart = plan.promoStartsAt?.getTime() ?? 0;
  const promoEnd = plan.promoEndsAt?.getTime() ?? Infinity;

  // Check if promo is active within time window
  if (nowTime < promoStart || nowTime > promoEnd) {
    return plan.priceCents;
  }

  // Calculate promo price based on type
  if (plan.promoType === "percent" && plan.promoValue) {
    // Value is 1..100
    const discountCents = Math.floor((plan.priceCents * plan.promoValue) / 100);
    return Math.max(0, plan.priceCents - discountCents);
  } else if (plan.promoType === "amount" && plan.promoValue) {
    // Value is in minor units (cents)
    const discountCents = Math.min(plan.promoValue, plan.priceCents);
    return Math.max(0, plan.priceCents - discountCents);
  } else if (plan.promoPriceCents) {
    // Backward compatibility: use promoPriceCents if promoType is not set
    return plan.promoPriceCents;
  }

  return plan.priceCents;
}

/**
 * Get active pricing plan by code
 */
export async function getPricingPlanByCode(
  db: PostgresJsDatabase<Record<string, unknown>>,
  code: string,
): Promise<PricingPlan | null> {
  const [plan] = await db
    .select()
    .from(pricingPlans)
    .where(and(eq(pricingPlans.code, code), eq(pricingPlans.isActive, true)))
    .limit(1);

  return plan ?? null;
}

/**
 * Get all active pricing plans with effective prices
 */
export async function getActivePricingPlans(
  db: PostgresJsDatabase<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<Array<PricingPlan & { effectivePriceCents: number }>> {
  const plans = await db
    .select()
    .from(pricingPlans)
    .where(eq(pricingPlans.isActive, true))
    .orderBy(pricingPlans.priceCents);

  return plans.map((plan) => ({
    ...plan,
    effectivePriceCents: getEffectivePrice(plan, now),
  }));
}
