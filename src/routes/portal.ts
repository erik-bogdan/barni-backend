import { Elysia, t } from "elysia"
import { and, desc, eq, inArray, sql } from "drizzle-orm"

import { db } from "../lib/db"
import { auth } from "../lib/auth"
import { getPresignedUrl } from "../services/s3"
import { buildFreeStoryCoverKey, buildFreeStoryCoverSquareKey } from "../services/cover/coverService"
import { buildFreeStoryAudioKey } from "../services/audio"
import {
  billingAddresses,
  childThemes,
  children,
  storyCreditTransactions,
  audioStarTransactions,
  stories,
  themeCategories,
  themes,
  user,
  freeStories,
  freeStoryFeedback,
} from "../../packages/db/src/schema"

async function requireSession(headers: Headers, set: { status: number }) {
  const session = await auth.api.getSession({ headers })
  if (!session) {
    set.status = 401
    return null
  }
  return session
}

export const portal = new Elysia({ name: "portal", prefix: "/portal" })
  .get("/themes", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const cats = await db.select().from(themeCategories).orderBy(themeCategories.id)
    const allThemes = await db.select().from(themes).orderBy(themes.id)

    const byCat = new Map<number, typeof allThemes>()
    for (const th of allThemes) {
      const arr = byCat.get(th.categoryId) ?? []
      arr.push(th)
      byCat.set(th.categoryId, arr)
    }

    return {
      categories: cats.map((c) => ({
        id: c.id,
        name: c.name,
        themes: (byCat.get(c.id) ?? []).map((th) => ({
          id: th.id,
          name: th.name,
          icon: th.icon,
          main: th.main,
          categoryId: th.categoryId,
        })),
      })),
    }
  })
  .get("/children", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const rows = await db
      .select()
      .from(children)
      .where(eq(children.userId, session.user.id))
      .orderBy(children.createdAt)

    return {
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        age: c.age,
        learningGoal: c.learningGoal ?? null,
        mood: c.mood ?? null,
        createdAt: c.createdAt,
      })),
    }
  })
  .post(
    "/children",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const userId = session.user.id

      const [created] = await db
        .insert(children)
        .values({
          userId,
          name: body.name.trim(),
          age: body.age,
          learningGoal: body.learningGoal?.trim() || null,
          mood: body.mood?.trim() || null,
        })
        .returning()

      if (!created) {
        set.status = 500
        return { error: "Failed to create child" }
      }

      const themeIds = Array.from(
        new Set([
          body.favoriteThemeId,
          ...(body.themeIds ?? []),
        ].filter((x): x is number => typeof x === "number")),
      )

      if (themeIds.length > 0) {
        // Ensure themes exist (best-effort)
        const existingThemes = await db
          .select({ id: themes.id })
          .from(themes)
          .where(inArray(themes.id, themeIds))

        const existingThemeIds = new Set(existingThemes.map((t) => t.id))
        const finalThemeIds = themeIds.filter((id) => existingThemeIds.has(id))

        if (finalThemeIds.length > 0) {
          await db.insert(childThemes).values(
            finalThemeIds.map((themeId) => ({
              childId: created.id,
              themeId,
              isFavorite: themeId === body.favoriteThemeId,
            })),
          )
        }
      }

      return {
        id: created.id,
        name: created.name,
        age: created.age,
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        age: t.Number({ minimum: 0, maximum: 25 }),
        favoriteThemeId: t.Number(),
        themeIds: t.Optional(t.Array(t.Number())),
        learningGoal: t.Optional(t.String()),
        mood: t.Optional(t.String()),
      }),
    },
  )
  .get("/credits", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const [creditRow] = await db
      .select({
        balance: sql<number>`coalesce(sum(${storyCreditTransactions.amount}), 0)`,
      })
      .from(storyCreditTransactions)
      .where(eq(storyCreditTransactions.userId, session.user.id))

    const [audioStarRow] = await db
      .select({
        balance: sql<number>`coalesce(sum(${audioStarTransactions.amount}), 0)`,
      })
      .from(audioStarTransactions)
      .where(eq(audioStarTransactions.userId, session.user.id))

    return { 
      balance: creditRow?.balance ?? 0,
      audioStarBalance: audioStarRow?.balance ?? 0,
    }
  })
  .get(
    "/transactions",
    async ({ request, query, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const page = Math.max(1, parseInt(query.page || "1", 10))
      const limit = Math.min(100, Math.max(5, parseInt(query.limit || "20", 10)))
      const offset = (page - 1) * limit
      const kind = query.kind ?? "all"
      const fetchCount = page * limit

      const [{ creditTotal }] = await db
        .select({ creditTotal: sql<number>`COUNT(*)::int` })
        .from(storyCreditTransactions)
        .where(eq(storyCreditTransactions.userId, session.user.id))

      const [{ audioTotal }] = await db
        .select({ audioTotal: sql<number>`COUNT(*)::int` })
        .from(audioStarTransactions)
        .where(eq(audioStarTransactions.userId, session.user.id))

      if (kind === "credits") {
        const creditRows = await db
          .select({
            id: storyCreditTransactions.id,
            type: storyCreditTransactions.type,
            amount: storyCreditTransactions.amount,
            reason: storyCreditTransactions.reason,
            source: storyCreditTransactions.source,
            createdAt: storyCreditTransactions.createdAt,
            storyId: storyCreditTransactions.storyId,
            orderId: storyCreditTransactions.orderId,
            storyTitle: stories.title,
          })
          .from(storyCreditTransactions)
          .leftJoin(stories, eq(storyCreditTransactions.storyId, stories.id))
          .where(eq(storyCreditTransactions.userId, session.user.id))
          .orderBy(desc(storyCreditTransactions.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          items: creditRows.map((row) => ({
            id: String(row.id),
            kind: "credits",
            type: row.type,
            amount: row.amount,
            reason: row.reason,
            source: row.source,
            createdAt: row.createdAt,
            storyId: row.storyId,
            orderId: row.orderId,
            storyTitle: row.storyTitle,
          })),
          total: creditTotal ?? 0,
          page,
          limit,
          totalPages: Math.ceil((creditTotal ?? 0) / limit),
        }
      }

      if (kind === "audio") {
        const audioRows = await db
          .select({
            id: audioStarTransactions.id,
            type: audioStarTransactions.type,
            amount: audioStarTransactions.amount,
            reason: audioStarTransactions.reason,
            source: audioStarTransactions.source,
            createdAt: audioStarTransactions.createdAt,
            storyId: audioStarTransactions.storyId,
            orderId: audioStarTransactions.orderId,
            storyTitle: stories.title,
          })
          .from(audioStarTransactions)
          .leftJoin(stories, eq(audioStarTransactions.storyId, stories.id))
          .where(eq(audioStarTransactions.userId, session.user.id))
          .orderBy(desc(audioStarTransactions.createdAt))
          .limit(limit)
          .offset(offset)

        return {
          items: audioRows.map((row) => ({
            id: String(row.id),
            kind: "audio_stars",
            type: row.type,
            amount: row.amount,
            reason: row.reason,
            source: row.source,
            createdAt: row.createdAt,
            storyId: row.storyId,
            orderId: row.orderId,
            storyTitle: row.storyTitle,
          })),
          total: audioTotal ?? 0,
          page,
          limit,
          totalPages: Math.ceil((audioTotal ?? 0) / limit),
        }
      }

      const creditRows = await db
        .select({
          id: storyCreditTransactions.id,
          type: storyCreditTransactions.type,
          amount: storyCreditTransactions.amount,
          reason: storyCreditTransactions.reason,
          source: storyCreditTransactions.source,
          createdAt: storyCreditTransactions.createdAt,
          storyId: storyCreditTransactions.storyId,
          orderId: storyCreditTransactions.orderId,
          storyTitle: stories.title,
        })
        .from(storyCreditTransactions)
        .leftJoin(stories, eq(storyCreditTransactions.storyId, stories.id))
        .where(eq(storyCreditTransactions.userId, session.user.id))
        .orderBy(desc(storyCreditTransactions.createdAt))
        .limit(fetchCount)

      const audioRows = await db
        .select({
          id: audioStarTransactions.id,
          type: audioStarTransactions.type,
          amount: audioStarTransactions.amount,
          reason: audioStarTransactions.reason,
          source: audioStarTransactions.source,
          createdAt: audioStarTransactions.createdAt,
          storyId: audioStarTransactions.storyId,
          orderId: audioStarTransactions.orderId,
          storyTitle: stories.title,
        })
        .from(audioStarTransactions)
        .leftJoin(stories, eq(audioStarTransactions.storyId, stories.id))
        .where(eq(audioStarTransactions.userId, session.user.id))
        .orderBy(desc(audioStarTransactions.createdAt))
        .limit(fetchCount)

      const combined = [
        ...creditRows.map((row) => ({
          id: String(row.id),
          kind: "credits" as const,
          type: row.type,
          amount: row.amount,
          reason: row.reason,
          source: row.source,
          createdAt: row.createdAt,
          storyId: row.storyId,
          orderId: row.orderId,
          storyTitle: row.storyTitle,
        })),
        ...audioRows.map((row) => ({
          id: String(row.id),
          kind: "audio_stars" as const,
          type: row.type,
          amount: row.amount,
          reason: row.reason,
          source: row.source,
          createdAt: row.createdAt,
          storyId: row.storyId,
          orderId: row.orderId,
          storyTitle: row.storyTitle,
        })),
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      const items = combined.slice(offset, offset + limit)
      const total = (creditTotal ?? 0) + (audioTotal ?? 0)

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        kind: t.Optional(t.Union([t.Literal("all"), t.Literal("credits"), t.Literal("audio")])),
      }),
    },
  )
  .get("/children/:childId", async ({ request, params, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const [child] = await db
      .select()
      .from(children)
      .where(and(eq(children.id, params.childId), eq(children.userId, session.user.id)))
      .limit(1)

    if (!child) {
      set.status = 404
      return { error: "Child not found" }
    }

    const childThemeRows = await db
      .select({
        themeId: childThemes.themeId,
        isFavorite: childThemes.isFavorite,
      })
      .from(childThemes)
      .where(eq(childThemes.childId, child.id))

    const favoriteTheme = childThemeRows.find((ct) => ct.isFavorite)
    const allThemeIds = childThemeRows.map((ct) => Number(ct.themeId))

    return {
      id: child.id,
      name: child.name,
      age: child.age,
      learningGoal: child.learningGoal ?? null,
      mood: child.mood ?? null,
      favoriteThemeId: favoriteTheme ? Number(favoriteTheme.themeId) : null,
      themeIds: allThemeIds,
    }
  })
  .put(
    "/children/:childId",
    async ({ request, params, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [existing] = await db
        .select()
        .from(children)
        .where(and(eq(children.id, params.childId), eq(children.userId, session.user.id)))
        .limit(1)

      if (!existing) {
        set.status = 404
        return { error: "Child not found" }
      }

      const [updated] = await db
        .update(children)
        .set({
          name: body.name?.trim() ?? existing.name,
          age: body.age ?? existing.age,
          learningGoal: body.learningGoal?.trim() || null,
          mood: body.mood?.trim() || null,
        })
        .where(eq(children.id, params.childId))
        .returning()

      if (!updated) {
        set.status = 500
        return { error: "Failed to update child" }
      }

      // Update themes if provided
      if (body.favoriteThemeId !== undefined || body.themeIds !== undefined) {
        // Delete existing child themes
        await db.delete(childThemes).where(eq(childThemes.childId, params.childId))

        const themeIds = Array.from(
          new Set([
            body.favoriteThemeId ?? null,
            ...(body.themeIds ?? []),
          ].filter((x): x is number => typeof x === "number")),
        )

        if (themeIds.length > 0) {
          // Ensure themes exist
          const existingThemes = await db
            .select({ id: themes.id })
            .from(themes)
            .where(inArray(themes.id, themeIds))

          const existingThemeIds = new Set(existingThemes.map((t) => t.id))
          const finalThemeIds = themeIds.filter((id) => existingThemeIds.has(id))

          if (finalThemeIds.length > 0) {
            await db.insert(childThemes).values(
              finalThemeIds.map((themeId) => ({
                childId: updated.id,
                themeId,
                isFavorite: themeId === (body.favoriteThemeId ?? null),
              })),
            )
          }
        }
      }

      return {
        id: updated.id,
        name: updated.name,
        age: updated.age,
      }
    },
    {
      params: t.Object({
        childId: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        age: t.Optional(t.Number({ minimum: 0, maximum: 25 })),
        favoriteThemeId: t.Optional(t.Number()),
        themeIds: t.Optional(t.Array(t.Number())),
        learningGoal: t.Optional(t.String()),
        mood: t.Optional(t.String()),
      }),
    },
  )
  .get("/profile", async ({ request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const [userRow] = await db
      .select({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (!userRow) {
      set.status = 404
      return { error: "User not found" }
    }

    const [billing] = await db
      .select()
      .from(billingAddresses)
      .where(eq(billingAddresses.userId, session.user.id))
      .limit(1)

    return {
      firstName: userRow.firstName ?? null,
      lastName: userRow.lastName ?? null,
      email: userRow.email,
      billingAddress: billing
        ? {
            name: billing.name,
            street: billing.street,
            city: billing.city,
            postalCode: billing.postalCode,
            country: billing.country,
            taxNumber: billing.taxNumber ?? null,
          }
        : null,
    }
  })
  .put(
    "/profile",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [existing] = await db
        .select()
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)

      if (!existing) {
        set.status = 404
        return { error: "User not found" }
      }

      const updateData: { firstName?: string; lastName?: string; name?: string } = {}
      if (body.firstName !== undefined) {
        updateData.firstName = body.firstName.trim() || null
      }
      if (body.lastName !== undefined) {
        updateData.lastName = body.lastName.trim() || null
      }
      if (body.firstName !== undefined || body.lastName !== undefined) {
        const firstName = body.firstName?.trim() || existing.firstName || ""
        const lastName = body.lastName?.trim() || existing.lastName || ""
        updateData.name = `${lastName} ${firstName}`.trim() || null
      }

      if (Object.keys(updateData).length === 0) {
        return { success: true }
      }

      await db.update(user).set(updateData).where(eq(user.id, session.user.id))

      return { success: true }
    },
    {
      body: t.Object({
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/billing-address",
    async ({ request, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const [existing] = await db
        .select()
        .from(billingAddresses)
        .where(eq(billingAddresses.userId, session.user.id))
        .limit(1)

      if (existing) {
        await db
          .update(billingAddresses)
          .set({
            name: body.name.trim(),
            street: body.street.trim(),
            city: body.city.trim(),
            postalCode: body.postalCode.trim(),
            country: body.country.trim(),
            taxNumber: body.taxNumber?.trim() || null,
          })
          .where(eq(billingAddresses.userId, session.user.id))
      } else {
        await db.insert(billingAddresses).values({
          userId: session.user.id,
          name: body.name.trim(),
          street: body.street.trim(),
          city: body.city.trim(),
          postalCode: body.postalCode.trim(),
          country: body.country.trim(),
          taxNumber: body.taxNumber?.trim() || null,
        })
      }

      return { success: true }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        street: t.String({ minLength: 1 }),
        city: t.String({ minLength: 1 }),
        postalCode: t.String({ minLength: 1 }),
        country: t.String({ minLength: 1 }),
        taxNumber: t.Optional(t.String()),
      }),
    },
  )
  // Free Stories - public endpoint (no auth required)
  .get("/free-stories", async () => {
    const activeFreeStories = await db
      .select()
      .from(freeStories)
      .where(eq(freeStories.status, "active"))
      .orderBy(sql`${freeStories.publishedAt} DESC NULLS LAST, ${freeStories.createdAt} DESC`)

    // Generate presigned URLs for covers
    const items = await Promise.all(
      activeFreeStories.map(async (story) => {
        let coverUrl = story.coverUrl
        let coverSquareUrl = story.coverSquareUrl

        // Generate presigned URL for main cover if it exists
        if (coverUrl) {
          try {
            const coverKey = buildFreeStoryCoverKey(story.id)
            coverUrl = await getPresignedUrl(coverKey, 3600) // 1 hour expiry
          } catch (error) {
            console.error(`Failed to generate presigned URL for cover ${story.id}:`, error)
            // Fallback to original URL
          }
        }

        // Generate presigned URL for square cover if it exists
        if (coverSquareUrl) {
          try {
            const coverSquareKey = buildFreeStoryCoverSquareKey(story.id)
            coverSquareUrl = await getPresignedUrl(coverSquareKey, 3600) // 1 hour expiry
          } catch (error) {
            console.error(`Failed to generate presigned URL for square cover ${story.id}:`, error)
            // Fallback to original URL
          }
        }

        return {
          ...story,
          coverUrl,
          coverSquareUrl,
        }
      }),
    )

    return { items }
  })
  .get("/free-stories/:id", async ({ params, set }) => {
    const [story] = await db
      .select()
      .from(freeStories)
      .where(and(
        eq(freeStories.id, params.id),
        eq(freeStories.status, "active")
      ))
      .limit(1)

    if (!story) {
      set.status = 404
      return { error: "Story not found" }
    }

    // Generate presigned URLs for covers
    let coverUrl = story.coverUrl
    let coverSquareUrl = story.coverSquareUrl

    // Generate presigned URL for main cover if it exists
    if (coverUrl) {
      try {
        const coverKey = buildFreeStoryCoverKey(story.id)
        coverUrl = await getPresignedUrl(coverKey, 3600) // 1 hour expiry
      } catch (error) {
        console.error(`Failed to generate presigned URL for cover ${story.id}:`, error)
        // Fallback to original URL
      }
    }

    // Generate presigned URL for square cover if it exists
    if (coverSquareUrl) {
      try {
        const coverSquareKey = buildFreeStoryCoverSquareKey(story.id)
        coverSquareUrl = await getPresignedUrl(coverSquareKey, 3600) // 1 hour expiry
      } catch (error) {
        console.error(`Failed to generate presigned URL for square cover ${story.id}:`, error)
        // Fallback to original URL
      }
    }

    // Generate presigned URL for audio if it exists
    let audioUrl = story.audioUrl
    if (audioUrl) {
      try {
        const audioKey = buildFreeStoryAudioKey(story.id)
        audioUrl = await getPresignedUrl(audioKey, 3600) // 1 hour expiry
      } catch (error) {
        console.error(`Failed to generate presigned URL for audio ${story.id}:`, error)
        // Fallback to original URL
      }
    }

    return {
      ...story,
      coverUrl,
      coverSquareUrl,
      audioUrl,
    }
  })
  .get("/free-stories/:id/feedback", async ({ params, request, set }) => {
    const session = await requireSession(request.headers, set)
    if (!session) return { error: "Unauthorized" }

    const userId = session.user.id
    const freeStoryId = params.id

    // Get all feedbacks for this free story
    const allFeedbacks = await db
      .select({
        id: freeStoryFeedback.id,
        userId: freeStoryFeedback.userId,
        childId: freeStoryFeedback.childId,
        type: freeStoryFeedback.type,
        comment: freeStoryFeedback.comment,
        createdAt: freeStoryFeedback.createdAt,
      })
      .from(freeStoryFeedback)
      .where(eq(freeStoryFeedback.freeStoryId, freeStoryId))
      .orderBy(freeStoryFeedback.createdAt)

    // Get user's own feedback
    const [userFeedback] = await db
      .select({
        id: freeStoryFeedback.id,
        type: freeStoryFeedback.type,
        comment: freeStoryFeedback.comment,
        createdAt: freeStoryFeedback.createdAt,
      })
      .from(freeStoryFeedback)
      .where(and(eq(freeStoryFeedback.freeStoryId, freeStoryId), eq(freeStoryFeedback.userId, userId)))
      .limit(1)

    // Count feedbacks by type
    const counts = {
      like: allFeedbacks.filter((f) => f.type === "like").length,
      sleep: allFeedbacks.filter((f) => f.type === "sleep").length,
      more: allFeedbacks.filter((f) => f.type === "more").length,
      dislike: allFeedbacks.filter((f) => f.type === "dislike").length,
    }

    return {
      allFeedbacks: allFeedbacks.map((f) => ({
        id: f.id,
        userId: f.userId,
        childId: f.childId,
        type: f.type,
        comment: f.comment,
        createdAt: f.createdAt,
        isOwn: f.userId === userId,
      })),
      userFeedback: userFeedback || null,
      counts,
      total: allFeedbacks.length,
    }
  })
  .post(
    "/free-stories/:id/feedback",
    async ({ params, body, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const freeStoryId = params.id
      const userId = session.user.id
      const { type, comment, childId } = body

      // Validate feedback type
      if (!["like", "sleep", "more", "dislike"].includes(type)) {
        set.status = 400
        return { error: "Invalid feedback type" }
      }

      // Validate comment is provided for dislike
      if (type === "dislike" && (!comment || comment.trim().length === 0)) {
        set.status = 400
        return { error: "Comment is required for dislike feedback" }
      }

      // Check if free story exists
      const [story] = await db
        .select({ id: freeStories.id })
        .from(freeStories)
        .where(and(eq(freeStories.id, freeStoryId), eq(freeStories.status, "active")))
        .limit(1)

      if (!story) {
        set.status = 404
        return { error: "Free story not found" }
      }

      // Check if feedback already exists
      const [existing] = await db
        .select({ id: freeStoryFeedback.id, type: freeStoryFeedback.type })
        .from(freeStoryFeedback)
        .where(and(eq(freeStoryFeedback.freeStoryId, freeStoryId), eq(freeStoryFeedback.userId, userId)))
        .limit(1)

      if (existing) {
        // Update existing feedback
        const [updated] = await db
          .update(freeStoryFeedback)
          .set({
            type: type as "like" | "sleep" | "more" | "dislike",
            comment: type === "dislike" ? (comment?.trim() || null) : null,
          })
          .where(eq(freeStoryFeedback.id, existing.id))
          .returning({ id: freeStoryFeedback.id, type: freeStoryFeedback.type, comment: freeStoryFeedback.comment })

        return {
          ok: true,
          alreadySubmitted: true,
          type: updated.type,
          comment: updated.comment,
        }
      }

      // Insert new feedback
      const [feedback] = await db
        .insert(freeStoryFeedback)
        .values({
          freeStoryId,
          userId,
          childId: childId || null,
          type: type as "like" | "sleep" | "more" | "dislike",
          comment: type === "dislike" ? (comment?.trim() || null) : null,
        })
        .returning({ id: freeStoryFeedback.id, type: freeStoryFeedback.type, comment: freeStoryFeedback.comment })

      return {
        ok: true,
        alreadySubmitted: false,
        type: feedback.type,
        comment: feedback.comment,
      }
    },
    {
      body: t.Object({
        type: t.String(),
        comment: t.Optional(t.String()),
        childId: t.Optional(t.String()),
      }),
    },
  )


