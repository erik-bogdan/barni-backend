import { Elysia } from 'elysia'
import { sql, eq, desc } from 'drizzle-orm'

import { db } from '../lib/db'
import { betterAuthMiddleware } from '../plugins/auth/middleware'
import { requireRole } from '../plugins/auth/requireRole'
import { user, pocket, savings, pocketTransactions, currencies, categories, subcategories } from '../../packages/db/src/schema'

export const dash = new Elysia({ name: 'dash', prefix: '/admin' })
  .use(betterAuthMiddleware)
  .use(requireRole('admin'))
  .get('/dashboard/stats', async () => {
    const [{ users: totalUsers }] =
      await db.select({ users: sql<number>`COUNT(*)::int` }).from(user)

    const [{ pockets: totalPockets }] =
      await db.select({ pockets: sql<number>`COUNT(*)::int` }).from(pocket)

    const [{ savings: totalSavings }] =
      await db.select({ savings: sql<number>`COUNT(*)::int` }).from(savings)

    const dailyRegistrations = await db
      .select({
        date: sql<string>`DATE_TRUNC('day', ${user.createdAt})::date`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(user)
      .groupBy(sql`DATE_TRUNC('day', ${user.createdAt})`)
      .orderBy(sql`DATE_TRUNC('day', ${user.createdAt})`)

    const latestTransactions = await db
      .select({
        id: pocketTransactions.id,
        amount: pocketTransactions.amount,
        entryType: pocketTransactions.entryType,
        createdAt: pocketTransactions.createdAt,
        currencySymbol: currencies.symbol,
        categoryKey: categories.key,
        subcategoryKey: subcategories.key,
      })
      .from(pocketTransactions)
      .leftJoin(pocket, eq(pocket.id, pocketTransactions.pocketId))
      .leftJoin(currencies, eq(currencies.id, pocket.currencyId))
      .leftJoin(categories, eq(categories.id, pocketTransactions.categoryId))
      .leftJoin(subcategories, eq(subcategories.id, pocketTransactions.subcategoryId))
      .orderBy(desc(pocketTransactions.createdAt))
      .limit(5)

    return {
      totals: {
        users: totalUsers ?? 0,
        pockets: totalPockets ?? 0,
        savings: totalSavings ?? 0,
      },
      dailyRegistrations: dailyRegistrations.map((d) => ({
        date: d.date,
        count: d.count ?? 0,
      })),
      latestTransactions: latestTransactions.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        entryType: tx.entryType,
        createdAt: tx.createdAt,
        currencySymbol: tx.currencySymbol,
        category: tx.categoryKey,
        subcategory: tx.subcategoryKey,
      })),
    }
  })
