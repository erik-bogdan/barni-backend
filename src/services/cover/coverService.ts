import { eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import { stories, freeStories } from "../../../packages/db/src/schema"
import { db } from "../../lib/db"
import { buildPublicUrl, uploadBuffer } from "../s3"
import { generateCoverWebp, type Mood, type Theme, type Length } from "./generateCover"

export type CoverStoryRow = {
  id: string
  title: string | null
  theme: string
  mood: string
  length: string
  coverUrl: string | null
  coverSquareUrl: string | null
}

export type CoverRepo = {
  getStoryById(storyId: string): Promise<CoverStoryRow | null>
  updateCover(storyId: string, payload: { coverUrl: string | null; coverSquareUrl?: string | null }): Promise<void>
}

export function createCoverRepo(
  database: PostgresJsDatabase<Record<string, unknown>>,
): CoverRepo {
  return {
    async getStoryById(storyId) {
      const [row] = await database
        .select({
          id: stories.id,
          title: stories.title,
          theme: stories.theme,
          mood: stories.mood,
          length: stories.length,
          coverUrl: stories.coverUrl,
          coverSquareUrl: stories.coverSquareUrl,
        })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1)
      return row ?? null
    },
    async updateCover(storyId, payload) {
      await database
        .update(stories)
        .set({
          coverUrl: payload.coverUrl,
          coverSquareUrl: payload.coverSquareUrl ?? null,
        })
        .where(eq(stories.id, storyId))
    },
  }
}

export function buildCoverKey(storyId: string): string {
  return `stories/${storyId}/cover.webp`
}

export function buildCoverSquareKey(storyId: string): string {
  return `stories/${storyId}/cover_square.webp`
}

export function buildFreeStoryCoverKey(storyId: string): string {
  return `free-stories/${storyId}/cover.webp`
}

export function buildFreeStoryCoverSquareKey(storyId: string): string {
  return `free-stories/${storyId}/cover_square.webp`
}

export type FreeStoryCoverRepo = {
  getStoryById(storyId: string): Promise<CoverStoryRow | null>
  updateCover(storyId: string, payload: { coverUrl: string | null; coverSquareUrl?: string | null; coverStatus?: string; coverError?: string | null }): Promise<void>
}

export function createFreeStoryCoverRepo(
  database: PostgresJsDatabase<Record<string, unknown>>,
): FreeStoryCoverRepo {
  return {
    async getStoryById(storyId) {
      const [row] = await database
        .select({
          id: freeStories.id,
          title: freeStories.title,
          theme: freeStories.theme,
          mood: freeStories.mood,
          length: freeStories.length,
          coverUrl: freeStories.coverUrl,
          coverSquareUrl: freeStories.coverSquareUrl,
        })
        .from(freeStories)
        .where(eq(freeStories.id, storyId))
        .limit(1)
      return row ?? null
    },
    async updateCover(storyId, payload) {
      await database
        .update(freeStories)
        .set({
          coverUrl: payload.coverUrl,
          coverSquareUrl: payload.coverSquareUrl ?? null,
          coverStatus: payload.coverStatus ?? "ready",
          coverError: payload.coverError ?? null,
        })
        .where(eq(freeStories.id, storyId))
    },
  }
}

