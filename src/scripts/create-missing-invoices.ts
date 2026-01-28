import { eq, and, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import { orders, orderItems, user, billingAddresses } from "../../packages/db/src/schema";
import { getOrderById } from "../services/orders";
import { createInvoiceForOrder } from "../services/billingo";
import { updateOrderPayment } from "../services/orders";
import { createLogger, setLogger } from "../lib/logger";

const logger = createLogger("backend");
setLogger(logger);

/**
 * Create missing Billingo invoices for paid orders
 */
export async function createMissingInvoices() {
  logger.info("billingo.missing_invoices.search_start");

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

  logger.info(
    { count: ordersWithoutInvoice.length },
    "billingo.missing_invoices.found",
  );

  if (ordersWithoutInvoice.length === 0) {
    logger.info("billingo.missing_invoices.none");
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (const order of ordersWithoutInvoice) {
    try {
      logger.info({ orderId: order.id }, "billingo.missing_invoices.processing");

      // Get order with items
      const orderResult = await getOrderById(db, order.id);
      if (!orderResult) {
        logger.error({ orderId: order.id }, "billingo.missing_invoices.order_missing");
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
        logger.error(
          { orderId: order.id, userId: fullOrder.userId },
          "billingo.missing_invoices.user_missing",
        );
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
      logger.info({ orderId: order.id }, "billingo.missing_invoices.create_invoice");
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

      logger.info(
        { orderId: order.id, billingoInvoiceId },
        "billingo.missing_invoices.invoice_created",
      );
      successCount++;
    } catch (error: any) {
      logger.error(
        { err: error, orderId: order.id },
        "billingo.missing_invoices.invoice_failed",
      );
      errorCount++;
    }
  }

  logger.info(
    {
      successCount,
      errorCount,
      total: ordersWithoutInvoice.length,
    },
    "billingo.missing_invoices.summary",
  );
}

// Allow running directly: `bun src/scripts/create-missing-invoices.ts`
if (import.meta.main) {
  createMissingInvoices()
    .then(() => {
      logger.info("billingo.missing_invoices.completed");
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, "billingo.missing_invoices.failed");
      process.exit(1);
    });
}
