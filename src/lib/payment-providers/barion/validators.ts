/**
 * Barion URL and configuration validators
 */

export class BarionValidator {
  /**
   * Validate and normalize redirect URL
   */
  static validateRedirectUrl(url: string): string {
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch (error: any) {
      throw new Error(`Invalid redirect URL format: ${url}. ${error.message}`);
    }

    // Barion requires HTTPS
    if (urlObj.protocol !== "https:") {
      throw new Error(
        `Redirect URL must use HTTPS protocol. Current: ${urlObj.protocol}`,
      );
    }

    // Barion doesn't accept localhost
    if (urlObj.hostname === "localhost" || urlObj.hostname === "127.0.0.1") {
      throw new Error(
        "Barion does not accept localhost URLs. Please use a valid HTTPS URL with a real domain. " +
        "For local development, use ngrok or a similar tunneling service.",
      );
    }

    return url;
  }

  /**
   * Validate callback URL
   */
  static validateCallbackUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== "https:") {
        throw new Error("Callback URL must use HTTPS protocol");
      }
      return url;
    } catch (error: any) {
      throw new Error(`Invalid callback URL format: ${url}. ${error.message}`);
    }
  }

  /**
   * Validate amount
   */
  static validateAmount(amount: number, currency: string, minimum: number): number {
    const rounded = Math.round(amount);

    if (rounded !== amount) {
      throw new Error(`Invalid amount: ${amount} is not an integer`);
    }

    if (rounded < minimum) {
      throw new Error(
        `Amount too low for ${currency}: ${rounded}. Minimum is ${minimum}.`,
      );
    }

    return rounded;
  }
}
