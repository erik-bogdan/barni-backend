import { Elysia, t } from "elysia"
import { and, count, desc, eq, sql } from "drizzle-orm"

import { db } from "../lib/db"
import { auth } from "../lib/auth"
import {
  children,
  stories,
  storyCreditTransactions,
} from "../../packages/db/src/schema"
import { calcCost, calcAudioCost, getUserCreditBalance } from "../services/credits"
import { enqueueStoryJob } from "../jobs/queue"
import { enqueueAudioJob } from "../jobs/audio-queue"
import { THEMES } from "../services/storyPrompt"
import { requestStoryAudio, createAudioRepo, buildAudioKey } from "../services/audio"
import { getPresignedUrl } from "../services/s3"

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

      const creditCost = calcCost(body.length)

      const result = await db.transaction(async (tx) => {
        const balance = await getUserCreditBalance(tx, userId)
        if (balance < creditCost) {
          return { error: "Insufficient credits", storyId: null as string | null }
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
        return { error: "Insufficient credits" }
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
          createdAt: stories.createdAt,
          status: stories.status,
          theme: stories.theme,
          mood: stories.mood,
          length: stories.length,
          errorMessage: stories.errorMessage,
        })
        .from(stories)
        .where(eq(stories.childId, childId))
        .orderBy(desc(stories.createdAt))
        .limit(limit)
        .offset(offset)

      return {
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          preview_url: r.previewUrl,
          created_at: r.createdAt,
          status: r.status,
          theme: r.theme,
          mood: r.mood,
          length: r.length,
          error_message: r.errorMessage,
        })),
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

      return {
        id: row.id,
        title: row.title,
        summary: row.summary,
        text: row.text,
        preview_url: row.previewUrl,
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

      const cost = calcAudioCost(row.length as "short" | "medium" | "long")
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
      }),
    },
  )

