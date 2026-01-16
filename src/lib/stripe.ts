import Stripe from 'stripe'
import { env } from '../env'
import { db } from './db'
import { stripeCustomers, user } from '../../packages/db/src/schema'
import { eq } from 'drizzle-orm'

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, { 
  apiVersion: '2024-06-20' 
})

export async function ensureCustomer(userId: string, email: string): Promise<string> {
  const [row] = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, userId)).limit(1)
  
  if (row) {
    return row.customerId
  }

  const customer = await stripe.customers.create({ 
    email, 
    metadata: { userId } 
  })

  await db.insert(stripeCustomers).values({ 
    userId, 
    customerId: customer.id 
  })

  return customer.id
}

