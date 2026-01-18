import { Elysia, t } from 'elysia'
import { sql, eq, desc, gte, and, or } from 'drizzle-orm'

import { db } from '../lib/db'
import { betterAuthMiddleware } from '../plugins/auth/middleware'
import { requireRole } from '../plugins/auth/requireRole'
import { user, stories, orders, pricingPlans, coupons, orderItems, storyTransactions, storyCreditTransactions, children, stripeEvents, payments } from '../../packages/db/src/schema'
import { calculateGPTCost, calculateAudioCost } from '../services/gpt-cost'
import { getPresignedUrl } from '../services/s3'
import { buildCoverKey, buildCoverSquareKey } from '../services/cover/coverService'
import { buildAudioKey } from '../services/audio'

export const dash = new Elysia({ name: 'dash', prefix: '/admin' })
  .use(betterAuthMiddleware)
  .use(requireRole('admin'))
  .get('/dashboard/stats', async () => {
    // Calculate date 7 days ago as ISO timestamp string (no Date objects in queries)
    const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Total counts
    const [{ users: totalUsers }] =
      await db.select({ users: sql<number>`COUNT(*)::int` }).from(user)

    const [{ stories: totalStories }] =
      await db.select({ stories: sql<number>`COUNT(*)::int` }).from(stories)

    const [{ orders: totalOrders }] =
      await db.select({ orders: sql<number>`COUNT(*)::int` }).from(orders)

    // Total revenue from all paid orders (not just last 7 days)
    const [{ totalRevenueCents }] = await db
      .select({
        totalRevenueCents: sql<number>`COALESCE(SUM(${orders.totalCents}), 0)::int`,
      })
      .from(orders)
      .where(eq(orders.status, 'paid'))

    // Get all stories for cost calculation
    const allStories = await db
      .select({
        id: stories.id,
        audioCharacterCount: stories.audioCharacterCount,
        model: stories.model,
      })
      .from(stories)

    // Get token usage for all stories
    const storiesWithTokens = await Promise.all(
      allStories.map(async (story) => {
        const [tokenData] = await db
          .select({
            inputTokens: sql<number>`COALESCE(SUM(${storyTransactions.inputTokens})::int, 0)`,
            outputTokens: sql<number>`COALESCE(SUM(${storyTransactions.outputTokens})::int, 0)`,
            model: sql<string | null>`MAX(${storyTransactions.model})`,
          })
          .from(storyTransactions)
          .where(eq(storyTransactions.storyId, story.id))
          .limit(1)

        const inputTokens = Number(tokenData?.inputTokens ?? 0)
        const outputTokens = Number(tokenData?.outputTokens ?? 0)
        const model = tokenData?.model || story.model

        const gptCostCents = calculateGPTCost(model, inputTokens, outputTokens)
        const audioCostCents = calculateAudioCost(story.audioCharacterCount)

        return {
          gptCostCents: Number(gptCostCents),
          audioCostCents: Number(audioCostCents),
        }
      })
    )

    // Calculate total costs
    const totalGPTCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.gptCostCents || 0), 0)
    const totalAudioCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.audioCostCents || 0), 0)
    const totalCostCents = totalGPTCostCents + totalAudioCostCents

    // Calculate profit (revenue - costs)
    // totalRevenueCents is in forints (2990 = 2990 Ft)
    // totalCostCents is in cents/fillér (2990 = 29.90 Ft)
    // Convert cost to forints: totalCostCents / 100
    const totalCostForints = totalCostCents / 100
    const profitCents = (totalRevenueCents ?? 0) - totalCostForints

    // Daily registrations for last 7 days
    // Use SQL to calculate date and filter - no Date objects in JavaScript
    const dailyRegistrationsRaw = await db
      .select({
        date: sql<string>`TO_CHAR(DATE_TRUNC('day', ${user.createdAt}), 'YYYY-MM-DD')`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(user)
      .where(sql`${user.createdAt} >= ${sql.raw(`'${sevenDaysAgoStr}'`)}::timestamp`)
      .groupBy(sql`DATE_TRUNC('day', ${user.createdAt})`)
      .orderBy(sql`DATE_TRUNC('day', ${user.createdAt})`)

    // Daily revenue for last 7 days (only paid orders)
    // Use SQL to calculate date and filter - no Date objects in JavaScript
    const dailyRevenueRaw = await db
      .select({
        date: sql<string>`TO_CHAR(DATE_TRUNC('day', ${orders.createdAt}), 'YYYY-MM-DD')`,
        revenue: sql<number>`COALESCE(SUM(${orders.totalCents}), 0)::int`,
      })
      .from(orders)
      .where(
        sql`${orders.status} = 'paid' AND ${orders.createdAt} >= ${sql.raw(`'${sevenDaysAgoStr}'`)}::timestamp`
      )
      .groupBy(sql`DATE_TRUNC('day', ${orders.createdAt})`)
      .orderBy(sql`DATE_TRUNC('day', ${orders.createdAt})`)

    // Convert to plain objects with strings and numbers only
    const dailyRegistrations = dailyRegistrationsRaw.map((d) => ({
      date: String(d.date || ''),
      count: Number(d.count ?? 0),
    }))

    const dailyRevenue = dailyRevenueRaw.map((d) => ({
      date: String(d.date || ''),
      revenue: Number(d.revenue ?? 0),
    }))

    // Fill in missing days with 0 values for both datasets
    // Generate dates as strings directly (no Date objects)
    const allDates: string[] = []
    const now = Date.now()
    for (let i = 6; i >= 0; i--) {
      const timestamp = now - i * 24 * 60 * 60 * 1000
      const dateStr = new Date(timestamp).toISOString().split('T')[0]
      allDates.push(dateStr)
    }

    const registrationsMap = new Map<string, number>(
      dailyRegistrations.map((d) => [String(d.date), Number(d.count)])
    )
    const revenueMap = new Map<string, number>(
      dailyRevenue.map((d) => [String(d.date), Number(d.revenue)])
    )

    const filledRegistrations = allDates.map((dateStr) => ({
      date: String(dateStr),
      count: Number(registrationsMap.get(String(dateStr)) ?? 0),
    }))

    const filledRevenue = allDates.map((dateStr) => ({
      date: String(dateStr),
      revenue: Number(revenueMap.get(String(dateStr)) ?? 0),
    }))

    // Build response object with only primitives (no Date objects anywhere)
    const response = {
      totals: {
        users: Number(totalUsers ?? 0),
        stories: Number(totalStories ?? 0),
        orders: Number(totalOrders ?? 0),
      },
      financials: {
        totalRevenueCents: Number(totalRevenueCents ?? 0),
        totalGPTCostCents: Number(totalGPTCostCents),
        totalAudioCostCents: Number(totalAudioCostCents),
        totalCostCents: Number(totalCostCents),
        profitCents: Number(profitCents),
      },
      dailyRegistrations: filledRegistrations,
      dailyRevenue: filledRevenue,
    }

    // Double-check: serialize and parse to ensure no Date objects
    return JSON.parse(JSON.stringify(response))
  })
  // Users management
  .get('/users', async () => {
    const userList = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        banned: user.banned,
        banReason: user.banReason,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt))

    // Get stats for each user
    const usersWithStats = await Promise.all(
      userList.map(async (u) => {
        // Count children
        const [{ childrenCount }] = await db
          .select({
            childrenCount: sql<number>`COUNT(*)::int`,
          })
          .from(children)
          .where(eq(children.userId, u.id))

        // Get paid orders for revenue
        const paidOrders = await db
          .select({
            totalCents: orders.totalCents,
          })
          .from(orders)
          .where(and(eq(orders.userId, u.id), eq(orders.status, 'paid')))

        const totalRevenueCents = paidOrders.reduce((sum, o) => sum + (o.totalCents || 0), 0)

        // Get all stories for cost calculation
        const userStories = await db
          .select({
            id: stories.id,
            audioCharacterCount: stories.audioCharacterCount,
            model: stories.model,
          })
          .from(stories)
          .where(eq(stories.userId, u.id))

        // Get token usage for all stories
        const storiesWithTokens = await Promise.all(
          userStories.map(async (story) => {
            const [tokenData] = await db
              .select({
                inputTokens: sql<number>`COALESCE(SUM(${storyTransactions.inputTokens})::int, 0)`,
                outputTokens: sql<number>`COALESCE(SUM(${storyTransactions.outputTokens})::int, 0)`,
                model: sql<string | null>`MAX(${storyTransactions.model})`,
              })
              .from(storyTransactions)
              .where(eq(storyTransactions.storyId, story.id))
              .limit(1)

            const inputTokens = Number(tokenData?.inputTokens ?? 0)
            const outputTokens = Number(tokenData?.outputTokens ?? 0)
            const model = tokenData?.model || story.model

            const gptCostCents = calculateGPTCost(model, inputTokens, outputTokens)
            const audioCostCents = calculateAudioCost(story.audioCharacterCount)

            return {
              gptCostCents: Number(gptCostCents),
              audioCostCents: Number(audioCostCents),
            }
          })
        )

        // Calculate total costs
        const totalGPTCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.gptCostCents || 0), 0)
        const totalAudioCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.audioCostCents || 0), 0)
        const totalCostCents = totalGPTCostCents + totalAudioCostCents

        // Calculate profit (revenue - costs)
        // totalRevenueCents is in forints (2990 = 2990 Ft)
        // totalCostCents is in cents/fillér (2990 = 29.90 Ft)
        // Convert cost to forints: totalCostCents / 100
        const totalCostForints = totalCostCents / 100
        const profitCents = totalRevenueCents - totalCostForints

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          banned: u.banned || false,
          banReason: u.banReason,
          createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt || ''),
          updatedAt: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : String(u.updatedAt || ''),
          childrenCount: Number(childrenCount ?? 0),
          totalRevenueCents: Number(totalRevenueCents),
          totalCostCents: Number(totalCostCents),
          profitCents: Number(profitCents),
        }
      })
    )

    return { users: usersWithStats }
  })
  .get('/users/:id', async ({ params }) => {
    const [userData] = await db
      .select()
      .from(user)
      .where(eq(user.id, params.id))
      .limit(1)
    if (!userData) {
      return { error: 'User not found' }
    }
    return { user: userData }
  })
  .get('/users/:id/children', async ({ params }) => {
    const childrenList = await db
      .select()
      .from(children)
      .where(eq(children.userId, params.id))
      .orderBy(desc(children.createdAt))
    return { children: childrenList }
  })
  .get('/users/:id/orders', async ({ params }) => {
    const orderList = await db
      .select({
        id: orders.id,
        status: orders.status,
        currency: orders.currency,
        subtotalCents: orders.subtotalCents,
        discountCents: orders.discountCents,
        totalCents: orders.totalCents,
        couponCodeSnapshot: orders.couponCodeSnapshot,
        creditsTotal: orders.creditsTotal,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .where(eq(orders.userId, params.id))
      .orderBy(desc(orders.createdAt))
    return { orders: orderList }
  })
  .get('/orders/:id/details', async ({ params }) => {
    // Get order with full details
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, params.id))
      .limit(1)

    if (!order) {
      return { error: 'Order not found' }
    }

    // Get order items
    const orderItemsList = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, params.id))

    // Get payment records
    const paymentList = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, params.id))
      .orderBy(desc(payments.createdAt))

    // Get related Stripe events
    // Find events that reference this order's checkout session or payment intent
    let relatedEvents: any[] = []
    if (order.stripeCheckoutSessionId || order.stripePaymentIntentId) {
      const conditions: any[] = []
      if (order.stripeCheckoutSessionId) {
        conditions.push(sql`${stripeEvents.payloadJson}::text LIKE ${`%${order.stripeCheckoutSessionId}%`}`)
      }
      if (order.stripePaymentIntentId) {
        conditions.push(sql`${stripeEvents.payloadJson}::text LIKE ${`%${order.stripePaymentIntentId}%`}`)
      }
      if (conditions.length > 0) {
        relatedEvents = await db
          .select()
          .from(stripeEvents)
          .where(or(...conditions))
          .orderBy(desc(stripeEvents.created))
      }
    }

    return {
      order: {
        ...order,
        createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : String(order.createdAt || ''),
        updatedAt: order.updatedAt instanceof Date ? order.updatedAt.toISOString() : String(order.updatedAt || ''),
      },
      items: orderItemsList.map((item) => ({
        ...item,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt || ''),
      })),
      payments: paymentList.map((p) => ({
        ...p,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt || ''),
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt || ''),
      })),
      stripeEvents: relatedEvents.map((e) => ({
        id: e.id,
        stripeEventId: e.stripeEventId,
        type: e.type,
        apiVersion: e.apiVersion,
        created: e.created instanceof Date ? e.created.toISOString() : String(e.created || ''),
        livemode: e.livemode,
        payloadJson: e.payloadJson,
        processedAt: e.processedAt instanceof Date ? e.processedAt.toISOString() : (e.processedAt ? String(e.processedAt) : null),
        processingError: e.processingError,
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt || ''),
      })),
    }
  })
  .get('/users/:id/stories', async ({ params }) => {
    // Get all stories for user with child info
    const storyList = await db
      .select({
        id: stories.id,
        childId: stories.childId,
        status: stories.status,
        title: stories.title,
        text: stories.text,
        creditCost: stories.creditCost,
        audioUrl: stories.audioUrl,
        audioStatus: stories.audioStatus,
        audioCharacterCount: stories.audioCharacterCount,
        coverUrl: stories.coverUrl,
        coverSquareUrl: stories.coverSquareUrl,
        model: stories.model,
        createdAt: stories.createdAt,
        readyAt: stories.readyAt,
        childName: children.name,
      })
      .from(stories)
      .leftJoin(children, eq(stories.childId, children.id))
      .where(eq(stories.userId, params.id))
      .orderBy(desc(stories.createdAt))

    // Get token usage for each story
    const storiesWithTokens = await Promise.all(
      storyList.map(async (story) => {
        const [tokenData] = await db
          .select({
            totalTokens: sql<number>`COALESCE(SUM(${storyTransactions.totalTokens})::int, 0)`,
            inputTokens: sql<number>`COALESCE(SUM(${storyTransactions.inputTokens})::int, 0)`,
            outputTokens: sql<number>`COALESCE(SUM(${storyTransactions.outputTokens})::int, 0)`,
            model: sql<string | null>`MAX(${storyTransactions.model})`,
          })
          .from(storyTransactions)
          .where(eq(storyTransactions.storyId, story.id))
          .limit(1)

        const inputTokens = Number(tokenData?.inputTokens ?? 0)
        const outputTokens = Number(tokenData?.outputTokens ?? 0)
        const model = tokenData?.model || story.model

        // Calculate GPT cost
        const gptCostCents = calculateGPTCost(model, inputTokens, outputTokens)

        // Calculate audio cost
        const audioCostCents = calculateAudioCost(story.audioCharacterCount)

        // Generate presigned URLs for covers
        let coverUrl = story.coverUrl
        let coverSquareUrl = story.coverSquareUrl

        if (coverUrl) {
          try {
            const coverKey = buildCoverKey(story.id)
            coverUrl = await getPresignedUrl(coverKey, 3600) // 1 hour expiry
          } catch (error) {
            console.error(`Failed to generate presigned URL for cover ${story.id}:`, error)
            // Fallback to original URL
          }
        }

        if (coverSquareUrl) {
          try {
            const coverSquareKey = buildCoverSquareKey(story.id)
            coverSquareUrl = await getPresignedUrl(coverSquareKey, 3600) // 1 hour expiry
          } catch (error) {
            console.error(`Failed to generate presigned URL for square cover ${story.id}:`, error)
            // Fallback to original URL
          }
        }

        // Generate presigned URL for audio if it exists
        let audioUrl = story.audioUrl
        if (audioUrl && story.audioStatus === 'ready') {
          try {
            const audioKey = buildAudioKey(story.id)
            audioUrl = await getPresignedUrl(audioKey, 3600) // 1 hour expiry
          } catch (error) {
            console.error(`Failed to generate presigned URL for audio ${story.id}:`, error)
            // Fallback to original URL
          }
        }

        return {
          ...story,
          coverUrl,
          coverSquareUrl,
          audioUrl,
          totalTokens: Number(tokenData?.totalTokens ?? 0),
          inputTokens,
          outputTokens,
          model,
          gptCostCents,
          audioCostCents,
        }
      })
    )

    return { stories: storiesWithTokens }
  })
  .get('/users/:id/credit-transactions', async ({ params }) => {
    const creditTransactions = await db
      .select({
        id: storyCreditTransactions.id,
        userId: storyCreditTransactions.userId,
        storyId: storyCreditTransactions.storyId,
        orderId: storyCreditTransactions.orderId,
        type: storyCreditTransactions.type,
        amount: storyCreditTransactions.amount,
        reason: storyCreditTransactions.reason,
        source: storyCreditTransactions.source,
        createdAt: storyCreditTransactions.createdAt,
      })
      .from(storyCreditTransactions)
      .where(eq(storyCreditTransactions.userId, params.id))
      .orderBy(desc(storyCreditTransactions.createdAt))

    // Convert dates to strings
    return {
      transactions: creditTransactions.map((t) => ({
        id: Number(t.id),
        userId: t.userId,
        storyId: t.storyId || null,
        orderId: t.orderId || null,
        type: t.type,
        amount: Number(t.amount),
        reason: t.reason || null,
        source: t.source || null,
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt || ''),
      })),
    }
  })
  .get('/users/:id/stats', async ({ params }) => {
    const userId = params.id

    // Get all user orders (for ordersCount)
    const allUserOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, params.id))

    // Get ONLY paid orders for revenue calculation (filter in SQL for efficiency)
    const paidOrders = await db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, params.id), eq(orders.status, 'paid')))

    // Calculate total revenue from paid orders only
    const totalRevenueCents = paidOrders.reduce((sum, o) => sum + (o.totalCents || 0), 0)

    // Get all stories for user
    const userStories = await db
      .select({
        id: stories.id,
        audioCharacterCount: stories.audioCharacterCount,
      })
      .from(stories)
      .where(eq(stories.userId, userId))

    // Get token usage for all stories
    const storiesWithTokens = await Promise.all(
      userStories.map(async (story) => {
        const [tokenData] = await db
          .select({
            totalTokens: sql<number>`COALESCE(SUM(${storyTransactions.totalTokens})::int, 0)`,
            inputTokens: sql<number>`COALESCE(SUM(${storyTransactions.inputTokens})::int, 0)`,
            outputTokens: sql<number>`COALESCE(SUM(${storyTransactions.outputTokens})::int, 0)`,
            model: sql<string | null>`MAX(${storyTransactions.model})`,
          })
          .from(storyTransactions)
          .where(eq(storyTransactions.storyId, story.id))
          .limit(1)

        const inputTokens = Number(tokenData?.inputTokens ?? 0)
        const outputTokens = Number(tokenData?.outputTokens ?? 0)
        const model = tokenData?.model

        const gptCostCents = calculateGPTCost(model, inputTokens, outputTokens)
        const audioCostCents = calculateAudioCost(story.audioCharacterCount)

        return {
          gptCostCents,
          audioCostCents,
        }
      })
    )

    // Calculate total costs
    const totalGPTCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.gptCostCents || 0), 0)
    const totalAudioCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.audioCostCents || 0), 0)
    const totalCostCents = totalGPTCostCents + totalAudioCostCents

    // Calculate profit (revenue - costs)
    // totalRevenueCents is in forints (2990 = 2990 Ft)
    // totalCostCents is in cents/fillér (2990 = 29.90 Ft)
    // Convert cost to forints: totalCostCents / 100
    // Result is in forints (same unit as totalRevenueCents)
    const totalCostForints = totalCostCents / 100
    const profitCents = totalRevenueCents - totalCostForints

    return {
      ordersCount: allUserOrders.length, // Total number of orders (transactions)
      totalRevenueCents, // Total revenue from paid orders
      totalGPTCostCents,
      totalAudioCostCents,
      totalCostCents,
      profitCents,
      paidOrdersCount: paidOrders.length,
      storiesCount: userStories.length,
    }
  })
  // Pricing Plans CRUD
  .get('/pricing-plans', async () => {
    const plans = await db.select().from(pricingPlans).orderBy(pricingPlans.createdAt)
    return { plans }
  })
  .get('/pricing-plans/:id', async ({ params }) => {
    const [plan] = await db
      .select()
      .from(pricingPlans)
      .where(eq(pricingPlans.id, params.id))
      .limit(1)
    if (!plan) {
      return { error: 'Pricing plan not found' }
    }
    return { plan }
  })
  .post(
    '/pricing-plans',
    async ({ body, set }) => {
      try {
        const [plan] = await db
          .insert(pricingPlans)
          .values({
            code: body.code,
            name: body.name,
            credits: body.credits,
            currency: body.currency || 'HUF',
            priceCents: body.priceCents,
            isActive: body.isActive ?? true,
            promoEnabled: body.promoEnabled ?? false,
            promoType: body.promoType || null,
            promoValue: body.promoValue ?? null,
            promoPriceCents: body.promoPriceCents ?? null,
            promoStartsAt: body.promoStartsAt ? new Date(body.promoStartsAt) : null,
            promoEndsAt: body.promoEndsAt ? new Date(body.promoEndsAt) : null,
          })
          .returning()
        return { plan }
      } catch (error: any) {
        if (error?.code === '23505') {
          // Unique constraint violation
          set.status = 400
          return { error: 'Pricing plan with this code already exists' }
        }
        set.status = 500
        return { error: 'Failed to create pricing plan' }
      }
    },
    {
      body: t.Object({
        code: t.String(),
        name: t.String(),
        credits: t.Number(),
        currency: t.Optional(t.String()),
        priceCents: t.Number(),
        isActive: t.Optional(t.Boolean()),
        promoEnabled: t.Optional(t.Boolean()),
        promoType: t.Optional(t.Nullable(t.Union([t.Literal('percent'), t.Literal('amount')]))),
        promoValue: t.Optional(t.Nullable(t.Number())),
        promoPriceCents: t.Optional(t.Nullable(t.Number())),
        promoStartsAt: t.Optional(t.Nullable(t.String())),
        promoEndsAt: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .patch(
    '/pricing-plans/:id',
    async ({ params, body, set }) => {
      const updateData: any = {}
      if (body.code !== undefined) updateData.code = body.code
      if (body.name !== undefined) updateData.name = body.name
      if (body.credits !== undefined) updateData.credits = body.credits
      if (body.currency !== undefined) updateData.currency = body.currency
      if (body.priceCents !== undefined) updateData.priceCents = body.priceCents
      if (body.isActive !== undefined) updateData.isActive = body.isActive
      if (body.promoEnabled !== undefined) updateData.promoEnabled = body.promoEnabled
      if (body.promoType !== undefined) updateData.promoType = body.promoType
      if (body.promoValue !== undefined) updateData.promoValue = body.promoValue
      if (body.promoPriceCents !== undefined) updateData.promoPriceCents = body.promoPriceCents
      if (body.promoStartsAt !== undefined) {
        updateData.promoStartsAt = body.promoStartsAt ? new Date(body.promoStartsAt) : null
      }
      if (body.promoEndsAt !== undefined) {
        updateData.promoEndsAt = body.promoEndsAt ? new Date(body.promoEndsAt) : null
      }
      updateData.updatedAt = new Date()

      try {
        const [plan] = await db
          .update(pricingPlans)
          .set(updateData)
          .where(eq(pricingPlans.id, params.id))
          .returning()
        if (!plan) {
          set.status = 404
          return { error: 'Pricing plan not found' }
        }
        return { plan }
      } catch (error: any) {
        if (error?.code === '23505') {
          set.status = 400
          return { error: 'Pricing plan with this code already exists' }
        }
        set.status = 500
        return { error: 'Failed to update pricing plan' }
      }
    },
    {
      body: t.Object({
        code: t.Optional(t.String()),
        name: t.Optional(t.String()),
        credits: t.Optional(t.Number()),
        currency: t.Optional(t.String()),
        priceCents: t.Optional(t.Number()),
        isActive: t.Optional(t.Boolean()),
        promoEnabled: t.Optional(t.Boolean()),
        promoType: t.Optional(t.Nullable(t.Union([t.Literal('percent'), t.Literal('amount')]))),
        promoValue: t.Optional(t.Nullable(t.Number())),
        promoPriceCents: t.Optional(t.Nullable(t.Number())),
        promoStartsAt: t.Optional(t.Nullable(t.String())),
        promoEndsAt: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  // Coupons CRUD
  .get('/coupons', async () => {
    const couponList = await db.select().from(coupons).orderBy(coupons.createdAt)
    return { coupons: couponList }
  })
  .get('/coupons/:id', async ({ params }) => {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(eq(coupons.id, params.id))
      .limit(1)
    if (!coupon) {
      return { error: 'Coupon not found' }
    }
    return { coupon }
  })
  .get('/coupons/:id/details', async ({ params }) => {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(eq(coupons.id, params.id))
      .limit(1)
    if (!coupon) {
      return { error: 'Coupon not found' }
    }

    // Get all orders that used this coupon
    const ordersUsingCoupon = await db
      .select({
        id: orders.id,
        userId: orders.userId,
        status: orders.status,
        totalCents: orders.totalCents,
        discountCents: orders.discountCents,
        createdAt: orders.createdAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(orders)
      .leftJoin(user, eq(orders.userId, user.id))
      .where(eq(orders.couponId, coupon.id))
      .orderBy(desc(orders.createdAt))

    // Count unique users
    const uniqueUsers = new Set(ordersUsingCoupon.map(o => o.userId))
    const uniqueUserCount = uniqueUsers.size

    // Calculate total discount given
    const totalDiscountCents = ordersUsingCoupon
      .filter(o => o.status === 'paid')
      .reduce((sum, o) => sum + (o.discountCents || 0), 0)

    return {
      coupon,
      stats: {
        totalRedemptions: ordersUsingCoupon.length,
        uniqueUsers: uniqueUserCount,
        totalDiscountCents,
        paidOrders: ordersUsingCoupon.filter(o => o.status === 'paid').length,
      },
      redemptions: ordersUsingCoupon.map(o => ({
        orderId: o.id,
        userId: o.userId,
        userName: o.userName,
        userEmail: o.userEmail,
        status: o.status,
        totalCents: o.totalCents,
        discountCents: o.discountCents,
        createdAt: o.createdAt,
      })),
    }
  })
  .post(
    '/coupons',
    async ({ body, set }) => {
      try {
        const [coupon] = await db
          .insert(coupons)
          .values({
            code: body.code.trim().toUpperCase(),
            type: body.type,
            value: body.value,
            currency: body.currency || null,
            maxRedemptions: body.maxRedemptions ?? null,
            perUserLimit: body.perUserLimit ?? 1,
            minOrderAmountCents: body.minOrderAmountCents ?? null,
            startsAt: body.startsAt ? new Date(body.startsAt) : null,
            endsAt: body.endsAt ? new Date(body.endsAt) : null,
            isActive: body.isActive ?? true,
          })
          .returning()
        return { coupon }
      } catch (error: any) {
        if (error?.code === '23505') {
          set.status = 400
          return { error: 'Coupon with this code already exists' }
        }
        set.status = 500
        return { error: 'Failed to create coupon' }
      }
    },
    {
      body: t.Object({
        code: t.String(),
        type: t.Union([t.Literal('percent'), t.Literal('amount')]),
        value: t.Number(),
        currency: t.Optional(t.Nullable(t.String())),
        maxRedemptions: t.Optional(t.Nullable(t.Number())),
        perUserLimit: t.Optional(t.Nullable(t.Number())),
        minOrderAmountCents: t.Optional(t.Nullable(t.Number())),
        startsAt: t.Optional(t.Nullable(t.String())),
        endsAt: t.Optional(t.Nullable(t.String())),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )
  .patch(
    '/coupons/:id',
    async ({ params, body, set }) => {
      const updateData: any = {}
      if (body.code !== undefined) updateData.code = body.code.trim().toUpperCase()
      if (body.type !== undefined) updateData.type = body.type
      if (body.value !== undefined) updateData.value = body.value
      if (body.currency !== undefined) updateData.currency = body.currency
      if (body.maxRedemptions !== undefined) updateData.maxRedemptions = body.maxRedemptions
      if (body.perUserLimit !== undefined) updateData.perUserLimit = body.perUserLimit
      if (body.minOrderAmountCents !== undefined) updateData.minOrderAmountCents = body.minOrderAmountCents
      if (body.startsAt !== undefined) {
        updateData.startsAt = body.startsAt ? new Date(body.startsAt) : null
      }
      if (body.endsAt !== undefined) {
        updateData.endsAt = body.endsAt ? new Date(body.endsAt) : null
      }
      if (body.isActive !== undefined) updateData.isActive = body.isActive
      updateData.updatedAt = new Date()

      try {
        const [coupon] = await db
          .update(coupons)
          .set(updateData)
          .where(eq(coupons.id, params.id))
          .returning()
        if (!coupon) {
          set.status = 404
          return { error: 'Coupon not found' }
        }
        return { coupon }
      } catch (error: any) {
        if (error?.code === '23505') {
          set.status = 400
          return { error: 'Coupon with this code already exists' }
        }
        set.status = 500
        return { error: 'Failed to update coupon' }
      }
    },
    {
      body: t.Object({
        code: t.Optional(t.String()),
        type: t.Optional(t.Union([t.Literal('percent'), t.Literal('amount')])),
        value: t.Optional(t.Number()),
        currency: t.Optional(t.Nullable(t.String())),
        maxRedemptions: t.Optional(t.Nullable(t.Number())),
        perUserLimit: t.Optional(t.Nullable(t.Number())),
        minOrderAmountCents: t.Optional(t.Nullable(t.Number())),
        startsAt: t.Optional(t.Nullable(t.String())),
        endsAt: t.Optional(t.Nullable(t.String())),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )
  // Orders management
  .get('/orders', async () => {
    const orderList = await db
      .select({
        id: orders.id,
        userId: orders.userId,
        status: orders.status,
        currency: orders.currency,
        subtotalCents: orders.subtotalCents,
        discountCents: orders.discountCents,
        totalCents: orders.totalCents,
        couponCodeSnapshot: orders.couponCodeSnapshot,
        couponTypeSnapshot: orders.couponTypeSnapshot,
        couponValueSnapshot: orders.couponValueSnapshot,
        creditsTotal: orders.creditsTotal,
        provider: orders.provider,
        stripeCheckoutSessionId: orders.stripeCheckoutSessionId,
        billingoInvoiceId: orders.billingoInvoiceId,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(orders)
      .leftJoin(user, eq(orders.userId, user.id))
      .orderBy(desc(orders.createdAt))

    // Get order items for each order
    const ordersWithItems = await Promise.all(
      orderList.map(async (order) => {
        const items = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
        return {
          ...order,
          items,
        }
      })
    )

    return { orders: ordersWithItems }
  })
  .get('/orders/:id', async ({ params }) => {
    const [order] = await db
      .select({
        id: orders.id,
        userId: orders.userId,
        status: orders.status,
        currency: orders.currency,
        subtotalCents: orders.subtotalCents,
        discountCents: orders.discountCents,
        totalCents: orders.totalCents,
        couponId: orders.couponId,
        couponCodeSnapshot: orders.couponCodeSnapshot,
        couponTypeSnapshot: orders.couponTypeSnapshot,
        couponValueSnapshot: orders.couponValueSnapshot,
        creditsTotal: orders.creditsTotal,
        provider: orders.provider,
        stripeCheckoutSessionId: orders.stripeCheckoutSessionId,
        stripePaymentIntentId: orders.stripePaymentIntentId,
        stripeCustomerId: orders.stripeCustomerId,
        billingoInvoiceId: orders.billingoInvoiceId,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(orders)
      .leftJoin(user, eq(orders.userId, user.id))
      .where(eq(orders.id, params.id))
      .limit(1)

    if (!order) {
      return { error: 'Order not found' }
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, params.id))

    return {
      order: {
        ...order,
        items,
      },
    }
  })
  // Stories management
  .get('/stories', async ({ query }) => {
    const startDate = query.startDate ? new Date(query.startDate) : null
    const endDate = query.endDate ? new Date(query.endDate) : null

    // Build where conditions
    const conditions = []
    if (startDate) {
      conditions.push(gte(stories.createdAt, startDate))
    }
    if (endDate) {
      const endDateWithTime = new Date(endDate)
      endDateWithTime.setHours(23, 59, 59, 999)
      conditions.push(sql`${stories.createdAt} <= ${endDateWithTime}`)
    }

    // Get stories with user and child info
    const storyList = await db
      .select({
        id: stories.id,
        userId: stories.userId,
        childId: stories.childId,
        status: stories.status,
        title: stories.title,
        creditCost: stories.creditCost,
        audioUrl: stories.audioUrl,
        audioStatus: stories.audioStatus,
        audioCharacterCount: stories.audioCharacterCount,
        model: stories.model,
        createdAt: stories.createdAt,
        readyAt: stories.readyAt,
        userName: user.name,
        userEmail: user.email,
        childName: children.name,
      })
      .from(stories)
      .leftJoin(user, eq(stories.userId, user.id))
      .leftJoin(children, eq(stories.childId, children.id))
      .where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined)
      .orderBy(desc(stories.createdAt))

    // Get token usage and model for each story
    const storiesWithTokens = await Promise.all(
      storyList.map(async (story) => {
        const [tokenData] = await db
          .select({
            totalTokens: sql<number>`COALESCE(SUM(${storyTransactions.totalTokens})::int, 0)`,
            inputTokens: sql<number>`COALESCE(SUM(${storyTransactions.inputTokens})::int, 0)`,
            outputTokens: sql<number>`COALESCE(SUM(${storyTransactions.outputTokens})::int, 0)`,
            model: sql<string | null>`MAX(${storyTransactions.model})`,
          })
          .from(storyTransactions)
          .where(eq(storyTransactions.storyId, story.id))
          .limit(1)

        const inputTokens = Number(tokenData?.inputTokens ?? 0)
        const outputTokens = Number(tokenData?.outputTokens ?? 0)
        const model = tokenData?.model || story.model

        // Calculate GPT cost based on actual token usage
        const gptCostCents = calculateGPTCost(model, inputTokens, outputTokens)

        // Calculate audio cost: 1 character = 1 credit = 0.00022 USD
        // Convert to HUF using same rate as GPT tokens
        const audioCostCents = calculateAudioCost(story.audioCharacterCount)

        return {
          ...story,
          totalTokens: Number(tokenData?.totalTokens ?? 0),
          inputTokens,
          outputTokens,
          model,
          gptCostCents,
          audioCharacterCount: story.audioCharacterCount,
          audioCostCents,
        }
      })
    )

    // Calculate stats
    const totalStories = storiesWithTokens.length
    const successfulStories = storiesWithTokens.filter(s => s.status === 'ready').length
    const failedStories = storiesWithTokens.filter(s => s.status === 'failed').length
    const totalTokens = storiesWithTokens.reduce((sum, s) => sum + (s.totalTokens || 0), 0)
    
    // Calculate total cost based on GPT token usage (actual cost)
    const totalGPTCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.gptCostCents || 0), 0)

    // Calculate total audio cost (1 character = 1 credit)
    const totalAudioCostCents = storiesWithTokens.reduce((sum, s) => sum + (s.audioCostCents || 0), 0)

    // Total cost = GPT cost + Audio cost
    const totalCostCents = totalGPTCostCents + totalAudioCostCents

    // Also calculate cost based on credits (for comparison)
    const [{ avgCreditPrice }] = await db
      .select({
        avgCreditPrice: sql<number>`COALESCE(AVG(${pricingPlans.priceCents}::float / NULLIF(${pricingPlans.credits}, 0)), 0)`,
      })
      .from(pricingPlans)
      .where(eq(pricingPlans.isActive, true))
      .limit(1)

    const totalCostCredits = storiesWithTokens.reduce((sum, s) => sum + (s.creditCost || 0), 0)
    const totalCostCentsFromCredits = Math.round(totalCostCredits * (avgCreditPrice || 0))

    return {
      stories: storiesWithTokens,
      stats: {
        totalStories,
        successfulStories,
        failedStories,
        totalTokens,
        totalCostCredits,
        totalCostCents, // GPT cost + Audio cost
        totalGPTCostCents, // GPT cost only
        totalAudioCostCents, // Audio cost only
        totalCostCentsFromCredits, // Keep credit-based cost for comparison
        avgCreditPrice: avgCreditPrice || 0,
      },
    }
  },
  {
    query: t.Object({
      startDate: t.Optional(t.String()),
      endDate: t.Optional(t.String()),
    }),
  })
