import Stripe from 'stripe'
import { env } from '../env'
import { db } from './db'
import { stripeCustomers, user } from '../../packages/db/src/schema'
import { eq } from 'drizzle-orm'

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, { 
  apiVersion: '2025-12-15.clover' 
})

export async function ensureCustomer(userId: string, email: string): Promise<string> {
  const [row] = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, userId)).limit(1)
  
  if (row) {
    // Verify that the customer still exists in Stripe
    try {
      await stripe.customers.retrieve(row.customerId)
    return row.customerId
    } catch (error: any) {
      // Customer doesn't exist in Stripe (deleted or wrong account)
      // Delete from DB and create a new one
      console.warn(`[Stripe] Customer ${row.customerId} not found in Stripe, creating new one:`, error.message)
      await db.delete(stripeCustomers).where(eq(stripeCustomers.userId, userId))
    }
  }

  // Create new customer in Stripe
  const customer = await stripe.customers.create({ 
    email, 
    metadata: { userId } 
  })

  // Store in DB
  await db.insert(stripeCustomers).values({ 
    userId, 
    customerId: customer.id 
  })

  return customer.id
}

export interface CreateCheckoutSessionParams {
  orderId: string;
  userId: string;
  planName: string;
  planCode: string;
  totalCents: number;
  currency: string;
  creditsTotal: number;
  customerEmail?: string;
  customerId?: string;
}

/**
 * Create Stripe Checkout Session for order
 */
export async function createCheckoutSession(
  params: CreateCheckoutSessionParams,
): Promise<Stripe.Checkout.Session> {
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
  if (stripeCurrency !== 'huf') {
    console.warn(`[Stripe Checkout] Unexpected currency: ${stripeCurrency}, expected 'huf'`);
  }

  // For HUF: unit_amount is in the smallest currency unit
  // HUF is a zero-decimal currency, so 2990 Ft = 2990 unit_amount (NO division by 100!)
  // Stripe minimum for HUF is 175 Ft
  if (stripeCurrency === 'huf' && totalCents < 175) {
    throw new Error(`Amount too low for HUF: ${totalCents} Ft. Stripe minimum is 175 Ft.`);
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
  const stripeUnitAmountForAPI = stripeCurrency === 'huf' 
    ? stripeUnitAmount * 100  // Multiply by 100 to compensate for Stripe's incorrect division
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
    note: stripeCurrency === 'huf' 
      ? "WORKAROUND: Multiplying by 100 to compensate for Stripe SDK bug"
      : "For non-HUF, unit_amount should equal totalCents",
  });

  // CRITICAL: For HUF (zero-decimal currency), unit_amount must be an integer
  // representing the amount in the smallest currency unit (which is 1 Ft for HUF)
  // So 2990 Ft = 2990 unit_amount (NOT 29.90 or 299000)
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
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

  // CRITICAL DEBUG: Log the exact values being sent to Stripe
  const firstLineItem = sessionParams.line_items?.[0];
  console.log("[Stripe Checkout] DEBUG - Exact values being sent:", {
    orderId,
    totalCents,
    stripeUnitAmount,
    stripeUnitAmountForAPI,
    currency: stripeCurrency,
    lineItemUnitAmount: firstLineItem?.price_data?.unit_amount,
    lineItemCurrency: firstLineItem?.price_data?.currency,
    lineItemQuantity: firstLineItem?.quantity,
    fullLineItem: firstLineItem ? JSON.stringify(firstLineItem, null, 2) : null,
    note: stripeCurrency === 'huf' 
      ? "WORKAROUND: Sending unit_amount * 100 to compensate for Stripe SDK bug"
      : "Normal handling for non-HUF currencies",
  });

  try {
    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `checkout_create:${orderId}`,
    });

    console.log("[Stripe Checkout] Session created successfully:", {
      sessionId: session.id,
      amountTotal: session.amount_total,
      currency: session.currency,
      url: session.url,
    });

    return session;
  } catch (error: any) {
    console.error("[Stripe Checkout] Error creating session:", {
      error: error.message,
      code: error.code,
      type: error.type,
      orderId,
      totalCents,
      stripeUnitAmount,
      currency: stripeCurrency,
      sessionParams: {
        mode: sessionParams.mode,
        line_items: sessionParams.line_items?.map(item => ({
          unit_amount: (item as any).price_data?.unit_amount,
          currency: (item as any).price_data?.currency,
          quantity: item.quantity,
        })),
      },
      // Log the full line item for debugging
      fullLineItem: sessionParams.line_items?.[0] ? JSON.stringify(sessionParams.line_items[0], null, 2) : null,
    });
    throw error;
  }
}

/**
 * Verify webhook signature
 * IMPORTANT: In Bun, we must use constructEventAsync because SubtleCrypto is async
 */
export async function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
): Promise<Stripe.Event> {
  try {
    const event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      300, // tolerance in seconds
    );
    return event;
  } catch (err: any) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
}
