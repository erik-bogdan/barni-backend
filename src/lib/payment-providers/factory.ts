/**
 * Payment Provider Factory
 * 
 * Creates and returns the appropriate payment provider based on configuration
 */

import { env } from "../../env";
import { StripeProvider } from "./stripe-provider";
import { BarionProvider } from "./barion-provider";
import type { PaymentProvider, PaymentProviderType } from "./types";
import { getLogger } from "../logger";

let stripeProvider: StripeProvider | null = null;
let barionProvider: BarionProvider | null = null;

/**
 * Get the configured payment provider
 * Defaults to the PAYMENT_PROVIDER env variable, or "stripe" if not set
 */
export function getPaymentProvider(): PaymentProvider {
  const providerType = (env.PAYMENT_PROVIDER || "stripe").toLowerCase() as PaymentProviderType;

  switch (providerType) {
    case "stripe":
      if (!stripeProvider) {
        stripeProvider = new StripeProvider();
      }
      return stripeProvider;

    case "barion":
      if (!barionProvider) {
        barionProvider = new BarionProvider();
      }
      return barionProvider;

    default:
      getLogger().warn(
        { providerType },
        "payment_provider.unknown_defaulting_stripe",
      );
      if (!stripeProvider) {
        stripeProvider = new StripeProvider();
      }
      return stripeProvider;
  }
}

/**
 * Get a specific payment provider by type
 */
export function getPaymentProviderByType(type: PaymentProviderType): PaymentProvider {
  switch (type) {
    case "stripe":
      if (!stripeProvider) {
        stripeProvider = new StripeProvider();
      }
      return stripeProvider;

    case "barion":
      if (!barionProvider) {
        barionProvider = new BarionProvider();
      }
      return barionProvider;

    default:
      throw new Error(`Unknown payment provider type: ${type}`);
  }
}

/**
 * Get the current provider type from configuration
 */
export function getCurrentProviderType(): PaymentProviderType {
  return (env.PAYMENT_PROVIDER || "stripe").toLowerCase() as PaymentProviderType;
}
