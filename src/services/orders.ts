import { eq, and, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { orders, orderItems, payments, storyCreditTransactions } from "../../packages/db/src/schema";
import type { PricingPlan } from "./pricing";
import type { Coupon } from "./coupons";

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;

export interface CreateOrderParams {
  userId: string;
  plan: PricingPlan;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  coupon?: Coupon;
  couponDiscountCents?: number;
}

export interface CreateOrderResult {
  order: Order;
  orderItem: OrderItem;
}

/**
 * Create order and order item with snapshots
 */
export async function createOrder(
  db: PostgresJsDatabase<Record<string, unknown>>,
  params: CreateOrderParams,
): Promise<CreateOrderResult> {
  const { userId, plan, quantity, unitPriceCents, currency, coupon, couponDiscountCents = 0 } = params;

  const subtotalCents = unitPriceCents * quantity;
  const totalCents = Math.max(0, subtotalCents - couponDiscountCents);
  const creditsTotal = plan.credits * quantity;

  // Validate total is positive
  if (totalCents <= 0) {
    throw new Error(`Invalid order total: ${totalCents} ${currency}. Total must be greater than 0.`);
  }

  // Create order
  const [order] = await db
    .insert(orders)
    .values({
      userId,
      status: "pending_payment",
      currency,
      subtotalCents,
      discountCents: couponDiscountCents,
      totalCents,
      couponId: coupon?.id,
      couponCodeSnapshot: coupon?.code,
      couponTypeSnapshot: coupon?.type,
      couponValueSnapshot: coupon?.value,
      creditsTotal,
      provider: "stripe",
    })
    .returning();

  if (!order) {
    throw new Error("Failed to create order");
  }

  // Create order item
  const [orderItem] = await db
    .insert(orderItems)
    .values({
      orderId: order.id,
      pricingPlanId: plan.id,
      planCodeSnapshot: plan.code,
      planNameSnapshot: plan.name,
      unitPriceCentsSnapshot: unitPriceCents,
      quantity,
      creditsPerUnitSnapshot: plan.credits,
      lineSubtotalCents: subtotalCents,
    })
    .returning();

  if (!orderItem) {
    throw new Error("Failed to create order item");
  }

  return { order, orderItem };
}

/**
 * Get order by ID with items
 */
export async function getOrderById(
  db: PostgresJsDatabase<Record<string, unknown>>,
  orderId: string,
  userId?: string,
): Promise<{ order: Order; items: OrderItem[] } | null> {
  const whereClause = userId
    ? and(eq(orders.id, orderId), eq(orders.userId, userId))
    : eq(orders.id, orderId);

  const [order] = await db.select().from(orders).where(whereClause).limit(1);

  if (!order) {
    return null;
  }

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return { order, items };
}

/**
 * Get orders for user
 */
export async function getUserOrders(
  db: PostgresJsDatabase<Record<string, unknown>>,
  userId: string,
  limit: number = 50,
): Promise<Order[]> {
  return await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(sql`${orders.createdAt} DESC`) // Most recent first
    .limit(limit);
}

/**
 * Update order status and Stripe IDs
 */
export async function updateOrderPayment(
  db: PostgresJsDatabase<Record<string, unknown>>,
  orderId: string,
  updates: {
    status?: Order["status"];
    stripePaymentIntentId?: string;
    stripeCustomerId?: string;
    stripeCheckoutSessionId?: string;
    billingoInvoiceId?: number | null;
  },
): Promise<Order | null> {
  const [updated] = await db
    .update(orders)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  return updated ?? null;
}

/**
 * Fulfill order: add credits to user's account
 * Idempotent: checks if credits already added for this order
 */
export async function fulfillOrder(
  db: PostgresJsDatabase<Record<string, unknown>>,
  orderId: string,
): Promise<boolean> {
  // Check if already fulfilled (idempotency check)
  const [existing] = await db
    .select()
    .from(storyCreditTransactions)
    .where(
      and(
        eq(storyCreditTransactions.orderId, orderId),
        eq(storyCreditTransactions.type, "purchase"),
      ),
    )
    .limit(1);

  if (existing) {
    // Already fulfilled
    return false;
  }

  // Get order
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== "paid") {
    throw new Error(`Order ${orderId} is not paid (status: ${order.status})`);
  }

  // Add credits
  await db.insert(storyCreditTransactions).values({
    userId: order.userId,
    orderId: order.id,
    type: "purchase",
    amount: order.creditsTotal,
    reason: "Stripe checkout purchase",
    source: "stripe",
  });

  return true;
}

/**
 * Create payment record
 */
export async function createPayment(
  db: PostgresJsDatabase<Record<string, unknown>>,
  orderId: string,
  params: {
    status: Payment["status"];
    amountCents: number;
    currency: string;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    failureCode?: string;
    failureMessage?: string;
  },
): Promise<Payment> {
  const [payment] = await db
    .insert(payments)
    .values({
      orderId,
      provider: "stripe",
      ...params,
    })
    .returning();

  if (!payment) {
    throw new Error("Failed to create payment record");
  }

  return payment;
}
