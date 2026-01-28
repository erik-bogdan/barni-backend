import { Elysia, t } from "elysia"
import { desc, eq, sql, and, isNotNull, isNull, or, inArray } from "drizzle-orm"
import { randomBytes } from "crypto"

import { db } from "../lib/db"
import { auth } from "../lib/auth"
import { betterAuthMiddleware } from "../plugins/auth/middleware"
import { requireRole } from "../plugins/auth/requireRole"
import { EmailService } from "../plugins/email/email.service"
import { renderBarniMeseiLaunchEmail } from "../plugins/email/templates/barnimesei-launch-email"
import { invitations, launchSubscriptions, user } from "../../packages/db/src/schema"

function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url")
}

export const launchSubscriptionsApi = new Elysia({
  name: "launch-subscriptions",
  prefix: "/launch-subscriptions",
})
  .post(
    "/",
    async ({ body, set, logger }) => {
      const email = body.email.trim().toLowerCase()

      const existing = await db
        .select({ id: launchSubscriptions.id })
        .from(launchSubscriptions)
        .where(eq(launchSubscriptions.email, email))
        .limit(1)

      if (existing.length > 0) {
        set.status = 400
        return { error: "Ez az email cím már fel van iratkozva" }
      }

      try {
        const [created] = await db
          .insert(launchSubscriptions)
          .values({ email })
          .returning()

        return { subscription: created }
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (message.includes("unique") || message.includes("duplicate")) {
          set.status = 400
          return { error: "Ez az email cím már fel van iratkozva" }
        }

        logger.error({ err: error, email }, "launch_subscription.insert_failed")
        set.status = 500
        return { error: "Hiba történt a feliratkozás során" }
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
      }),
    },
  )

