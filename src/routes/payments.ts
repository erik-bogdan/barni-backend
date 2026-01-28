import { Elysia, t } from "elysia";
import type { Logger } from "../lib/logger";
import { randomUUID } from "crypto";
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
import { getPaymentProvider, getCurrentProviderType, getPaymentProviderByType } from "../lib/payment-providers/factory";
import { stripeEvents, barionEvents, orders, orderItems, user, billingAddresses } from "../../packages/db/src/schema";
import { createInvoiceForOrder } from "../services/billingo";
import { getLogger } from "../lib/logger";

async function requireSession(headers: Headers, set: { status?: number | string }) {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    set.status = 401;
    return null;
  }
  return session;
}

export const paymentsApi = new Elysia({ name: "payments", prefix: "/payments" })
  .decorate("logger", getLogger())
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
        description: plan.description,
        promoEnabled: plan.promoEnabled,
        promoType: plan.promoType,
        promoValue: plan.promoValue,
        promoPriceCents: plan.promoPriceCents,
        promoStartsAt: plan.promoStartsAt,
        promoEndsAt: plan.promoEndsAt,
        effectivePriceCents: plan.effectivePriceCents,
        bonusAudioStars: plan.bonusAudioStars ?? 0,
        bonusCredits: plan.bonusCredits ?? 0,
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
    async ({ request, body, set, logger }) => {
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

      // Get payment provider to validate minimum amount
      const paymentProviderForValidation = getPaymentProvider();
      const minimumAmount = paymentProviderForValidation.getMinimumAmount(plan.currency);
      if (totalCents < minimumAmount) {
        set.status = 400;
        return { error: `Order total too low: ${totalCents} ${plan.currency}. Minimum is ${minimumAmount} ${plan.currency}.` };
      }

      // Log for debugging (remove in production or use proper logger)
      logger.info({
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
      }, "checkout.order_calculation");

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
      logger.info({
        userId,
        planCode: plan.code,
        quantity,
        unitPriceCents,
        subtotalCents,
        discountCents,
        totalCents,
        currency: plan.currency,
      }, "checkout.order_create");

      const { order } = await createOrder(db, {
        userId,
        plan,
        quantity,
        unitPriceCents,
        currency: plan.currency,
        coupon: coupon ?? undefined,
        couponDiscountCents: discountCents,
      });

      logger.info({
        orderId: order.id,
        orderTotalCents: order.totalCents,
        orderSubtotalCents: order.subtotalCents,
        orderDiscountCents: order.discountCents,
        orderCurrency: order.currency,
      }, "checkout.order_created");

      // Get payment provider
      const paymentProvider = getPaymentProvider();
      const providerType = getCurrentProviderType();

      // Ensure customer exists in payment provider
      let customerId: string | undefined;
      try {
        customerId = await paymentProvider.ensureCustomer(userId, userRow.email, logger);
      } catch (err) {
        logger.error({ err, provider: providerType }, "checkout.ensure_customer_failed");
        // Continue without customer ID
      }

      // Create checkout session
      // IMPORTANT: Use order.totalCents (backend-calculated, not client-provided)
      logger.info({
        orderId: order.id,
        orderTotalCents: order.totalCents,
        currency: plan.currency,
        planCode: plan.code,
        provider: providerType,
      }, "checkout.session_create");

      const checkoutSession = await paymentProvider.createCheckoutSession({
        orderId: order.id,
        userId,
        planName: plan.name,
        planCode: plan.code,
        totalCents: order.totalCents, // Backend-calculated total with discount
        currency: plan.currency,
        creditsTotal: order.creditsTotal,
        customerEmail: userRow.email,
        customerId: customerId,
        logger,
      });

      // Verify the amount matches
      logger.info({
        sessionId: checkoutSession.id,
        orderTotal: order.totalCents,
        providerTotal: checkoutSession.amountTotal,
        currency: checkoutSession.currency,
        provider: providerType,
      }, "checkout.session_created");

      if (Math.abs(checkoutSession.amountTotal - order.totalCents) > 0.01) {
        logger.error({
          orderTotal: order.totalCents,
          providerTotal: checkoutSession.amountTotal,
        }, "checkout.amount_mismatch");
      }

      // Update order with provider-specific fields
      const updateData: any = {};
      if (providerType === "stripe") {
        updateData.stripeCheckoutSessionId = checkoutSession.id;
        updateData.stripeCustomerId = customerId;
      } else if (providerType === "barion") {
        updateData.barionPaymentId = checkoutSession.id;
        updateData.barionPaymentRequestId = checkoutSession.metadata?.payment_request_id;
        updateData.barionCustomerId = customerId;
      }
      await updateOrderPayment(db, order.id, updateData);

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
        barionPaymentId: order.barionPaymentId,
        barionPaymentRequestId: order.barionPaymentRequestId,
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
    async ({ request, params, set, logger }) => {
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
        const { getInvoicePublicUrl } = await import("../services/billingo");
        const invoiceUrl = await getInvoicePublicUrl(order.billingoInvoiceId);

        // Redirect to Billingo public URL
        set.redirect = invoiceUrl;
        return;
      } catch (error: any) {
        logger.error({ err: error, orderId: params.id }, "invoice.fetch_failed");
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
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    set.headers["x-request-id"] = requestId;
    const logger = getLogger().child({ requestId });
    const path = new URL(request.url).pathname;
    logger.info(
      {
        method: request.method,
        path,
        contentLength: request.headers.get("content-length") ?? undefined,
        hasSignature: Boolean(request.headers.get("stripe-signature")),
      },
      "stripe_webhook.received",
    );
    
    // CRITICAL: Get raw body for signature verification
    // In Elysia, if no body schema is specified, request.text() gives raw body
    // But we need to ensure the body hasn't been consumed yet
    let rawBody: string;
    try {
      rawBody = await request.text();
      logger.info({ rawBodyLength: rawBody.length }, "stripe_webhook.body_read");
    } catch (error: any) {
      logger.error({ err: error }, "stripe_webhook.body_read_failed");
      set.status = 400;
      return { error: "Failed to read request body" };
    }

      const signature = request.headers.get("stripe-signature");

    if (!signature) {
      set.status = 400;
      return { error: "Missing stripe-signature header" };
    }

    // Get Stripe provider and verify signature
    const stripeProvider = getPaymentProviderByType("stripe");
    let event;
    try {
      event = await stripeProvider.verifyWebhookSignature(rawBody, signature);
      logger.info({ eventType: event.type }, "stripe_webhook.verified");
    } catch (err: any) {
      logger.error({ err }, "stripe_webhook.verify_failed");
      set.status = 400;
      return { error: err.message };
    }

    // Store raw event in database (idempotent by stripe_event_id unique constraint)
    try {
      await db.insert(stripeEvents).values({
        stripeEventId: event.id,
        type: event.type,
        apiVersion: (event.data as any).api_version ?? null,
        created: event.created,
        livemode: event.livemode,
        payloadJson: JSON.parse(rawBody) as any,
      });
    } catch (err: any) {
      // If duplicate, that's okay (idempotency)
      if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
        logger.error({ err }, "stripe_webhook.store_failed");
      }
    }

    // Acknowledge quickly
    // Process events asynchronously (in production, you might want to use a queue)
    processStripeWebhookEvent(event, logger).catch((err) => {
      logger.error({ err }, "stripe_webhook.process_failed");
    });

    return { received: true };
  });

