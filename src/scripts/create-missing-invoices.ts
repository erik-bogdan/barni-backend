import { eq, and, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import { orders, orderItems, user, billingAddresses } from "../../packages/db/src/schema";
import { getOrderById } from "../services/orders";
import { createInvoiceForOrder } from "../services/billingo";
import { updateOrderPayment } from "../services/orders";

/**
 * Create missing Billingo invoices for paid orders
 */
export async function createMissingInvoices() {
  console.log("🔍 Searching for paid orders without Billingo invoices...");

  // Find all paid orders without billingoInvoiceId
  const ordersWithoutInvoice = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "paid"),
        isNull(orders.billingoInvoiceId),
      ),
    )
    .orderBy(orders.createdAt);

  console.log(`📋 Found ${ordersWithoutInvoice.length} orders without invoices`);

  if (ordersWithoutInvoice.length === 0) {
    console.log("✅ All paid orders already have invoices");
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (const order of ordersWithoutInvoice) {
    try {
      console.log(`\n📄 Processing order ${order.id}...`);

      // Get order with items
      const orderResult = await getOrderById(db, order.id);
      if (!orderResult) {
        console.error(`❌ Order ${order.id} not found`);
        errorCount++;
        continue;
      }

      const { order: fullOrder, items } = orderResult;

      // Get user profile and billing address
      const [userRow] = await db
        .select()
        .from(user)
        .where(eq(user.id, fullOrder.userId))
        .limit(1);

      if (!userRow) {
        console.error(`❌ User ${fullOrder.userId} not found for order ${order.id}`);
        errorCount++;
        continue;
      }

      const [billing] = await db
        .select()
        .from(billingAddresses)
        .where(eq(billingAddresses.userId, fullOrder.userId))
        .limit(1);

      const userProfile = {
        email: userRow.email,
        firstName: userRow.firstName,
        lastName: userRow.lastName,
        billingAddress: billing
          ? {
              name: billing.name,
              street: billing.street,
              city: billing.city,
              postalCode: billing.postalCode,
              country: billing.country,
              taxNumber: billing.taxNumber,
            }
          : null,
      };

      // Create invoice
      console.log(`  💰 Creating invoice for order ${order.id}...`);
      const billingoInvoiceId = await createInvoiceForOrder(
        {
          id: fullOrder.id,
          totalCents: fullOrder.totalCents,
          subtotalCents: fullOrder.subtotalCents,
          discountCents: fullOrder.discountCents,
          currency: fullOrder.currency,
          createdAt: fullOrder.createdAt,
        },
        items.map((item) => ({
          planNameSnapshot: item.planNameSnapshot,
          quantity: item.quantity,
          lineSubtotalCents: item.lineSubtotalCents,
          creditsPerUnitSnapshot: item.creditsPerUnitSnapshot,
        })),
        userProfile,
      );

      // Save invoice ID to order
      await updateOrderPayment(db, order.id, {
        billingoInvoiceId,
      });

      console.log(`  ✅ Invoice created: ${billingoInvoiceId} for order ${order.id}`);
      successCount++;
    } catch (error: any) {
      console.error(`  ❌ Failed to create invoice for order ${order.id}:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Errors: ${errorCount}`);
  console.log(`  📋 Total processed: ${ordersWithoutInvoice.length}`);
}

// Allow running directly: `bun src/scripts/create-missing-invoices.ts`
if (import.meta.main) {
  createMissingInvoices()
    .then(() => {
      console.log("\n✅ Script completed");
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n❌ Script failed:", err);
      process.exit(1);
    });
}
