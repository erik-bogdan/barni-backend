"use strict"

import { createHash, randomUUID } from "node:crypto"

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js"
import { eq, and } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import { stories, storyCreditTransactions, audioStarTransactions, freeStories } from "../../packages/db/src/schema"
import { db } from "../lib/db"
import { buildPublicUrl, uploadBuffer } from "./s3"
import { calcAudioCost, getUserCreditBalance, getUserAudioStarBalance } from "./credits"

export const AUDIO_VOICE_ID = "scmhl57lfsXIkyLMdk8s"
export const AUDIO_MODEL_ID = "eleven_v3"
export const AUDIO_OUTPUT_FORMAT = "mp3_44100_128"
export const AUDIO_PRESET = "default"

const AUDIO_CACHE_CONTROL = "public, max-age=31536000, immutable"

export type AudioStoryRow = {
  id: string
  userId: string
  text: string | null
  length: string
  audioUrl: string | null
  audioStatus: string
  audioHash: string | null
  isInteractive: boolean
}

export type AudioUpdate = {
  audioUrl?: string | null
  audioStatus?: string
  audioError?: string | null
  audioVoiceId?: string | null
  audioPreset?: string | null
  audioUpdatedAt?: Date | null
  audioHash?: string | null
}

export type AudioRepo = {
  getStoryForUser(storyId: string, userId: string): Promise<AudioStoryRow | null>
  getStoryById(storyId: string): Promise<AudioStoryRow | null>
  updateAudio(storyId: string, payload: AudioUpdate): Promise<void>
}

export function buildAudioKey(storyId: string): string {
  return `stories/${storyId}/audio.mp3`
}

export function buildFreeStoryAudioKey(storyId: string): string {
  return `free-stories/${storyId}/audio.mp3`
}

export function computeAudioHash(params: {
  voiceId: string
  preset: string
  text: string
}): string {
  const hash = createHash("sha256")
  hash.update(`${params.voiceId}:${params.preset}:`)
  hash.update(params.text)
  return hash.digest("hex")
}

async function hasAudioRefund(
  database: PostgresJsDatabase<Record<string, unknown>>,
  params: { userId: string; storyId: string; useAudioStar: boolean },
): Promise<boolean> {
  if (params.useAudioStar) {
    const [existing] = await database
      .select({ id: audioStarTransactions.id })
      .from(audioStarTransactions)
      .where(
        and(
          eq(audioStarTransactions.userId, params.userId),
          eq(audioStarTransactions.storyId, params.storyId),
          eq(audioStarTransactions.type, "refund"),
          eq(audioStarTransactions.reason, "audio_failed"),
          eq(audioStarTransactions.source, "audio_worker"),
        ),
      )
      .limit(1)
    return Boolean(existing)
  }

  const [existing] = await database
    .select({ id: storyCreditTransactions.id })
    .from(storyCreditTransactions)
    .where(
      and(
        eq(storyCreditTransactions.userId, params.userId),
        eq(storyCreditTransactions.storyId, params.storyId),
        eq(storyCreditTransactions.type, "refund"),
        eq(storyCreditTransactions.reason, "audio_failed"),
        eq(storyCreditTransactions.source, "audio_worker"),
      ),
    )
    .limit(1)
  return Boolean(existing)
}