/**
 * Process Stripe webhook event
 */
async function processStripeWebhookEvent(event: any, logger: Logger): Promise<void> {
  try {
    if (event.type === "checkout.session.completed") {
      await handleStripeCheckoutSessionCompleted(event, logger);
    } else if (event.type === "charge.refunded") {
      await handleStripeChargeRefunded(event, logger);
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
 * Handle Stripe checkout.session.completed event
 */
async function handleStripeCheckoutSessionCompleted(
  event: any,
  logger: Logger,
): Promise<void> {
  const session = event.data.object;

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
    logger.info({ orderId }, "stripe_webhook.order_already_paid");
    return;
  }

  // Reconcile amounts
  // IMPORTANT: Due to Stripe SDK bug, we multiplied by 100 when creating checkout session
  // So Stripe returns amount_total already multiplied by 100 (299000 instead of 2990)
  // We need to divide by 100 to get the actual amount for comparison
  const stripeAmountTotal = session.amount_total ?? 0;
  const actualStripeAmount = stripeAmountTotal / 100; // Divide by 100 to compensate for SDK bug
  
  logger.info({
    stripeAmountTotal,
    actualStripeAmount,
    orderTotalCents: order.totalCents,
    currency: order.currency,
  }, "stripe_webhook.amount_reconciliation");
  
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
    provider: "stripe",
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
      logger.error({ userId, orderId }, "billingo.user_missing");
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

      logger.info({ orderId, billingoInvoiceId }, "billingo.invoice_created");
    }
  } catch (error: any) {
    // Log error but don't fail the webhook - invoice creation is not critical
    logger.error({ err: error, orderId }, "billingo.invoice_failed");
  }
}

