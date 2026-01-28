import { eq } from "drizzle-orm"

import { db } from "../lib/db"
import { pricingPlans } from "../../packages/db/src/schema"
import { createLogger, setLogger } from "../lib/logger"

const logger = createLogger("backend")
setLogger(logger)

type SeedPricingPlan = {
  code: string
  name: string
  credits: number
  priceCents: number
  promoEnabled?: boolean
  promoPriceCents?: number
  promoStartsAt?: Date
  promoEndsAt?: Date
}

const SEED: SeedPricingPlan[] = [
  {
    code: "pack_1000",
    name: "Kezdő csomag",
    credits: 1000,
    priceCents: 2990, // 2990 HUF = ~3 EUR
    promoEnabled: false,
  },
  {
    code: "pack_3000",
    name: "Népszerű választás",
    credits: 3000,
    priceCents: 7990, // 7990 HUF = ~8 EUR
    promoEnabled: false,
  },
  {
    code: "pack_5000",
    name: "Nagy csomag",
    credits: 5000,
    priceCents: 11990, // 11990 HUF = ~12 EUR
    promoEnabled: false,
  },
  {
    code: "pack_10000",
    name: "Mega csomag",
    credits: 10000,
    priceCents: 21990, // 21990 HUF = ~22 EUR
    promoEnabled: false,
  },
]

export async function seedPricing() {
  logger.info("pricing.seed_start")

  for (const plan of SEED) {
    // Check if plan already exists
    const existing = await db
      .select({ id: pricingPlans.id })
      .from(pricingPlans)
      .where(eq(pricingPlans.code, plan.code))
      .limit(1)

    if (existing.length > 0) {
      logger.info({ code: plan.code }, "pricing.plan_exists_skip")
      continue
    }

    // Insert new plan
    await db.insert(pricingPlans).values({
      code: plan.code,
      name: plan.name,
      credits: plan.credits,
      currency: "HUF",
      priceCents: plan.priceCents,
      isActive: true,
      promoEnabled: plan.promoEnabled ?? false,
      promoPriceCents: plan.promoPriceCents ?? null,
      promoStartsAt: plan.promoStartsAt ?? null,
      promoEndsAt: plan.promoEndsAt ?? null,
    })

    // Note: For HUF, priceCents is stored directly in forints (2990 = 2990 Ft), not divided by 100
    logger.info(
      {
        name: plan.name,
        code: plan.code,
        credits: plan.credits,
        priceCents: plan.priceCents,
        currency: "HUF",
      },
      "pricing.plan_created",
    )
  }

  logger.info("pricing.seed_complete")
}

// Allow running directly: `bun src/scripts/seed-pricing.ts`
if (import.meta.main) {
  seedPricing()
    .then(() => {
      logger.info("pricing.seed_done")
      process.exit(0)
    })
    .catch((err) => {
      logger.error({ err }, "pricing.seed_failed")
      process.exit(1)
    })
}
