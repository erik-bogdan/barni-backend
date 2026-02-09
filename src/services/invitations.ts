import { eq, and } from "drizzle-orm"
import { db } from "../lib/db"
import {
  invitations,
  invitationCreditTransactions,
  storyCreditTransactions,
  invitationSettings,
  preRegistrations,
  user,
} from "../../packages/db/src/schema"
import { getLogger } from "../lib/logger"

const PRE_REGISTRATION_APPROVAL_CREDITS_KEY = "credits_for_pre_registration_approval"

export async function processInvitationOnRegistration(
  userId: string,
  userEmail: string,
  invitationToken: string
): Promise<void> {
  // Validate and mark invitation as accepted
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, invitationToken),
        eq(invitations.status, "pending")
      )
    )
    .limit(1)

  if (!invitation) {
    getLogger().warn("invitations.pending_not_found")
    return
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    getLogger().warn({ invitationId: invitation.id }, "invitations.expired")
    return
  }

  // Update invitation
  await db
    .update(invitations)
    .set({
      status: "accepted",
      acceptedBy: userId,
      acceptedAt: new Date(),
    })
    .where(eq(invitations.id, invitation.id))

  // Update user's invitedBy field
  await db
    .update(user)
    .set({ invitedBy: invitation.id })
    .where(eq(user.id, userId))

  // Get credit settings for inviter and invitee
  const creditsForInviter = await db
    .select()
    .from(invitationSettings)
    .where(eq(invitationSettings.key, "credits_for_inviter_on_registration"))
    .limit(1)

  const creditsForInvitee = await db
    .select()
    .from(invitationSettings)
    .where(eq(invitationSettings.key, "credits_for_invitee_on_registration"))
    .limit(1)

  const inviterCreditAmount = creditsForInviter[0]?.value ?? 0
  const inviteeCreditAmount = creditsForInvitee[0]?.value ?? 0

  const [preRegistrationMatch] = await db
    .select({ id: preRegistrations.id })
    .from(preRegistrations)
    .where(
      and(
        eq(preRegistrations.invitationId, invitation.id),
        eq(preRegistrations.status, "approved"),
      )
    )
    .limit(1)

  // Pre-registration approval flow uses a dedicated starter credit setting.
  // We skip inviter/invitee invitation rewards for these system-issued invites.
  if (preRegistrationMatch) {
    const preRegistrationCreditsSetting = await db
      .select()
      .from(invitationSettings)
      .where(eq(invitationSettings.key, PRE_REGISTRATION_APPROVAL_CREDITS_KEY))
      .limit(1)

    const starterCreditAmount = preRegistrationCreditsSetting[0]?.value ?? 0

    if (starterCreditAmount > 0) {
      await db.insert(storyCreditTransactions).values({
        userId,
        type: "bonus",
        amount: starterCreditAmount,
        reason: "Regisztrációs jelentkezés jóváhagyása",
        source: "invitation_system",
      })
    }

    getLogger().info(
      { invitationId: invitation.id, userId, starterCreditAmount },
      "invitations.processed_pre_registration",
    )
    return
  }

  // Award credits to inviter (who sent the invitation)
  if (inviterCreditAmount > 0) {
    // Award invitation credits to inviter
    await db.insert(invitationCreditTransactions).values({
      userId: invitation.inviterId,
      invitationId: invitation.id,
      type: "invitation_accepted",
      amount: inviterCreditAmount,
      reason: `Meghívott regisztrált: ${userEmail}`,
    })

    // Also award story credits to inviter
    await db.insert(storyCreditTransactions).values({
      userId: invitation.inviterId,
      type: "bonus",
      amount: inviterCreditAmount,
      reason: "Meghívott regisztrált",
      source: "invitation_system",
    })
  }

  // Award credits to invitee (who registered)
  if (inviteeCreditAmount > 0) {
    // Award story credits to invitee
    await db.insert(storyCreditTransactions).values({
      userId: userId,
      type: "bonus",
      amount: inviteeCreditAmount,
      reason: "Meghívóval regisztrált",
      source: "invitation_system",
    })
  }

  getLogger().info({ invitationId: invitation.id, userId }, "invitations.processed")
}