/**
 * Handle Stripe charge.refunded event
 */
async function handleStripeChargeRefunded(event: any, logger: Logger): Promise<void> {
  const charge = event.data.object;

  // Find order by payment intent or charge
  // This is simplified - in production you'd want to store charge_id in payments table
  logger.info({ chargeId: charge.id }, "stripe_webhook.charge_refunded");
  // TODO: Implement refund logic
  // - Find order by charge/payment_intent
  // - Mark order as refunded
  // - Add negative credit ledger entry
}

const BARION_SUCCESS_STATUSES = new Set(["succeeded", "partiallysucceeded"]);
const BARION_CANCELLED_STATUSES = new Set(["canceled", "cancelled"]);
const BARION_FAILED_STATUSES = new Set(["failed", "expired"]);

function normalizeBarionStatus(status?: string): string {
  return (status || "").trim().toLowerCase();
}

// Barion webhook endpoint
// Route: GET/POST /barion/webhook
// Barion can send callbacks as either GET (with paymentId query param) or POST (with JSON body)
export const barionWebhook = new Elysia({ name: "barion-webhook" })
  // Test endpoint to verify route is accessible
  .get("/barion/webhook/test", () => {
    return { message: "Barion webhook route is accessible", timestamp: new Date().toISOString() };
  })
  // Handle GET requests (Barion callback with paymentId query parameter)
  .get("/barion/webhook", async ({ request, query, set }) => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    set.headers["x-request-id"] = requestId;
    const logger = getLogger().child({ requestId });
    const path = new URL(request.url).pathname;
    logger.info({ method: request.method, path }, "barion_webhook.received");

    const paymentId = query.paymentId as string | undefined;
    
    if (!paymentId) {
      set.status = 400;
      return { error: "Missing paymentId query parameter" };
    }

    logger.info({ paymentId }, "barion_webhook.processing");

    // Get Barion provider to fetch payment state
    const barionProvider = getPaymentProviderByType("barion");
    
    try {
      // Fetch payment state from Barion API
      if (!barionProvider.getPaymentState) {
        throw new Error("Barion provider does not support getPaymentState");
      }
      const paymentState = await barionProvider.getPaymentState(paymentId);
      
      logger.info(
        {
          paymentId,
          status: paymentState.Status,
          transactions: paymentState.Transactions?.length || 0,
        },
        "barion_webhook.payment_state",
      );

      // Create a webhook event-like object from the payment state
      const event = {
        id: paymentId,
        type: paymentState.Status === "Succeeded" ? "payment.completed" : "payment.state_changed",
        data: paymentState,
        created: new Date(),
        livemode: env.BARION_ENVIRONMENT === "production",
      };

      // Store event in database
      try {
        await db.insert(barionEvents).values({
          barionEventId: paymentId,
          paymentId: paymentId,
          type: event.type,
          created: event.created,
          livemode: event.livemode,
          payloadJson: paymentState as any,
        });
      } catch (err: any) {
        // If duplicate, that's okay (idempotency)
        if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
          logger.error({ err }, "barion_webhook.store_failed");
        }
      }

      // Process event asynchronously
      processBarionWebhookEvent(event, logger).catch((err) => {
        logger.error({ err }, "barion_webhook.process_failed");
      });

      return { received: true, paymentId, status: paymentState.Status };
    } catch (error: any) {
      logger.error({ err: error, paymentId }, "barion_webhook.get_failed");
      set.status = 500;
      return { error: error.message || "Failed to process callback" };
    }
  })
  // Handle POST requests (Barion webhook with JSON body and signature)
  .post("/barion/webhook", async ({ request, set }) => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    set.headers["x-request-id"] = requestId;
    const logger = getLogger().child({ requestId });
    const path = new URL(request.url).pathname;
    logger.info(
      {
        method: request.method,
        path,
        contentLength: request.headers.get("content-length") ?? undefined,
        hasSignature: Boolean(request.headers.get("x-barion-signature")),
      },
      "barion_webhook.received",
    );

    // Get raw body for signature verification
    let rawBody: string;
    try {
      rawBody = await request.text();
      logger.info({ rawBodyLength: rawBody.length }, "barion_webhook.body_read");
    } catch (error: any) {
      logger.error({ err: error }, "barion_webhook.body_read_failed");
      set.status = 400;
      return { error: "Failed to read request body" };
    }

    const signature = request.headers.get("x-barion-signature");

    // Signature is optional for POST requests (Barion may not always send it)
    // If signature is present, verify it; otherwise, process without verification
    if (signature) {
      // Get Barion provider and verify signature
      const barionProvider = getPaymentProviderByType("barion");
      let event;
      try {
        event = await barionProvider.verifyWebhookSignature(rawBody, signature);
        logger.info({ eventType: event.type }, "barion_webhook.verified");
      } catch (err: any) {
        logger.error({ err }, "barion_webhook.verify_failed");
        set.status = 400;
        return { error: err.message };
      }

      // Store raw event in database
      try {
        await db.insert(barionEvents).values({
          barionEventId: event.id,
          paymentId: event.data.PaymentId || null,
          type: event.type,
          created: event.created,
          livemode: event.livemode,
          payloadJson: JSON.parse(rawBody) as any,
        });
      } catch (err: any) {
        // If duplicate, that's okay (idempotency)
        if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
          logger.error({ err }, "barion_webhook.store_failed");
        }
      }

      // Acknowledge quickly
      // Process events asynchronously
      processBarionWebhookEvent(event, logger).catch((err) => {
        logger.error({ err }, "barion_webhook.process_failed");
      });

      return { received: true };
    } else {
      // No signature - try to parse payload (can be JSON or URL-encoded)
      logger.info("barion_webhook.no_signature");
      try {
        let paymentId: string | undefined;
        let payloadData: any;

        // Try to parse as JSON first
        try {
          payloadData = JSON.parse(rawBody);
          paymentId = payloadData.PaymentId || payloadData.paymentId;
        } catch {
          // If not JSON, try URL-encoded format (PaymentId=...)
          logger.info("barion_webhook.non_json_payload");
          const urlParams = new URLSearchParams(rawBody);
          paymentId = urlParams.get("PaymentId") || urlParams.get("paymentId") || undefined;
          
          // If still not found, try direct parsing (PaymentId=value format)
          if (!paymentId && rawBody.includes("PaymentId=")) {
            const match = rawBody.match(/PaymentId=([^&\s]+)/);
            if (match) {
              paymentId = match[1];
            }
          }
          
          payloadData = { PaymentId: paymentId };
        }
        
        if (!paymentId) {
          logger.error({ rawBodyLength: rawBody.length }, "barion_webhook.payment_id_missing");
          set.status = 400;
          return { error: "Missing PaymentId in payload" };
        }

        logger.info({ paymentId }, "barion_webhook.payment_id_extracted");

        // Fetch payment state from Barion API to verify
        const barionProvider = getPaymentProviderByType("barion");
        if (!barionProvider.getPaymentState) {
          throw new Error("Barion provider does not support getPaymentState");
        }
        const paymentState = await barionProvider.getPaymentState(paymentId);

        const event = {
          id: paymentId,
          type: paymentState.Status === "Succeeded" ? "payment.completed" : "payment.state_changed",
          data: paymentState,
          created: new Date(),
          livemode: env.BARION_ENVIRONMENT === "production",
        };

        // Store event
        try {
          await db.insert(barionEvents).values({
            barionEventId: paymentId,
            paymentId: paymentId,
            type: event.type,
            created: event.created,
            livemode: event.livemode,
            payloadJson: paymentState as any,
          });
        } catch (err: any) {
          if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
            logger.error({ err }, "barion_webhook.store_failed");
          }
        }

        // Process event
        processBarionWebhookEvent(event, logger).catch((err) => {
          logger.error({ err }, "barion_webhook.process_failed");
        });

        return { received: true, paymentId };
      } catch (error: any) {
        logger.error({ err: error }, "barion_webhook.payload_parse_failed");
        set.status = 400;
        return { error: `Failed to process payload: ${error.message}` };
      }
    }
  });

