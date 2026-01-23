/**
 * Barion API Client
 * Handles all communication with Barion API
 */

import {
  BarionPaymentStartRequest,
  BarionPaymentStartResponse,
  BarionGetPaymentStateResponse,
  BarionApiError,
} from "./types";
import { BARION_API_ENDPOINTS } from "./constants";

export class BarionApiClient {
  private baseUrl: string;
  private posKey: string;

  constructor(baseUrl: string, posKey: string) {
    this.baseUrl = baseUrl;
    this.posKey = posKey;
  }

  /**
   * Start a new payment
   */
  async startPayment(
    request: Omit<BarionPaymentStartRequest, "POSKey">,
  ): Promise<BarionPaymentStartResponse> {
    const fullRequest: BarionPaymentStartRequest = {
      ...request,
      POSKey: this.posKey,
    };

    return this.makeRequest<BarionPaymentStartResponse>(
      "/Payment/Start",
      "POST",
      fullRequest,
    );
  }

  /**
   * Get payment state
   */
  async getPaymentState(paymentId: string): Promise<BarionGetPaymentStateResponse> {
    const url = `/Payment/GetPaymentState?POSKey=${encodeURIComponent(this.posKey)}&PaymentId=${encodeURIComponent(paymentId)}`;
    return this.makeRequest<BarionGetPaymentStateResponse>(url, "GET");
  }

  /**
   * Make HTTP request to Barion API
   */
  private async makeRequest<T>(
    endpoint: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (body && method === "POST") {
      requestOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, requestOptions);

      // Read response text first (in case of error)
      const responseText = await response.text();

      if (!response.ok) {
        let parsedError: unknown;
        try {
          parsedError = JSON.parse(responseText);
        } catch {
          // If not JSON, use raw text
          parsedError = responseText;
        }

        const error: BarionApiError = new Error(
          `Barion API error: ${response.status} ${response.statusText}`,
        ) as BarionApiError;
        error.statusCode = response.status;
        error.responseBody = responseText;

        // Try to extract Barion errors from response
        if (
          typeof parsedError === "object" &&
          parsedError !== null &&
          "Errors" in parsedError &&
          Array.isArray((parsedError as any).Errors)
        ) {
          error.errors = (parsedError as any).Errors;
        }

        throw error;
      }

      // Parse successful response
      const result: T = JSON.parse(responseText);

      // Check for errors in response (Barion can return 200 with errors)
      if (
        typeof result === "object" &&
        result !== null &&
        "Errors" in result &&
        Array.isArray((result as any).Errors) &&
        (result as any).Errors.length > 0
      ) {
        const error: BarionApiError = new Error(
          `Barion API returned errors: ${(result as any).Errors.map((e: any) => e.Description).join(", ")}`,
        ) as BarionApiError;
        error.errors = (result as any).Errors;
        throw error;
      }

      return result;
    } catch (error) {
      // Re-throw BarionApiError as-is
      if (error instanceof Error && "statusCode" in error) {
        throw error;
      }

      // Wrap other errors
      throw new Error(
        `Failed to communicate with Barion API: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
