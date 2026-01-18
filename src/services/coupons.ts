import { eq, and, gte, lte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { coupons, orders } from "../../packages/db/src/schema";

export type Coupon = typeof coupons.$inferSelect;

export type CouponType = "percent" | "amount";

export interface CouponValidationResult {
  valid: boolean;
  error?: string;
  coupon?: Coupon;
}

export interface DiscountCalculation {
  discountCents: number;
  totalCents: number;
}

/**
 * Validate coupon code
 * Checks: active status, time window, max redemptions, min order amount
 */
export async function validateCoupon(
  db: PostgresJsDatabase<Record<string, unknown>>,
  code: string,
  subtotalCents: number,
  now: Date = new Date(),
): Promise<CouponValidationResult> {
  const normalizedCode = code.trim().toUpperCase();

  const [coupon] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, normalizedCode))
    .limit(1);

  if (!coupon) {
    return { valid: false, error: "Coupon not found" };
  }

  if (!coupon.isActive) {
    return { valid: false, error: "Coupon is not active" };
  }

  // Check time window
  const nowTime = now.getTime();
  if (coupon.startsAt) {
    const startTime = coupon.startsAt.getTime();
    if (nowTime < startTime) {
      return { valid: false, error: "Coupon not yet valid" };
    }
  }
  if (coupon.endsAt) {
    const endTime = coupon.endsAt.getTime();
    if (nowTime > endTime) {
      return { valid: false, error: "Coupon has expired" };
    }
  }

  // Check max redemptions
  if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) {
    return { valid: false, error: "Coupon has reached maximum redemptions" };
  }

  // Check min order amount
  if (coupon.minOrderAmountCents !== null && subtotalCents < coupon.minOrderAmountCents) {
    return {
      valid: false,
      error: `Minimum order amount is ${coupon.minOrderAmountCents / 100} ${coupon.currency ?? "HUF"}`,
    };
  }

  return { valid: true, coupon };
}

/**
 * Check per-user limit for coupon
 * Returns true if user can use the coupon (hasn't exceeded per_user_limit)
 */
export async function checkCouponPerUserLimit(
  db: PostgresJsDatabase<Record<string, unknown>>,
  couponId: string,
  userId: string,
): Promise<boolean> {
  const coupon = await db
    .select({ perUserLimit: coupons.perUserLimit })
    .from(coupons)
    .where(eq(coupons.id, couponId))
    .limit(1);

  if (!coupon[0] || coupon[0].perUserLimit === null) {
    return true; // No limit
  }

  // Count paid orders with this coupon by this user
  const [result] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.couponId, couponId),
        eq(orders.status, "paid"),
      ),
    );

  const usedCount = result?.count ?? 0;
  return usedCount < coupon[0].perUserLimit;
}

/**
 * Calculate discount and total based on coupon
 */
export function calculateDiscount(
  subtotalCents: number,
  coupon: Coupon,
): DiscountCalculation {
  let discountCents = 0;

  if (coupon.type === "percent") {
    // Value is 1..100
    discountCents = Math.floor((subtotalCents * coupon.value) / 100);
  } else if (coupon.type === "amount") {
    // Value is in minor units (cents)
    discountCents = Math.min(coupon.value, subtotalCents);
  }

  const totalCents = Math.max(0, subtotalCents - discountCents);

  return {
    discountCents,
    totalCents,
  };
}