/**
 * Process Barion webhook event
 */
async function processBarionWebhookEvent(event: any, logger: Logger): Promise<void> {
  try {
    const status = normalizeBarionStatus(event.data?.Status);

    // Barion sends payment state updates
    if (BARION_SUCCESS_STATUSES.has(status)) {
      await handleBarionPaymentCompleted(event, logger);
    } else if (BARION_CANCELLED_STATUSES.has(status) || BARION_FAILED_STATUSES.has(status)) {
      await handleBarionPaymentFailed(event, status, logger);
    } else {
      // Prepared/Started/other transitional states: no-op
      logger.info(
        {
          paymentId: event.id,
          status: event.data?.Status,
        },
        "barion_webhook.no_action",
      );
    }

    // Mark as processed
    await db
      .update(barionEvents)
      .set({ processedAt: new Date() })
      .where(eq(barionEvents.barionEventId, event.id));
  } catch (err: any) {
    // Mark processing error
    await db
      .update(barionEvents)
      .set({
        processingError: err.message,
      })
      .where(eq(barionEvents.barionEventId, event.id));
    throw err;
  }
}

/**
 * Handle Barion payment failed/canceled/expired event
 */
async function handleBarionPaymentFailed(event: any, status: string, logger: Logger): Promise<void> {
  const paymentData = event.data;
  const paymentId = paymentData.PaymentId;
  const paymentRequestId = paymentData.PaymentRequestId || paymentData.OrderNumber;

  if (!paymentRequestId) {
    throw new Error("Missing PaymentRequestId or OrderNumber in Barion webhook");
  }

  const orderId = paymentRequestId;
  const result = await getOrderById(db, orderId);
  if (!result) {
    throw new Error(`Order ${orderId} not found`);
  }

  const { order } = result;

  // If already paid/refunded, do not override
  if (order.status === "paid" || order.status === "refunded") {
    logger.info({ orderId, status: order.status }, "barion_webhook.order_already_settled");
    return;
  }

  const nextStatus =
    BARION_CANCELLED_STATUSES.has(status) ? "canceled" : "failed";

  await updateOrderPayment(db, orderId, {
    status: nextStatus,
    barionPaymentId: paymentId,
    barionPaymentRequestId: paymentRequestId,
  });

  const failure = paymentData.Errors?.[0];
  await createPayment(db, orderId, {
    status: "failed",
    amountCents: order.totalCents,
    currency: order.currency,
    provider: "barion",
    barionPaymentId: paymentId,
    barionTransactionId: paymentData.Transactions?.[0]?.POSTransactionId,
    failureCode: status,
    failureMessage: failure?.Description || failure?.Title || "Barion payment failed",
  });

  logger.info(
    {
      orderId,
      paymentId,
      paymentRequestId,
      nextStatus,
    },
    "barion_webhook.payment_failed",
  );

}

