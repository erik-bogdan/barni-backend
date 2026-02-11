import { eq, and, gte, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { pricingPlans, orders } from "../../packages/db/src/schema";

export type PricingPlan = typeof pricingPlans.$inferSelect;
type RegistrationPromoType = "percent" | "amount" | "bonus_credits";

async function hasUserUsedRegistrationPromo(
  db: PostgresJsDatabase<Record<string, unknown>>,
  userId: string | undefined,
  userCreatedAt: Date | null | undefined,
  plan: PricingPlan,
  now: Date = new Date(),
): Promise<boolean> {
  if (!userId || !userCreatedAt || !plan.registrationPromoValidHours) {
    return false;
  }

  const registrationTime = userCreatedAt.getTime();
  const expiresAt = registrationTime + plan.registrationPromoValidHours * 60 * 60 * 1000;
  const nowTime = now.getTime();

  // Check if promo window is still active
  if (nowTime > expiresAt) {
    return false; // Window expired, can't have used it
  }

  // Check if user has any paid orders created within the promo window
  const [result] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "paid"),
        gte(orders.createdAt, new Date(registrationTime)),
        lte(orders.createdAt, new Date(expiresAt)),
      ),
    );

  return (result?.count ?? 0) > 0;
}

function isRegistrationPromoActive(
  plan: PricingPlan,
  userCreatedAt?: Date | null,
  now: Date = new Date(),
  hasUsedPromo: boolean = false,
): boolean {
  if (hasUsedPromo) {
    return false; // User already used the promo
  }

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
  hasUsedPromo: boolean = false,
): number | null {
  if (!isRegistrationPromoActive(plan, userCreatedAt, now, hasUsedPromo) || !plan.registrationPromoValidHours) {
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
  hasUsedPromo: boolean = false,
): Date | null {
  if (!isRegistrationPromoActive(plan, userCreatedAt, now, hasUsedPromo) || !plan.registrationPromoValidHours) {
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
  hasUsedPromo: boolean = false,
): number {
  if (!isRegistrationPromoActive(plan, userCreatedAt, now, hasUsedPromo)) {
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
  hasUsedPromo: boolean = false,
): number {
  const baseBonusCredits = plan.bonusCredits ?? 0;
  if (!isRegistrationPromoActive(plan, userCreatedAt, now, hasUsedPromo)) {
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
  hasUsedPromo: boolean = false,
): number {
  if (!plan.promoEnabled) {
    const registrationDiscount = hasUsedPromo
      ? 0
      : getRegistrationPromoDiscountCents(plan, plan.priceCents, userCreatedAt, now, hasUsedPromo);
    return Math.max(0, plan.priceCents - registrationDiscount);
  }

  const nowTime = now.getTime();
  const promoStart = plan.promoStartsAt?.getTime() ?? 0;
  const promoEnd = plan.promoEndsAt?.getTime() ?? Infinity;

  // Check if promo is active within time window
  if (nowTime < promoStart || nowTime > promoEnd) {
    const registrationDiscount = hasUsedPromo
      ? 0
      : getRegistrationPromoDiscountCents(plan, plan.priceCents, userCreatedAt, now, hasUsedPromo);
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

  const registrationDiscount = hasUsedPromo
    ? 0
    : getRegistrationPromoDiscountCents(plan, baseEffectivePrice, userCreatedAt, now, hasUsedPromo);
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
  userId?: string,
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

  // Check if user has already used registration promo (check first plan with registration promo enabled)
  const firstPromoPlan = plans.find((p) => p.registrationPromoEnabled);
  const hasUsedPromo = firstPromoPlan && userId && userCreatedAt
    ? await hasUserUsedRegistrationPromo(db, userId, userCreatedAt, firstPromoPlan, now)
    : false;

  return plans.map((plan) => ({
    ...plan,
    effectivePriceCents: getEffectivePrice(plan, now, userCreatedAt, hasUsedPromo),
    effectiveBonusCredits: getEffectiveBonusCredits(plan, now, userCreatedAt, hasUsedPromo),
    registrationPromoIsActive: isRegistrationPromoActive(plan, userCreatedAt, now, hasUsedPromo),
    registrationPromoRemainingHours: hasUsedPromo ? null : getRegistrationPromoRemainingHours(plan, userCreatedAt, now, hasUsedPromo),
    registrationPromoEndsAt: hasUsedPromo ? null : getRegistrationPromoEndsAt(plan, userCreatedAt, now, hasUsedPromo),
  }));
}
