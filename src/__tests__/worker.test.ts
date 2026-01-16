import { describe, expect, test } from "bun:test"

import { processStoryJob } from "../jobs/processors/story"

describe("processStoryJob", () => {
  test("walks through status transitions and sets preview", async () => {
    const statuses: string[] = []
    let previewUrl = ""

    const repo = {
      getStory: async () => ({
        id: "story-1",
        userId: "user-1",
        childId: "child-1",
        status: "queued",
        theme: "erdő",
        mood: "nyugodt",
        length: "short",
        lesson: null,
        creditCost: 25,
      }),
      getChild: async () => ({ id: "child-1", age: 6 }),
      getRecentFingerprints: async () => [
        { setting: "tenger", conflict: "vihar", tone: "nyugodt" },
      ],
      updateStatus: async (_id: string, status: string) => {
        statuses.push(status)
      },
      saveStoryContent: async () => {},
      savePreview: async (_id: string, payload: { previewUrl: string }) => {
        previewUrl = payload.previewUrl
      },
      refundCredits: async () => {},
    }

    const openai = {
      generateStoryText: async () => "Egy nyugodt mese...",
      extractStoryMeta: async () => ({
        title: "Csendes erdő",
        summary: "Egy békés történet.",
        setting: "erdő",
        conflict: "félreértés",
        tone: "nyugodt",
      }),
    }

    const cover = {
      generateCoverBuffer: async () => Buffer.from("fake"),
    }

    const s3 = {
      uploadBuffer: async () => {},
      buildPublicUrl: () => "https://assets.test/stories/story-1/preview.webp",
    }

    await processStoryJob("story-1", { repo, openai, cover, s3 })

    expect(statuses).toEqual([
      "generating_text",
      "extracting_meta",
      "generating_cover",
      "uploading_cover",
    ])
    expect(previewUrl).toContain("preview.webp")
  })
})

