/**
 * Payment Provider Interface
 * 
 * This interface abstracts payment provider implementations (Stripe, Barion, etc.)
 * to allow easy switching between providers.
 */

export type PaymentProviderType = "stripe" | "barion";

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

export interface CheckoutSession {
  id: string;
  url: string | null;
  amountTotal: number;
  currency: string;
  metadata?: Record<string, string>;
  paymentIntentId?: string;
  customerId?: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  created: Date;
  livemode: boolean;
}

export interface PaymentProvider {
  /**
   * Provider type identifier
   */
  readonly type: PaymentProviderType;

  /**
   * Create a checkout session for payment
   */
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession>;

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<WebhookEvent>;

  /**
   * Ensure customer exists in the payment provider system
   */
  ensureCustomer(userId: string, email: string): Promise<string>;

  /**
   * Get minimum amount for the provider (in cents)
   */
  getMinimumAmount(currency: string): number;
}
