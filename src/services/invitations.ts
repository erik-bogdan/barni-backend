import { eq, and } from "drizzle-orm"
import { db } from "../lib/db"
import {
  invitations,
  invitationCreditTransactions,
  storyCreditTransactions,
  invitationSettings,
  user,
} from "../../packages/db/src/schema"

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
    console.warn(`[Invitations] No pending invitation found for token: ${invitationToken}`)
    return
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    console.warn(`[Invitations] Invitation expired: ${invitation.id}`)
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

  console.log(`[Invitations] Processed invitation ${invitation.id} for user ${userId}`)
}