/**
 * Handle Barion payment completed event
 */
async function handleBarionPaymentCompleted(event: any, logger: Logger): Promise<void> {
  const paymentData = event.data;
  const paymentId = paymentData.PaymentId;
  const paymentRequestId = paymentData.PaymentRequestId || paymentData.OrderNumber;

  if (!paymentRequestId) {
    throw new Error("Missing PaymentRequestId or OrderNumber in Barion webhook");
  }

  // PaymentRequestId is the orderId
  const orderId = paymentRequestId;

  // Get order
  const result = await getOrderById(db, orderId);
  if (!result) {
    throw new Error(`Order ${orderId} not found`);
  }

  const { order } = result;

  // Idempotency check: if already paid, skip
  if (order.status === "paid") {
    logger.info({ orderId }, "barion_webhook.order_already_paid");
    return;
  }

  // Verify amount from transaction
  const transaction = paymentData.Transactions?.[0];
  if (transaction) {
    const barionAmount = transaction.Total || 0;
    logger.info({
      barionAmount,
      orderTotalCents: order.totalCents,
      currency: order.currency,
    }, "barion_webhook.amount_reconciliation");

    if (Math.abs(barionAmount - order.totalCents) > 0.01) {
      // Amount mismatch - mark as failed
      await updateOrderPayment(db, orderId, {
        status: "failed",
      });
      throw new Error(
        `Amount mismatch: Barion ${barionAmount} vs Order ${order.totalCents}`,
      );
    }
  }

  // Update order to paid
  await updateOrderPayment(db, orderId, {
    status: "paid",
    barionPaymentId: paymentId,
    barionPaymentRequestId: paymentRequestId,
  });

  // Create payment record
  await createPayment(db, orderId, {
    status: "succeeded",
    amountCents: order.totalCents,
    currency: order.currency,
    provider: "barion",
    barionPaymentId: paymentId,
    barionTransactionId: transaction?.POSTransactionId,
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
      .where(eq(user.id, order.userId))
      .limit(1);

    if (!userRow) {
      logger.error({ userId: order.userId, orderId }, "billingo.user_missing");
    } else {
      const [billing] = await db
        .select()
        .from(billingAddresses)
        .where(eq(billingAddresses.userId, order.userId))
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

      logger.info({ orderId, billingoInvoiceId }, "billingo.invoice_created");
    }
  } catch (error: any) {
    // Log error but don't fail the webhook - invoice creation is not critical
    logger.error({ err: error, orderId }, "billingo.invoice_failed");
  }
}
