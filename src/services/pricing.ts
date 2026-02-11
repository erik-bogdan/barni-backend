import { eq, and, gte, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { pricingPlans } from "../../packages/db/src/schema";

export type PricingPlan = typeof pricingPlans.$inferSelect;
type RegistrationPromoType = "percent" | "amount" | "bonus_credits";

function isRegistrationPromoActive(
  plan: PricingPlan,
  userCreatedAt?: Date | null,
  now: Date = new Date(),
): boolean {
  if (!plan.registrationPromoEnabled || !userCreatedAt) {
    return false;
  }

  if (!plan.registrationPromoType || !plan.registrationPromoValue) {
    return false;
  }

  if (!plan.registrationPromoValidHours || plan.registrationPromoValidHours <= 0) {
    return false;
  }

  const registrationTime = userCreatedAt.getTime();
  const nowTime = now.getTime();
  if (nowTime < registrationTime) {
    return false;
  }

  const expiresAt = registrationTime + plan.registrationPromoValidHours * 60 * 60 * 1000;
  return nowTime <= expiresAt;
}

function getRegistrationPromoRemainingHours(
  plan: PricingPlan,
  userCreatedAt?: Date | null,
  now: Date = new Date(),
): number | null {
  if (!isRegistrationPromoActive(plan, userCreatedAt, now) || !plan.registrationPromoValidHours) {
    return null;
  }

  const registrationTime = userCreatedAt!.getTime();
  const expiresAt = registrationTime + plan.registrationPromoValidHours * 60 * 60 * 1000;
  const remainingMs = Math.max(0, expiresAt - now.getTime());
  return Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
}

function getRegistrationPromoEndsAt(
  plan: PricingPlan,
  userCreatedAt?: Date | null,
  now: Date = new Date(),
): Date | null {
  if (!isRegistrationPromoActive(plan, userCreatedAt, now) || !plan.registrationPromoValidHours) {
    return null;
  }

  const registrationTime = userCreatedAt!.getTime();
  const expiresAt = registrationTime + plan.registrationPromoValidHours * 60 * 60 * 1000;
  return new Date(expiresAt);
}

function getRegistrationPromoDiscountCents(
  plan: PricingPlan,
  effectiveBasePriceCents: number,
  userCreatedAt?: Date | null,
  now: Date = new Date(),
): number {
  if (!isRegistrationPromoActive(plan, userCreatedAt, now)) {
    return 0;
  }

  if (plan.registrationPromoType === "percent") {
    const value = Math.max(0, Math.min(100, plan.registrationPromoValue ?? 0));
    return Math.floor((effectiveBasePriceCents * value) / 100);
  }

  if (plan.registrationPromoType === "amount") {
    return Math.max(0, Math.min(plan.registrationPromoValue ?? 0, effectiveBasePriceCents));
  }

  return 0;
}

export function getEffectiveBonusCredits(
  plan: PricingPlan,
  now: Date = new Date(),
  userCreatedAt?: Date | null,
): number {
  const baseBonusCredits = plan.bonusCredits ?? 0;
  if (!isRegistrationPromoActive(plan, userCreatedAt, now)) {
    return baseBonusCredits;
  }

  if (plan.registrationPromoType !== "bonus_credits") {
    return baseBonusCredits;
  }

  const registrationBonus = Math.max(0, plan.registrationPromoValue ?? 0);
  return baseBonusCredits + registrationBonus;
}

/**
 * Calculate effective price for a pricing plan
 * Supports both percentage and amount-based promotions
 * Returns calculated promo price if promo is enabled and current time is within promo window,
 * otherwise returns price_cents
 */
export function getEffectivePrice(
  plan: PricingPlan,
  now: Date = new Date(),
  userCreatedAt?: Date | null,
): number {
  if (!plan.promoEnabled) {
    const registrationDiscount = getRegistrationPromoDiscountCents(
      plan,
      plan.priceCents,
      userCreatedAt,
      now,
    );
    return Math.max(0, plan.priceCents - registrationDiscount);
  }

  const nowTime = now.getTime();
  const promoStart = plan.promoStartsAt?.getTime() ?? 0;
  const promoEnd = plan.promoEndsAt?.getTime() ?? Infinity;

  // Check if promo is active within time window
  if (nowTime < promoStart || nowTime > promoEnd) {
    const registrationDiscount = getRegistrationPromoDiscountCents(
      plan,
      plan.priceCents,
      userCreatedAt,
      now,
    );
    return Math.max(0, plan.priceCents - registrationDiscount);
  }

  let baseEffectivePrice = plan.priceCents;

  // Calculate promo price based on type
  if (plan.promoType === "percent" && plan.promoValue) {
    // Value is 1..100
    const discountCents = Math.floor((plan.priceCents * plan.promoValue) / 100);
    baseEffectivePrice = Math.max(0, plan.priceCents - discountCents);
  } else if (plan.promoType === "amount" && plan.promoValue) {
    // Value is in minor units (cents)
    const discountCents = Math.min(plan.promoValue, plan.priceCents);
    baseEffectivePrice = Math.max(0, plan.priceCents - discountCents);
  } else if (plan.promoPriceCents) {
    // Backward compatibility: use promoPriceCents if promoType is not set
    baseEffectivePrice = plan.promoPriceCents;
  }

  const registrationDiscount = getRegistrationPromoDiscountCents(
    plan,
    baseEffectivePrice,
    userCreatedAt,
    now,
  );
  return Math.max(0, baseEffectivePrice - registrationDiscount);
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
  userCreatedAt?: Date | null,
): Promise<
  Array<
    PricingPlan & {
      effectivePriceCents: number;
      effectiveBonusCredits: number;
      registrationPromoIsActive: boolean;
      registrationPromoRemainingHours: number | null;
      registrationPromoEndsAt: Date | null;
    }
  >
> {
  const plans = await db
    .select()
    .from(pricingPlans)
    .where(eq(pricingPlans.isActive, true))
    .orderBy(pricingPlans.priceCents);

  return plans.map((plan) => ({
    ...plan,
    effectivePriceCents: getEffectivePrice(plan, now, userCreatedAt),
    effectiveBonusCredits: getEffectiveBonusCredits(plan, now, userCreatedAt),
    registrationPromoIsActive: isRegistrationPromoActive(plan, userCreatedAt, now),
    registrationPromoRemainingHours: getRegistrationPromoRemainingHours(plan, userCreatedAt, now),
    registrationPromoEndsAt: getRegistrationPromoEndsAt(plan, userCreatedAt, now),
  }));
}
