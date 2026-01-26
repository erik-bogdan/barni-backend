import { Elysia, t } from "elysia"
import { and, count, desc, eq, sql } from "drizzle-orm"

import { db } from "../lib/db"
import { auth } from "../lib/auth"
import {
  children,
  stories,
  storyCreditTransactions,
  storyFeedback,
} from "../../packages/db/src/schema"
import { calcCost, calcAudioCost, getUserCreditBalance } from "../services/credits"
import { enqueueStoryJob } from "../jobs/queue"
import { enqueueAudioJob } from "../jobs/audio-queue"
import { THEMES } from "../services/storyPrompt"
import { requestStoryAudio, createAudioRepo, buildAudioKey } from "../services/audio"
import { getPresignedUrl } from "../services/s3"
import { buildCoverKey, buildCoverSquareKey } from "../services/cover/coverService"

async function requireSession(headers: Headers, set: { status: number }) {
  const session = await auth.api.getSession({ headers })
  if (!session) {
    set.status = 401
    return null
  }
  return session
}

const moodValues = ["nyugodt", "vidam", "kalandos"] as const
const lengthValues = ["short", "medium", "long"] as const

export const storiesApi = new Elysia({ name: "stories-api", prefix: "/api" })
  .post(
    "/children/:childId/stories",
    async ({ request, params, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const childId = params.childId
      const userId = session.user.id

      const [child] = await db
        .select({ id: children.id })
        .from(children)
        .where(and(eq(children.id, childId), eq(children.userId, userId)))
        .limit(1)

      if (!child) {
        set.status = 404
        return { error: "Child not found" }
      }

      const resolvedTheme =
        body.theme === "meglepetes"
          ? THEMES[Math.floor(Math.random() * THEMES.length)]
          : body.theme

      const creditCost = await calcCost(body.length, body.isInteractive ?? false)

      const result = await db.transaction(async (tx) => {
        const balance = await getUserCreditBalance(tx, userId)
        if (balance < creditCost) {
          return { error: "Nincs elég mesetallér!", storyId: null as string | null }
        }

        const [created] = await tx
          .insert(stories)
          .values({
            userId,
            childId,
            status: "queued",
            theme: resolvedTheme,
            mood: body.mood,
            length: body.length,
            lesson: body.lesson?.trim() || null,
            creditCost,
            isInteractive: body.isInteractive ?? false,
          })
          .returning({ id: stories.id })

        if (!created?.id) {
          return { error: "Create failed", storyId: null as string | null }
        }

        await tx.insert(storyCreditTransactions).values({
          userId,
          storyId: created.id,
          type: "reserve",
          amount: -creditCost,
          reason: "story_reserve",
          source: "story_create",
        })

        return { error: null, storyId: created.id }
      })

      if (result.error || !result.storyId) {
        set.status = 402
        return { error: "Nincs elég mesetallér!" }
      }

      try {
        await enqueueStoryJob(result.storyId)
      } catch {
        await db.update(stories).set({ status: "failed" }).where(eq(stories.id, result.storyId))
        await db.insert(storyCreditTransactions).values({
          userId,
          storyId: result.storyId,
          type: "refund",
          amount: creditCost,
          reason: "queue_failed",
          source: "story_create",
        })
        set.status = 500
        return { error: "Failed to enqueue story job" }
      }

      return { id: result.storyId }
    },
    {
      params: t.Object({
        childId: t.String(),
      }),
      body: t.Object({
        mood: t.Union(moodValues.map((v) => t.Literal(v))),
        length: t.Union(lengthValues.map((v) => t.Literal(v))),
        theme: t.String(),
        lesson: t.Optional(t.String()),
        isInteractive: t.Optional(t.Boolean()),
      }),
    },
  )
  .get(
    "/children/:childId/stories",
    async ({ request, params, query, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const childId = params.childId
      const userId = session.user.id
      const page = Math.max(1, Number(query.page) || 1)
      const limit = Math.min(50, Math.max(1, Number(query.limit) || 10))
      const offset = (page - 1) * limit

      const [child] = await db
        .select({ id: children.id })
        .from(children)
        .where(and(eq(children.id, childId), eq(children.userId, userId)))
        .limit(1)

      if (!child) {
        set.status = 404
        return { error: "Child not found" }
      }

      const [totalResult] = await db
        .select({ count: count() })
        .from(stories)
        .where(eq(stories.childId, childId))

      const total = totalResult?.count ?? 0

      const rows = await db
        .select({
          id: stories.id,
          title: stories.title,
          previewUrl: stories.previewUrl,
          coverUrl: stories.coverUrl,
          coverSquareUrl: stories.coverSquareUrl,
          createdAt: stories.createdAt,
          status: stories.status,
          theme: stories.theme,
          mood: stories.mood,
          length: stories.length,
          errorMessage: stories.errorMessage,
          isInteractive: stories.isInteractive,
        })
        .from(stories)
        .where(eq(stories.childId, childId))
        .orderBy(desc(stories.createdAt))
        .limit(limit)
        .offset(offset)

      // Generate presigned URLs for covers
      const items = await Promise.all(
        rows.map(async (r) => {
          let coverUrl = r.coverUrl
          let coverSquareUrl = r.coverSquareUrl

          // Generate presigned URL for main cover if it exists
          if (coverUrl) {
            try {
              const coverKey = buildCoverKey(r.id)
              coverUrl = await getPresignedUrl(coverKey, 3600) // 1 hour expiry
            } catch (error) {
              console.error(`Failed to generate presigned URL for cover ${r.id}:`, error)
              // Fallback to original URL
            }
          }

          // Generate presigned URL for square cover if it exists
          if (coverSquareUrl) {
            try {
              const coverSquareKey = buildCoverSquareKey(r.id)
              coverSquareUrl = await getPresignedUrl(coverSquareKey, 3600) // 1 hour expiry
            } catch (error) {
              console.error(`Failed to generate presigned URL for square cover ${r.id}:`, error)
              // Fallback to original URL
            }
          }

          return {
            id: r.id,
            title: r.title,
            preview_url: r.previewUrl,
            cover_url: coverUrl,
            cover_square_url: coverSquareUrl,
            created_at: r.createdAt,
            status: r.status,
            theme: r.theme,
            mood: r.mood,
            length: r.length,
            error_message: r.errorMessage,
            is_interactive: r.isInteractive,
          }
        }),
      )

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    },
    {
      params: t.Object({
        childId: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )
  .delete(
    "/stories/:storyId",
    async ({ request, params, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const storyId = params.storyId
      const userId = session.user.id

      const [story] = await db
        .select({ id: stories.id, userId: stories.userId, status: stories.status })
        .from(stories)
        .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
        .limit(1)

      if (!story) {
        set.status = 404
        return { error: "Story not found" }
      }

      // Only allow deletion of failed stories
      if (story.status !== "failed") {
        set.status = 400
        return { error: "Only failed stories can be deleted" }
      }

      await db.delete(stories).where(eq(stories.id, storyId))

      return { success: true }
    },
    {
      params: t.Object({
        storyId: t.String(),
      }),
    },
  )
  .get(
    "/stories/:storyId",
    async ({ request, params, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const storyId = params.storyId
      const userId = session.user.id

      const [row] = await db
        .select({
          id: stories.id,
          title: stories.title,
          summary: stories.summary,
          text: stories.text,
          previewUrl: stories.previewUrl,
          coverUrl: stories.coverUrl,
          coverSquareUrl: stories.coverSquareUrl,
          createdAt: stories.createdAt,
          status: stories.status,
          theme: stories.theme,
          mood: stories.mood,
          length: stories.length,
          lesson: stories.lesson,
          setting: stories.setting,
          conflict: stories.conflict,
          tone: stories.tone,
          audioUrl: stories.audioUrl,
          audioStatus: stories.audioStatus,
          isInteractive: stories.isInteractive,
          storyData: stories.storyData,
        })
        .from(stories)
        .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
        .limit(1)

      if (!row) {
        set.status = 404
        return { error: "Story not found" }
      }

      // Generate presigned URL for audio if it exists
      let audioUrl = row.audioUrl
      if (row.audioUrl && row.audioStatus === "ready") {
        try {
          // Always use the deterministic key based on storyId
          const audioKey = buildAudioKey(row.id)
          audioUrl = await getPresignedUrl(audioKey, 3600) // 1 hour expiry
        } catch (error) {
          console.error("Failed to generate presigned URL for audio:", error)
          // Fallback to original URL if presigned URL generation fails
          audioUrl = row.audioUrl
        }
      }

      // Generate presigned URLs for covers if they exist
      let coverUrl = row.coverUrl
      let coverSquareUrl = row.coverSquareUrl

      if (coverUrl) {
        try {
          const coverKey = buildCoverKey(row.id)
          coverUrl = await getPresignedUrl(coverKey, 3600) // 1 hour expiry
        } catch (error) {
          console.error(`Failed to generate presigned URL for cover ${row.id}:`, error)
          // Fallback to original URL
        }
      }

      if (coverSquareUrl) {
        try {
          const coverSquareKey = buildCoverSquareKey(row.id)
          coverSquareUrl = await getPresignedUrl(coverSquareKey, 3600) // 1 hour expiry
        } catch (error) {
          console.error(`Failed to generate presigned URL for square cover ${row.id}:`, error)
          // Fallback to original URL
        }
      }

      return {
        id: row.id,
        title: row.title,
        summary: row.summary,
        text: row.text,
        preview_url: row.previewUrl,
        cover_url: coverUrl,
        cover_square_url: coverSquareUrl,
        created_at: row.createdAt,
        status: row.status,
        theme: row.theme,
        mood: row.mood,
        length: row.length,
        lesson: row.lesson,
        setting: row.setting,
        conflict: row.conflict,
        tone: row.tone,
        audio_url: audioUrl,
        audio_status: row.audioStatus,
        is_interactive: row.isInteractive,
        story_data: row.storyData,
      }
    },
    {
      params: t.Object({
        storyId: t.String(),
      }),
    },
  )
  .get(
    "/stories/:storyId/audio/cost",
    async ({ request, params, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const storyId = params.storyId
      const userId = session.user.id

      const [row] = await db
        .select({
          id: stories.id,
          length: stories.length,
          audioStatus: stories.audioStatus,
          audioUrl: stories.audioUrl,
        })
        .from(stories)
        .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
        .limit(1)

      if (!row) {
        set.status = 404
        return { error: "Story not found" }
      }

      const cost = await calcAudioCost(row.length as "short" | "medium" | "long")
      const hasAudio = row.audioStatus === "ready" && row.audioUrl !== null

      return {
        cost,
        has_audio: hasAudio,
        audio_status: row.audioStatus,
      }
    },
    {
      params: t.Object({
        storyId: t.String(),
      }),
    },
  )
  .post(
    "/stories/:storyId/audio",
    async ({ request, params, body, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const result = await requestStoryAudio(
        {
          storyId: params.storyId,
          userId: session.user.id,
          force: body.force,
          paymentMethod: body.paymentMethod,
        },
        {
          enqueue: async (payload) => enqueueAudioJob(payload),
        },
      )

      set.status = result.status
      return result.data
    },
    {
      params: t.Object({
        storyId: t.String(),
      }),
      body: t.Object({
        force: t.Optional(t.Boolean()),
        paymentMethod: t.Optional(t.Union([t.Literal("audioStar"), t.Literal("credits")])),
      }),
    },
  )
  .post(
    "/stories/:storyId/feedback",
    async ({ params, body, request, set }) => {
      const session = await requireSession(request.headers, set)
      if (!session) return { error: "Unauthorized" }

      const storyId = params.storyId
      const userId = session.user.id
      const { type, comment } = body

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

      // Check if story exists and belongs to user
      const [story] = await db
        .select({ id: stories.id, childId: stories.childId })
        .from(stories)
        .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
        .limit(1)

      if (!story) {
        set.status = 404
        return { error: "Story not found" }
      }

      // Check if feedback already exists
      const [existing] = await db
        .select({ id: storyFeedback.id, type: storyFeedback.type })
        .from(storyFeedback)
        .where(and(eq(storyFeedback.storyId, storyId), eq(storyFeedback.userId, userId)))
        .limit(1)

      if (existing) {
        return {
          ok: true,
          alreadySubmitted: true,
          type: existing.type,
        }
      }

      // Insert feedback
      const [feedback] = await db
        .insert(storyFeedback)
        .values({
          storyId,
          userId,
          childId: story.childId,
          type: type as "like" | "sleep" | "more" | "dislike",
          comment: comment?.trim() || null,
        })
        .returning({ id: storyFeedback.id, type: storyFeedback.type, comment: storyFeedback.comment })

      return {
        ok: true,
        alreadySubmitted: false,
        type: feedback.type,
        comment: feedback.comment,
      }
    },
    {
      body: t.Object({
        type: t.Union([t.Literal("like"), t.Literal("sleep"), t.Literal("more"), t.Literal("dislike")]),
        comment: t.Optional(t.String()),
      }),
      params: t.Object({
        storyId: t.String(),
      }),
    }
  )