export async function processFreeStoryCoverJob(
  params: { storyId: string },
  deps?: {
    repo?: FreeStoryCoverRepo
    s3?: { uploadBuffer: typeof uploadBuffer; buildPublicUrl: typeof buildPublicUrl }
    db?: typeof db
  },
): Promise<void> {
  const repo = deps?.repo ?? createFreeStoryCoverRepo(db)
  const s3Client = deps?.s3 ?? { uploadBuffer, buildPublicUrl }
  const database = deps?.db ?? db

  const story = await repo.getStoryById(params.storyId)

  if (!story) {
    throw new Error("Free story not found")
  }

  if (!story.title) {
    await repo.updateCover(story.id, { coverUrl: null, coverSquareUrl: null, coverStatus: "failed", coverError: "No title" })
    return
  }

  try {
    await repo.updateCover(story.id, { coverStatus: "generating", coverError: null })

    const { cover, coverSquare } = await generateCoverWebp({
      title: story.title,
      theme: story.theme as Theme,
      mood: story.mood as Mood,
      length: story.length as Length,
    })

    // Upload main cover
    const coverKey = buildFreeStoryCoverKey(story.id)
    await s3Client.uploadBuffer({
      key: coverKey,
      body: cover,
      contentType: "image/webp",
      cacheControl: COVER_CACHE_CONTROL,
    })
    const coverUrl = s3Client.buildPublicUrl(coverKey)

    // Upload square cover if generated
    let coverSquareUrl: string | null = null
    if (coverSquare) {
      const coverSquareKey = buildFreeStoryCoverSquareKey(story.id)
      await s3Client.uploadBuffer({
        key: coverSquareKey,
        body: coverSquare,
        contentType: "image/webp",
        cacheControl: COVER_CACHE_CONTROL,
      })
      coverSquareUrl = s3Client.buildPublicUrl(coverSquareKey)
    }

    // Update story with cover URLs
    await repo.updateCover(story.id, { coverUrl, coverSquareUrl, coverStatus: "ready", coverError: null })
  } catch (error) {
    console.error(`[cover-worker] Failed to generate cover for free story ${params.storyId}:`, error)
    await repo.updateCover(story.id, { 
      coverUrl: null, 
      coverSquareUrl: null, 
      coverStatus: "failed", 
      coverError: error instanceof Error ? error.message : "Unknown error" 
    })
  }
}

const COVER_CACHE_CONTROL = "public, max-age=31536000, immutable"

export async function processCoverJob(
  params: { storyId: string },
  deps?: {
    repo?: CoverRepo
    s3?: { uploadBuffer: typeof uploadBuffer; buildPublicUrl: typeof buildPublicUrl }
    db?: typeof db
  },
): Promise<void> {
  const repo = deps?.repo ?? createCoverRepo(db)
  const s3Client = deps?.s3 ?? { uploadBuffer, buildPublicUrl }
  const database = deps?.db ?? db

  const story = await repo.getStoryById(params.storyId)

  if (!story) {
    throw new Error("Story not found")
  }

  if (!story.title) {
    // Story doesn't have title yet, cover generation will fail
    // Update DB to leave coverUrl null and continue
    await repo.updateCover(story.id, { coverUrl: null, coverSquareUrl: null })
    return
  }

  // If cover already exists, skip
  if (story.coverUrl) {
    return
  }

  try {
    const { cover, coverSquare } = await generateCoverWebp({
      title: story.title,
      theme: story.theme as Theme,
      mood: story.mood as Mood,
      length: story.length as Length,
    })

    // Upload main cover
    const coverKey = buildCoverKey(story.id)
    await s3Client.uploadBuffer({
      key: coverKey,
      body: cover,
      contentType: "image/webp",
      cacheControl: COVER_CACHE_CONTROL,
    })
    const coverUrl = s3Client.buildPublicUrl(coverKey)

    // Upload square cover if generated
    let coverSquareUrl: string | null = null
    if (coverSquare) {
      const coverSquareKey = buildCoverSquareKey(story.id)
      await s3Client.uploadBuffer({
        key: coverSquareKey,
        body: coverSquare,
        contentType: "image/webp",
        cacheControl: COVER_CACHE_CONTROL,
      })
      coverSquareUrl = s3Client.buildPublicUrl(coverSquareKey)
    }

    // Update story with cover URLs
    await repo.updateCover(story.id, { coverUrl, coverSquareUrl })
  } catch (error) {
    // Log error but don't fail the whole story
    console.error(`[cover-worker] Failed to generate cover for story ${params.storyId}:`, error)
    // Update DB with null coverUrl to indicate failure
    await repo.updateCover(story.id, { coverUrl: null, coverSquareUrl: null })
    // Don't throw - let the story continue without cover
  }
}
