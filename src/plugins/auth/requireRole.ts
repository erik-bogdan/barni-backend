import { Elysia } from 'elysia'
import { auth } from '../../lib/auth'

export type RoleName = 'admin' | 'user'

export const requireRole = (role: RoleName) =>
  new Elysia({ name: `require-role:${role}` })
    .onBeforeHandle(async ({ request, set }) => {
      // CRITICAL: Check role before handling any request
      const session = await auth.api.getSession({ headers: request.headers })
      if (!session) {
        set.status = 401
        return { error: 'Unauthorized' }
      }
      const userRole = (session.user as any)?.role ?? 'user'
      if (userRole !== role) {
        set.status = 403
        return { error: 'Forbidden: Admin access required' }
      }
      // Role is valid, continue to handler
      return
    })
    .macro({
      requireRole: {
        async resolve({ status, request: { headers } }) {
          const session = await auth.api.getSession({ headers })
          if (!session) return status(401)
          const userRole = (session.user as any)?.role ?? 'user'
          if (userRole !== role) return status(403)
          return {
            user: session.user,
            session: session.session
          }
        }
      }
    })


