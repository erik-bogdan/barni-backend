import { eq, sql, and } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import { storyCreditTransactions, storyPricing, audioStarTransactions } from "../../packages/db/src/schema"
import { db } from "../lib/db"

export type StoryLength = "short" | "medium" | "long"

// Fallback values if database pricing is not available
const FALLBACK_CREDIT_COSTS: Record<StoryLength, number> = {
  short: 20,
  medium: 35,
  long: 50,
}

const FALLBACK_INTERACTIVE_CREDIT_COSTS: Record<StoryLength, number> = {
  short: 60,
  medium: 80,
  long: 100,
}

const FALLBACK_AUDIO_CREDIT_COSTS: Record<StoryLength, number> = {
  short: 300,
  medium: 400,
  long: 500,
}

// Cache for pricing data
let pricingCache: Map<string, number> | null = null
let cacheTimestamp: number = 0
const CACHE_TTL = 60000 // 1 minute

export function invalidatePricingCache() {
  pricingCache = null
  cacheTimestamp = 0
}

async function loadPricingCache(database: PostgresJsDatabase<Record<string, unknown>> = db): Promise<Map<string, number>> {
  const now = Date.now()
  if (pricingCache && (now - cacheTimestamp) < CACHE_TTL) {
    return pricingCache
  }

  const allPricing = await database.select().from(storyPricing)
  const cache = new Map<string, number>()
  
  for (const pricing of allPricing) {
    cache.set(pricing.key, pricing.credits)
  }
  
  pricingCache = cache
  cacheTimestamp = now
  return cache
}

export async function getStoryCost(
  length: StoryLength,
  isInteractive: boolean = false,
  database: PostgresJsDatabase<Record<string, unknown>> = db
): Promise<number> {
  const cache = await loadPricingCache(database)
  const key = isInteractive ? `story_interactive_${length}` : `story_${length}`
  const cost = cache.get(key)
  
  if (cost !== undefined) {
    return cost
  }
  
  // Fallback to hardcoded values
  return isInteractive 
    ? FALLBACK_INTERACTIVE_CREDIT_COSTS[length]
    : FALLBACK_CREDIT_COSTS[length]
}

export async function getAudioCost(
  length: StoryLength,
  database: PostgresJsDatabase<Record<string, unknown>> = db
): Promise<number> {
  const cache = await loadPricingCache(database)
  const key = `audio_${length}`
  const cost = cache.get(key)
  
  if (cost !== undefined) {
    return cost
  }
  
  // Fallback to hardcoded values
  return FALLBACK_AUDIO_CREDIT_COSTS[length]
}

// Legacy functions for backward compatibility (now async)
export async function calcCost(
  length: StoryLength,
  isInteractive: boolean = false,
  database: PostgresJsDatabase<Record<string, unknown>> = db
): Promise<number> {
  return getStoryCost(length, isInteractive, database)
}

export async function calcAudioCost(
  length: StoryLength,
  database: PostgresJsDatabase<Record<string, unknown>> = db
): Promise<number> {
  return getAudioCost(length, database)
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

/**
 * Get user's audio star balance (hangcsillag)
 * 1 hang = 1 csillag, mindegy milyen hosszú a mese
 */
export async function getUserAudioStarBalance(
  db: PostgresJsDatabase<Record<string, unknown>>,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${audioStarTransactions.amount}), 0)`,
    })
    .from(audioStarTransactions)
    .where(eq(audioStarTransactions.userId, userId))

  return row?.balance ?? 0
}
