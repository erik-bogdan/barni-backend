import { Elysia } from 'elysia'
import { auth } from '../../lib/auth'

export type RoleName = 'admin' | 'user'

export const requireRole = (role: RoleName) =>
  new Elysia({ name: `require-role:${role}` })
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


