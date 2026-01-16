"use strict"

import { createHash, randomUUID } from "node:crypto"

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js"
import { eq, and } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

import { stories, storyCreditTransactions } from "../../packages/db/src/schema"
import { db } from "../lib/db"
import { buildPublicUrl, uploadBuffer } from "./s3"
import { calcAudioCost, getUserCreditBalance } from "./credits"
import { eq, sql } from "drizzle-orm"

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
  params: { storyId: string; userId: string; force?: boolean },
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

  if (!story.text) return { status: 400, data: { error: "Story text missing" } }

  const force = Boolean(params.force)
  const blockedStatuses = new Set(["queued", "generating", "uploaded", "ready"])
  if (!force && blockedStatuses.has(story.audioStatus)) {
    return {
      status: 200,
      data: { storyId: story.id, audioStatus: story.audioStatus, audioUrl: story.audioUrl },
    }
  }

  // Calculate audio cost and reserve credits
  const audioCost = calcAudioCost(story.length as "short" | "medium" | "long")
  const balance = await getUserCreditBalance(database, params.userId)
  if (balance < audioCost) {
    return { status: 402, data: { error: "Insufficient credits" } }
  }

  if (!enqueue) {
    return { status: 400, data: { error: "Audio queue is not configured" } }
  }

  // Reserve credits in transaction
  await database.transaction(async (tx) => {
    const txBalance = await getUserCreditBalance(tx, params.userId)
    if (txBalance < audioCost) {
      throw new Error("Insufficient credits")
    }

    await tx.insert(storyCreditTransactions).values({
      userId: params.userId,
      storyId: story.id,
      type: "reserve",
      amount: -audioCost,
      reason: "audio_reserve",
      source: "audio_create",
    })
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
    // Refund credits on failure
    const audioCost = calcAudioCost(story.length as "short" | "medium" | "long")
    await database.insert(storyCreditTransactions).values({
      userId: params.userId,
      storyId: story.id,
      type: "refund",
      amount: audioCost,
      reason: "audio_failed",
      source: "audio_worker",
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

  const audioCost = calcAudioCost(story.length as "short" | "medium" | "long")

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

    // Commit credits (convert reserve to actual charge)
    // In a real system, you might want to mark the reserve as committed
    // For simplicity, we'll just ensure the transaction exists
  } catch (error) {
    // Refund credits on failure
    await database.insert(storyCreditTransactions).values({
      userId: params.userId,
      storyId: story.id,
      type: "refund",
      amount: audioCost,
      reason: "audio_failed",
      source: "audio_worker",
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