export async function refundAudioFailureOnce(
  database: PostgresJsDatabase<Record<string, unknown>>,
  params: { userId: string; storyId: string; length?: string },
): Promise<void> {
  const [audioStarReserve] = await database
    .select()
    .from(audioStarTransactions)
    .where(
      and(
        eq(audioStarTransactions.userId, params.userId),
        eq(audioStarTransactions.storyId, params.storyId),
        eq(audioStarTransactions.type, "reserve"),
        eq(audioStarTransactions.reason, "audio_reserve"),
        eq(audioStarTransactions.source, "audio_create"),
      ),
    )
    .limit(1)

  const useAudioStar = Boolean(audioStarReserve)
  const alreadyRefunded = await hasAudioRefund(database, {
    userId: params.userId,
    storyId: params.storyId,
    useAudioStar,
  })

  if (alreadyRefunded) {
    return
  }

  if (useAudioStar) {
    await database.insert(audioStarTransactions).values({
      userId: params.userId,
      storyId: params.storyId,
      type: "refund",
      amount: 1, // 1 hang = 1 csillag
      reason: "audio_failed",
      source: "audio_worker",
    })
    return
  }

  const [creditReserve] = await database
    .select({ amount: storyCreditTransactions.amount })
    .from(storyCreditTransactions)
    .where(
      and(
        eq(storyCreditTransactions.userId, params.userId),
        eq(storyCreditTransactions.storyId, params.storyId),
        eq(storyCreditTransactions.type, "reserve"),
        eq(storyCreditTransactions.reason, "audio_reserve"),
        eq(storyCreditTransactions.source, "audio_create"),
      ),
    )
    .limit(1)

  const refundAmount =
    creditReserve?.amount != null
      ? Math.abs(creditReserve.amount)
      : params.length
        ? await calcAudioCost(
            params.length as "short" | "medium" | "long",
            database,
          )
        : 0

  if (refundAmount <= 0) {
    return
  }

  await database.insert(storyCreditTransactions).values({
    userId: params.userId,
    storyId: params.storyId,
    type: "refund",
    amount: refundAmount,
    reason: "audio_failed",
    source: "audio_worker",
  })
}

export function createAudioRepo(
  database: PostgresJsDatabase<Record<string, unknown>>,
): AudioRepo {
  return {
    async getStoryForUser(storyId, userId) {
      const [row] = await database
        .select({
          id: stories.id,
          userId: stories.userId,
          text: stories.text,
          length: stories.length,
          audioUrl: stories.audioUrl,
          audioStatus: stories.audioStatus,
          audioHash: stories.audioHash,
          isInteractive: stories.isInteractive,
        })
        .from(stories)
        .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
        .limit(1)
      return row ?? null
    },
    async getStoryById(storyId) {
      const [row] = await database
        .select({
          id: stories.id,
          userId: stories.userId,
          text: stories.text,
          length: stories.length,
          audioUrl: stories.audioUrl,
          audioStatus: stories.audioStatus,
          audioHash: stories.audioHash,
          isInteractive: stories.isInteractive,
        })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1)
      return row ?? null
    },
    async updateAudio(storyId, payload) {
      await database.update(stories).set(payload).where(eq(stories.id, storyId))
    },
  }
}

type RequestAudioResult =
  | {
      status: 200
      data: { storyId: string; audioStatus: string; audioUrl: string | null }
    }
  | {
      status: 202
      data: { jobId: string; storyId: string; audioStatus: "queued" }
    }
  | { status: 400 | 402 | 404; data: { error: string } }