export const launchSubscriptionsAdminApi = new Elysia({
  name: "launch-subscriptions-admin",
  prefix: "/admin/launch-subscriptions",
})
  .use(betterAuthMiddleware)
  .use(requireRole("admin"))
  .get(
    "/",
    async ({ query }) => {
      const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 200) : 20
      const page = query.page ? Math.max(parseInt(query.page, 10) || 1, 1) : 1
      const offset = (page - 1) * limit
      const search = query.search?.trim().toLowerCase() || ""
      const notifiedFilter = query.notified
      const registeredFilter = query.registered

      const filters = []

      if (search) {
        filters.push(sql`LOWER(${launchSubscriptions.email}) LIKE ${`%${search}%`}`)
      }

      if (notifiedFilter === "true") {
        filters.push(isNotNull(launchSubscriptions.lastSentAt))
      } else if (notifiedFilter === "false") {
        filters.push(isNull(launchSubscriptions.lastSentAt))
      }

      if (registeredFilter === "true") {
        filters.push(or(isNotNull(invitations.acceptedAt), isNotNull(user.id)))
      } else if (registeredFilter === "false") {
        filters.push(and(isNull(invitations.acceptedAt), isNull(user.id)))
      }

    const rows = await db
      .select({
        id: launchSubscriptions.id,
        email: launchSubscriptions.email,
        invitationId: launchSubscriptions.invitationId,
        lastSentAt: launchSubscriptions.lastSentAt,
        sendCount: launchSubscriptions.sendCount,
        createdAt: launchSubscriptions.createdAt,
        invitationStatus: invitations.status,
        invitationExpiresAt: invitations.expiresAt,
        invitationAcceptedAt: invitations.acceptedAt,
        registeredUserId: user.id,
      })
      .from(launchSubscriptions)
      .leftJoin(invitations, eq(launchSubscriptions.invitationId, invitations.id))
      .leftJoin(user, eq(user.email, launchSubscriptions.email))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(launchSubscriptions.createdAt))
      .limit(limit)
      .offset(offset)

    const now = Date.now()

    const subscriptions = rows.map((row) => {
      const invitationExpired =
        row.invitationExpiresAt != null && row.invitationExpiresAt.getTime() < now
      const isRegistered = Boolean(row.invitationAcceptedAt || row.registeredUserId)

      return {
        ...row,
        invitationExpired,
        isRegistered,
      }
    })

    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(launchSubscriptions)
      .leftJoin(invitations, eq(launchSubscriptions.invitationId, invitations.id))
      .leftJoin(user, eq(user.email, launchSubscriptions.email))
      .where(filters.length > 0 ? and(...filters) : undefined)

    const [{ notified }] = await db
      .select({
        notified: sql<number>`COUNT(*)::int`,
      })
      .from(launchSubscriptions)
      .leftJoin(invitations, eq(launchSubscriptions.invitationId, invitations.id))
      .leftJoin(user, eq(user.email, launchSubscriptions.email))
      .where(
        filters.length > 0
          ? and(...filters, isNotNull(launchSubscriptions.lastSentAt))
          : isNotNull(launchSubscriptions.lastSentAt)
      )

    const [{ registered }] = await db
      .select({
        registered: sql<number>`COUNT(*)::int`,
      })
      .from(launchSubscriptions)
      .leftJoin(invitations, eq(launchSubscriptions.invitationId, invitations.id))
      .leftJoin(user, eq(user.email, launchSubscriptions.email))
      .where(
        filters.length > 0
          ? and(...filters, or(isNotNull(invitations.acceptedAt), isNotNull(user.id)))
          : or(isNotNull(invitations.acceptedAt), isNotNull(user.id))
      )

    return {
      subscriptions,
      page,
      limit,
      total,
      stats: {
        total,
        notified,
        registered,
      },
    }
  },
  {
    query: t.Object({
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      search: t.Optional(t.String()),
      notified: t.Optional(t.String()),
      registered: t.Optional(t.String()),
    }),
  })
  .post(
    "/:id/send",
    async ({ params, request, set, logger }) => {
      const session = await auth.api.getSession({ headers: request.headers })
      if (!session) {
        set.status = 401
        return { error: "Unauthorized" }
      }

      const [subscription] = await db
        .select()
        .from(launchSubscriptions)
        .where(eq(launchSubscriptions.id, params.id))
        .limit(1)

      if (!subscription) {
        set.status = 404
        return { error: "Feliratkozás nem található" }
      }

      const existingUser = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, subscription.email))
        .limit(1)

      if (existingUser.length > 0) {
        set.status = 400
        return { error: "Ez az email cím már regisztrált" }
      }

      let invitation = null as null | typeof invitations.$inferSelect
      if (subscription.invitationId) {
        const [found] = await db
          .select()
          .from(invitations)
          .where(eq(invitations.id, subscription.invitationId))
          .limit(1)
        invitation = found ?? null
      }

      const now = new Date()
      const isExpired =
        invitation &&
        (invitation.status === "expired" || invitation.expiresAt.getTime() < now.getTime())

      if (invitation && invitation.status === "accepted") {
        set.status = 400
        return { error: "A meghívó már beváltásra került" }
      }

      if (!invitation || isExpired) {
        if (invitation && invitation.status === "pending") {
          await db
            .update(invitations)
            .set({ status: "expired" })
            .where(eq(invitations.id, invitation.id))
        }

        const token = generateInvitationToken()
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 30)

        const [created] = await db
          .insert(invitations)
          .values({
            inviterId: session.user.id,
            inviteeEmail: subscription.email,
            token,
            expiresAt,
          })
          .returning()

        invitation = created
      }

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000"
      const registerUrl = `${frontendUrl}/register?token=${invitation.token}`

      try {
        const emailHtml = await renderBarniMeseiLaunchEmail({
          registerUrl,
        })

        await EmailService.sendTemplate(
          subscription.email,
          "BarniMeséi elindult! Meghívód itt van",
          emailHtml
        )
      } catch (error) {
        logger.error({ err: error, subscriptionId: params.id }, "launch_subscription.email_failed")
        set.status = 500
        return { error: "Nem sikerült elküldeni az emailt" }
      }

      const [updated] = await db
        .update(launchSubscriptions)
        .set({
          invitationId: invitation.id,
          lastSentAt: new Date(),
          sendCount: sql`${launchSubscriptions.sendCount} + 1`,
        })
        .where(eq(launchSubscriptions.id, params.id))
        .returning()

      return { subscription: updated }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/bulk",
    async ({ body, set }) => {
      const raw = body.emails || ""
      const tokens = raw
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)

      if (tokens.length === 0) {
        set.status = 400
        return { error: "Nincs megadható email cím" }
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const normalized = tokens.map((entry) => entry.toLowerCase())
      const validEmails = normalized.filter((email) => emailRegex.test(email))
      const invalidCount = normalized.length - validEmails.length

      const uniqueEmails = Array.from(new Set(validEmails))
      const duplicateCount = validEmails.length - uniqueEmails.length

      const existingRows = await db
        .select({ email: launchSubscriptions.email })
        .from(launchSubscriptions)
        .where(inArray(launchSubscriptions.email, uniqueEmails))

      const existingSet = new Set(existingRows.map((row) => row.email))
      const existingCount = existingSet.size

      const toInsert = uniqueEmails.filter((email) => !existingSet.has(email))

      if (toInsert.length === 0) {
        return {
          added: 0,
          skipped: {
            invalid: invalidCount,
            duplicates: duplicateCount,
            existing: existingCount,
          },
        }
      }

      const inserted = await db
        .insert(launchSubscriptions)
        .values(toInsert.map((email) => ({ email })))
        .onConflictDoNothing()
        .returning({ id: launchSubscriptions.id })

      return {
        added: inserted.length,
        skipped: {
          invalid: invalidCount,
          duplicates: duplicateCount,
          existing: existingCount,
        },
      }
    },
    {
      body: t.Object({
        emails: t.String(),
      }),
    }
  )
