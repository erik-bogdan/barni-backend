import { eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import { storyCreditTransactions } from "../../packages/db/src/schema"

export type StoryLength = "short" | "medium" | "long"

export const CREDIT_COSTS: Record<StoryLength, number> = {
  short: 25,
  medium: 30,
  long: 35,
}

export const AUDIO_CREDIT_COSTS: Record<StoryLength, number> = {
  short: 15,
  medium: 20,
  long: 25,
}

export function calcCost(length: StoryLength): number {
  return CREDIT_COSTS[length]
}

export function calcAudioCost(length: StoryLength): number {
  return AUDIO_CREDIT_COSTS[length]
}

export async function getUserCreditBalance(
  db: PostgresJsDatabase<Record<string, unknown>>,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${storyCreditTransactions.amount}), 0)`,
    })
    .from(storyCreditTransactions)
    .where(eq(storyCreditTransactions.userId, userId))

  return row?.balance ?? 0
}

