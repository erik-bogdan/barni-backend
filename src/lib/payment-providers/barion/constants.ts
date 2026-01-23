/**
 * Barion API Constants
 */

export const BARION_API_ENDPOINTS = {
  PRODUCTION: "https://api.barion.com/v2",
  SANDBOX: "https://api.test.barion.com/v2",
} as const;

export const BARION_PAYMENT_STATUS = {
  PREPARED: "Prepared",
  STARTED: "Started",
  IN_PROGRESS: "InProgress",
  WAITING: "Waiting",
  RESERVED: "Reserved",
  AUTHORIZED: "Authorized",
  CANCELED: "Canceled",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  PARTIALLY_SUCCEEDED: "PartiallySucceeded",
  EXPIRED: "Expired",
} as const;

export const BARION_MINIMUM_AMOUNTS = {
  HUF: 100,
  EUR: 50, // 0.50 EUR in cents
  USD: 50, // 0.50 USD in cents
  DEFAULT: 50,
} as const;

export const BARION_PAYMENT_WINDOW = "00:15:00"; // 15 minutes

export const BARION_LOCALES = {
  HU: "hu-HU",
  EN: "en-US",
} as const;
