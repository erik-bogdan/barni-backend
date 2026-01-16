import { describe, expect, test } from "bun:test"

import { buildStoryPrompt } from "../services/storyPrompt"

describe("buildStoryPrompt", () => {
  test("includes avoid list pairs", () => {
    const prompt = buildStoryPrompt({
      childAge: 6,
      mood: "nyugodt",
      length: "short",
      theme: "erdő",
      lesson: "kedvesség",
      avoidPairs: [
        { setting: "erdő", conflict: "elveszik" },
        { setting: "tenger", conflict: "vihar" },
      ],
    })

    expect(prompt).toContain("erdő / elveszik")
    expect(prompt).toContain("tenger / vihar")
  })
})