export async function requestStoryAudio(
  params: { storyId: string; userId: string; force?: boolean; paymentMethod?: "audioStar" | "credits" },
  deps?: {
    repo?: AudioRepo
    enqueue?: (payload: { storyId: string; userId: string; force: boolean }) => Promise<string>
    now?: () => Date
    db?: typeof db
  },
): Promise<RequestAudioResult> {
  const repo = deps?.repo ?? createAudioRepo(db)
  const database = deps?.db ?? db
  const enqueue = deps?.enqueue
  const now = deps?.now ?? (() => new Date())

  const story = await repo.getStoryForUser(params.storyId, params.userId)
  if (!story) return { status: 404, data: { error: "Story not found" } }

  if (story.isInteractive) {
    return { status: 400, data: { error: "Audio generation is not available for interactive stories" } }
  }

  if (!story.text) return { status: 400, data: { error: "Story text missing" } }

  const force = Boolean(params.force)
  const blockedStatuses = new Set(["queued", "generating", "uploaded", "ready"])
  if (!force && blockedStatuses.has(story.audioStatus)) {
    return {
      status: 200,
      data: { storyId: story.id, audioStatus: story.audioStatus, audioUrl: story.audioUrl },
    }
  }

  // Determine payment method: use explicit choice or auto-detect
  const audioStarBalance = await getUserAudioStarBalance(database, params.userId)
  let useAudioStar = false
  
  if (params.paymentMethod === "audioStar") {
    // User explicitly chose audio star
    if (audioStarBalance < 1) {
      return { status: 402, data: { error: "Insufficient audio stars" } }
    }
    useAudioStar = true
  } else if (params.paymentMethod === "credits") {
    // User explicitly chose credits
    useAudioStar = false
  } else {
    // Auto-detect: use audio star if available, otherwise credits
    useAudioStar = audioStarBalance >= 1
  }
  
  // If using credits, check credit balance (old pricing based on length)
  let audioCost = 0
  if (!useAudioStar) {
    audioCost = await calcAudioCost(story.length as "short" | "medium" | "long", database)
    const creditBalance = await getUserCreditBalance(database, params.userId)
    if (creditBalance < audioCost) {
      return { status: 402, data: { error: "Nincs elég mesetallér!" } }
    }
  }

  if (!enqueue) {
    return { status: 400, data: { error: "Audio queue is not configured" } }
  }

  // Reserve payment in transaction
  await database.transaction(async (tx) => {
    if (useAudioStar) {
      // Use 1 audio star
      const txAudioStarBalance = await getUserAudioStarBalance(tx, params.userId)
      if (txAudioStarBalance < 1) {
        throw new Error("Insufficient audio stars")
      }

      await tx.insert(audioStarTransactions).values({
        userId: params.userId,
        storyId: story.id,
        type: "reserve",
        amount: -1, // 1 hang = 1 csillag
        reason: "audio_reserve",
        source: "audio_create",
      })
    } else {
      // Use credits (old pricing)
      const txBalance = await getUserCreditBalance(tx, params.userId)
      if (txBalance < audioCost) {
        throw new Error("Nincs elég mesetallér!")
      }

      await tx.insert(storyCreditTransactions).values({
        userId: params.userId,
        storyId: story.id,
        type: "reserve",
        amount: -audioCost,
        reason: "audio_reserve",
        source: "audio_create",
      })
    }
  })

  const audioHash = computeAudioHash({
    voiceId: AUDIO_VOICE_ID,
    preset: AUDIO_PRESET,
    text: story.text,
  })

  await repo.updateAudio(story.id, {
    audioStatus: "queued",
    audioError: null,
    audioVoiceId: AUDIO_VOICE_ID,
    audioPreset: AUDIO_PRESET,
    audioUpdatedAt: now(),
    audioHash,
    audioUrl: force ? null : story.audioUrl,
  })

  const jobId = await enqueue({
    storyId: story.id,
    userId: params.userId,
    force,
  })

  return { status: 202, data: { jobId, storyId: story.id, audioStatus: "queued" } }
}

