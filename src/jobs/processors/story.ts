import { buildStoryPrompt } from "../../services/storyPrompt"
import type { StoryMeta, StoryGenerationResult, StoryMetaResult } from "../../services/openai"

type AvoidPair = {
  setting: string
  conflict: string
}

export type StoryProcessorDeps = {
  repo: {
    getStory(id: string): Promise<{
      id: string
      userId: string
      childId: string
      status: string
      theme: string
      mood: string
      length: string
      lesson: string | null
      creditCost: number
    } | null>
    getChild(id: string): Promise<{ id: string; age: number } | null>
    getRecentFingerprints(childId: string, limit: number): Promise<
      Array<{ setting: string | null; conflict: string | null; tone: string | null }>
    >
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
    savePreview(id: string, payload: { previewUrl: string; readyAt: Date }): Promise<void>
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
  openai: {
    generateStoryText(prompt: string): Promise<StoryGenerationResult>
    extractStoryMeta(text: string): Promise<StoryMetaResult>
  }
  cover: {
    generateCoverBuffer(input: {
      title: string
      theme: string
      mood: string
      length: string
    }): Promise<Buffer>
  }
  s3: {
    uploadBuffer(params: { key: string; body: Buffer; contentType: string }): Promise<void>
    buildPublicUrl(key: string): string
  }
  now?: () => Date
}

export async function processStoryJob(
  storyId: string,
  deps: StoryProcessorDeps,
) {
  const now = deps.now ?? (() => new Date())

  const story = await deps.repo.getStory(storyId)
  if (!story) return

  try {
    await deps.repo.updateStatus(storyId, "generating_text")

    const child = await deps.repo.getChild(story.childId)
    if (!child) throw new Error("Child not found")

    const fingerprints = await deps.repo.getRecentFingerprints(story.childId, 5)
    const avoidPairs: AvoidPair[] = fingerprints
      .filter((f) => f.setting && f.conflict)
      .map((f) => ({ setting: f.setting!, conflict: f.conflict! }))

    const prompt = buildStoryPrompt({
      childAge: child.age,
      mood: story.mood as "nyugodt" | "vidam" | "kalandos",
      length: story.length as "short" | "medium" | "long",
      theme: story.theme,
      lesson: story.lesson ?? undefined,
      avoidPairs,
    })

    const storyResult = await deps.openai.generateStoryText(prompt)
    if (!storyResult.text) throw new Error("Story generation failed")

    // Save story generation transaction
    await deps.repo.saveStoryTransaction(storyId, {
      operationType: "story_generation",
      model: storyResult.model,
      inputTokens: storyResult.usage.inputTokens ?? storyResult.usage.promptTokens ?? 0,
      outputTokens: storyResult.usage.outputTokens ?? storyResult.usage.completionTokens ?? 0,
      totalTokens: storyResult.usage.totalTokens,
      promptTokens: storyResult.usage.promptTokens,
      completionTokens: storyResult.usage.completionTokens,
      requestId: storyResult.requestId,
      responseId: storyResult.responseId,
    })

    await deps.repo.updateStatus(storyId, "extracting_meta")
    const metaResult = await deps.openai.extractStoryMeta(storyResult.text)

    if (!metaResult.meta.title || !metaResult.meta.summary || !metaResult.meta.setting || !metaResult.meta.conflict || !metaResult.meta.tone) {
      throw new Error("Story metadata extraction incomplete")
    }

    // Save metadata extraction transaction
    await deps.repo.saveStoryTransaction(storyId, {
      operationType: "meta_extraction",
      model: metaResult.model,
      inputTokens: metaResult.usage.inputTokens ?? metaResult.usage.promptTokens ?? 0,
      outputTokens: metaResult.usage.outputTokens ?? metaResult.usage.completionTokens ?? 0,
      totalTokens: metaResult.usage.totalTokens,
      promptTokens: metaResult.usage.promptTokens,
      completionTokens: metaResult.usage.completionTokens,
      requestId: metaResult.requestId,
      responseId: metaResult.responseId,
    })

    // Use the model from story generation as the primary model
    const primaryModel = storyResult.model

    await deps.repo.saveStoryContent(storyId, {
      title: metaResult.meta.title,
      summary: metaResult.meta.summary,
      text: storyResult.text,
      setting: metaResult.meta.setting,
      conflict: metaResult.meta.conflict,
      tone: metaResult.meta.tone,
      model: primaryModel,
    })

    await deps.repo.updateStatus(storyId, "generating_cover")
    const coverBuffer = await deps.cover.generateCoverBuffer({
      title: metaResult.meta.title,
      theme: story.theme,
      mood: story.mood,
      length: story.length,
    })

    await deps.repo.updateStatus(storyId, "uploading_cover")
    const key = `stories/${storyId}/preview.webp`
    await deps.s3.uploadBuffer({
      key,
      body: coverBuffer,
      contentType: "image/webp",
    })
    const previewUrl = deps.s3.buildPublicUrl(key)

    await deps.repo.savePreview(storyId, { previewUrl, readyAt: now() })
  } catch (error) {
    const mappedMessage = mapGenerationError(error)
    await deps.repo.updateStatus(storyId, "failed", mappedMessage)
    await deps.repo.refundCredits(story.userId, storyId, story.creditCost)
    throw error
  }
}

function mapGenerationError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { status?: number; code?: string; message?: string }
    if (maybeError.status === 429 || maybeError.code === "insufficient_quota") {
      return "OpenAI kvóta elfogyott. Kérlek próbáld később."
    }
    if (maybeError.status === 401) {
      return "OpenAI API kulcs érvénytelen vagy hiányzik."
    }
    if (typeof maybeError.message === "string" && maybeError.message.length > 0) {
      return maybeError.message
    }
  }
  return "Ismeretlen hiba történt a mesegenerálás során."
}

