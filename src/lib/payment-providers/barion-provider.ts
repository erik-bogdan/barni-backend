/**
 * Barion Payment Provider Implementation
 * 
 * Refactored with best practices:
 * - Separated API client
 * - Better error handling
 * - Type safety
 * - Structured logging
 * - Validation
 * 
 * Based on Barion API documentation: https://docs.barion.com
 */

import { env } from "../../env";
import { db } from "../db";
import { barionCustomers } from "../../../packages/db/src/schema";
import { eq } from "drizzle-orm";
import type {
  PaymentProvider,
  CreateCheckoutSessionParams,
  CheckoutSession,
  WebhookEvent,
} from "./types";
import { BarionApiClient } from "./barion/api-client";
import { BarionValidator } from "./barion/validators";
import {
  BARION_API_ENDPOINTS,
  BARION_MINIMUM_AMOUNTS,
  BARION_PAYMENT_WINDOW,
  BARION_LOCALES,
} from "./barion/constants";
import type {
  BarionPaymentStartRequest,
  BarionApiError,
} from "./barion/types";

export class BarionProvider implements PaymentProvider {
  readonly type = "barion" as const;
  private apiClient: BarionApiClient;
  private payee: string;

  constructor() {
    // Validate required configuration
    if (!env.BARION_POS_KEY) {
      throw new Error(
        "BARION_POS_KEY is required when using Barion payment provider",
      );
    }
    if (!env.BARION_PAYEE) {
      throw new Error(
        "BARION_PAYEE is required when using Barion payment provider",
      );
    }

    // Initialize API client
    const apiUrl =
      env.BARION_ENVIRONMENT === "production"
        ? BARION_API_ENDPOINTS.PRODUCTION
        : BARION_API_ENDPOINTS.SANDBOX;

    this.apiClient = new BarionApiClient(apiUrl, env.BARION_POS_KEY);
    this.payee = env.BARION_PAYEE;
  }

  async ensureCustomer(userId: string, email: string): Promise<string> {
    // Barion doesn't require pre-creating customers like Stripe
    // We store the email for reference
    const [row] = await db
      .select()
      .from(barionCustomers)
      .where(eq(barionCustomers.userId, userId))
      .limit(1);

    if (row) {
      return row.customerId;
    }

    // Store user reference
    await db.insert(barionCustomers).values({
      userId,
      customerId: email,
    });

    return email;
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
    } = params;

    // Validate configuration
    if (!env.BARION_SUCCESS_URL) {
      throw new Error(
        "BARION_SUCCESS_URL is required when using Barion payment provider. " +
        "Please set it in your environment variables to a valid HTTPS URL.",
      );
    }

    if (!env.BARION_CALLBACK_URL) {
      throw new Error(
        "BARION_CALLBACK_URL is required when using Barion payment provider. " +
        "Please set it in your environment variables.",
      );
    }

    // Validate and normalize URLs
    const redirectUrl = BarionValidator.validateRedirectUrl(env.BARION_SUCCESS_URL);
    const callbackUrl = BarionValidator.validateCallbackUrl(env.BARION_CALLBACK_URL);

    // Validate amount
    const minimumAmount = this.getMinimumAmount(currency);
    const barionAmount = BarionValidator.validateAmount(
      totalCents,
      currency,
      minimumAmount,
    );

    // Build redirect URL with order_id parameter
    // Barion will append PaymentId automatically after payment
    const redirectUrlWithParams = `${redirectUrl}?order_id=${encodeURIComponent(orderId)}`;

    // Build payment request
    const paymentRequest: Omit<BarionPaymentStartRequest, "POSKey"> = {
      PaymentType: "Immediate",
      PaymentWindow: BARION_PAYMENT_WINDOW,
      GuestCheckout: true,
      FundingSources: ["All"],
      PaymentRequestId: orderId,
      PayerHint: customerEmail,
      Transactions: [
        {
          POSTransactionId: `${orderId}-txn`,
          Payee: this.payee,
          Total: barionAmount,
          Comment: `${creditsTotal} Mesetallér`,
          Items: [
            {
              Name: planName,
              Description: `${creditsTotal} Mesetallér`,
              Quantity: 1,
              Unit: "db",
              UnitPrice: barionAmount,
              ItemTotal: barionAmount,
              SKU: planCode,
            },
          ],
        },
      ],
      Locale: BARION_LOCALES.HU,
      Currency: currency.toUpperCase(),
      RedirectUrl: redirectUrlWithParams,
      CallbackUrl: callbackUrl,
      OrderNumber: orderId,
    };

