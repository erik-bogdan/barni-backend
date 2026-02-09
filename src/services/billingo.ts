import { env } from "../env";
import { 
  OpenAPI, 
  PartnerService, 
  DocumentService,
  type Partner,
  type DocumentInsert,
  type Address,
  DocumentInsertType,
  PaymentMethod,
  DocumentLanguage,
  Currency,
} from "@codingsans/billingo-client";
import { getLogger } from "../lib/logger";

// Initialize Billingo client
OpenAPI.HEADERS = {
  "X-API-KEY": env.BILLINGO_API_KEY,
};

/**
 * Create invoice for order
 */
export async function createInvoiceForOrder(
  order: {
    id: string;
    totalCents: number;
    subtotalCents: number;
    discountCents: number;
    currency: string;
    createdAt: Date;
  },
  items: Array<{
    planNameSnapshot: string;
    quantity: number;
    lineSubtotalCents: number;
    creditsPerUnitSnapshot: number;
  }>,
  userProfile: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    billingAddress: {
      name: string;
      street: string;
      city: string;
      postalCode: string;
      country: string;
      taxNumber: string | null;
    } | null;
  },
): Promise<number> {
  // Create or get partner
  let partnerName = userProfile.billingAddress?.name || 
    `${userProfile.firstName || ""} ${userProfile.lastName || ""}`.trim() || 
    "Vásárló";
  
  // Ensure name is not empty
  if (!partnerName || partnerName.trim() === "") {
    partnerName = "Vásárló";
  }

  // Build partner address - Billingo requires address fields
  let partnerAddress: Address;

  if (
    userProfile.billingAddress &&
    userProfile.billingAddress.postalCode &&
    userProfile.billingAddress.postalCode.trim() !== "" &&
    userProfile.billingAddress.city &&
    userProfile.billingAddress.city.trim() !== "" &&
    userProfile.billingAddress.street &&
    userProfile.billingAddress.street.trim() !== ""
  ) {
    const countryCode = userProfile.billingAddress.country === "Hungary" || 
                        userProfile.billingAddress.country === "Magyarország" || 
                        userProfile.billingAddress.country === "HU" 
                          ? "HU" 
                          : "XX";
    
    partnerAddress = {
      country_code: countryCode as any, // Country enum
      post_code: userProfile.billingAddress.postalCode.trim(),
      city: userProfile.billingAddress.city.trim(),
      address: userProfile.billingAddress.street.trim(),
    };
  } else {
    // Use minimal required address fields if missing
    getLogger().warn(
      {
        hasBillingAddress: Boolean(userProfile.billingAddress),
        hasPostalCode: Boolean(userProfile.billingAddress?.postalCode),
        hasCity: Boolean(userProfile.billingAddress?.city),
        hasStreet: Boolean(userProfile.billingAddress?.street),
      },
      "billingo.default_address_used",
    );
    
    partnerAddress = {
      country_code: "HU" as any,
      post_code: "0000",
      city: "Budapest",
      address: "N/A",
    };
  }

  // Build partner object using library types
  const partner: Partner = {
    name: partnerName.trim(),
    address: partnerAddress,
  };

  // Add optional fields
  if (userProfile.email && userProfile.email.trim() !== "") {
    partner.emails = [userProfile.email];
  }

  if (userProfile.billingAddress?.taxNumber && userProfile.billingAddress.taxNumber.trim() !== "") {
    partner.taxcode = userProfile.billingAddress.taxNumber.trim();
  }

  getLogger().info(
    {
      hasEmail: Boolean(partner.emails?.length),
      hasTaxCode: Boolean(partner.taxcode),
    },
    "billingo.partner_create",
  );

  // Create partner using library - directly pass Partner object
  const partnerResponse = await PartnerService.createPartner(partner);

  const partnerId = partnerResponse.id;
  if (!partnerId) {
    throw new Error("Failed to create partner: no ID returned");
  }

  getLogger().info({ partnerId }, "billingo.partner_created");

  // Format dates
  const today = new Date();
  const fulfillmentDate = today.toISOString().split("T")[0]; // YYYY-MM-DD
  const dueDate = today.toISOString().split("T")[0]; // YYYY-MM-DD (same day for paid invoices)

  // Create invoice items - using DocumentProductData format
  const invoiceItems: any[] = items.map((item) => ({
    name: `${item.planNameSnapshot} (${item.creditsPerUnitSnapshot.toLocaleString("hu-HU")} mesetallér)`,
    unit_price: item.lineSubtotalCents, // For HUF, this is the actual amount (2990, not 29.90)
    unit_price_type: "gross",
    quantity: item.quantity,
    unit: "db",
    vat: "AAM", // 0% VAT (Áfa alanyiság mentes)
    comment: `Rendelés: ${order.id.slice(0, 8)}`,
  }));

  // If there's a discount, add it as a negative line item
  if (order.discountCents > 0) {
    invoiceItems.push({
      name: "Kedvezmény",
      unit_price: -order.discountCents, // Negative amount for discount
      unit_price_type: "gross",
      quantity: 1,
      unit: "db",
      vat: "AAM",
      comment: "Voucher kedvezmény",
    });
  }

  // Create invoice document using library - directly pass DocumentInsert object
  const blockId = env.BILLINGO_BLOCK_ID ? parseInt(env.BILLINGO_BLOCK_ID, 10) : 0;
  const documentInsert: DocumentInsert = {
    partner_id: partnerId,
    block_id: blockId, // Configurable via BILLINGO_BLOCK_ID env var, defaults to 0 (default block)
    type: DocumentInsertType.INVOICE,
    fulfillment_date: fulfillmentDate,
    due_date: dueDate,
    payment_method: PaymentMethod.ONLINE_BANKCARD,
    language: DocumentLanguage.HU,
    currency: order.currency as Currency,
    conversion_rate: 1,
    electronic: false,
    paid: true, // Already paid via Stripe
    items: invoiceItems,
    comment: `Stripe rendelés: ${order.id}`,
  };

  getLogger().info(
    {
      partnerId: documentInsert.partner_id,
      type: documentInsert.type,
      fulfillmentDate: documentInsert.fulfillment_date,
      itemsCount: documentInsert.items?.length || 0,
    },
    "billingo.invoice_create",
  );

  const documentResponse = await DocumentService.createDocument(documentInsert);

  const invoiceId = documentResponse.id;
  if (!invoiceId) {
    throw new Error("Failed to create invoice: no ID returned");
  }

  getLogger().info({ invoiceId }, "billingo.invoice_created");

  // Send invoice via email if email is available
  if (userProfile.email && userProfile.email.trim() !== "") {
    try {
      await sendInvoiceByEmail(invoiceId, [userProfile.email]);
      getLogger().info({ invoiceId, email: userProfile.email }, "billingo.invoice_sent");
    } catch (error) {
      // Log error but don't fail invoice creation - email sending is not critical
      getLogger().error(
        { err: error, invoiceId, email: userProfile.email },
        "billingo.invoice_send_failed",
      );
    }
  }

  return invoiceId;
}

/**
 * Send invoice by email using Billingo API
 */
export async function sendInvoiceByEmail(
  invoiceId: number,
  emails: string[],
): Promise<void> {
  // Use OpenAPI to make direct API call since DocumentService might not have sendDocument method
  const response = await fetch(
    `https://api.billingo.hu/v3/documents/${invoiceId}/send`,
    {
      method: "POST",
      headers: {
        "X-API-KEY": env.BILLINGO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        emails: emails.filter((email) => email && email.trim() !== ""),
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to send invoice: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const result = await response.json();
  getLogger().info(
    { invoiceId, sentEmails: result.emails },
    "billingo.invoice_sent_success",
  );
}

/**
 * Get invoice public URL
 */
export async function getInvoicePublicUrl(invoiceId: number): Promise<string> {
  const response = await DocumentService.getPublicUrl(invoiceId);
  
  return response.public_url || "";
}