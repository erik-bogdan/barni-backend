import { Elysia } from 'elysia'
import { client } from '../lib/db'
import { debugSessionsEnabled } from '../env'

export const health = new Elysia({ name: 'health' })
  .get('/health', async () => {
    try {
      await client`select 1`;
      return { ok: true, db: 'up' }
    } catch {
      return new Response(JSON.stringify({ ok: false, db: 'down' }), { status: 503 })
    }
  })


