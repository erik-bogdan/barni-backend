/**
 * Barion API Types
 * Based on official Barion API documentation: https://docs.barion.com
 */

export interface BarionPaymentStartRequest {
  POSKey: string;
  PaymentType: "Immediate" | "Reservation";
  ReservationPeriod?: number;
  PaymentWindow?: string;
  GuestCheckout?: boolean;
  FundingSources: string[];
  PaymentRequestId: string;
  PayerHint?: string;
  Transactions: BarionTransaction[];
  Locale: string;
  Currency: string;
  RedirectUrl: string;
  CallbackUrl?: string;
  OrderNumber?: string;
}

export interface BarionTransaction {
  POSTransactionId: string;
  Payee: string;
  Total: number;
  Comment?: string;
  Items: BarionItem[];
}

export interface BarionItem {
  Name: string;
  Description?: string;
  Quantity: number;
  Unit: string;
  UnitPrice: number;
  ItemTotal: number;
  SKU?: string;
}

export interface BarionPaymentStartResponse {
  PaymentId: string;
  Status: string;
  QRUrl?: string;
  RecurrenceResult?: string;
  RedirectUrl: string;
  Errors?: BarionError[];
}

export interface BarionGetPaymentStateResponse {
  PaymentId: string;
  PaymentRequestId: string;
  Status: string;
  Transactions: Array<{
    POSTransactionId: string;
    Status: string;
    Total: number;
    Currency: string;
  }>;
  Errors?: BarionError[];
}

export interface BarionError {
  ErrorCode: string;
  Title: string;
  Description: string;
}

export interface BarionApiError extends Error {
  statusCode?: number;
  errors?: BarionError[];
  responseBody?: string;
}
