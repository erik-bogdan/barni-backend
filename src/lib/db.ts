// apps/api/src/lib/db.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from '../../packages/db/src/schema'

export const client = postgres(env.DATABASE_URL, {
  prepare: true,
  idle_timeout: 30_000
})
export const db = drizzle(client, { schema })

