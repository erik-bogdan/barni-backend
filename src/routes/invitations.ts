import { Elysia, t } from "elysia"
import { and, eq, desc, sql, or, gte } from "drizzle-orm"
import { randomBytes } from "crypto"

import { db } from "../lib/db"
import { auth } from "../lib/auth"
import { betterAuthMiddleware } from "../plugins/auth/middleware"
import { requireRole } from "../plugins/auth/requireRole"
import {
  user,
  invitationRequests,
  invitations,
  invitationCreditTransactions,
  invitationSettings,
  storyCreditTransactions,
  preRegistrations,
} from "../../packages/db/src/schema"
import { EmailService } from "../plugins/email/email.service"
import { renderBarniMeseiInvitationEmail } from "../plugins/email/templates/barnimesei-invitation-email"

async function requireSession(headers: Headers, set: any) {
  const session = await auth.api.getSession({ headers })
  if (!session) {
    set.status = 401
    return null
  }
  return session
}

// Generate a secure random token
function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url")
}

// Get invitation credit balance for a user
async function getInvitationCreditBalance(userId: string): Promise<number> {
  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${invitationCreditTransactions.amount}), 0)::int`,
    })
    .from(invitationCreditTransactions)
    .where(eq(invitationCreditTransactions.userId, userId))

  return result[0]?.total ?? 0
}

// Get invitation settings
async function getInvitationSetting(key: string): Promise<number> {
  const setting = await db
    .select()
    .from(invitationSettings)
    .where(eq(invitationSettings.key, key))
    .limit(1)

  return setting[0]?.value ?? 0
}

// User routes - no admin required
export const invitationsApi = new Elysia({ name: "invitations", prefix: "/invitations" })
  .use(betterAuthMiddleware)
  
  // GET /invitations/my-request - Get current user's active invitation request (pending or approved)
  .get("/my-request", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const requestData = await db
      .select()
      .from(invitationRequests)
      .where(
        and(
          eq(invitationRequests.userId, session.user.id),
          or(
            eq(invitationRequests.status, "pending"),
            eq(invitationRequests.status, "approved")
          )
        )
      )
      .limit(1)

    if (requestData.length === 0) {
      return { request: null }
    }

    return {
      request: {
        id: requestData[0].id,
        status: requestData[0].status,
        reason: requestData[0].reason,
        reviewedAt: requestData[0].reviewedAt,
        createdAt: requestData[0].createdAt,
      },
    }
  })

  // GET /invitations/my-request-history - Get all invitation requests history for user
  .get("/my-request-history", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const allRequests = await db
      .select()
      .from(invitationRequests)
      .where(eq(invitationRequests.userId, session.user.id))
      .orderBy(desc(invitationRequests.createdAt))

    return {
      requests: allRequests.map((req) => ({
        id: req.id,
        status: req.status,
        reason: req.reason,
        reviewedAt: req.reviewedAt,
        createdAt: req.createdAt,
      })),
    }
  })

  // POST /invitations/request - Create invitation request
  .post(
    "/request",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      // Check invitation credit balance
      const creditBalance = await getInvitationCreditBalance(session.user.id)
      
      // Check if user already has a pending request
      const pendingRequest = await db
        .select()
        .from(invitationRequests)
        .where(
          and(
            eq(invitationRequests.userId, session.user.id),
            eq(invitationRequests.status, "pending")
          )
        )
        .limit(1)

      if (pendingRequest.length > 0) {
        set.status = 400
        return { error: "Már van folyamatban lévő meghívó kérése" }
      }

      // If user has approved request, only allow new request if they have 0 credits
      // (they can request again to get 1 credit)
      const approvedRequest = await db
        .select()
        .from(invitationRequests)
        .where(
          and(
            eq(invitationRequests.userId, session.user.id),
            eq(invitationRequests.status, "approved")
          )
        )
        .limit(1)

      if (approvedRequest.length > 0 && creditBalance > 0) {
        set.status = 400
        return { error: "Már van jóváhagyott meghívó kérése és van kredited" }
      }

      const [created] = await db
        .insert(invitationRequests)
        .values({
          userId: session.user.id,
          reason: body.reason?.trim() || null,
        })
        .returning()

      return { request: created }
    },
    {
      body: t.Object({
        reason: t.Optional(t.String()),
      }),
    }
  )

  // GET /invitations/my-invitations - Get user's sent invitations
  .get("/my-invitations", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const userInvitations = await db
      .select()
      .from(invitations)
      .where(eq(invitations.inviterId, session.user.id))
      .orderBy(desc(invitations.createdAt))

    return {
      invitations: userInvitations.map((inv) => ({
        id: inv.id,
        inviteeEmail: inv.inviteeEmail,
        status: inv.status,
        acceptedAt: inv.acceptedAt,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      })),
    }
  })

  // GET /invitations/credit-balance - Get user's invitation credit balance
  .get("/credit-balance", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const balance = await getInvitationCreditBalance(session.user.id)

    return { balance }
  })

  // GET /invitations/redemption-credits - Get credit amounts for invitation redemption
  .get("/redemption-credits", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const creditsForInviter = await getInvitationSetting("credits_for_inviter_on_registration")
    const creditsForInvitee = await getInvitationSetting("credits_for_invitee_on_registration")

    return {
      inviterCredits: creditsForInviter,
      inviteeCredits: creditsForInvitee,
    }
  })

  // POST /invitations/send - Send an invitation
  .post(
    "/send",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      // Check if user has approved invitation request
      const approvedRequest = await db
        .select()
        .from(invitationRequests)
        .where(
          and(
            eq(invitationRequests.userId, session.user.id),
            eq(invitationRequests.status, "approved")
          )
        )
        .limit(1)

      if (approvedRequest.length === 0) {
        set.status = 403
        return { error: "Nincs jóváhagyott meghívó kérése" }
      }

      // Check credit balance (sending invitation costs 1 credit)
      const balance = await getInvitationCreditBalance(session.user.id)
      if (balance < 1) {
        set.status = 400
        return { error: "Nincs elég meghívó kredited" }
      }

      // Check if email is already registered
      const existingUser = await db
        .select()
        .from(user)
        .where(eq(user.email, body.email.trim().toLowerCase()))
        .limit(1)

      if (existingUser.length > 0) {
        set.status = 400
        return { error: "Ez az email cím már regisztrálva van" }
      }

      // Check if there's already a pending invitation for this email
      const existingInvitation = await db
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.inviteeEmail, body.email.trim().toLowerCase()),
            eq(invitations.status, "pending"),
            gte(invitations.expiresAt, new Date())
          )
        )
        .limit(1)

      if (existingInvitation.length > 0) {
        set.status = 400
        return { error: "Már van aktív meghívó erre az email címre" }
      }

      // Generate token and create invitation
      const token = generateInvitationToken()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30) // 30 days validity

      const [created] = await db
        .insert(invitations)
        .values({
          inviterId: session.user.id,
          inviteeEmail: body.email.trim().toLowerCase(),
          token,
          expiresAt,
        })
        .returning()

      // Deduct 1 credit for sending invitation
      await db.insert(invitationCreditTransactions).values({
        userId: session.user.id,
        invitationId: created.id,
        type: "invitation_sent",
        amount: -1,
        reason: `Meghívó küldése: ${body.email}`,
      })

      // Send invitation email
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000"
      const registerUrl = `${frontendUrl}/register?token=${token}`

      try {
        const inviterName = session.user.name || session.user.email || "Valaki"
        const emailHtml = await renderBarniMeseiInvitationEmail({
          inviterName,
          registerUrl,
        })

        await EmailService.sendTemplate(
          body.email.trim().toLowerCase(),
          "Meghívó a BarniMeséi-hoz",
          emailHtml
        )
      } catch (error) {
        //console.error("Failed to send invitation email:", error)
        // Don't fail the request if email fails
      }

      return { invitation: created }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
      }),
    }
  )

  // POST /invitations/process-token - Process invitation token after registration (public, but validates token and email)
  .post("/process-token", async ({ body, set }) => {
    if (!body.token || !body.email) {
      set.status = 400
      return { error: "Token and email are required" }
    }

    // Validate token first
    const invitation = await db
      .select({
        id: invitations.id,
        inviteeEmail: invitations.inviteeEmail,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(eq(invitations.token, body.token))
      .limit(1)

    if (invitation.length === 0) {
      set.status = 400
      return { error: "Érvénytelen meghívó token" }
    }

    const inv = invitation[0]

    if (inv.status !== "pending") {
      set.status = 400
      return { error: "Ez a meghívó már felhasználva vagy lejárt" }
    }

    if (new Date(inv.expiresAt) < new Date()) {
      set.status = 400
      return { error: "Ez a meghívó lejárt" }
    }

    // Verify email matches
    if (inv.inviteeEmail.toLowerCase() !== body.email.trim().toLowerCase()) {
      set.status = 400
      return { error: "Az email cím nem egyezik a meghívóhoz tartozó email címmel" }
    }

    // Get user by email
    const [registeredUser] = await db
      .select()
      .from(user)
      .where(eq(user.email, body.email.trim().toLowerCase()))
      .limit(1)

    if (!registeredUser) {
      set.status = 404
      return { error: "Felhasználó nem található" }
    }

    try {
      const { processInvitationOnRegistration } = await import("../services/invitations")
      await processInvitationOnRegistration(
        registeredUser.id,
        registeredUser.email || "",
        body.token
      )
      return { success: true }
    } catch (error: any) {
      console.error("[Invitations] Failed to process token:", error)
      set.status = 500
      return { error: error?.message || "Nem sikerült feldolgozni a meghívót" }
    }
  }, {
    body: t.Object({
      token: t.String(),
      email: t.String({ format: "email" }),
    }),
  })

  // GET /invitations/validate-token - Validate invitation token (public endpoint)
  .get("/validate-token", async ({ query, set }) => {
    if (!query.token) {
      set.status = 400
      return { error: "Token is required", valid: false }
    }

    const invitation = await db
      .select({
        id: invitations.id,
        inviteeEmail: invitations.inviteeEmail,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        inviterId: invitations.inviterId,
      })
      .from(invitations)
      .where(eq(invitations.token, query.token))
      .limit(1)

    if (invitation.length === 0) {
      return { valid: false, error: "Érvénytelen meghívó token" }
    }

    const inv = invitation[0]

    if (inv.status !== "pending") {
      return { valid: false, error: "Ez a meghívó már felhasználva vagy lejárt" }
    }

    if (new Date(inv.expiresAt) < new Date()) {
      return { valid: false, error: "Ez a meghívó lejárt" }
    }

    // Get inviter name and role
    const inviter = await db
      .select({ name: user.name, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, inv.inviterId))
      .limit(1)

    // If inviter is admin, use "Barni Maci" instead
    const inviterName = inviter[0]?.role === "admin" 
      ? "Barni Maci" 
      : (inviter[0]?.name || inviter[0]?.email || "Ismeretlen")

    return {
      valid: true,
      invitation: {
        id: inv.id,
        inviteeEmail: inv.inviteeEmail,
        inviterName,
      },
    }
  })

// Admin routes
export const invitationsAdminApi = new Elysia({ name: "invitations-admin", prefix: "/admin/invitations" })
  .use(betterAuthMiddleware)
  .use(requireRole("admin"))

  // GET /admin/invitations/requests - Get all invitation requests
  .get("/requests", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const requests = await db
      .select({
        id: invitationRequests.id,
        userId: invitationRequests.userId,
        userEmail: user.email,
        userName: user.name,
        status: invitationRequests.status,
        reason: invitationRequests.reason,
        reviewedBy: invitationRequests.reviewedBy,
        reviewedAt: invitationRequests.reviewedAt,
        createdAt: invitationRequests.createdAt,
      })
      .from(invitationRequests)
      .leftJoin(user, eq(invitationRequests.userId, user.id))
      .orderBy(desc(invitationRequests.createdAt))

    return { requests }
  })

  // POST /admin/invitations/requests/:id/approve - Approve invitation request
  .post(
    "/requests/:id/approve",
    async ({ params, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [requestData] = await db
        .select()
        .from(invitationRequests)
        .where(eq(invitationRequests.id, params.id))
        .limit(1)

      if (!requestData) {
        set.status = 404
        return { error: "Meghívó kérés nem található" }
      }

      if (requestData.status !== "pending") {
        set.status = 400
        return { error: "Ez a kérés már feldolgozva" }
      }

      // Update request status
      const [updated] = await db
        .update(invitationRequests)
        .set({
          status: "approved",
          reviewedBy: session.user.id,
          reviewedAt: new Date(),
        })
        .where(eq(invitationRequests.id, params.id))
        .returning()

      // Award 1 credit on approval (always)
      await db.insert(invitationCreditTransactions).values({
        userId: requestData.userId,
        invitationRequestId: requestData.id,
        type: "request_approved",
        amount: 1,
        reason: "Meghívó kérés jóváhagyása",
      })

      // Also add to story credits
      await db.insert(storyCreditTransactions).values({
        userId: requestData.userId,
        type: "bonus",
        amount: 1,
        reason: "Meghívó kérés jóváhagyása",
        source: "invitation_system",
      })

      return { request: updated }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /admin/invitations/requests/:id/reject - Reject invitation request
  .post(
    "/requests/:id/reject",
    async ({ params, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [requestData] = await db
        .select()
        .from(invitationRequests)
        .where(eq(invitationRequests.id, params.id))
        .limit(1)

      if (!requestData) {
        set.status = 404
        return { error: "Meghívó kérés nem található" }
      }

      if (requestData.status !== "pending") {
        set.status = 400
        return { error: "Ez a kérés már feldolgozva" }
      }

      const [updated] = await db
        .update(invitationRequests)
        .set({
          status: "rejected",
          reviewedBy: session.user.id,
          reviewedAt: new Date(),
        })
        .where(eq(invitationRequests.id, params.id))
        .returning()

      return { request: updated }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /admin/invitations/all - Get all invitations
  .get("/all", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const allInvitations = await db
      .select({
        id: invitations.id,
        inviterId: invitations.inviterId,
        inviteeEmail: invitations.inviteeEmail,
        token: invitations.token,
        status: invitations.status,
        acceptedBy: invitations.acceptedBy,
        acceptedAt: invitations.acceptedAt,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
        inviterEmail: user.email,
        inviterName: user.name,
      })
      .from(invitations)
      .leftJoin(user, eq(invitations.inviterId, user.id))
      .orderBy(desc(invitations.createdAt))

    return { invitations: allInvitations }
  })

  // GET /admin/invitations/settings - Get invitation settings
  .get("/settings", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const settings = await db.select().from(invitationSettings)

    return { settings }
  })

  // PUT /admin/invitations/settings/:key - Update invitation setting
  .put(
    "/settings/:key",
    async ({ params, body, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const existing = await db
        .select()
        .from(invitationSettings)
        .where(eq(invitationSettings.key, params.key))
        .limit(1)

      if (existing.length > 0) {
        const [updated] = await db
          .update(invitationSettings)
          .set({
            value: body.value,
            description: body.description || null,
          })
          .where(eq(invitationSettings.key, params.key))
          .returning()

        return { setting: updated }
      } else {
        const [created] = await db
          .insert(invitationSettings)
          .values({
            key: params.key,
            value: body.value,
            description: body.description || null,
          })
          .returning()

        return { setting: created }
      }
    },
    {
      params: t.Object({
        key: t.String(),
      }),
      body: t.Object({
        value: t.Number(),
        description: t.Optional(t.String()),
      }),
    }
  )

// Pre-registration API - public endpoint for registration requests
export const preRegistrationApi = new Elysia({ name: "pre-registration", prefix: "/pre-registration" })
  // POST /pre-registration/apply - Submit a pre-registration request (public)
  .post(
    "/apply",
    async ({ body, set }) => {
      // Check if email already exists
      const existing = await db
        .select()
        .from(preRegistrations)
        .where(eq(preRegistrations.email, body.email.trim().toLowerCase()))
        .limit(1)

      if (existing.length > 0) {
        set.status = 400
        return { error: "Ez az email cím már jelentkezett" }
      }

      // Check if user already exists
      const existingUser = await db
        .select()
        .from(user)
        .where(eq(user.email, body.email.trim().toLowerCase()))
        .limit(1)

      if (existingUser.length > 0) {
        set.status = 400
        return { error: "Ez az email cím már regisztrálva van" }
      }

      const [created] = await db
        .insert(preRegistrations)
        .values({
          email: body.email.trim().toLowerCase(),
          firstName: body.firstName?.trim() || null,
          lastName: body.lastName?.trim() || null,
          reason: body.reason?.trim() || null,
        })
        .returning()

      return { preRegistration: created }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
        reason: t.Optional(t.String()),
      }),
    }
  )

// Pre-registration Admin API
export const preRegistrationAdminApi = new Elysia({ name: "pre-registration-admin", prefix: "/admin/pre-registrations" })
  .use(requireRole("admin"))
  // GET /admin/pre-registrations - Get all pre-registration requests
  .get("/", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const allRequests = await db
      .select({
        id: preRegistrations.id,
        email: preRegistrations.email,
        firstName: preRegistrations.firstName,
        lastName: preRegistrations.lastName,
        reason: preRegistrations.reason,
        status: preRegistrations.status,
        approvedBy: preRegistrations.approvedBy,
        approvedAt: preRegistrations.approvedAt,
        invitationId: preRegistrations.invitationId,
        emailSentAt: preRegistrations.emailSentAt,
        createdAt: preRegistrations.createdAt,
        updatedAt: preRegistrations.updatedAt,
        approverName: sql<string | null>`${user.name}`.as("approver_name"),
        approverEmail: sql<string | null>`${user.email}`.as("approver_email"),
      })
      .from(preRegistrations)
      .leftJoin(user, eq(preRegistrations.approvedBy, user.id))
      .orderBy(desc(preRegistrations.createdAt))

    // Check which emails are already registered
    const requestsWithRegistrationStatus = await Promise.all(
      allRequests.map(async (req) => {
        const [existingUser] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, req.email.toLowerCase()))
          .limit(1)

        return {
          ...req,
          isRegistered: !!existingUser,
        }
      })
    )

    return { requests: requestsWithRegistrationStatus }
  })
  // POST /admin/pre-registrations/:id/approve - Approve pre-registration and generate invitation
  .post(
    "/:id/approve",
    async ({ params, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [requestData] = await db
        .select()
        .from(preRegistrations)
        .where(eq(preRegistrations.id, params.id))
        .limit(1)

      if (!requestData) {
        set.status = 404
        return { error: "Jelentkezés nem található" }
      }

      if (requestData.status !== "pending") {
        set.status = 400
        return { error: "Ez a jelentkezés már feldolgozva" }
      }

      // Generate invitation token
      const token = generateInvitationToken()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30) // 30 days validity

      // Create invitation (using system user or null inviterId - we'll use a special system user ID)
      // For now, we'll use the admin's ID as inviterId, or we could create a system user
      const [invitation] = await db
        .insert(invitations)
        .values({
          inviterId: session.user.id, // Admin who approved becomes the inviter
          inviteeEmail: requestData.email,
          token,
          expiresAt,
        })
        .returning()

      // Update pre-registration status
      const [updated] = await db
        .update(preRegistrations)
        .set({
          status: "approved",
          approvedBy: session.user.id,
          approvedAt: new Date(),
          invitationId: invitation.id,
        })
        .where(eq(preRegistrations.id, params.id))
        .returning()

      // Send invitation email
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000"
      const registerUrl = `${frontendUrl}/register?token=${token}`

      try {
        // For pre-registration approval, use "Barni jóváhagyta" message
        const emailHtml = await renderBarniMeseiInvitationEmail({
          inviterName: "Barni",
          registerUrl,
          isApprovalEmail: true,
        })

        await EmailService.sendTemplate(
          requestData.email,
          "Barni jóváhagyta a regisztrációs kérelmed",
          emailHtml
        )

        // Update emailSentAt
        await db
          .update(preRegistrations)
          .set({
            emailSentAt: new Date(),
          })
          .where(eq(preRegistrations.id, params.id))
      } catch (error) {
        // Don't fail the request if email fails
      }

      // Fetch updated record with emailSentAt
      const [finalUpdated] = await db
        .select()
        .from(preRegistrations)
        .where(eq(preRegistrations.id, params.id))
        .limit(1)

      return { preRegistration: finalUpdated || updated, invitation }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /admin/pre-registrations/:id/reject - Reject pre-registration
  .post(
    "/:id/reject",
    async ({ params, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [requestData] = await db
        .select()
        .from(preRegistrations)
        .where(eq(preRegistrations.id, params.id))
        .limit(1)

      if (!requestData) {
        set.status = 404
        return { error: "Jelentkezés nem található" }
      }

      if (requestData.status !== "pending") {
        set.status = 400
        return { error: "Ez a jelentkezés már feldolgozva" }
      }

      const [updated] = await db
        .update(preRegistrations)
        .set({
          status: "rejected",
          approvedBy: session.user.id,
          approvedAt: new Date(),
        })
        .where(eq(preRegistrations.id, params.id))
        .returning()

      return { preRegistration: updated }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /admin/pre-registrations/:id/resend-email - Resend invitation email
  .post(
    "/:id/resend-email",
    async ({ params, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [requestData] = await db
        .select()
        .from(preRegistrations)
        .where(eq(preRegistrations.id, params.id))
        .limit(1)

      if (!requestData) {
        set.status = 404
        return { error: "Jelentkezés nem található" }
      }

      if (requestData.status !== "approved" || !requestData.invitationId) {
        set.status = 400
        return { error: "Ez a jelentkezés még nem lett jóváhagyva vagy nincs meghívó" }
      }

      // Get invitation token
      const [invitation] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, requestData.invitationId))
        .limit(1)

      if (!invitation) {
        set.status = 404
        return { error: "Meghívó nem található" }
      }

      // Send invitation email
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000"
      const registerUrl = `${frontendUrl}/register?token=${invitation.token}`

      try {
        console.log("[Resend Email] Starting for:", requestData.email)
        console.log("[Resend Email] Register URL:", registerUrl)
        console.log("[Resend Email] Invitation token:", invitation.token)
        
        const emailHtml = await renderBarniMeseiInvitationEmail({
          inviterName: "Barni",
          registerUrl,
          isApprovalEmail: true,
        })

        console.log("[Resend Email] HTML rendered, length:", emailHtml?.length || 0)

        if (!emailHtml || emailHtml.length === 0) {
          throw new Error("Email HTML is empty")
        }

        console.log("[Resend Email] Calling EmailService.sendTemplate...")
        await EmailService.sendTemplate(
          requestData.email,
          "Barni jóváhagyta a regisztrációs kérelmed",
          emailHtml
        )

        console.log("[Resend Email] Email sent successfully")

        // Update emailSentAt
        const [updated] = await db
          .update(preRegistrations)
          .set({
            emailSentAt: new Date(),
          })
          .where(eq(preRegistrations.id, params.id))
          .returning()

        console.log("[Resend Email] Database updated")
        return { preRegistration: updated }
      } catch (error: any) {
        console.error("[Resend Email] Full error:", error)
        console.error("[Resend Email] Error message:", error?.message)
        console.error("[Resend Email] Error stack:", error?.stack)
        console.error("[Resend Email] Error name:", error?.name)
        set.status = 500
        return { 
          error: "Nem sikerült elküldeni az emailt",
          details: error?.message || String(error)
        }
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )