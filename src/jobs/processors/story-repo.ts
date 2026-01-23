import { and, desc, eq } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import {
  children,
  stories,
  storyCreditTransactions,
  storyTransactions,
} from "../../../packages/db/src/schema"

export type StoryRow = {
  id: string
  userId: string
  childId: string
  status: string
  theme: string
  mood: string
  length: string
  lesson: string | null
  creditCost: number
  isInteractive: boolean
}

export type ChildRow = {
  id: string
  age: number
}

export type Fingerprint = {
  setting: string | null
  conflict: string | null
  tone: string | null
}

export type StoryRepo = {
  getStory(id: string): Promise<StoryRow | null>
  getChild(id: string): Promise<ChildRow | null>
  getRecentFingerprints(childId: string, limit: number): Promise<Fingerprint[]>
  updateStatus(id: string, status: string, errorMessage?: string | null): Promise<void>
  saveStoryContent(
    id: string,
    payload: {
      title: string
      summary: string
      text: string
      setting: string
      conflict: string
      tone: string
      model?: string
    },
  ): Promise<void>
  saveInteractiveStoryContent(
    id: string,
    payload: {
      title: string
      summary: string
      storyData: unknown // StoryTree JSON
      setting: string
      conflict: string
      tone: string
      model?: string
    },
  ): Promise<void>
    savePreview(id: string, payload: { previewUrl: string | null; readyAt: Date }): Promise<void>
  saveStoryTransaction(
    storyId: string,
    payload: {
      operationType: "story_generation" | "meta_extraction"
      model: string
      inputTokens: number
      outputTokens: number
      totalTokens: number
      promptTokens?: number
      completionTokens?: number
      requestId?: string
      responseId?: string
    },
  ): Promise<void>
  refundCredits(userId: string, storyId: string, amount: number): Promise<void>
}

export function createStoryRepo(
  db: PostgresJsDatabase<Record<string, unknown>>,
): StoryRepo {
  return {
    async getStory(id) {
      const [row] = await db
        .select({
          id: stories.id,
          userId: stories.userId,
          childId: stories.childId,
          status: stories.status,
          theme: stories.theme,
          mood: stories.mood,
          length: stories.length,
          lesson: stories.lesson,
          creditCost: stories.creditCost,
          isInteractive: stories.isInteractive,
        })
        .from(stories)
        .where(eq(stories.id, id))
        .limit(1)
      return row ?? null
    },
    async getChild(id) {
      const [row] = await db
        .select({
          id: children.id,
          age: children.age,
        })
        .from(children)
        .where(eq(children.id, id))
        .limit(1)
      return row ?? null
    },
    async getRecentFingerprints(childId, limit) {
      const rows = await db
        .select({
          setting: stories.setting,
          conflict: stories.conflict,
          tone: stories.tone,
        })
        .from(stories)
        .where(and(eq(stories.childId, childId), eq(stories.status, "ready")))
        .orderBy(desc(stories.createdAt))
        .limit(limit)
      return rows
    },
    async updateStatus(id, status, errorMessage) {
      await db
        .update(stories)
        .set({ status, errorMessage: errorMessage ?? null })
        .where(eq(stories.id, id))
    },
    async saveStoryContent(id, payload) {
      await db
        .update(stories)
        .set({
          title: payload.title,
          summary: payload.summary,
          text: payload.text,
          setting: payload.setting,
          conflict: payload.conflict,
          tone: payload.tone,
          model: payload.model ?? null,
        })
        .where(eq(stories.id, id))
    },
    async saveInteractiveStoryContent(id, payload) {
      await db
        .update(stories)
        .set({
          title: payload.title,
          summary: payload.summary,
          storyData: payload.storyData as unknown,
          setting: payload.setting,
          conflict: payload.conflict,
          tone: payload.tone,
          model: payload.model ?? null,
        })
        .where(eq(stories.id, id))
    },
    async saveStoryTransaction(storyId, payload) {
      await db.insert(storyTransactions).values({
        storyId,
        operationType: payload.operationType,
        model: payload.model,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
        totalTokens: payload.totalTokens,
        promptTokens: payload.promptTokens ?? null,
        completionTokens: payload.completionTokens ?? null,
        requestId: payload.requestId ?? null,
        responseId: payload.responseId ?? null,
      })
    },
    async savePreview(id, payload) {
      await db
        .update(stories)
        .set({
          previewUrl: payload.previewUrl ?? null,
          readyAt: payload.readyAt,
          status: "ready",
        })
        .where(eq(stories.id, id))
    },
    async refundCredits(userId, storyId, amount) {
      await db.insert(storyCreditTransactions).values({
        userId,
        storyId,
        type: "refund",
        amount,
        reason: "story_failed",
        source: "worker",
      })
    },
  }
}

