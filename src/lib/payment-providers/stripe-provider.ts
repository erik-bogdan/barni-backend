/**
 * Stripe Payment Provider Implementation
 */

import Stripe from "stripe";
import { env } from "../../env";
import { db } from "../db";
import { stripeCustomers, user } from "../../../packages/db/src/schema";
import { eq } from "drizzle-orm";
import type {
  PaymentProvider,
  CreateCheckoutSessionParams,
  CheckoutSession,
  WebhookEvent,
} from "./types";

export class StripeProvider implements PaymentProvider {
  readonly type = "stripe" as const;
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-12-15.clover",
    });
  }

  async ensureCustomer(userId: string, email: string): Promise<string> {
    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.userId, userId))
      .limit(1);

    if (row) {
      // Verify that the customer still exists in Stripe
      try {
        await this.stripe.customers.retrieve(row.customerId);
        return row.customerId;
      } catch (error: any) {
        // Customer doesn't exist in Stripe (deleted or wrong account)
        // Delete from DB and create a new one
        console.warn(
          `[Stripe] Customer ${row.customerId} not found in Stripe, creating new one:`,
          error.message,
        );
        await db.delete(stripeCustomers).where(eq(stripeCustomers.userId, userId));
      }
    }

    // Create new customer in Stripe
    const customer = await this.stripe.customers.create({
      email,
      metadata: { userId },
    });

    // Store in DB
    await db.insert(stripeCustomers).values({
      userId,
      customerId: customer.id,
    });

    return customer.id;
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    const {
      orderId,
      userId,
      planName,
      planCode,
      totalCents,
      currency,
      creditsTotal,
      customerEmail,
      customerId,
    } = params;

    // IMPORTANT: totalCents is backend-calculated and validated
    // This is the final amount after all discounts, must match order.totalCents

    // Ensure currency is lowercase and valid
    const stripeCurrency = currency.toLowerCase();
    if (stripeCurrency !== "huf") {
      console.warn(
        `[Stripe Checkout] Unexpected currency: ${stripeCurrency}, expected 'huf'`,
      );
    }

    // For HUF: unit_amount is in the smallest currency unit
    // HUF is a zero-decimal currency, so 2990 Ft = 2990 unit_amount (NO division by 100!)
    // Stripe minimum for HUF is 175 Ft
    if (stripeCurrency === "huf" && totalCents < 175) {
      throw new Error(
        `Amount too low for HUF: ${totalCents} Ft. Stripe minimum is 175 Ft.`,
      );
    }

    // CRITICAL: Ensure totalCents is an integer and not divided by 100
    // For HUF, we store prices directly in forints (2990 = 2990 Ft), not in "cents"
    const stripeUnitAmount = Math.round(totalCents);

    if (stripeUnitAmount !== totalCents) {
      throw new Error(`Invalid amount: ${totalCents} is not an integer`);
    }

    // WORKAROUND: If Stripe SDK/API version incorrectly divides by 100 for HUF,
    // we need to multiply by 100 to compensate
    // This is a bug in Stripe SDK/API, but we need to work around it
    const stripeUnitAmountForAPI =
      stripeCurrency === "huf"
        ? stripeUnitAmount * 100 // Multiply by 100 to compensate for Stripe's incorrect division
        : stripeUnitAmount;

    // Log for debugging
    console.log("[Stripe Checkout] Creating session with:", {
      orderId,
      totalCents,
      stripeUnitAmount,
      stripeUnitAmountForAPI,
      currency: stripeCurrency,
      creditsTotal,
      planCode,
      note:
        stripeCurrency === "huf"
          ? "WORKAROUND: Multiplying by 100 to compensate for Stripe SDK bug"
          : "For non-HUF, unit_amount should equal totalCents",
    });

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: stripeCurrency, // 'huf' for HUF
            // CRITICAL: For HUF, we multiply by 100 to compensate for Stripe SDK bug
            // that incorrectly divides by 100 for zero-decimal currencies
            // So 2990 Ft -> 299000 unit_amount -> Stripe sees it as 2990 Ft
            unit_amount: Number.parseInt(String(stripeUnitAmountForAPI), 10), // Force integer
            product_data: {
              name: planName,
              description: `${creditsTotal} Mesetallér`,
              metadata: {
                plan_code: planCode,
              },
            },
          },
          quantity: 1, // Always 1
        },
      ],
      success_url: `${env.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`,
      cancel_url: env.STRIPE_CANCEL_URL,
      metadata: {
        order_id: orderId,
        user_id: userId,
        plan_code: planCode,
        credits_total: creditsTotal.toString(),
      },
    };

    if (customerId) {
      sessionParams.customer = customerId;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    try {
      const session = await this.stripe.checkout.sessions.create(sessionParams, {
        idempotencyKey: `checkout_create:${orderId}`,
      });

      console.log("[Stripe Checkout] Session created successfully:", {
        sessionId: session.id,
        amountTotal: session.amount_total,
        currency: session.currency,
        url: session.url,
      });

      return {
        id: session.id,
        url: session.url,
        amountTotal: session.amount_total ?? 0,
        currency: session.currency ?? stripeCurrency,
        metadata: session.metadata as Record<string, string>,
        paymentIntentId: session.payment_intent as string | undefined,
        customerId: session.customer as string | undefined,
      };
    } catch (error: any) {
      console.error("[Stripe Checkout] Error creating session:", {
        error: error.message,
        code: error.code,
        type: error.type,
        orderId,
        totalCents,
        stripeUnitAmount,
        currency: stripeCurrency,
      });
      throw error;
    }
  }

  async verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
  ): Promise<WebhookEvent> {
    try {
      const event = await this.stripe.webhooks.constructEventAsync(
        payload,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
        300, // tolerance in seconds
      );

      return {
        id: event.id,
        type: event.type,
        data: event.data,
        created: new Date(event.created * 1000),
        livemode: event.livemode,
      };
    } catch (err: any) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }
  }

  getMinimumAmount(currency: string): number {
    const normalizedCurrency = currency.toLowerCase();
    // Stripe minimum for HUF is 175 Ft
    if (normalizedCurrency === "huf") {
      return 175;
    }
    // Default minimum (adjust based on Stripe's requirements for other currencies)
    return 50; // 0.50 in major currencies
  }
}