export async function processStoryAudioJob(
  params: { storyId: string; userId: string; force?: boolean },
  deps?: {
    repo?: AudioRepo
    elevenlabs?: ElevenLabsClient
    s3?: { uploadBuffer: typeof uploadBuffer; buildPublicUrl: typeof buildPublicUrl }
    now?: () => Date
    db?: typeof db
  },
): Promise<void> {
  const repo = deps?.repo ?? createAudioRepo(db)
  const database = deps?.db ?? db
  const now = deps?.now ?? (() => new Date())
  const story = await repo.getStoryById(params.storyId)

  if (!story || story.userId !== params.userId) {
    throw new Error("Story not found")
  }

  if (!story.text) {
    await refundAudioFailureOnce(database, {
      userId: params.userId,
      storyId: story.id,
      length: story.length,
    })
    await repo.updateAudio(story.id, {
      audioStatus: "failed",
      audioError: "Story text missing",
      audioUpdatedAt: now(),
    })
    return
  }

  const force = Boolean(params.force)
  if (!force && story.audioUrl) {
    await repo.updateAudio(story.id, {
      audioStatus: "ready",
      audioError: null,
      audioUpdatedAt: now(),
    })
    return
  }

  // Calculate audio cost based on story length (fixed pricing from database)
  const audioCost = await calcAudioCost(story.length as "short" | "medium" | "long", database)

  try {
    await repo.updateAudio(story.id, {
      audioStatus: "generating",
      audioError: null,
      audioVoiceId: AUDIO_VOICE_ID,
      audioPreset: AUDIO_PRESET,
      audioUpdatedAt: now(),
    })

    const token = process.env.ELEVENLABS_TOKEN
    if (!token) throw new Error("ELEVENLABS_TOKEN is missing")

    const client =
      deps?.elevenlabs ??
      new ElevenLabsClient({
        apiKey: token,
      })

    const audio = await client.textToSpeech.convert(AUDIO_VOICE_ID, {
      text: story.text,
      modelId: AUDIO_MODEL_ID,
      outputFormat: AUDIO_OUTPUT_FORMAT,
    })

    const audioBuffer = await bufferFromAudio(audio)
    const key = buildAudioKey(story.id)
    const s3Client = deps?.s3 ?? { uploadBuffer, buildPublicUrl }

    await s3Client.uploadBuffer({
      key,
      body: audioBuffer,
      contentType: "audio/mpeg",
      cacheControl: AUDIO_CACHE_CONTROL,
    })

    const audioUrl = s3Client.buildPublicUrl(key)

    await repo.updateAudio(story.id, {
      audioStatus: "uploaded",
      audioUrl,
      audioError: null,
      audioUpdatedAt: now(),
    })

    await repo.updateAudio(story.id, {
      audioStatus: "ready",
      audioError: null,
      audioUpdatedAt: now(),
    })

    // Commit payment (convert reserve to actual charge)
    // Check if audio star was used (reserve transaction exists)
    const [audioStarReserve] = await database
      .select()
      .from(audioStarTransactions)
      .where(
        and(
          eq(audioStarTransactions.userId, params.userId),
          eq(audioStarTransactions.storyId, story.id),
          eq(audioStarTransactions.type, "reserve")
        )
      )
      .limit(1)

    if (audioStarReserve) {
      // Audio star was used, transaction already committed (reserve = -1, no need to do anything)
      // The reserve transaction itself is the charge
    } else {
      // Credits were used, transaction already committed (reserve = -cost, no need to do anything)
      // The reserve transaction itself is the charge
    }
  } catch (error) {
    await refundAudioFailureOnce(database, {
      userId: params.userId,
      storyId: story.id,
      length: story.length,
    })
    await repo.updateAudio(story.id, {
      audioStatus: "failed",
      audioError: error instanceof Error ? error.message : "Unknown error",
      audioUpdatedAt: now(),
    })
    throw error
  }
}

