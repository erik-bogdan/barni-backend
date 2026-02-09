import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SECRET: z.string().min(1),
  ALLOW_ORIGIN: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DEBUG_SESSIONS: z.string().optional(),
  // Payment Provider Configuration
  PAYMENT_PROVIDER: z.enum(['stripe', 'barion']).optional().default('stripe'),
  // Stripe Configuration
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_SUCCESS_URL: z.string().url(),
  STRIPE_CANCEL_URL: z.string().url(),
  // Barion Configuration (optional, only required if PAYMENT_PROVIDER=barion)
  BARION_POS_KEY: z.string().optional(),
  BARION_PAYEE: z.string().optional(),
  BARION_ENVIRONMENT: z.enum(['sandbox', 'production']).optional().default('sandbox'),
  BARION_SUCCESS_URL: z.string().url().optional(),
  BARION_CALLBACK_URL: z.string().url().optional(),
  BARION_CALLBACK_SECRET: z.string().optional(),
  // General
  DEFAULT_CURRENCY: z.string().default('HUF'),
  BILLINGO_API_KEY: z.string().min(1),
  BILLINGO_BLOCK_ID: z.string().optional(),
  REGISTER_URL: z.string().url().default('http://localhost:3000'),
  IS_SHARED_ABLE_TO_DELETE_TRANSACTION: z.string().optional().default('false'),
})

export type Env = z.infer<typeof EnvSchema>

export const env: Env = (() => {
  const parsed = EnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL_DRIZZLE ?? process.env.DATABASE_URL,
    SECRET: process.env.SECRET,
    ALLOW_ORIGIN: process.env.ALLOW_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
    DEBUG_SESSIONS: process.env.DEBUG_SESSIONS,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL,
    STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL,
    BARION_POS_KEY: process.env.BARION_POS_KEY,
    BARION_PAYEE: process.env.BARION_PAYEE,
    BARION_ENVIRONMENT: process.env.BARION_ENVIRONMENT,
    BARION_SUCCESS_URL: process.env.BARION_SUCCESS_URL,
    BARION_CALLBACK_URL: process.env.BARION_CALLBACK_URL,
    BARION_CALLBACK_SECRET: process.env.BARION_CALLBACK_SECRET,
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY,
    BILLINGO_API_KEY: process.env.BILLINGO_API_KEY,
    BILLINGO_BLOCK_ID: process.env.BILLINGO_BLOCK_ID,
    REGISTER_URL: process.env.REGISTER_URL,
    IS_SHARED_ABLE_TO_DELETE_TRANSACTION: process.env.IS_SHARED_ABLE_TO_DELETE_TRANSACTION,
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


