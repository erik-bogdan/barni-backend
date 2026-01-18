import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SECRET: z.string().min(1),
  ALLOW_ORIGIN: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DEBUG_SESSIONS: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_SUCCESS_URL: z.string().url(),
  STRIPE_CANCEL_URL: z.string().url(),
  DEFAULT_CURRENCY: z.string().default('HUF'),
  BILLINGO_API_KEY: z.string().min(1),
  REGISTER_URL: z.string().url().default('http://localhost:3000'),
  IS_SHARED_ABLE_TO_DELETE_TRANSACTION: z.string().optional().default('false'),
  BACKUP_DIR: z.string().min(1),
})

export type Env = z.infer<typeof EnvSchema>

export const env: Env = (() => {
  const parsed = EnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL_DRIZZLE ?? process.env.DATABASE_URL,
    SECRET: process.env.SECRET,
    ALLOW_ORIGIN: process.env.ALLOW_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
    DEBUG_SESSIONS: process.env.DEBUG_SESSIONS,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL,
    STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL,
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY,
    BILLINGO_API_KEY: process.env.BILLINGO_API_KEY,
    REGISTER_URL: process.env.REGISTER_URL,
    IS_SHARED_ABLE_TO_DELETE_TRANSACTION: process.env.IS_SHARED_ABLE_TO_DELETE_TRANSACTION,
    BACKUP_DIR: process.env.BACKUP_DIR,
  })

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    // Crash at boot if missing
    throw new Error(`Invalid ENV: ${issues}`)
  }

  return parsed.data
})()

export function getDailySaltUTC(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}:${env.SECRET}`
}


export function debugSessionsEnabled(): boolean {
  const v = env.DEBUG_SESSIONS
  if (!v) return false
  const s = String(v).toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

export function isSharedAbleToDeleteTransaction(): boolean {
  const v = env.IS_SHARED_ABLE_TO_DELETE_TRANSACTION
  if (!v) return false
  const s = String(v).toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}


