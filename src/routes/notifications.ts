import { Elysia, t } from "elysia"
import { desc, eq, sql } from "drizzle-orm"

import { db } from "../lib/db"
import { auth } from "../lib/auth"
import { notifications } from "../../packages/db/src/schema"

async function requireSession(headers: Headers, set: { status: number }) {
  const session = await auth.api.getSession({ headers })
  if (!session) {
    set.status = 401
    return null
  }
  return session
}

export const notificationsApi = new Elysia({
  name: "notifications",
  prefix: "/notifications",
})
  .get(
    "/",
    async ({ request, query, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const limitRaw = Number(query.limit ?? 10)
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), 50)
        : 10

      const rows = await db
        .select({
          id: notifications.id,
          type: notifications.type,
          icon: notifications.icon,
          title: notifications.title,
          message: notifications.message,
          link: notifications.link,
          isRead: notifications.isRead,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, session.user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)

      return {
        items: rows,
      }
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    },
  )
  .get("/unread-count", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(
        sql`${notifications.userId} = ${session.user.id} AND ${notifications.isRead} = false`,
      )

    return { count: count ?? 0 }
  })
  .patch(
    "/:id/read",
    async ({ request, params, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [updated] = await db
        .update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(
          sql`${notifications.id} = ${params.id} AND ${notifications.userId} = ${session.user.id}`,
        )
        .returning({ id: notifications.id })

      if (!updated) {
        set.status = 404
        return { error: "Notification not found" }
      }

      return { success: true }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )
  .patch("/read-all", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        sql`${notifications.userId} = ${session.user.id} AND ${notifications.isRead} = false`,
      )

    return { success: true }
  })