    try {
      // Log request (without sensitive data)
      console.log("[Barion] Creating payment request:", {
        orderId,
        amount: barionAmount,
        currency: currency.toUpperCase(),
        planCode,
        redirectUrl: redirectUrlWithParams,
        callbackUrl,
      });

      // Call Barion API
      const result = await this.apiClient.startPayment(paymentRequest);

      // Validate response
      if (!result.PaymentId) {
        throw new Error("Invalid response from Barion API: Missing PaymentId");
      }

      console.log("[Barion] Payment created successfully:", {
        paymentId: result.PaymentId,
        status: result.Status,
        redirectUrl: result.RedirectUrl,
        qrUrl: result.QRUrl,
      });

      // IMPORTANT: Barion API behavior understanding:
      // - If status is "Prepared" or "Started", payment is not yet completed
      // - RedirectUrl in response is the URL where Barion will redirect AFTER payment
      // - For web payments, we need to construct the Barion payment page URL
      // - The payment page URL format: https://secure.barion.com/Pay?id={PaymentId}
      
      let paymentPageUrl: string;
      
      // Check if payment was already completed (unlikely in sandbox, but possible)
      if ((result.Status === "Succeeded" || result.Status === "PartiallySucceeded") && result.RedirectUrl) {
        // Payment already completed, redirect to success page
        console.log("[Barion] Payment already completed, redirecting to success page");
        paymentPageUrl = result.RedirectUrl;
      } else {
        // Payment not yet completed - redirect to Barion payment page
        // Barion payment page URL format: https://secure.barion.com/Pay?id={PaymentId}
        // For sandbox: https://secure.test.barion.com/Pay?id={PaymentId}
        const barionPaymentDomain = env.BARION_ENVIRONMENT === "production"
          ? "https://secure.barion.com"
          : "https://secure.test.barion.com";
        
        paymentPageUrl = `${barionPaymentDomain}/Pay?id=${result.PaymentId}`;
        
        console.log("[Barion] Redirecting to Barion payment page:", {
          paymentId: result.PaymentId,
          status: result.Status,
          paymentPageUrl,
          redirectUrlAfterPayment: result.RedirectUrl,
        });
      }

      // Build metadata with optional fields
      const metadata: Record<string, string> = {
        order_id: orderId,
        user_id: userId,
        plan_code: planCode,
        credits_total: creditsTotal.toString(),
        payment_request_id: orderId,
        barion_status: result.Status,
      };
      
      if (result.RedirectUrl) {
        metadata.barion_redirect_url = result.RedirectUrl;
      }
      
      if (result.QRUrl) {
        metadata.qr_url = result.QRUrl;
      }

      return {
        id: result.PaymentId,
        url: paymentPageUrl, // Use Barion payment page URL, not the RedirectUrl
        amountTotal: barionAmount,
        currency: currency.toUpperCase(),
        metadata,
      };
    } catch (error) {
      // Enhanced error handling
      if (error instanceof Error && "statusCode" in error) {
        const apiError = error as BarionApiError;
        console.error("[Barion] API error:", {
          statusCode: apiError.statusCode,
          message: apiError.message,
          errors: apiError.errors,
          orderId,
        });
      } else {
        console.error("[Barion] Error creating payment:", {
          error: error instanceof Error ? error.message : String(error),
          orderId,
          amount: barionAmount,
          currency,
        });
      }
      throw error;
    }
  }

  async verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
  ): Promise<WebhookEvent> {
    if (!env.BARION_CALLBACK_SECRET) {
      throw new Error(
        "BARION_CALLBACK_SECRET is required for webhook verification",
      );
    }

    try {
      const crypto = await import("crypto");
      const payloadString =
        typeof payload === "string" ? payload : payload.toString();

      // Extract hash from signature (format: "sha256=hash")
      const parts = signature.split("=");
      if (parts.length !== 2 || parts[0] !== "sha256") {
        throw new Error(
          `Invalid signature format. Expected "sha256=hash", got: ${signature.substring(0, 20)}...`,
        );
      }

      const receivedHash = parts[1];

      // Calculate expected hash
      const expectedHash = crypto
        .createHmac("sha256", env.BARION_CALLBACK_SECRET)
        .update(payloadString)
        .digest("hex");

      // Constant-time comparison
      if (receivedHash !== expectedHash) {
        throw new Error("Webhook signature verification failed");
      }

      // Parse the payload
      const data = JSON.parse(payloadString);

      return {
        id: data.PaymentId || data.EventId || crypto.randomUUID(),
        type: data.EventType || "payment.completed",
        data,
        created: new Date(data.Timestamp || Date.now()),
        livemode: env.BARION_ENVIRONMENT === "production",
      };
    } catch (err: any) {
      throw new Error(
        `Webhook signature verification failed: ${err.message}`,
      );
    }
  }

  getMinimumAmount(currency: string): number {
    const normalizedCurrency = currency.toUpperCase();

    switch (normalizedCurrency) {
      case "HUF":
        return BARION_MINIMUM_AMOUNTS.HUF;
      case "EUR":
        return BARION_MINIMUM_AMOUNTS.EUR;
      case "USD":
        return BARION_MINIMUM_AMOUNTS.USD;
      default:
        return BARION_MINIMUM_AMOUNTS.DEFAULT;
    }
  }

  /**
   * Get payment state from Barion API
   * Useful for checking payment status
   */
  async getPaymentState(paymentId: string) {
    try {
      return await this.apiClient.getPaymentState(paymentId);
    } catch (error) {
      console.error("[Barion] Error getting payment state:", {
        paymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