async function bufferFromAudio(audio: unknown): Promise<Buffer> {
  if (!audio) throw new Error("Empty audio response")

  if (audio instanceof Uint8Array) {
    return Buffer.from(audio)
  }

  if (typeof (audio as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function") {
    const buf = await (audio as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer()
    return Buffer.from(buf)
  }

  if (typeof (audio as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (audio as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  }

  if (Symbol.asyncIterator in (audio as object)) {
    const chunks: Buffer[] = []
    for await (const chunk of audio as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  throw new Error("Unsupported audio response format")
}

export function createAudioJobId(): string {
  return randomUUID()
}

export type FreeStoryAudioRow = {
  id: string
  text: string
  audioUrl: string | null
  audioStatus: string
  audioError: string | null
  audioHash: string | null
  audioCharacterCount: number | null
}

export type FreeStoryAudioRepo = {
  getStoryById(storyId: string): Promise<FreeStoryAudioRow | null>
  updateAudio(storyId: string, payload: AudioUpdate): Promise<void>
}

export function createFreeStoryAudioRepo(
  database: PostgresJsDatabase<Record<string, unknown>>,
): FreeStoryAudioRepo {
  return {
    async getStoryById(storyId) {
      const [row] = await database
        .select({
          id: freeStories.id,
          text: freeStories.text,
          audioUrl: freeStories.audioUrl,
          audioStatus: freeStories.audioStatus,
          audioError: freeStories.audioError,
          audioHash: freeStories.audioHash,
          audioCharacterCount: freeStories.audioCharacterCount,
        })
        .from(freeStories)
        .where(eq(freeStories.id, storyId))
        .limit(1)
      return row ?? null
    },
    async updateAudio(storyId, payload) {
      await database.update(freeStories).set(payload).where(eq(freeStories.id, storyId))
    },
  }
}

export async function processFreeStoryAudioJob(
  params: { storyId: string },
  deps?: {
    repo?: FreeStoryAudioRepo
    elevenlabs?: ElevenLabsClient
    s3?: { uploadBuffer: typeof uploadBuffer; buildPublicUrl: typeof buildPublicUrl }
    now?: () => Date
    db?: typeof db
  },
): Promise<void> {
  const repo = deps?.repo ?? createFreeStoryAudioRepo(db)
  const database = deps?.db ?? db
  const now = deps?.now ?? (() => new Date())
  const story = await repo.getStoryById(params.storyId)

  if (!story) {
    throw new Error("Free story not found")
  }

  if (!story.text) {
    await repo.updateAudio(params.storyId, {
      audioStatus: "failed",
      audioError: "Story text missing",
      audioUpdatedAt: now(),
    })
    return
  }

  const force = false // Free stories don't support force regeneration for now
  if (!force && story.audioUrl) {
    await repo.updateAudio(params.storyId, {
      audioStatus: "ready",
      audioError: null,
      audioUpdatedAt: now(),
    })
    return
  }

  // Calculate audio cost based on character count (1 character = 1 credit)
  const characterCount = story.audioCharacterCount ?? story.text.length

  try {
    await repo.updateAudio(params.storyId, {
      audioStatus: "generating",
      audioError: null,
      audioVoiceId: AUDIO_VOICE_ID,
      audioPreset: AUDIO_PRESET,
      audioUpdatedAt: now(),
      audioHash: computeAudioHash({
        voiceId: AUDIO_VOICE_ID,
        preset: AUDIO_PRESET,
        text: story.text,
      }),
    })

    const token = process.env.ELEVENLABS_TOKEN
    if (!token) throw new Error("ELEVENLABS_TOKEN is missing")

    const client =
      deps?.elevenlabs ??
      new ElevenLabsClient({
        apiKey: token,
      })

    const audio = await client.textToSpeech.convert(AUDIO_VOICE_ID, {
      text: story.text,
      modelId: AUDIO_MODEL_ID,
      outputFormat: AUDIO_OUTPUT_FORMAT,
    })

    const audioBuffer = await bufferFromAudio(audio)
    const key = buildFreeStoryAudioKey(story.id)
    const s3Client = deps?.s3 ?? { uploadBuffer, buildPublicUrl }

    await s3Client.uploadBuffer({
      key,
      body: audioBuffer,
      contentType: "audio/mpeg",
      cacheControl: AUDIO_CACHE_CONTROL,
    })

    const audioUrl = s3Client.buildPublicUrl(key)

    await repo.updateAudio(params.storyId, {
      audioStatus: "ready",
      audioUrl,
      audioError: null,
      audioUpdatedAt: now(),
    })
  } catch (error) {
    await repo.updateAudio(params.storyId, {
      audioStatus: "failed",
      audioError: error instanceof Error ? error.message : "Unknown error",
      audioUpdatedAt: now(),
    })
    throw error
  }
}
