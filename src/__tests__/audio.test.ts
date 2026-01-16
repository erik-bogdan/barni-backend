import { describe, expect, test } from "bun:test"

import {
  buildAudioKey,
  processStoryAudioJob,
  requestStoryAudio,
  type AudioRepo,
} from "../services/audio"

describe("audio helpers", () => {
  test("buildAudioKey returns deterministic key", () => {
    expect(buildAudioKey("story-123")).toBe("stories/story-123/audio.mp3")
  })
})

describe("requestStoryAudio", () => {
  test("returns existing audio when ready and force=false", async () => {
    const repo: AudioRepo = {
      getStoryForUser: async () => ({
        id: "story-1",
        userId: "user-1",
        text: "Mese szöveg",
        audioUrl: "https://assets.test/stories/story-1/audio.mp3",
        audioStatus: "ready",
        audioHash: "hash",
      }),
      getStoryById: async () => null,
      updateAudio: async () => {
        throw new Error("updateAudio should not be called")
      },
    }

    const result = await requestStoryAudio(
      { storyId: "story-1", userId: "user-1", force: false },
      { repo, enqueue: async () => "job-1" },
    )

    expect(result.status).toBe(200)
    if (result.status === 200) {
      expect(result.data.audioStatus).toBe("ready")
      expect(result.data.audioUrl).toContain("audio.mp3")
    }
  })
})

describe("processStoryAudioJob", () => {
  test("skips generation when audio exists and force=false", async () => {
    const updates: Array<{ audioStatus?: string }> = []
    let elevenCalled = false
    let uploadCalled = false

    const repo: AudioRepo = {
      getStoryForUser: async () => null,
      getStoryById: async () => ({
        id: "story-1",
        userId: "user-1",
        text: "Mese szöveg",
        audioUrl: "https://assets.test/stories/story-1/audio.mp3",
        audioStatus: "ready",
        audioHash: "hash",
      }),
      updateAudio: async (_id, payload) => {
        updates.push({ audioStatus: payload.audioStatus })
      },
    }

    await processStoryAudioJob(
      { storyId: "story-1", userId: "user-1", force: false },
      {
        repo,
        elevenlabs: new Proxy(
          {},
          {
            get: () => {
              elevenCalled = true
              return () => undefined
            },
          },
        ) as never,
        s3: {
          uploadBuffer: async () => {
            uploadCalled = true
          },
          buildPublicUrl: () => "https://assets.test/stories/story-1/audio.mp3",
        },
      },
    )

    expect(updates.some((u) => u.audioStatus === "ready")).toBe(true)
    expect(elevenCalled).toBe(false)
    expect(uploadCalled).toBe(false)
  })
})
