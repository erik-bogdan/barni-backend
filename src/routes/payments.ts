import { Elysia, t } from "elysia";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { auth } from "../lib/auth";
import { coupons } from "../../packages/db/src/schema";
import { env } from "../env";
import {
  getPricingPlanByCode,
  getEffectivePrice,
  getActivePricingPlans,
} from "../services/pricing";
import {
  validateCoupon,
  checkCouponPerUserLimit,
  calculateDiscount,
} from "../services/coupons";
import {
  createOrder,
  getOrderById,
  getUserOrders,
  updateOrderPayment,
  fulfillOrder,
  createPayment,
} from "../services/orders";
import {
  createCheckoutSession,
  verifyWebhookSignature,
  ensureCustomer,
} from "../lib/stripe";
import { stripeEvents, orders, orderItems, user, billingAddresses } from "../../packages/db/src/schema";
import Stripe from "stripe";
import { createInvoiceForOrder } from "../services/billingo";

async function requireSession(headers: Headers, set: { status: number }) {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    set.status = 401;
    return null;
  }
  return session;
}

export const paymentsApi = new Elysia({ name: "payments", prefix: "/payments" })
  // GET /pricing - Public endpoint
  .get("/pricing", async () => {
    const plans = await getActivePricingPlans(db);
    return {
      plans: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        credits: plan.credits,
        currency: plan.currency,
        priceCents: plan.priceCents,
        promoEnabled: plan.promoEnabled,
        promoType: plan.promoType,
        promoValue: plan.promoValue,
        promoPriceCents: plan.promoPriceCents,
        promoStartsAt: plan.promoStartsAt,
        promoEndsAt: plan.promoEndsAt,
        effectivePriceCents: plan.effectivePriceCents,
      })),
    };
  })
  // POST /validate-coupon - Validate coupon and calculate discount
  .post(
    "/validate-coupon",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set);
      if (!session) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const { couponCode, subtotalCents } = body;

      if (!couponCode || !subtotalCents) {
        set.status = 400;
        return { error: "couponCode and subtotalCents are required" };
      }

      // Validate coupon
      const validation = await validateCoupon(db, couponCode, subtotalCents);
      if (!validation.valid || !validation.coupon) {
        set.status = 400;
        return { error: validation.error || "Invalid coupon" };
      }

      // Check per-user limit
      const canUse = await checkCouponPerUserLimit(
        db,
        validation.coupon.id,
        session.user.id,
      );
      if (!canUse) {
        set.status = 400;
        return { error: "Coupon usage limit reached" };
      }

      // Calculate discount
      const discountCalc = calculateDiscount(subtotalCents, validation.coupon);

      return {
        valid: true,
        coupon: {
          code: validation.coupon.code,
          type: validation.coupon.type,
          value: validation.coupon.value,
        },
        discountCents: discountCalc.discountCents,
        totalCents: discountCalc.totalCents,
      };
    },
    {
      body: t.Object({
        couponCode: t.String(),
        subtotalCents: t.Number(),
      }),
    }
  )

  // POST /checkout/create - Create checkout session
  .post(
    "/checkout/create",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set);
      if (!session) return { error: "Unauthorized" };

      const userId = session.user.id;
      const { planCode, couponCode } = body;

      // Quantity is always 1 (removed from frontend UI)
      const quantity = 1;

      // Get pricing plan - BACKEND AUTHORITY: price comes from DB, not client
      const plan = await getPricingPlanByCode(db, planCode);
      if (!plan) {
        set.status = 404;
        return { error: "Pricing plan not found or inactive" };
      }

      // Calculate effective price - BACKEND AUTHORITY: price calculation
      const unitPriceCents = getEffectivePrice(plan);
      const subtotalCents = unitPriceCents * quantity;

      // Validate and apply coupon if provided - BACKEND AUTHORITY: coupon validation
      let coupon = null;
      let discountCents = 0;

      if (couponCode) {
        const validation = await validateCoupon(db, couponCode, subtotalCents);
        if (!validation.valid || !validation.coupon) {
          set.status = 400;
          return { error: validation.error || "Invalid coupon" };
        }

        // Check per-user limit
        const canUse = await checkCouponPerUserLimit(
          db,
          validation.coupon.id,
          userId,
        );
        if (!canUse) {
          set.status = 400;
          return { error: "Coupon usage limit reached" };
        }

        coupon = validation.coupon;
        // BACKEND AUTHORITY: discount calculation
        const discountCalc = calculateDiscount(subtotalCents, coupon);
        discountCents = discountCalc.discountCents;
      }

      // BACKEND AUTHORITY: final total calculation
      const totalCents = Math.max(0, subtotalCents - discountCents);

      // Validate total is positive
      if (totalCents <= 0) {
        set.status = 400;
        return { error: "Invalid order total: amount must be greater than 0" };
      }

      // Validate minimum for Stripe (HUF minimum is 175 Ft)
      if (totalCents < 175) {
        set.status = 400;
        return { error: `Order total too low: ${totalCents} ${plan.currency}. Minimum is 175 ${plan.currency}.` };
      }

      // Log for debugging (remove in production or use proper logger)
      console.log("[Checkout] Order calculation:", {
        planCode,
        planId: plan.id,
        planName: plan.name,
        unitPriceCents,
        effectivePriceCents: getEffectivePrice(plan),
        quantity,
        subtotalCents,
        discountCents,
        totalCents,
        couponCode: coupon?.code || null,
        currency: plan.currency,
      });

      // Get user email for Stripe customer
      const [userRow] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      if (!userRow) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Create order
      console.log("[Checkout] Creating order with:", {
        userId,
        planCode: plan.code,
        quantity,
        unitPriceCents,
        subtotalCents,
        discountCents,
        totalCents,
        currency: plan.currency,
      });

      const { order } = await createOrder(db, {
        userId,
        plan,
        quantity,
        unitPriceCents,
        currency: plan.currency,
        coupon: coupon ?? undefined,
        couponDiscountCents: discountCents,
      });

      console.log("[Checkout] Order created:", {
        orderId: order.id,
        orderTotalCents: order.totalCents,
        orderSubtotalCents: order.subtotalCents,
        orderDiscountCents: order.discountCents,
        orderCurrency: order.currency,
      });

      // Ensure Stripe customer exists
      let stripeCustomerId: string | undefined;
      try {
        stripeCustomerId = await ensureCustomer(userId, userRow.email);
      } catch (err) {
        console.error("Failed to ensure Stripe customer:", err);
        // Continue without customer ID
      }

      // Create Stripe checkout session
      // IMPORTANT: Use order.totalCents (backend-calculated, not client-provided)
      console.log("[Checkout] Creating Stripe session for order:", {
        orderId: order.id,
        orderTotalCents: order.totalCents,
        currency: plan.currency,
        planCode: plan.code,
      });

      const checkoutSession = await createCheckoutSession({
        orderId: order.id,
        userId,
        planName: plan.name,
        planCode: plan.code,
        totalCents: order.totalCents, // Backend-calculated total with discount
        currency: plan.currency,
        creditsTotal: order.creditsTotal,
        customerEmail: userRow.email,
        customerId: stripeCustomerId,
      });

      // Verify the amount matches
      console.log("[Checkout] Stripe session created:", {
        sessionId: checkoutSession.id,
        orderTotal: order.totalCents,
        stripeTotal: checkoutSession.amount_total,
        currency: checkoutSession.currency,
      });

      if (checkoutSession.amount_total !== order.totalCents) {
        console.error("[Checkout] Amount mismatch!", {
          orderTotal: order.totalCents,
          stripeTotal: checkoutSession.amount_total,
        });
      }

      // Update order with checkout session ID
      await updateOrderPayment(db, order.id, {
        stripeCheckoutSessionId: checkoutSession.id,
        stripeCustomerId: stripeCustomerId,
      });

      return {
        checkoutUrl: checkoutSession.url,
        orderId: order.id,
      };
    },
    {
      body: t.Object({
        planCode: t.String({ minLength: 1 }),
        // quantity removed - always 1
        couponCode: t.Optional(t.String()),
      }),
    },
  )

  // GET /orders - List user orders
  .get("/orders", async ({ request, set }) => {
    const session = await requireSession(request.headers, set);
    if (!session) return { error: "Unauthorized" };

    const orders = await getUserOrders(db, session.user.id);

    // Get order items for each order
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));

        return {
          id: order.id,
          status: order.status,
          currency: order.currency,
          subtotalCents: order.subtotalCents,
          discountCents: order.discountCents,
          totalCents: order.totalCents,
          creditsTotal: order.creditsTotal,
          couponCodeSnapshot: order.couponCodeSnapshot,
          couponTypeSnapshot: order.couponTypeSnapshot,
          couponValueSnapshot: order.couponValueSnapshot,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          items: items.map((item) => ({
            id: item.id,
            planCodeSnapshot: item.planCodeSnapshot,
            planNameSnapshot: item.planNameSnapshot,
            unitPriceCentsSnapshot: item.unitPriceCentsSnapshot,
            quantity: item.quantity,
            creditsPerUnitSnapshot: item.creditsPerUnitSnapshot,
            lineSubtotalCents: item.lineSubtotalCents,
            createdAt: item.createdAt,
          })),
        };
      }),
    );

    return {
      orders: ordersWithItems,
    };
  })

  // GET /orders/:id - Get order details
  .get(
    "/orders/:id",
    async ({ request, params, set }) => {
      const session = await requireSession(request.headers, set);
      if (!session) return { error: "Unauthorized" };

      const result = await getOrderById(db, params.id, session.user.id);
      if (!result) {
        set.status = 404;
        return { error: "Order not found" };
      }

      const { order, items } = result;

      return {
        id: order.id,
        status: order.status,
        currency: order.currency,
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        totalCents: order.totalCents,
        creditsTotal: order.creditsTotal,
        couponCodeSnapshot: order.couponCodeSnapshot,
        couponTypeSnapshot: order.couponTypeSnapshot,
        couponValueSnapshot: order.couponValueSnapshot,
        stripeCheckoutSessionId: order.stripeCheckoutSessionId,
        stripePaymentIntentId: order.stripePaymentIntentId,
        billingoInvoiceId: order.billingoInvoiceId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        items: items.map((item) => ({
          id: item.id,
          planCodeSnapshot: item.planCodeSnapshot,
          planNameSnapshot: item.planNameSnapshot,
          unitPriceCentsSnapshot: item.unitPriceCentsSnapshot,
          quantity: item.quantity,
          creditsPerUnitSnapshot: item.creditsPerUnitSnapshot,
          lineSubtotalCents: item.lineSubtotalCents,
          createdAt: item.createdAt,
        })),
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // GET /orders/:id/invoice - Redirect to Billingo invoice public URL
  .get(
    "/orders/:id/invoice",
    async ({ request, params, set }) => {
      const session = await requireSession(request.headers, set);
      if (!session) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const result = await getOrderById(db, params.id, session.user.id);
      if (!result) {
        set.status = 404;
        return { error: "Order not found" };
      }

      const { order } = result;

      if (order.status !== "paid") {
        set.status = 400;
        return { error: "Invoice only available for paid orders" };
      }

      if (!order.billingoInvoiceId) {
        set.status = 404;
        return { error: "Invoice not found" };
      }

      try {
        // Get invoice public URL from Billingo
        const { billingoClient } = await import("../services/billingo");
        const invoiceUrl = await billingoClient.getInvoicePublicUrl(order.billingoInvoiceId);

        // Redirect to Billingo public URL
        set.redirect = invoiceUrl;
        return;
      } catch (error: any) {
        console.error("[Invoice] Failed to get invoice URL:", error);
        set.status = 500;
        return { error: "Failed to retrieve invoice" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );

// Webhook endpoint - separate route for raw body handling
// No body schema specified = Elysia won't parse JSON, allowing raw body access
// IMPORTANT: This endpoint must be accessible at /stripe/webhook (no prefix)
// Stripe Dashboard webhook URL should be: http://localhost:4444/stripe/webhook (or your production domain)
// Webhook endpoint - must be mounted early to avoid conflicts
// Route: POST /stripe/webhook
// IMPORTANT: No body schema specified = Elysia won't parse JSON automatically
export const stripeWebhook = new Elysia({ name: "stripe-webhook" })
  // Test endpoint to verify route is accessible
  .get("/stripe/webhook/test", () => {
    return { message: "Stripe webhook route is accessible", timestamp: new Date().toISOString() };
  })
  // Explicitly disable body parsing for webhook endpoint
  // No body schema = Elysia won't parse JSON, allowing raw body access
  .post("/stripe/webhook", async ({ request, set }) => {
    console.log("[Stripe Webhook] Received POST request");
    console.log("[Stripe Webhook] Request URL:", request.url);
    console.log("[Stripe Webhook] Request method:", request.method);
    console.log("[Stripe Webhook] Request pathname:", new URL(request.url).pathname);
    console.log("[Stripe Webhook] Request headers:", Object.fromEntries(request.headers.entries()));
    
    // CRITICAL: Get raw body for signature verification
    // In Elysia, if no body schema is specified, request.text() gives raw body
    // But we need to ensure the body hasn't been consumed yet
    let rawBody: string;
    try {
      rawBody = await request.text();
      console.log("[Stripe Webhook] Raw body length:", rawBody.length);
    } catch (error: any) {
      console.error("[Stripe Webhook] Error reading raw body:", error);
      set.status = 400;
      return { error: "Failed to read request body" };
    }

      const signature = request.headers.get("stripe-signature");

    if (!signature) {
      set.status = 400;
      return { error: "Missing stripe-signature header" };
    }

    // Verify signature (async in Bun due to SubtleCrypto)
    let event: Stripe.Event;
    try {
      event = await verifyWebhookSignature(rawBody, signature);
      console.log("[Stripe Webhook] Signature verified, event type:", event.type);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err);
      set.status = 400;
      return { error: err.message };
    }

    // Store raw event in database (idempotent by stripe_event_id unique constraint)
    try {
      await db.insert(stripeEvents).values({
        stripeEventId: event.id,
        type: event.type,
        apiVersion: event.api_version ?? null,
        created: new Date(event.created * 1000), // Stripe timestamp is in seconds
        livemode: event.livemode,
        payloadJson: JSON.parse(rawBody) as any,
      });
    } catch (err: any) {
      // If duplicate, that's okay (idempotency)
      if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
        console.error("Failed to store stripe event:", err);
      }
    }

    // Acknowledge quickly
    // Process events asynchronously (in production, you might want to use a queue)
    processWebhookEvent(event).catch((err) => {
      console.error("Error processing webhook event:", err);
    });

    return { received: true };
  });

/**
 * Process webhook event
 */
async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutSessionCompleted(event);
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(event);
    }

    // Mark as processed
    await db
      .update(stripeEvents)
      .set({ processedAt: new Date() })
      .where(eq(stripeEvents.stripeEventId, event.id));
  } catch (err: any) {
    // Mark processing error
    await db
      .update(stripeEvents)
      .set({
        processingError: err.message,
      })
      .where(eq(stripeEvents.stripeEventId, event.id));
    throw err;
  }
}

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  const orderId = session.metadata?.order_id;
  const userId = session.metadata?.user_id;

  if (!orderId || !userId) {
    throw new Error("Missing order_id or user_id in session metadata");
  }

  // Get order
  const result = await getOrderById(db, orderId, userId);
  if (!result) {
    throw new Error(`Order ${orderId} not found`);
  }

  const { order } = result;

  // Idempotency check: if already paid, skip
  if (order.status === "paid") {
    console.log(`Order ${orderId} already paid, skipping fulfillment`);
    return;
  }

  // Reconcile amounts
  // IMPORTANT: Due to Stripe SDK bug, we multiplied by 100 when creating checkout session
  // So Stripe returns amount_total already multiplied by 100 (299000 instead of 2990)
  // We need to divide by 100 to get the actual amount for comparison
  const stripeAmountTotal = session.amount_total ?? 0;
  const actualStripeAmount = stripeAmountTotal / 100; // Divide by 100 to compensate for SDK bug
  
  console.log("[Webhook] Amount reconciliation:", {
    stripeAmountTotal,
    actualStripeAmount,
    orderTotalCents: order.totalCents,
    currency: order.currency,
  });
  
  if (Math.abs(actualStripeAmount - order.totalCents) > 0.01) {
    // Amount mismatch - mark as failed
    await updateOrderPayment(db, orderId, {
      status: "failed",
    });
    throw new Error(
      `Amount mismatch: Stripe ${actualStripeAmount} (raw: ${stripeAmountTotal}) vs Order ${order.totalCents}`,
    );
  }

  // Update order to paid
  await updateOrderPayment(db, orderId, {
    status: "paid",
    stripePaymentIntentId: session.payment_intent as string | undefined,
    stripeCustomerId: session.customer as string | undefined,
  });

  // Create payment record
  await createPayment(db, orderId, {
    status: "succeeded",
    amountCents: order.totalCents,
    currency: order.currency,
    stripePaymentIntentId: session.payment_intent as string | undefined,
    stripeChargeId: undefined, // Will be available in payment_intent.succeeded event
  });

  // Fulfill order: add credits
  await fulfillOrder(db, orderId);

  // Update coupon redeemed count if applicable
  if (order.couponId) {
    await db
      .update(coupons)
      .set({
        redeemedCount: sql`${coupons.redeemedCount} + 1`,
      })
      .where(eq(coupons.id, order.couponId));
  }

  // Create Billingo invoice
  try {
    // Get user profile and billing address
    const [userRow] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!userRow) {
      console.error(`[Billingo] User ${userId} not found for invoice creation`);
    } else {
      const [billing] = await db
        .select()
        .from(billingAddresses)
        .where(eq(billingAddresses.userId, userId))
        .limit(1);

      const userProfile = {
        email: userRow.email,
        firstName: userRow.firstName,
        lastName: userRow.lastName,
        billingAddress: billing
          ? {
              name: billing.name,
              street: billing.street,
              city: billing.city,
              postalCode: billing.postalCode,
              country: billing.country,
              taxNumber: billing.taxNumber,
            }
          : null,
      };

      // Get order items
      const orderItemsList = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      // Create invoice
      const billingoInvoiceId = await createInvoiceForOrder(
        {
          id: order.id,
          totalCents: order.totalCents,
          subtotalCents: order.subtotalCents,
          discountCents: order.discountCents,
          currency: order.currency,
          createdAt: order.createdAt,
        },
        orderItemsList.map((item) => ({
          planNameSnapshot: item.planNameSnapshot,
          quantity: item.quantity,
          lineSubtotalCents: item.lineSubtotalCents,
          creditsPerUnitSnapshot: item.creditsPerUnitSnapshot,
        })),
        userProfile,
      );

      // Save invoice ID to order
      await updateOrderPayment(db, orderId, {
        billingoInvoiceId,
      });

      console.log(`[Billingo] Invoice created for order ${orderId}: ${billingoInvoiceId}`);
    }
  } catch (error: any) {
    // Log error but don't fail the webhook - invoice creation is not critical
    console.error(`[Billingo] Failed to create invoice for order ${orderId}:`, error.message);
  }
}

/**
 * Handle charge.refunded event
 */
async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;

  // Find order by payment intent or charge
  // This is simplified - in production you'd want to store charge_id in payments table
  console.log("Charge refunded:", charge.id);
  // TODO: Implement refund logic
  // - Find order by charge/payment_intent
  // - Mark order as refunded
  // - Add negative credit ledger entry
}
